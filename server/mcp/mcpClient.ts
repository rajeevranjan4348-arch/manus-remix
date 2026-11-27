/**
 * Model Context Protocol (MCP) Streamable HTTP / SSE JSON-RPC 2.0 Client
 *
 * Speaks the standard MCP 2024-11-05 / 2025-03-26 JSON-RPC 2.0 protocol over HTTP:
 * - Handshake: `initialize` + `notifications/initialized` (capturing `Mcp-Session-Id`)
 * - Discovery: `tools/list`, `resources/list`, `prompts/list`
 * - Execution: `tools/call`, `resources/read`
 * - Parses both `application/json` and `text/event-stream` (SSE) responses
 * - Enforces strict SSRF protection on every remote MCP server request.
 */

import {
  redactSensitiveExecutionText,
  validateBrowserNavigationUrlWithDns,
} from '../sandbox/security';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpResourceSchema {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptSchema {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpServerCapabilities {
  tools?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
}

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: McpServerCapabilities;
  sessionId?: string;
}

export interface McpClientOptions {
  endpointUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
}

export class McpClientError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'MCP_CLIENT_ERROR', statusCode = 502) {
    super(message);
    this.name = 'McpClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * Extracts JSON-RPC response payloads from either plain JSON or Server-Sent Events (SSE) streams.
 */
function parseMcpResponseBody(rawText: string, contentType: string, expectedId: number): JsonRpcResponse {
  const lowerCt = (contentType || '').toLowerCase();
  if (lowerCt.includes('text/event-stream') || rawText.trimStart().startsWith('event:') || rawText.trimStart().startsWith('data:')) {
    const frames = rawText.split(/\r?\n\r?\n/);
    let lastValid: JsonRpcResponse | null = null;
    for (const frame of frames) {
      const dataLines = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== '[DONE]');
      if (dataLines.length === 0) continue;
      const joined = dataLines.join('\n');
      try {
        const parsed = JSON.parse(joined) as JsonRpcResponse;
        lastValid = parsed;
        if (parsed.id === expectedId || parsed.result !== undefined || parsed.error !== undefined) {
          return parsed;
        }
      } catch {
        // Skip non-JSON SSE comments or keep-alives
      }
    }
    if (lastValid) return lastValid;
    throw new McpClientError('MCP SSE response contained no valid JSON-RPC payload.', 'MCP_INVALID_SSE', 502);
  }

  try {
    return JSON.parse(rawText) as JsonRpcResponse;
  } catch {
    throw new McpClientError('MCP server returned invalid JSON.', 'MCP_INVALID_JSON', 502);
  }
}

export class McpHttpClient {
  private readonly endpointUrl: string;
  private readonly customHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly skipDnsLookup: boolean;
  private sessionId?: string;
  private nextId = 1;

  constructor(options: McpClientOptions) {
    this.endpointUrl = options.endpointUrl.trim();
    this.customHeaders = options.headers ? { ...options.headers } : {};
    this.timeoutMs = Math.min(60_000, Math.max(2_000, options.timeoutMs ?? Number(process.env.MCP_REQUEST_TIMEOUT_MS || 15_000)));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.skipDnsLookup = Boolean(options.skipDnsLookup);
  }

  private async ensureSafeEndpoint(): Promise<string> {
    const check = await validateBrowserNavigationUrlWithDns(this.endpointUrl, {
      skipDnsLookup: this.skipDnsLookup,
    });
    if (!check.valid || !check.normalizedUrl) {
      throw new McpClientError(
        check.error || 'MCP server URL rejected by SSRF network security policy.',
        'MCP_SSRF_BLOCKED',
        400,
      );
    }
    return check.normalizedUrl;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'Deku-AI-MCP-Client/1.0',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    };
    for (const [k, v] of Object.entries(this.customHeaders)) {
      if (!/^(host|content-length|transfer-encoding|connection)$/i.test(k)) {
        headers[k] = v;
      }
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }
    return headers;
  }

  public async request<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    const targetUrl = await this.ensureSafeEndpoint();
    const id = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    let res: Response;
    try {
      res = await this.fetchImpl(targetUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new McpClientError(
        redactSensitiveExecutionText(
          err instanceof Error ? `MCP transport failed: ${err.message}` : 'MCP transport failed.',
        ),
        'MCP_TRANSPORT_ERROR',
        502,
      );
    }

    const sessionHeader = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
    if (sessionHeader) {
      this.sessionId = sessionHeader.trim();
    }

    if (!res.ok) {
      const errSnippet = redactSensitiveExecutionText((await res.text().catch(() => '')).slice(0, 300));
      throw new McpClientError(
        `MCP server returned HTTP ${res.status}${errSnippet ? `: ${errSnippet}` : ''}`,
        'MCP_HTTP_ERROR',
        res.status >= 400 && res.status < 600 ? res.status : 502,
      );
    }

    const rawText = await res.text();
    const parsed = parseMcpResponseBody(rawText, res.headers.get('content-type') || '', id);
    if (parsed.error) {
      throw new McpClientError(
        redactSensitiveExecutionText(parsed.error.message || `MCP error code ${parsed.error.code}`),
        'MCP_RPC_ERROR',
        400,
      );
    }
    return parsed.result as T;
  }

  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    try {
      const targetUrl = await this.ensureSafeEndpoint();
      await this.fetchImpl(targetUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          ...(params !== undefined ? { params } : {}),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(5000, this.timeoutMs)),
      });
    } catch {
      // Notifications are best-effort per JSON-RPC 2.0 spec
    }
  }

  public async initialize(): Promise<McpInitializeResult> {
    const result = await this.request<McpInitializeResult>('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: false },
      },
      clientInfo: {
        name: 'deku-ai-mcp-bridge',
        version: '1.0.0',
      },
    });
    await this.notify('notifications/initialized', {});
    return {
      protocolVersion: result?.protocolVersion || MCP_PROTOCOL_VERSION,
      serverInfo: result?.serverInfo,
      capabilities: result?.capabilities,
      sessionId: this.sessionId,
    };
  }

  public async listTools(): Promise<McpToolSchema[]> {
    const result = await this.request<{ tools?: McpToolSchema[] }>('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  public async callTool(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean; structuredContent?: unknown }> {
    const result = await this.request<{
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
      structuredContent?: unknown;
    }>('tools/call', {
      name: toolName,
      arguments: args,
    });
    return {
      content: Array.isArray(result?.content) ? result.content : [],
      isError: Boolean(result?.isError),
      structuredContent: result?.structuredContent,
    };
  }

  public async listResources(): Promise<McpResourceSchema[]> {
    try {
      const result = await this.request<{ resources?: McpResourceSchema[] }>('resources/list', {});
      return Array.isArray(result?.resources) ? result.resources : [];
    } catch {
      return [];
    }
  }

  public async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    const result = await this.request<{ contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }>(
      'resources/read',
      { uri },
    );
    return {
      contents: Array.isArray(result?.contents) ? result.contents : [],
    };
  }

  public async listPrompts(): Promise<McpPromptSchema[]> {
    try {
      const result = await this.request<{ prompts?: McpPromptSchema[] }>('prompts/list', {});
      return Array.isArray(result?.prompts) ? result.prompts : [];
    } catch {
      return [];
    }
  }
}
