import { randomUUID } from 'node:crypto';
import { createMcpHandler } from 'mcp-handler';
import { authenticateBearer } from './auth.js';
import { readConfig, type RuntimeConfig } from './config.js';
import { createOctokit, type OctokitLike } from './github.js';
import { consumeRateLimit, type RateLimitResult } from './rateLimit.js';
import { registerVercelReadOnlyTools } from './vercelTools.js';

type AuthenticatedUser = { uid: string } | null;

export interface VercelRouteDependencies {
  getConfig(): RuntimeConfig;
  authenticate(authorization: string | undefined, config: RuntimeConfig): Promise<AuthenticatedUser>;
  rateLimit(uid: string, config: RuntimeConfig): Promise<RateLimitResult>;
  createOctokit(config: RuntimeConfig): OctokitLike;
}

class BodyTooLargeError extends Error {}
class InvalidBodyError extends Error {}

const responseSecurityHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function validRequestId(value: string | null): string {
  return value && /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : randomUUID();
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, MCP-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'MCP-Protocol-Version, MCP-Session-Id, X-Request-ID',
    Vary: 'Origin',
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  origin?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...responseSecurityHeaders,
      'X-Request-ID': requestId,
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function withSecurityHeaders(response: Response, requestId: string, origin?: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(responseSecurityHeaders)) headers.set(name, value);
  headers.set('X-Request-ID', requestId);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function boundedRequest(request: Request, maxBytes: number): Promise<Request> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new InvalidBodyError('Invalid Content-Length.');
    if (Number(contentLength) > maxBytes) throw new BodyTooLargeError('Request body exceeds the configured limit.');
  }
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BodyTooLargeError('Request body exceeds the configured limit.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw error;
    throw new InvalidBodyError('Request body could not be read.');
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: bytes,
  });
}

const defaultDependencies: VercelRouteDependencies = {
  getConfig() {
    const config = readConfig({
      ...process.env,
      MCP_TRANSPORT: 'http',
      MCP_ENABLE_WRITE_TOOLS: 'false',
    });
    return { ...config, enableWriteTools: false };
  },
  authenticate: authenticateBearer,
  rateLimit: consumeRateLimit,
  createOctokit,
};

export function createVercelMcpRoute(dependencies: VercelRouteDependencies = defaultDependencies) {
  return async function handleMcpRequest(request: Request): Promise<Response> {
    const requestId = validRequestId(request.headers.get('x-request-id'));
    const origin = request.headers.get('origin') || undefined;
    let config: RuntimeConfig;

    try {
      config = dependencies.getConfig();
      if (config.enableWriteTools) config = { ...config, enableWriteTools: false };
    } catch {
      console.warn(JSON.stringify({ level: 'warn', event: 'github_mcp_vercel_configuration_error', requestId }));
      return jsonResponse(503, { error: 'MCP server configuration is incomplete.', code: 'CONFIGURATION_ERROR', requestId }, requestId, origin);
    }

    const host = (request.headers.get('host') || new URL(request.url).host).toLowerCase();
    if (!host || !config.allowedHosts.has(host)) {
      return jsonResponse(403, { error: 'Host header is not allowed.', code: 'HOST_NOT_ALLOWED', requestId }, requestId);
    }
    if (origin && !config.allowedOrigins.has(origin)) {
      return jsonResponse(403, { error: 'Origin is not allowed.', code: 'ORIGIN_NOT_ALLOWED', requestId }, requestId);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...responseSecurityHeaders, 'X-Request-ID': requestId, ...corsHeaders(origin) },
      });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED', requestId }, requestId, origin, { Allow: 'GET, POST, OPTIONS' });
    }

    const user = await dependencies.authenticate(request.headers.get('authorization') || undefined, config);
    if (!user) {
      return jsonResponse(401, { error: 'Authentication required or the Firebase user is not allowlisted.', code: 'UNAUTHENTICATED', requestId }, requestId, origin, { 'WWW-Authenticate': 'Bearer' });
    }

    const limit = await dependencies.rateLimit(user.uid, config);
    if (!limit.allowed) {
      const unavailable = config.nodeEnv === 'production' && !limit.distributed;
      return jsonResponse(
        unavailable ? 503 : 429,
        { error: unavailable ? 'Distributed rate limiter is unavailable.' : 'Rate limit exceeded.', code: unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED', requestId },
        requestId,
        origin,
        { 'Retry-After': String(limit.retryAfterSeconds) },
      );
    }

    let mcpRequest = request;
    if (request.method === 'POST') {
      try {
        mcpRequest = await boundedRequest(request, config.maxBodyBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          return jsonResponse(413, { error: 'Request body exceeds the configured limit.', code: 'BODY_TOO_LARGE', requestId }, requestId, origin);
        }
        return jsonResponse(400, { error: 'Request body could not be read.', code: 'BAD_REQUEST', requestId }, requestId, origin);
      }
    }

    try {
      const octokit = dependencies.createOctokit(config);
      const handler = createMcpHandler((server) => registerVercelReadOnlyTools(server, octokit, config), {
        serverInfo: { name: 'cue-github-mcp', version: '1.0.0' },
        verboseLogs: false,
      });
      const response = await handler(mcpRequest);
      console.info(JSON.stringify({ level: 'info', event: 'github_mcp_vercel_request', requestId, method: request.method, status: response.status }));
      return withSecurityHeaders(response, requestId, origin);
    } catch {
      console.warn(JSON.stringify({ level: 'warn', event: 'github_mcp_vercel_handler_error', requestId }));
      return jsonResponse(500, { error: 'MCP server could not process the request.', code: 'INTERNAL_ERROR', requestId }, requestId, origin);
    }
  };
}

export const handleVercelMcpRequest = createVercelMcpRoute();
