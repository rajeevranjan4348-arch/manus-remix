import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { RuntimeConfig } from './config.js';
import { authenticateBearer } from './auth.js';
import { healthPayload } from './health.js';
import type { OctokitLike } from './github.js';
import { consumeRateLimit } from './rateLimit.js';
import { SessionCapacity } from './sessionCapacity.js';
import { createMcpServer } from './server.js';

interface McpSession {
  userId: string;
  createdAt: number;
  lastUsedAt: number;
  transport: StreamableHTTPServerTransport;
  mcpServer: ReturnType<typeof createMcpServer>;
  sessionId?: string;
}

export interface HttpServerOptions {
  config: RuntimeConfig;
  octokit: OctokitLike;
}

const sessions = new Map<string, McpSession>();
const sessionCapacity = new SessionCapacity();

function json(res: ServerResponse, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function checkHostAndOrigin(req: IncomingMessage, res: ServerResponse, config: RuntimeConfig): boolean {
  const host = String(req.headers.host || '').toLowerCase();
  if (!host || !config.allowedHosts.has(host)) {
    json(res, { error: 'Host header is not allowed.' }, 403);
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    if (!config.allowedOrigins.has(origin)) {
      json(res, { error: 'Origin is not allowed.' }, 403);
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version');
  }
  return true;
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > maxBytes) throw Object.assign(new Error('Request body exceeds the configured limit.'), { statusCode: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw Object.assign(new Error('Request body exceeds the configured limit.'), { statusCode: 413 });
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) throw Object.assign(new Error('A JSON-RPC body is required.'), { statusCode: 400 });
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
}

function sessionId(req: IncomingMessage): string | undefined {
  const value = req.headers['mcp-session-id'];
  return Array.isArray(value) ? value[0] : value;
}

function recordRequest(req: IncomingMessage, requestId: string, userId: string, body?: any, outcome = 'accepted') {
  const toolName = typeof body?.params?.name === 'string' ? body.params.name.slice(0, 100) : undefined;
  console.info(JSON.stringify({
    level: 'info',
    event: 'github_mcp_http_request',
    requestId,
    user: userId.slice(0, 12),
    method: req.method,
    rpcMethod: typeof body?.method === 'string' ? body.method : undefined,
    toolName,
    outcome,
  }));
}

function cleanupExpiredSessions(config: RuntimeConfig) {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > config.sessionTtlMs) {
      sessions.delete(id);
      void session.transport.close().catch(() => undefined);
      void session.mcpServer.close().catch(() => undefined);
    }
  }
}

async function createSession(
  userId: string,
  config: RuntimeConfig,
  octokit: OctokitLike,
  onSessionInitialized: () => void,
): Promise<McpSession> {
  const record: McpSession = {
    userId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    transport: undefined as unknown as StreamableHTTPServerTransport,
    mcpServer: undefined as unknown as ReturnType<typeof createMcpServer>,
  };
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      record.sessionId = id;
      sessions.set(id, record);
      onSessionInitialized();
    },
  });
  record.transport = transport;
  record.mcpServer = createMcpServer({ config, octokit });
  transport.onclose = () => {
    if (record.sessionId) sessions.delete(record.sessionId);
  };
  await record.mcpServer.connect(transport);
  return record;
}

export function createMcpHttpServer({ config, octokit }: HttpServerOptions): Server {
  const httpServer = createHttpServer(async (req, res) => {
    const requestId = typeof req.headers['x-request-id'] === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(req.headers['x-request-id'])
      ? req.headers['x-request-id']
      : randomUUID();
    res.setHeader('X-Request-ID', requestId);
    let releaseSessionReservation: (() => void) | undefined;
    try {
      const path = (req.url || '/').split('?')[0];
      if (path === '/health') {
        if (req.method !== 'GET') {
          json(res, { ok: false, code: 'METHOD_NOT_ALLOWED', requestId }, 405, { Allow: 'GET' });
          return;
        }
        json(res, healthPayload(config));
        return;
      }
      if (path !== '/mcp') {
        json(res, { error: 'Not found.', code: 'NOT_FOUND', requestId }, 404);
        return;
      }
      if (!checkHostAndOrigin(req, res, config)) return;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (!['GET', 'POST', 'DELETE'].includes(String(req.method))) {
        json(res, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED', requestId }, 405, { Allow: 'GET, POST, DELETE, OPTIONS' });
        return;
      }
      const user = await authenticateBearer(req.headers.authorization, config);
      if (!user) {
        json(res, { error: 'Authentication required or the Firebase user is not allowlisted.', code: 'UNAUTHENTICATED', requestId }, 401);
        return;
      }
      const limit = await consumeRateLimit(user.uid, config);
      if (!limit.allowed) {
        const unavailable = config.nodeEnv === 'production' && !limit.distributed;
        json(res, { error: unavailable ? 'Distributed rate limiter is unavailable.' : 'Rate limit exceeded.', code: unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED', requestId }, unavailable ? 503 : 429, { 'Retry-After': String(limit.retryAfterSeconds) });
        return;
      }

      cleanupExpiredSessions(config);
      let body: any;
      if (req.method === 'POST') {
        body = await readJsonBody(req, config.maxBodyBytes);
        if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
          json(res, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } }, 400);
          return;
        }
      }

      const id = sessionId(req);
      let session: McpSession | undefined;
      if (id) {
        session = sessions.get(id);
        if (!session) {
          json(res, { error: 'MCP session not found or expired. Initialize a new session.', code: 'SESSION_NOT_FOUND', requestId }, 404);
          return;
        }
        if (session.userId !== user.uid) {
          json(res, { error: 'MCP session belongs to a different authenticated user.', code: 'SESSION_USER_MISMATCH', requestId }, 403);
          return;
        }
        session.lastUsedAt = Date.now();
      } else {
        if (req.method !== 'POST' || body?.method !== 'initialize') {
          json(res, { error: 'A new MCP session must begin with initialize.', code: 'INITIALIZATION_REQUIRED', requestId }, 400);
          return;
        }
        releaseSessionReservation = sessionCapacity.reserve(sessions.size, config.maxSessions);
        if (!releaseSessionReservation) {
          json(res, { error: 'MCP server session capacity is full; retry later.', code: 'SESSION_CAPACITY', requestId }, 503);
          return;
        }
        session = await createSession(user.uid, config, octokit, () => releaseSessionReservation?.());
      }

      recordRequest(req, requestId, user.uid, body);
      await session.transport.handleRequest(req, res, body);
      releaseSessionReservation?.();
    } catch (error: any) {
      releaseSessionReservation?.();
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      const publicMessage = status < 500 ? error.message : 'MCP server could not process the request.';
      console.warn(JSON.stringify({ level: 'warn', event: 'github_mcp_http_error', requestId, status, code: error?.code || 'INTERNAL_ERROR' }));
      if (res.headersSent) {
        res.destroy();
      } else {
        json(res, { error: publicMessage, code: status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR', requestId }, status);
      }
    }
  });

  const cleanupTimer = setInterval(() => cleanupExpiredSessions(config), Math.min(config.sessionTtlMs, 60_000));
  cleanupTimer.unref();
  httpServer.on('close', () => clearInterval(cleanupTimer));
  return httpServer;
}
