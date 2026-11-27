/**
 * Netlify Serverless Function: MCP (Model Context Protocol) Connector Bridge API
 * Routes: /api/mcp/* and /.netlify/functions/mcp/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import {
  defaultMcpBridgeService,
  McpBridgeError,
  type McpBridgeService,
} from '../../server/mcp/mcpBridgeService';
import type { DurableRequestContext } from '../../server/sandbox/durableStore';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
import { verifyBearerToken } from '../../src/middleware/auth';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return undefined;
  const token = auth.slice(7).trim();
  if (!token || token.startsWith('guest_')) return undefined;
  return token;
}

async function readJsonBody(req: Request, maxBytes = 128 * 1024) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'MCP payload exceeds 128KB limit.' }, 413),
    };
  }
  if (!raw.trim()) return { ok: true as const, data: {} as Record<string, any> };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected JSON object body.' }, 400),
      };
    }
    return { ok: true as const, data: parsed as Record<string, any> };
  } catch {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

export async function handleMcpRequest(
  req: Request,
  bridge: McpBridgeService = defaultMcpBridgeService,
): Promise<Response> {
  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/mcp/, '')
      .replace(/^\/api\/mcp/, '') || '/';

  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`mcp:${decoded.uid}`, 90, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for MCP API.' }, 429);
  }

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && subPath === '/health') {
      return jsonResponse({ ok: true, ...bridge.getHealth(ctx) });
    }

    if (req.method === 'GET' && (subPath === '/servers' || subPath === '/')) {
      const servers = await bridge.listServers(ctx);
      return jsonResponse({ ok: true, servers });
    }

    if (req.method === 'POST' && (subPath === '/servers/register' || subPath === '/servers')) {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const result = await bridge.registerServer(ctx, {
        name: typeof body.name === 'string' ? body.name : '',
        endpointUrl: typeof body.endpointUrl === 'string' ? body.endpointUrl : '',
        description: typeof body.description === 'string' ? body.description : undefined,
        authType: body.authType,
        authToken: typeof body.authToken === 'string' ? body.authToken : undefined,
        authHeaderName: typeof body.authHeaderName === 'string' ? body.authHeaderName : undefined,
        headers: body.headers && typeof body.headers === 'object' ? body.headers : undefined,
        autoDiscover: body.autoDiscover !== false,
      });
      return jsonResponse({ ok: true, ...result }, 201);
    }

    if (req.method === 'POST' && subPath === '/servers/delete') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.serverId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'serverId is required.' }, 400);
      }
      const deleted = await bridge.deleteServer(ctx, parsed.data.serverId);
      return jsonResponse({ ok: true, deleted });
    }

    if (req.method === 'POST' && subPath === '/discover') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.serverId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'serverId is required.' }, 400);
      }
      const server = await bridge.discoverServer(ctx, parsed.data.serverId);
      return jsonResponse({ ok: true, server });
    }

    if (req.method === 'GET' && subPath === '/tools') {
      const tools = await bridge.listAllDiscoveredTools(ctx);
      return jsonResponse({ ok: true, tools });
    }

    if (req.method === 'POST' && subPath === '/call') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (typeof body.serverId !== 'string' || typeof body.toolName !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'serverId and toolName are required.' }, 400);
      }
      const result = await bridge.callServerTool(ctx, {
        serverId: body.serverId,
        toolName: body.toolName,
        args: body.args && typeof body.args === 'object' ? body.args : {},
        approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
      });
      return jsonResponse(result, result.requiresApproval ? 403 : 200);
    }

    if (req.method === 'POST' && subPath === '/resources/read') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (typeof body.serverId !== 'string' || typeof body.uri !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'serverId and uri are required.' }, 400);
      }
      const result = await bridge.readServerResource(ctx, {
        serverId: body.serverId,
        uri: body.uri,
      });
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in MCP API.' }, 404);
  } catch (err) {
    if (err instanceof McpBridgeError) {
      return jsonResponse(
        { ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) },
        err.statusCode,
      );
    }
    const msg = err instanceof Error ? err.message : 'Unexpected MCP bridge error.';
    return jsonResponse({ ok: false, code: 'MCP_BRIDGE_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
  }
}

export default async (req: Request) => handleMcpRequest(req);
