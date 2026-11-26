/**
 * Netlify Serverless Function: Sandboxed Coding Execution Engine API
 * Routes: /api/sandbox/* and /.netlify/functions/sandbox/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { defaultDurableStore, type DurableRequestContext } from '../../server/sandbox/durableStore';
import { SandboxProviderError } from '../../server/sandbox/providers';
import {
  defaultSandboxEngine,
  SandboxEngineError,
  type SandboxExecutionEngine,
} from '../../server/sandbox/sandboxEngine';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
import type { TerminalStreamEvent } from '../../server/sandbox/types';
import { verifyBearerToken } from '../../src/middleware/auth';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function jsonResponse(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, ...(extraHeaders || {}) },
  });
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return undefined;
  const token = auth.slice(7).trim();
  // Guest session tokens start with "guest_"; only pass real Firebase JWTs to Firestore REST
  if (!token || token.startsWith('guest_')) return undefined;
  return token;
}

async function readJsonBody(req: Request, maxBytes = 64 * 1024): Promise<{ ok: true; data: any } | { ok: false; response: Response }> {
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return {
      ok: false,
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Request payload exceeds allowed size limit.' }, 413),
    };
  }
  if (!text.trim()) return { ok: true, data: {} };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected a JSON object body.' }, 400),
      };
    }
    return { ok: true, data: parsed };
  } catch {
    return {
      ok: false,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

function mapErrorToResponse(err: unknown): Response {
  if (err instanceof SandboxEngineError) {
    return jsonResponse(
      {
        ok: false,
        code: err.code,
        error: redactSensitiveExecutionText(err.message),
        ...(err.challenge ? { requiresApproval: true, challenge: err.challenge } : {}),
      },
      err.statusCode,
    );
  }
  if (err instanceof SandboxProviderError) {
    return jsonResponse(
      {
        ok: false,
        code: err.code,
        provider: err.provider,
        retryable: err.retryable,
        error: redactSensitiveExecutionText(err.message),
      },
      err.statusCode,
    );
  }
  const msg = err instanceof Error ? err.message : 'Unexpected sandbox engine error.';
  return jsonResponse({ ok: false, code: 'SANDBOX_ENGINE_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
}

export async function handleSandboxRequest(
  req: Request,
  engine: SandboxExecutionEngine = defaultSandboxEngine,
): Promise<Response> {
  const url = new URL(req.url);
  const subPath = url.pathname
    .replace(/^\/\.netlify\/functions\/sandbox/, '')
    .replace(/^\/api\/sandbox/, '') || '/';

  // 1. Signed provider webhook endpoint (authenticated via HMAC-SHA256, not user Bearer token)
  if (req.method === 'POST' && subPath === '/webhook') {
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 128 * 1024) {
      return jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Webhook payload too large.' }, 413);
    }
    try {
      const signatureHeader =
        req.headers.get('x-sandbox-signature') ||
        req.headers.get('x-webhook-signature') ||
        req.headers.get('x-hub-signature-256');
      const result = await engine.handleProviderWebhook({ rawBody, signatureHeader });
      return jsonResponse({ ok: true, ...result }, 200);
    } catch (err) {
      return mapErrorToResponse(err);
    }
  }

  // 2. Sanitized provider capability & health endpoint (no secret leakage)
  if (req.method === 'GET' && (subPath === '/health' || subPath === '/')) {
    const live = url.searchParams.get('live') === 'true';
    const health = await engine.getHealth(live);
    return jsonResponse({ ok: true, ...health }, 200);
  }

  // 3. All operational endpoints strictly require verified authentication
  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rate = await checkSharedRateLimit(`sandbox:${decoded.uid}`, 90, 60);
  if (rate.unavailable) {
    return jsonResponse(
      { ok: false, code: 'RATE_LIMIT_UNAVAILABLE', error: 'Sandbox execution is temporarily unavailable.' },
      503,
    );
  }
  if (!rate.allowed) {
    return jsonResponse(
      { ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded. Please wait before retrying.' },
      429,
      { 'Retry-After': String(rate.retryAfterSeconds) },
    );
  }

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    // GET /audit
    if (req.method === 'GET' && subPath === '/audit') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const records = await defaultDurableStore.listAudit(ctx, limit);
      return jsonResponse({ ok: true, auditLog: records, persistenceMode: engine.getPersistenceMode(ctx) });
    }

    // POST /create
    if (req.method === 'POST' && subPath === '/create') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const sandbox = await engine.createSandbox(ctx, {
        projectId: String(body.projectId || 'default-project'),
        taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
        runtime: body.runtime,
        image: typeof body.image === 'string' ? body.image : undefined,
        limits: body.limits,
        env: body.env,
        persistent: Boolean(body.persistent),
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        idempotencyKey:
          typeof body.idempotencyKey === 'string'
            ? body.idempotencyKey
            : req.headers.get('x-idempotency-key') || undefined,
      });
      return jsonResponse({ ok: true, sandbox, persistenceMode: engine.getPersistenceMode(ctx) }, 201);
    }

    // GET or POST /status
    if ((req.method === 'GET' || req.method === 'POST') && subPath === '/status') {
      let sandboxId = url.searchParams.get('sandboxId') || '';
      let refresh = url.searchParams.get('refresh') !== 'false';
      if (req.method === 'POST') {
        const parsed = await readJsonBody(req);
        if (!parsed.ok) return parsed.response;
        sandboxId = String(parsed.data.sandboxId || sandboxId);
        if (typeof parsed.data.refresh === 'boolean') refresh = parsed.data.refresh;
      }
      const sandbox = await engine.getSandboxStatus(ctx, sandboxId, refresh);
      return jsonResponse({ ok: true, sandbox });
    }

    // POST /cleanup
    if (req.method === 'POST' && subPath === '/cleanup') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.cleanupSandbox(ctx, String(parsed.data.sandboxId || ''));
      return jsonResponse({ ok: true, ...result });
    }

    // POST /terminal/execute
    if (req.method === 'POST' && subPath === '/terminal/execute') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const execution = await engine.executeTerminal(ctx, {
        sandboxId: String(body.sandboxId || ''),
        command: body.command,
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        env: body.env,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
        idempotencyKey:
          typeof body.idempotencyKey === 'string'
            ? body.idempotencyKey
            : req.headers.get('x-idempotency-key') || undefined,
        toolName: 'terminal_execute',
      });
      return jsonResponse({ ok: true, execution });
    }

    // POST /terminal/stream (Server-Sent Events streaming terminal output)
    if (req.method === 'POST' && subPath === '/terminal/stream') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (ev: TerminalStreamEvent) => {
            controller.enqueue(encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
          };
          try {
            const execution = await engine.executeTerminal(ctx, {
              sandboxId: String(body.sandboxId || ''),
              command: body.command,
              cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
              env: body.env,
              timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
              approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
              idempotencyKey:
                typeof body.idempotencyKey === 'string'
                  ? body.idempotencyKey
                  : req.headers.get('x-idempotency-key') || undefined,
              toolName: 'terminal_stream',
              onEvent: sendEvent,
            });
            controller.enqueue(
              encoder.encode(`event: complete\ndata: ${JSON.stringify({ ok: true, execution })}\n\n`),
            );
          } catch (err: any) {
            const errorPayload =
              err instanceof SandboxEngineError
                ? {
                    ok: false,
                    code: err.code,
                    error: redactSensitiveExecutionText(err.message),
                    ...(err.challenge ? { requiresApproval: true, challenge: err.challenge } : {}),
                  }
                : {
                    ok: false,
                    code: err instanceof SandboxProviderError ? err.code : 'STREAM_ERROR',
                    error: redactSensitiveExecutionText(err?.message || 'Terminal stream failed.'),
                  };
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // POST /terminal/cancel
    if (req.method === 'POST' && subPath === '/terminal/cancel') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.cancelTerminal(
        ctx,
        String(parsed.data.sandboxId || ''),
        String(parsed.data.executionId || ''),
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/list
    if (req.method === 'POST' && subPath === '/files/list') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.listFiles(
        ctx,
        String(parsed.data.sandboxId || ''),
        typeof parsed.data.path === 'string' ? parsed.data.path : '.',
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/read
    if (req.method === 'POST' && subPath === '/files/read') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.readFile(
        ctx,
        String(parsed.data.sandboxId || ''),
        String(parsed.data.path || ''),
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/write (allow up to 3 MiB JSON payload for 2 MiB UTF-8 file contents)
    if (req.method === 'POST' && subPath === '/files/write') {
      const parsed = await readJsonBody(req, 3 * 1024 * 1024);
      if (!parsed.ok) return parsed.response;
      const result = await engine.writeFile(
        ctx,
        String(parsed.data.sandboxId || ''),
        String(parsed.data.path || ''),
        parsed.data.content,
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/delete
    if (req.method === 'POST' && subPath === '/files/delete') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.deleteFile(
        ctx,
        String(parsed.data.sandboxId || ''),
        String(parsed.data.path || ''),
        typeof parsed.data.approvalToken === 'string' ? parsed.data.approvalToken : undefined,
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/mkdir
    if (req.method === 'POST' && subPath === '/files/mkdir') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.makeDirectory(
        ctx,
        String(parsed.data.sandboxId || ''),
        String(parsed.data.path || ''),
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/rename
    if (req.method === 'POST' && subPath === '/files/rename') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.renamePath(
        ctx,
        String(parsed.data.sandboxId || ''),
        String(parsed.data.fromPath || ''),
        String(parsed.data.toPath || ''),
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/search
    if (req.method === 'POST' && subPath === '/files/search') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.searchFiles(
        ctx,
        String(parsed.data.sandboxId || ''),
        String(parsed.data.query || ''),
        typeof parsed.data.path === 'string' ? parsed.data.path : '.',
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/structure
    if (req.method === 'POST' && subPath === '/files/structure') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const result = await engine.inspectProjectStructure(
        ctx,
        String(parsed.data.sandboxId || ''),
        typeof parsed.data.maxDepth === 'number' ? Math.min(5, Math.max(1, parsed.data.maxDepth)) : 3,
      );
      return jsonResponse({ ok: true, ...result });
    }

    // POST /files/artifact
    if (req.method === 'POST' && subPath === '/files/artifact') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const artifact = await engine.createWorkspaceArtifact(
        ctx,
        String(parsed.data.sandboxId || ''),
        typeof parsed.data.path === 'string' ? parsed.data.path : '.',
      );
      return jsonResponse({ ok: true, artifact });
    }

    // POST /preview/start
    if (req.method === 'POST' && subPath === '/preview/start') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const preview = await engine.startPreview(ctx, {
        sandboxId: String(body.sandboxId || ''),
        command: body.command,
        port: Number(body.port),
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        readinessTimeoutMs: typeof body.readinessTimeoutMs === 'number' ? body.readinessTimeoutMs : undefined,
        approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
      });
      return jsonResponse({ ok: preview.status === 'ready', preview }, preview.status === 'ready' ? 200 : 502);
    }

    // GET or POST /preview/status
    if ((req.method === 'GET' || req.method === 'POST') && subPath === '/preview/status') {
      let sandboxId = url.searchParams.get('sandboxId') || '';
      if (req.method === 'POST') {
        const parsed = await readJsonBody(req);
        if (!parsed.ok) return parsed.response;
        sandboxId = String(parsed.data.sandboxId || sandboxId);
      }
      const preview = await engine.getPreviewStatus(ctx, sandboxId);
      return jsonResponse({ ok: true, preview });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: `Unknown sandbox route: ${subPath}` }, 404);
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export default async (req: Request) => handleSandboxRequest(req);
