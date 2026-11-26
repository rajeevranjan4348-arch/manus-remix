/**
 * Netlify Serverless Function: Feature 05 Persistent Scheduler & Automation Engine API
 * Routes: /api/scheduler/* and /.netlify/functions/scheduler/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import type { DurableRequestContext } from '../../server/sandbox/durableStore';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
import {
  defaultSchedulerEngine,
  SchedulerEngineError,
  type PersistentSchedulerEngine,
} from '../../server/scheduler/schedulerEngine';
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

async function readJsonBody(req: Request, maxBytes = 64 * 1024) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds allowed limit.' }, 413),
    };
  }
  if (!raw.trim()) return { ok: true as const, data: {}, raw };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected JSON object body.' }, 400),
      };
    }
    return { ok: true as const, data: parsed, raw };
  } catch {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

export async function handleSchedulerRequest(
  req: Request,
  engine: PersistentSchedulerEngine = defaultSchedulerEngine,
): Promise<Response> {
  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/scheduler/, '')
      .replace(/^\/api\/scheduler/, '') || '/';

  // 1. External Cron / Scheduler dispatch trigger (HMAC-SHA256 authenticated)
  if (subPath === '/dispatch') {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'POST required for scheduler dispatch.' }, 405);
    }
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;

    if (!engine.verifySchedulerRequest(parsed.raw, req.headers)) {
      return jsonResponse(
        {
          ok: false,
          code: 'SCHEDULER_UNAUTHORIZED',
          error: 'Valid x-scheduler-signature or x-scheduler-secret is required (SCHEDULER_SECRET >= 16 chars).',
        },
        401,
      );
    }

    try {
      const body = parsed.data;
      const result = await engine.dispatchDueSchedules({
        nowMs: typeof body.nowMs === 'number' ? body.nowMs : Date.now(),
        userId: typeof body.userId === 'string' ? body.userId : undefined,
        scheduleId: typeof body.scheduleId === 'string' ? body.scheduleId : undefined,
        conditionContext:
          body.conditionContext && typeof body.conditionContext === 'object' ? body.conditionContext : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    } catch (err) {
      if (err instanceof SchedulerEngineError) {
        return jsonResponse({ ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) }, err.statusCode);
      }
      const msg = err instanceof Error ? err.message : 'Unexpected scheduler dispatch error.';
      return jsonResponse({ ok: false, code: 'SCHEDULER_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
    }
  }

  // 2. User-authenticated routes
  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`scheduler:${decoded.uid}`, 60, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for scheduler API.' }, 429);
  }

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && subPath === '/health') {
      return jsonResponse({ ok: true, ...engine.getHealth(ctx) });
    }

    if (req.method === 'GET' && (subPath === '/list' || subPath === '/')) {
      const schedules = await engine.listSchedules(ctx);
      return jsonResponse({ ok: true, schedules });
    }

    if (req.method === 'GET' && subPath === '/history') {
      const scheduleId = url.searchParams.get('scheduleId') || undefined;
      const limit = Number(url.searchParams.get('limit') || '50');
      const runs = await engine.listScheduleRuns(ctx, scheduleId, Number.isFinite(limit) ? limit : 50);
      return jsonResponse({ ok: true, runs });
    }

    if (req.method === 'POST' && subPath === '/create') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (body.userId !== undefined && body.userId !== ctx.userId) {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', error: 'Schedule owner does not match authenticated user.' }, 403);
      }
      const schedule = await engine.createSchedule(ctx, {
        name: typeof body.name === 'string' ? body.name : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        naturalLanguageReminder:
          typeof body.naturalLanguageReminder === 'string' ? body.naturalLanguageReminder : undefined,
        kind: body.kind,
        timeZone: typeof body.timeZone === 'string' ? body.timeZone : 'UTC',
        runAt: typeof body.runAt === 'string' ? body.runAt : undefined,
        intervalMinutes: typeof body.intervalMinutes === 'number' ? body.intervalMinutes : undefined,
        timeOfDay: typeof body.timeOfDay === 'string' ? body.timeOfDay : undefined,
        dayOfWeek: typeof body.dayOfWeek === 'number' ? body.dayOfWeek : undefined,
        dayOfMonth: typeof body.dayOfMonth === 'number' ? body.dayOfMonth : undefined,
        cronExpression: typeof body.cronExpression === 'string' ? body.cronExpression : undefined,
        missedJobPolicy: body.missedJobPolicy,
        maxCatchUpRuns: typeof body.maxCatchUpRuns === 'number' ? body.maxCatchUpRuns : undefined,
        condition: body.condition,
        taskTitle: typeof body.taskTitle === 'string' ? body.taskTitle : undefined,
        taskPrompt: typeof body.taskPrompt === 'string' ? body.taskPrompt : undefined,
        taskType: body.taskType,
        priority: body.priority,
        maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined,
        payload: body.payload,
        notifyOnRun: typeof body.notifyOnRun === 'boolean' ? body.notifyOnRun : true,
      });
      return jsonResponse({ ok: true, schedule }, 201);
    }

    if (req.method === 'POST' && subPath === '/update') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.scheduleId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'scheduleId is required.' }, 400);
      }
      const schedule = await engine.updateSchedule(ctx, parsed.data.scheduleId, parsed.data);
      return jsonResponse({ ok: true, schedule });
    }

    if (req.method === 'POST' && subPath === '/pause') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.scheduleId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'scheduleId is required.' }, 400);
      }
      const schedule = await engine.pauseSchedule(ctx, parsed.data.scheduleId);
      return jsonResponse({ ok: true, schedule });
    }

    if (req.method === 'POST' && subPath === '/resume') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.scheduleId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'scheduleId is required.' }, 400);
      }
      const schedule = await engine.resumeSchedule(ctx, parsed.data.scheduleId);
      return jsonResponse({ ok: true, schedule });
    }

    if (req.method === 'POST' && subPath === '/cancel') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.scheduleId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'scheduleId is required.' }, 400);
      }
      const schedule = await engine.cancelSchedule(ctx, parsed.data.scheduleId);
      return jsonResponse({ ok: true, schedule });
    }

    if (req.method === 'POST' && subPath === '/run-now') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.scheduleId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'scheduleId is required.' }, 400);
      }
      const res = await engine.dispatchDueSchedules({
        userId: ctx.userId,
        scheduleId: parsed.data.scheduleId,
        conditionContext:
          parsed.data.conditionContext && typeof parsed.data.conditionContext === 'object'
            ? parsed.data.conditionContext
            : undefined,
        forceRunNow: true,
      });
      return jsonResponse({ ok: true, ...res });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in scheduler API.' }, 404);
  } catch (err) {
    if (err instanceof SchedulerEngineError) {
      return jsonResponse(
        { ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) },
        err.statusCode,
      );
    }
    const msg = err instanceof Error ? err.message : 'Unexpected scheduler error.';
    return jsonResponse({ ok: false, code: 'SCHEDULER_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
  }
}

export default async (req: Request) => handleSchedulerRequest(req);
