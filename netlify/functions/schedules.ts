/**
 * Feature 05 API: persistent scheduler & automation endpoints.
 */
import { verifyBearerToken } from '../../src/middleware/auth';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import { scheduleEngine, ScheduleSpec } from '../../server/scheduler/scheduleEngine';
import { workerConfigured } from '../../server/taskQueue/workerDispatch';

const jsonResponse = (data: unknown, status = 200, requestId: string = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Request-ID': requestId,
    },
  });

const VALID_TASK_TYPES = ['research', 'coding_job', 'report', 'reminder', 'website_check', 'quality_check', 'automation'];

function validateSpec(raw: any): ScheduleSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'once' && typeof raw.at === 'string') {
    const at = new Date(raw.at);
    if (Number.isNaN(at.getTime())) return null;
    return { kind: 'once', at: at.toISOString() };
  }
  if (raw.kind === 'interval' && Number.isFinite(Number(raw.intervalMinutes))) {
    return { kind: 'interval', intervalMinutes: Math.max(1, Math.floor(Number(raw.intervalMinutes))) };
  }
  if (raw.kind === 'cron' && typeof raw.expression === 'string' && typeof raw.timeZone === 'string') {
    return { kind: 'cron', expression: raw.expression.slice(0, 100), timeZone: raw.timeZone.slice(0, 64) };
  }
  return null;
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401, requestId);
  }
  const userId = decodedToken.uid;
  const rateCheck = await checkSharedRateLimit(`schedules:${userId}`, 60, 60);
  if (!rateCheck.allowed) {
    return jsonResponse({ ok: false, error: 'Too many requests.', code: 'RATE_LIMITED' }, 429, requestId);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/schedules/, '').replace(/^\/api\/schedules/, '');

  try {
    if (req.method === 'GET' && (path === '' || path === '/')) {
      const schedules = await scheduleEngine.listSchedules(userId);
      return jsonResponse({ ok: true, schedules, workerConfigured: workerConfigured(), requestId }, 200, requestId);
    }
    if (req.method === 'GET' && path === '/runs') {
      const scheduleId = url.searchParams.get('scheduleId') || undefined;
      const runs = await scheduleEngine.getRunHistory(userId, scheduleId);
      return jsonResponse({ ok: true, runs, requestId }, 200, requestId);
    }

    if (req.method === 'POST') {
      const parsed = await parseJsonBodyLimited(req, 256 * 1024);
      if (!parsed.ok) {
        return jsonResponse({ ok: false, error: parsed.error, code: parsed.code }, parsed.status, requestId);
      }
      const body: any = parsed.value;
      const action = typeof body.action === 'string' ? body.action : '';
      const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId.slice(0, 200) : '';

      switch (action) {
        case 'create': {
          const spec = validateSpec(body.spec);
          if (!spec) {
            return jsonResponse({ ok: false, error: 'A valid spec (once|interval|cron) is required.', code: 'INVALID_SPEC' }, 400, requestId);
          }
          if (!VALID_TASK_TYPES.includes(body.taskType)) {
            return jsonResponse({ ok: false, error: `taskType must be one of: ${VALID_TASK_TYPES.join(', ')}`, code: 'INVALID_TASK_TYPE' }, 400, requestId);
          }
          const schedule = await scheduleEngine.createSchedule({
            userId,
            title: String(body.title ?? '').slice(0, 200),
            taskType: body.taskType,
            payload: body.payload ?? {},
            spec,
            missedPolicy: body.missedPolicy === 'skip' ? 'skip' : 'run_once',
            maxRetries: Number.isFinite(Number(body.maxRetries)) ? Number(body.maxRetries) : undefined,
          });
          return jsonResponse({ ok: true, schedule, workerConfigured: workerConfigured(), requestId }, 201, requestId);
        }
        case 'pause':
        case 'resume': {
          const ok = await scheduleEngine.setScheduleStatus(scheduleId, userId, action === 'pause' ? 'paused' : 'active');
          return jsonResponse({ ok, requestId }, ok ? 200 : 404, requestId);
        }
        case 'cancel': {
          const ok = await scheduleEngine.cancelSchedule(scheduleId, userId);
          return jsonResponse({ ok, requestId }, ok ? 200 : 404, requestId);
        }
        case 'edit': {
          const changes: any = {};
          if (typeof body.title === 'string') changes.title = body.title.slice(0, 200);
          if (body.spec) {
            const spec = validateSpec(body.spec);
            if (!spec) {
              return jsonResponse({ ok: false, error: 'Invalid spec.', code: 'INVALID_SPEC' }, 400, requestId);
            }
            changes.spec = spec;
          }
          if (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)) changes.payload = body.payload;
          if (typeof body.timeZone === 'string') changes.timeZone = body.timeZone.slice(0, 64);
          const ok = await scheduleEngine.editSchedule(scheduleId, userId, changes);
          return jsonResponse({ ok, requestId }, ok ? 200 : 404, requestId);
        }
        default:
          return jsonResponse({ ok: false, error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, requestId);
      }
    }

    return jsonResponse({ ok: false, error: 'Route not found.', code: 'NOT_FOUND' }, 404, requestId);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: 'Schedule storage unavailable.',
        detail: (error instanceof Error ? error.message : '').slice(0, 300),
        code: 'SCHEDULE_STORE_UNAVAILABLE',
      },
      503,
      requestId,
    );
  }
};
