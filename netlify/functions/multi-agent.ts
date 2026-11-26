/**
 * Netlify Serverless Function: Feature 03 True Autonomous Multi-Agent Runtime API
 * Routes: /api/multi-agent/* and /.netlify/functions/multi-agent/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import {
  defaultMultiAgentEngine,
  MultiAgentEngineError,
  type MultiAgentRuntimeEngine,
} from '../../server/multiAgent/multiAgentEngine';
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
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds allowed limit.' }, 413),
    };
  }
  if (!raw.trim()) return { ok: true as const, data: {} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected JSON object body.' }, 400),
      };
    }
    return { ok: true as const, data: parsed };
  } catch {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

export async function handleMultiAgentRequest(
  req: Request,
  engine: MultiAgentRuntimeEngine = defaultMultiAgentEngine,
): Promise<Response> {
  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`multi_agent:${decoded.uid}`, 30, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for multi-agent API.' }, 429);
  }

  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/multi-agent/, '')
      .replace(/^\/api\/multi-agent/, '') || '/';

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && subPath === '/health') {
      return jsonResponse({ ok: true, ...engine.getHealth(ctx) });
    }

    if (req.method === 'GET' && (subPath === '/roles' || subPath === '/')) {
      return jsonResponse({ ok: true, roles: engine.getRoles() });
    }

    if (req.method === 'GET' && subPath === '/status') {
      const runId = url.searchParams.get('runId') || '';
      if (!runId) return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'runId query parameter is required.' }, 400);
      const run = await engine.getRun(ctx, runId);
      if (!run) return jsonResponse({ ok: false, code: 'RUN_NOT_FOUND', error: 'Multi-agent run not found.' }, 404);
      return jsonResponse({ ok: true, run });
    }

    if (req.method === 'GET' && subPath === '/history') {
      const limit = Number(url.searchParams.get('limit') || '30');
      const runs = await engine.listRuns(ctx, Number.isFinite(limit) ? limit : 30);
      return jsonResponse({ ok: true, runs });
    }

    if (req.method === 'POST' && subPath === '/run') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (body.userId !== undefined && body.userId !== ctx.userId) {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', error: 'Run owner does not match authenticated user.' }, 403);
      }
      const run = await engine.runOrchestration(ctx, {
        objective: String(body.objective || ''),
        nodes: Array.isArray(body.nodes) ? body.nodes : undefined,
        maxConcurrency: typeof body.maxConcurrency === 'number' ? body.maxConcurrency : undefined,
        maxRecursionDepth: typeof body.maxRecursionDepth === 'number' ? body.maxRecursionDepth : undefined,
        maxTotalTokens: typeof body.maxTotalTokens === 'number' ? body.maxTotalTokens : undefined,
        maxCostUsd: typeof body.maxCostUsd === 'number' ? body.maxCostUsd : undefined,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        maxCorrectionRounds: typeof body.maxCorrectionRounds === 'number' ? body.maxCorrectionRounds : undefined,
        enableQaReview: typeof body.enableQaReview === 'boolean' ? body.enableQaReview : true,
        toolArgsByNode: body.toolArgsByNode && typeof body.toolArgsByNode === 'object' ? body.toolArgsByNode : undefined,
      });
      return jsonResponse({ ok: true, run });
    }

    if (req.method === 'POST' && subPath === '/cancel') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.runId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'runId is required.' }, 400);
      }
      const run = await engine.cancelRun(ctx, parsed.data.runId);
      if (!run) return jsonResponse({ ok: false, code: 'RUN_NOT_FOUND', error: 'Multi-agent run not found.' }, 404);
      return jsonResponse({ ok: true, run });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in multi-agent API.' }, 404);
  } catch (err) {
    if (err instanceof MultiAgentEngineError) {
      return jsonResponse(
        { ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) },
        err.statusCode,
      );
    }
    const msg = err instanceof Error ? err.message : 'Unexpected multi-agent error.';
    return jsonResponse({ ok: false, code: 'MULTI_AGENT_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
  }
}

export default async (req: Request) => handleMultiAgentRequest(req);
