/**
 * Model Context Protocol (MCP) Connector Bridge Service
 *
 * Manages durable per-user external MCP server registrations (GitHub, Notion, Linear, Slack,
 * Postgres/databases, custom MCP servers), encrypts auth credentials at rest, discovers tools
 * and resources dynamically via `McpHttpClient`, and routes tool calls through PermissionsGateway
 * with full durable security audit logging.
 */

import crypto from 'node:crypto';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from '../infrastructure/durableCollectionStore';
import {
  permissionsGateway,
  type PermissionsGatewayService,
} from '../permissionsGateway';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
  type PersistenceMode,
} from '../sandbox/durableStore';
import {
  redactSensitiveExecutionText,
  validateBrowserNavigationUrlWithDns,
} from '../sandbox/security';
import { defaultLiveSyncHub, type LiveSyncHub } from '../realtime/liveSyncHub';
import {
  McpClientError,
  McpHttpClient,
  type McpPromptSchema,
  type McpResourceSchema,
  type McpToolSchema,
} from './mcpClient';

export type McpAuthType = 'none' | 'bearer' | 'api_key_header' | 'custom_headers';

interface EncryptedSecretBox {
  iv: string;
  encryptedData: string;
  authTag: string;
}

export interface McpServerRecord {
  serverId: string;
  userId: string;
  name: string;
  slug: string;
  description?: string;
  endpointUrl: string;
  authType: McpAuthType;
  authHeaderName?: string;
  encryptedAuthPayload?: EncryptedSecretBox;
  devAuthPayload?: string;
  enabled: boolean;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  tools: McpToolSchema[];
  resources: McpResourceSchema[];
  prompts: McpPromptSchema[];
  lastDiscoveredAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicMcpServer = Omit<McpServerRecord, 'encryptedAuthPayload' | 'devAuthPayload'> & {
  hasAuthCredentials: boolean;
};

export interface DiscoveredMcpToolEntry {
  qualifiedName: string;
  serverId: string;
  serverSlug: string;
  serverName: string;
  toolName: string;
  description: string;
  riskLevel: 'read-only' | 'moderate' | 'privileged' | 'destructive';
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export class McpBridgeError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'MCP_BRIDGE_ERROR', statusCode = 400) {
    super(message);
    this.name = 'McpBridgeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const MCP_SERVERS_COLLECTION = 'mcp_servers';

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  Boolean(process.env.NETLIFY) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

function resolveMcpEncryptionKey(): Buffer | null {
  const secret = (process.env.TOKEN_ENCRYPTION_SECRET || '').trim();
  if (secret.length >= 32) {
    return crypto.scryptSync(secret, 'deku-mcp-auth-v1', 32);
  }
  return null;
}

function sealAuthPayload(headers: Record<string, string>): {
  encryptedAuthPayload?: EncryptedSecretBox;
  devAuthPayload?: string;
} {
  const json = JSON.stringify(headers);
  const key = resolveMcpEncryptionKey();
  if (key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encryptedData = cipher.update(json, 'utf8', 'hex');
    encryptedData += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return {
      encryptedAuthPayload: { iv: iv.toString('hex'), encryptedData, authTag },
    };
  }
  if (IS_PRODUCTION) {
    throw new McpBridgeError(
      'TOKEN_ENCRYPTION_SECRET (min 32 chars) must be configured in production to store MCP server credentials.',
      'ENCRYPTION_SECRET_REQUIRED',
      503,
    );
  }
  return { devAuthPayload: json };
}

function unsealAuthPayload(record: McpServerRecord): Record<string, string> {
  if (record.encryptedAuthPayload) {
    const key = resolveMcpEncryptionKey();
    if (!key) return {};
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(record.encryptedAuthPayload.iv, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(record.encryptedAuthPayload.authTag, 'hex'));
      let plain = decipher.update(record.encryptedAuthPayload.encryptedData, 'hex', 'utf8');
      plain += decipher.final('utf8');
      const parsed = JSON.parse(plain);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (record.devAuthPayload) {
    try {
      const parsed = JSON.parse(record.devAuthPayload);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function sanitizeServer(record: McpServerRecord): PublicMcpServer {
  const { encryptedAuthPayload, devAuthPayload, ...rest } = record;
  return {
    ...rest,
    hasAuthCredentials: Boolean(encryptedAuthPayload || devAuthPayload),
  };
}

function toSlug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return cleaned || 'mcp_server';
}

function classifyMcpToolRisk(tool: McpToolSchema): 'read-only' | 'moderate' | 'privileged' | 'destructive' {
  if (tool.annotations?.destructiveHint) return 'destructive';
  if (tool.annotations?.readOnlyHint) return 'read-only';
  const tokens = tool.name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  const destructiveWords = ['delete', 'drop', 'remove', 'destroy', 'purge', 'truncate', 'revoke', 'terminate'];
  if (destructiveWords.some((w) => tokenSet.has(w))) {
    return 'destructive';
  }
  const privilegedWords = ['exec', 'execute', 'run', 'shell', 'sql', 'mutate', 'deploy', 'push', 'merge', 'charge', 'pay', 'transfer', 'send'];
  if (privilegedWords.some((w) => tokenSet.has(w))) {
    return 'privileged';
  }
  const readOnlyWords = ['get', 'list', 'search', 'find', 'read', 'fetch', 'describe', 'inspect', 'query', 'view', 'show'];
  if (readOnlyWords.some((w) => tokenSet.has(w))) {
    return 'read-only';
  }
  return 'moderate';
}

export interface McpBridgeServiceOptions {
  store?: DurableCollectionStore;
  auditStore?: DurableExecutionStore;
  permissions?: PermissionsGatewayService;
  syncHub?: LiveSyncHub;
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
}

export class McpBridgeService {
  private readonly store: DurableCollectionStore;
  private readonly auditStore: DurableExecutionStore;
  private readonly permissions: PermissionsGatewayService;
  private readonly syncHub: LiveSyncHub;
  private readonly fetchImpl: typeof fetch;
  private readonly skipDnsLookup: boolean;

  constructor(options?: McpBridgeServiceOptions) {
    this.store = options?.store ?? defaultCollectionStore;
    this.auditStore = options?.auditStore ?? defaultDurableStore;
    this.permissions = options?.permissions ?? permissionsGateway;
    this.syncHub = options?.syncHub ?? defaultLiveSyncHub;
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.skipDnsLookup = Boolean(options?.skipDnsLookup);
  }

  public getHealth(ctx?: DurableRequestContext): {
    persistenceMode: PersistenceMode;
    transport: string;
    protocolVersion: string;
  } {
    return {
      persistenceMode: this.store.getMode(ctx),
      transport: 'streamable-http-sse',
      protocolVersion: '2025-03-26',
    };
  }

  private createClient(record: McpServerRecord): McpHttpClient {
    const authHeaders = unsealAuthPayload(record);
    return new McpHttpClient({
      endpointUrl: record.endpointUrl,
      headers: authHeaders,
      fetchImpl: this.fetchImpl,
      skipDnsLookup: this.skipDnsLookup,
    });
  }

  /**
   * Register a remote MCP server, validate SSRF safety, encrypt auth headers,
   * and optionally run immediate live tool/resource discovery.
   */
  public async registerServer(
    ctx: DurableRequestContext,
    input: {
      name: string;
      endpointUrl: string;
      description?: string;
      authType?: McpAuthType;
      authToken?: string;
      authHeaderName?: string;
      headers?: Record<string, string>;
      autoDiscover?: boolean;
    },
  ): Promise<{ server: PublicMcpServer; discovered: boolean; discoveryError?: string }> {
    const name = String(input.name || '').trim().slice(0, 120);
    const rawUrl = String(input.endpointUrl || '').trim();
    if (!name || !rawUrl) {
      throw new McpBridgeError('name and endpointUrl are required.', 'INVALID_MCP_SERVER', 400);
    }

    const urlCheck = await validateBrowserNavigationUrlWithDns(rawUrl, {
      skipDnsLookup: this.skipDnsLookup,
    });
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      throw new McpBridgeError(
        urlCheck.error || 'MCP server URL rejected by SSRF network security policy.',
        'MCP_SSRF_BLOCKED',
        400,
      );
    }

    const authType: McpAuthType =
      input.authType && ['none', 'bearer', 'api_key_header', 'custom_headers'].includes(input.authType)
        ? input.authType
        : input.authToken
          ? 'bearer'
          : input.headers && Object.keys(input.headers).length > 0
            ? 'custom_headers'
            : 'none';

    const resolvedAuthHeaders: Record<string, string> = {};
    if (authType === 'bearer' && input.authToken?.trim()) {
      resolvedAuthHeaders.Authorization = `Bearer ${input.authToken.trim()}`;
    } else if (authType === 'api_key_header' && input.authToken?.trim()) {
      const headerName = (input.authHeaderName || 'X-API-Key').trim();
      if (!/^[a-zA-Z0-9-]+$/.test(headerName)) {
        throw new McpBridgeError('Invalid authHeaderName.', 'INVALID_HEADER_NAME', 400);
      }
      resolvedAuthHeaders[headerName] = input.authToken.trim();
    } else if (authType === 'custom_headers' && input.headers) {
      for (const [k, v] of Object.entries(input.headers).slice(0, 10)) {
        if (/^[a-zA-Z0-9-]+$/.test(k.trim())) {
          resolvedAuthHeaders[k.trim()] = String(v).slice(0, 1000);
        }
      }
    }

    const sealed =
      Object.keys(resolvedAuthHeaders).length > 0
        ? sealAuthPayload(resolvedAuthHeaders)
        : {};

    const nowIso = new Date().toISOString();
    const serverId = `mcp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const record: McpServerRecord = {
      serverId,
      userId: ctx.userId,
      name,
      slug: toSlug(name),
      description: input.description?.slice(0, 400),
      endpointUrl: urlCheck.normalizedUrl,
      authType,
      authHeaderName: input.authHeaderName?.slice(0, 64),
      encryptedAuthPayload: sealed.encryptedAuthPayload,
      devAuthPayload: sealed.devAuthPayload,
      enabled: true,
      tools: [],
      resources: [],
      prompts: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.put(ctx, MCP_SERVERS_COLLECTION, serverId, record);

    let discovered = false;
    let discoveryError: string | undefined;
    if (input.autoDiscover !== false) {
      try {
        const updated = await this.discoverServer(ctx, serverId);
        return { server: updated, discovered: true };
      } catch (err) {
        discoveryError = err instanceof Error ? err.message : 'Initial MCP discovery failed.';
        record.lastError = discoveryError.slice(0, 400);
        await this.store.put(ctx, MCP_SERVERS_COLLECTION, serverId, record);
      }
    }

    await this.permissions.recordSecurityAuditDurable(
      ctx,
      {
        action: 'register_mcp_server',
        category: 'external_api_access',
        resourceId: serverId,
        status: 'succeeded',
        details: { name, host: urlCheck.hostname, authType },
      },
      this.auditStore,
    );

    return { server: sanitizeServer(record), discovered, discoveryError };
  }

  public async listServers(ctx: DurableRequestContext): Promise<PublicMcpServer[]> {
    const all = await this.store.list<McpServerRecord>(ctx, MCP_SERVERS_COLLECTION, 100);
    return all
      .filter((s) => s.userId === ctx.userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(sanitizeServer);
  }

  public async deleteServer(ctx: DurableRequestContext, serverId: string): Promise<boolean> {
    const existing = await this.store.get<McpServerRecord>(ctx, MCP_SERVERS_COLLECTION, serverId);
    if (!existing || existing.userId !== ctx.userId) return false;
    await this.store.delete(ctx, MCP_SERVERS_COLLECTION, serverId);
    return true;
  }

  /**
   * Perform live MCP protocol handshake (`initialize`) and fetch `tools/list`, `resources/list`, `prompts/list`.
   */
  public async discoverServer(ctx: DurableRequestContext, serverId: string): Promise<PublicMcpServer> {
    const existing = await this.store.get<McpServerRecord>(ctx, MCP_SERVERS_COLLECTION, serverId);
    if (!existing || existing.userId !== ctx.userId) {
      throw new McpBridgeError('MCP server not found.', 'MCP_SERVER_NOT_FOUND', 404);
    }

    const client = this.createClient(existing);
    try {
      const initRes = await client.initialize();
      const [tools, resources, prompts] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listPrompts(),
      ]);

      const nowIso = new Date().toISOString();
      existing.protocolVersion = initRes.protocolVersion;
      existing.serverInfo = initRes.serverInfo;
      existing.tools = tools.slice(0, 100);
      existing.resources = resources.slice(0, 100);
      existing.prompts = prompts.slice(0, 50);
      existing.lastDiscoveredAt = nowIso;
      existing.lastError = undefined;
      existing.updatedAt = nowIso;

      await this.store.put(ctx, MCP_SERVERS_COLLECTION, serverId, existing);

      void this.syncHub.publish(ctx, {
        type: 'mcp:tools_updated',
        title: `MCP Server Connected: ${existing.name}`,
        message: `Discovered ${existing.tools.length} tool(s) and ${existing.resources.length} resource(s).`,
        resourceId: serverId,
        severity: 'success',
        notifyUser: false,
        persist: false,
        data: { serverId, toolCount: existing.tools.length, resourceCount: existing.resources.length },
      });

      return sanitizeServer(existing);
    } catch (err) {
      const msg = redactSensitiveExecutionText(
        err instanceof Error ? err.message : 'MCP discovery failed.',
      );
      existing.lastError = msg.slice(0, 400);
      existing.updatedAt = new Date().toISOString();
      await this.store.put(ctx, MCP_SERVERS_COLLECTION, serverId, existing);
      if (err instanceof McpClientError) {
        throw new McpBridgeError(msg, err.code, err.statusCode);
      }
      throw new McpBridgeError(msg, 'MCP_DISCOVERY_FAILED', 502);
    }
  }

  /**
   * Returns a flat catalog of all discovered tools across the user's enabled MCP servers,
   * ready for injection into Deku AI's unified ToolRegistryService.
   */
  public async listAllDiscoveredTools(ctx: DurableRequestContext): Promise<DiscoveredMcpToolEntry[]> {
    const servers = await this.store.list<McpServerRecord>(ctx, MCP_SERVERS_COLLECTION, 100);
    const out: DiscoveredMcpToolEntry[] = [];

    for (const srv of servers) {
      if (srv.userId !== ctx.userId || !srv.enabled) continue;
      for (const tool of srv.tools || []) {
        const safeToolName = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        out.push({
          qualifiedName: `mcp__${srv.slug}__${safeToolName}`,
          serverId: srv.serverId,
          serverSlug: srv.slug,
          serverName: srv.name,
          toolName: tool.name,
          description: tool.description || `MCP tool '${tool.name}' on ${srv.name}`,
          riskLevel: classifyMcpToolRisk(tool),
          inputSchema: {
            type: tool.inputSchema?.type || 'object',
            properties: tool.inputSchema?.properties || {},
            required: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [],
          },
        });
      }
    }
    return out;
  }

  /**
   * Execute a tool on a registered MCP server with permission-gateway gating and audit logging.
   */
  public async callServerTool(
    ctx: DurableRequestContext,
    input: {
      serverId: string;
      toolName: string;
      args?: Record<string, unknown>;
      approvalToken?: string;
    },
  ): Promise<{
    ok: boolean;
    requiresApproval?: boolean;
    challenge?: unknown;
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    structuredContent?: unknown;
    textSummary: string;
    isError?: boolean;
  }> {
    const server = await this.store.get<McpServerRecord>(ctx, MCP_SERVERS_COLLECTION, input.serverId);
    if (!server || server.userId !== ctx.userId) {
      throw new McpBridgeError('MCP server not found.', 'MCP_SERVER_NOT_FOUND', 404);
    }
    if (!server.enabled) {
      throw new McpBridgeError('MCP server is disabled.', 'MCP_SERVER_DISABLED', 403);
    }

    const toolMeta = (server.tools || []).find((t) => t.name === input.toolName);
    const riskLevel = toolMeta ? classifyMcpToolRisk(toolMeta) : 'privileged';

    // Destructive or privileged MCP tools require explicit user approval token unless policy allows
    if (riskLevel === 'destructive' || riskLevel === 'privileged') {
      const policyActionName = `mcp:${server.slug}:${input.toolName}`;
      const evalRes = await this.permissions.evaluateActionDurable(
        {
          toolName: policyActionName,
          args: { serverId: server.serverId, toolName: input.toolName, args: input.args || {} },
          userId: ctx.userId,
          target: `${server.name} (${input.toolName})`,
          approvalToken: input.approvalToken,
          forceConfirmation: riskLevel === 'destructive',
        },
        ctx,
        this.auditStore,
      );

      if (!evalRes.allowed) {
        if (evalRes.requiresApproval && evalRes.challenge) {
          void this.syncHub.publish(ctx, {
            type: 'approval:required',
            title: `Approval Required: ${server.name} (${input.toolName})`,
            message: evalRes.reason,
            challengeId: evalRes.challenge.challengeId,
            severity: 'warning',
            notifyUser: true,
            data: { serverId: server.serverId, toolName: input.toolName, riskLevel },
          });
          return {
            ok: false,
            requiresApproval: true,
            challenge: evalRes.challenge,
            textSummary: evalRes.reason,
          };
        }
        throw new McpBridgeError(evalRes.reason || 'MCP tool call denied by security policy.', 'MCP_DENIED', 403);
      }
    }

    const client = this.createClient(server);
    try {
      await client.initialize();
      const result = await client.callTool(input.toolName, input.args || {});

      const textParts = result.content
        .map((c) => (c.type === 'text' && c.text ? c.text : c.mimeType ? `[${c.mimeType} payload]` : ''))
        .filter(Boolean);
      const textSummary = redactSensitiveExecutionText(
        textParts.join('\n') ||
          (result.structuredContent ? JSON.stringify(result.structuredContent).slice(0, 4000) : 'MCP tool executed.'),
      );

      await this.permissions.recordSecurityAuditDurable(
        ctx,
        {
          action: `mcp_call:${server.slug}:${input.toolName}`,
          category: 'external_api_access',
          resourceId: server.serverId,
          status: result.isError ? 'failed' : 'succeeded',
          details: { serverName: server.name, toolName: input.toolName, riskLevel },
        },
        this.auditStore,
      );

      return {
        ok: !result.isError,
        content: result.content,
        structuredContent: result.structuredContent,
        textSummary,
        isError: result.isError,
      };
    } catch (err) {
      const msg = redactSensitiveExecutionText(
        err instanceof Error ? err.message : 'MCP tool execution failed.',
      );
      await this.permissions.recordSecurityAuditDurable(
        ctx,
        {
          action: `mcp_call:${server.slug}:${input.toolName}`,
          category: 'external_api_access',
          resourceId: server.serverId,
          status: 'failed',
          details: { serverName: server.name, toolName: input.toolName, error: msg.slice(0, 300) },
        },
        this.auditStore,
      );
      if (err instanceof McpClientError) {
        throw new McpBridgeError(msg, err.code, err.statusCode);
      }
      throw new McpBridgeError(msg, 'MCP_CALL_FAILED', 502);
    }
  }

  public async readServerResource(
    ctx: DurableRequestContext,
    input: { serverId: string; uri: string },
  ): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    const server = await this.store.get<McpServerRecord>(ctx, MCP_SERVERS_COLLECTION, input.serverId);
    if (!server || server.userId !== ctx.userId) {
      throw new McpBridgeError('MCP server not found.', 'MCP_SERVER_NOT_FOUND', 404);
    }
    const client = this.createClient(server);
    await client.initialize();
    return client.readResource(input.uri);
  }
}

export const defaultMcpBridgeService = new McpBridgeService();
