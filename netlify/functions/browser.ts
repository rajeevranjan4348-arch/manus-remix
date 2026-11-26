/**
 * Netlify Serverless Function: Isolated Browser Execution Engine API
 * Routes: /api/browser/* and /.netlify/functions/browser/*
 */

import {
  BrowserEngineError,
  defaultBrowserEngine,
  type BrowserExecutionEngine,
} from '../../server/browser/browserEngine';
import { BrowserProviderError } from '../../server/browser/providers';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import type { DurableRequestContext } from '../../server/sandbox/durableStore';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
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
  if (err instanceof BrowserEngineError) {
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
  if (err instanceof BrowserProviderError) {
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
  const msg = err instanceof Error ? err.message : 'Unexpected browser engine error.';
  return jsonResponse({ ok: false, code: 'BROWSER_ENGINE_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
}

export async function handleBrowserRequest(
  req: Request,
  engine: BrowserExecutionEngine = defaultBrowserEngine,
): Promise<Response> {
  const url = new URL(req.url);
  const subPath = url.pathname
    .replace(/^\/\.netlify\/functions\/browser/, '')
    .replace(/^\/api\/browser/, '') || '/';

  if (req.method === 'GET' && (subPath === '/health' || subPath === '/')) {
    const live = url.searchParams.get('live') === 'true';
    const health = await engine.getHealth(live);
    return jsonResponse({ ok: true, ...health }, 200);
  }

  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rate = await checkSharedRateLimit(`browser:${decoded.uid}`, 60, 60);
  if (rate.unavailable) {
    return jsonResponse(
      { ok: false, code: 'RATE_LIMIT_UNAVAILABLE', error: 'Browser execution is temporarily unavailable.' },
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

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Use POST for browser session actions.' }, 405);
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    if (subPath === '/session/create') {
      const session = await engine.createSession(ctx, {
        projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
        taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
        viewport: body.viewport,
        timeoutSec: typeof body.timeoutSec === 'number' ? body.timeoutSec : undefined,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
      });
      return jsonResponse({ ok: true, session }, 201);
    }

    if (subPath === '/navigate') {
      const result = await engine.navigate(ctx, {
        sessionId: String(body.sessionId || ''),
        url: String(body.url || ''),
        waitUntil: body.waitUntil,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        allowedHosts: Array.isArray(body.allowedHosts) ? body.allowedHosts : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (subPath === '/inspect') {
      const result = await engine.inspect(ctx, {
        sessionId: String(body.sessionId || ''),
        selector: typeof body.selector === 'string' ? body.selector : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (subPath === '/click') {
      const result = await engine.click(ctx, {
        sessionId: String(body.sessionId || ''),
        selector: String(body.selector || ''),
        label: typeof body.label === 'string' ? body.label : undefined,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (subPath === '/fill') {
      const result = await engine.fill(ctx, {
        sessionId: String(body.sessionId || ''),
        selector: String(body.selector || ''),
        value: body.value,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (subPath === '/scroll') {
      const result = await engine.scroll(ctx, {
        sessionId: String(body.sessionId || ''),
        direction: body.direction,
        pixels: typeof body.pixels === 'number' ? body.pixels : undefined,
        selector: typeof body.selector === 'string' ? body.selector : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (subPath === '/wait') {
      const result = await engine.waitFor(ctx, {
        sessionId: String(body.sessionId || ''),
        selector: typeof body.selector === 'string' ? body.selector : undefined,
        urlIncludes: typeof body.urlIncludes === 'string' ? body.urlIncludes : undefined,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (subPath === '/screenshot') {
      const screenshot = await engine.screenshot(ctx, {
        sessionId: String(body.sessionId || ''),
        fullPage: Boolean(body.fullPage),
        format: body.format,
      });
      return jsonResponse({ ok: true, screenshot });
    }

    if (subPath === '/session/close') {
      const result = await engine.closeSession(ctx, String(body.sessionId || ''));
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: `Unknown browser route: ${subPath}` }, 404);
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export default async (req: Request) => handleBrowserRequest(req);
