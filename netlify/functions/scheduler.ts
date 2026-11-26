/**
 * Netlify function: persistent scheduler & automation engine (Feature 05).
 *
 * User routes are authenticated with the Firebase bearer token and gated by
 * the durable permission gateway. The tick route exists in two forms:
 *  - Scheduled-event invocation (Netlify Scheduled Function in netlify.toml),
 *    which only runs when SCHEDULER_TICK_SECRET is configured (fail closed).
 *  - HTTP POST with the x-dispatch-secret header for external schedulers.
 * Occurrence verification is a worker-only callback (dispatch secret).
 */

import crypto from 'crypto';
import { verifyBearerToken } from '../../src/middleware/auth';
import { permissionsGateway } from '../../server/permissionsGateway';
import { SchedulerService } from '../../server/scheduler/schedulerService';
import type { MissedJobPolicy, ScheduleSpec, ScheduleTarget } from '../../server/scheduler/types';

const SCHEDULER_POLICIES = [
  { toolName: 'scheduler_manage', displayName: 'Manage Schedule', category: 'system' as const, riskLevel: 'sensitive' as const, description: 'Creates, edits, pauses, resumes or cancels persistent schedules.', consequences: ['Automation will run without the user pressing anything when the schedule fires.'] },
];
for (const p of SCHEDULER_POLICIES) {
  permissionsGateway.registerPolicy({ ...p, requiresConfirmation: true });
}

const jsonResponse = (data: unknown, status = 200, requestId = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': requestId,
    },
  });

const MAX_BODY_BYTES = 256 * 1024;

async function parseBody(req: Request): Promise<{ body?: Record<string, unknown>; response?: Response }> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds the limit.' }, 413) };
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { response: jsonResponse({ ok: false, code: 'INVALID_PAYLOAD', error: 'Expected a JSON object.' }, 400) };
    }
    return { body: body as Record<string, unknown> };
  } catch {
    return { response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON payload.' }, 400) };
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function mapError(err: any): { status: number; body: Record<string, unknown> } {
  const status = Number(err?.status) || 500;
  const code = String(err?.code || 'INTERNAL_ERROR');
  if (status >= 400 && status < 500) {
    return { status, body: { ok: false, code, error: String(err?.message || 'Request failed.'), ...(err?.challenge ? { challenge: err.challenge } : {}) } };
  }
  return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', error: 'Unexpected error in the scheduler.' } };
}

type AnyEvent = Request | { nextRun?: string; [key: string]: unknown };

export default async (req: AnyEvent) => {
  const requestId = 'sched_' + crypto.randomBytes(6).toString('hex');

  /* ---------- Scheduled-event invocation ---------- */
  const isHttp = typeof (req as Request)?.headers?.get === 'function';
  if (!isHttp) {
    const tickSecret = (process.env.SCHEDULER_TICK_SECRET || '').trim();
    if (!tickSecret) {
      return jsonResponse({ ok: false, code: 'SECRET_NOT_CONFIGURED', error: 'Scheduler tick is disabled: SCHEDULER_TICK_SECRET is not configured.' }, 503, requestId);
    }
    const service = await SchedulerService.create();
    const summary = await service.processDue(Date.now());
    return jsonResponse({ ok: true, tick: summary }, 200, requestId);
  }

  const request = req as Request;
  if (request.method !== 'POST' && request.method !== 'GET') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Use GET for reads or POST with an action.' }, 405, requestId);
  }

  /* ---------- Worker / system paths (dispatch secret) ---------- */
  const dispatchSecret = request.headers.get('x-dispatch-secret');
  if (dispatchSecret !== null) {
    const expected = (process.env.INFRA_DISPATCH_SECRET || '').trim();
    if (!expected) return jsonResponse({ ok: false, code: 'SECRET_NOT_CONFIGURED', error: 'Dispatch secret is not configured; this path fails closed.' }, 503, requestId);
    if (!timingSafeEqualStr(dispatchSecret, expected)) return jsonResponse({ ok: false, code: 'UNAUTHENTICATED_WORKER', error: 'Invalid dispatch secret.' }, 401, requestId);

    const parsed = await parseBody(request);
    if (parsed.response) return parsed.response;
    const body = parsed.body as Record<string, unknown>;
    const action = String(body.action || '');
    const service = await SchedulerService.create();
    if (action === 'tick') {
      const summary = await service.processDue(Date.now());
      return jsonResponse({ ok: true, tick: summary }, 200, requestId);
    }
    if (action === 'record-occurrence') {
      const scheduleId = String(body.scheduleId || '');
      const runId = String(body.runId || '');
      const status = String(body.status || '');
      if (!scheduleId || !runId || !['succeeded', 'failed'].includes(status)) {
        return jsonResponse({ ok: false, code: 'INVALID_ARGUMENTS', error: 'scheduleId, runId and status (succeeded|failed) are required.' }, 400, requestId);
      }
      const run = await service.verifyOccurrence(scheduleId, runId, status, String(body.detail || ''));
      if (!run) return jsonResponse({ ok: false, code: 'OCCURRENCE_NOT_VERIFIABLE', error: 'Occurrence not found or already verified.' }, 409, requestId);
      await permissionsGateway.recordAuditEvent({
        userId: run.userId,
        category: 'tool_execution',
        toolName: 'automation.run',
        status: status === 'succeeded' ? 'allowed' : 'denied',
        reason: 'Scheduled occurrence ' + runId + ' verified as ' + status + '. ' + String(body.detail || ''),
        target: runId,
      }).catch(() => {});
      return jsonResponse({ ok: true, run }, 200, requestId);
    }
    return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Workers may only tick or record occurrences.' }, 400, requestId);
  }

  /* ---------- Authenticated user path ---------- */
  const decoded = await verifyBearerToken(request.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401, requestId);
  }
  const userId = decoded.uid;

  try {
    const service = await SchedulerService.create();

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const action = url.searchParams.get('action') || '';
      if (action === 'list') {
        return jsonResponse({ ok: true, schedules: await service.list(userId) }, 200, requestId);
      }
      if (action === 'get') {
        const record = await service.get(userId, url.searchParams.get('scheduleId') || '');
        if (!record) return jsonResponse({ ok: false, code: 'SCHEDULE_NOT_FOUND', error: 'Schedule not found for this user.' }, 404, requestId);
        const runs = await service.listRuns(userId, record.scheduleId, Number(url.searchParams.get('runLimit') || 20));
        return jsonResponse({ ok: true, schedule: record, runs }, 200, requestId);
      }
      if (action === 'runs') {
        const runs = await service.listRuns(userId, url.searchParams.get('scheduleId') || undefined, Number(url.searchParams.get('limit') || 50));
        return jsonResponse({ ok: true, runs }, 200, requestId);
      }
      return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
    }

    const parsed = await parseBody(request);
    if (parsed.response) return parsed.response;
    const body = parsed.body as Record<string, unknown>;
    const action = String(body.action || '');
    const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 2048) : undefined;
    const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId.trim() : '';

    const gate = async (args: Record<string, unknown>): Promise<Response | null> => {
      const decision = await permissionsGateway.evaluateAction({ toolName: 'scheduler_manage', args, userId, approvalToken });
      if (decision.allowed) return null;
      return jsonResponse({ ok: false, code: decision.requiresApproval ? 'APPROVAL_REQUIRED' : 'PERMISSION_DENIED', error: decision.reason, ...(decision.challenge ? { challenge: decision.challenge } : {}) }, 403, requestId);
    };

    if (action === 'create') {
      const input = {
        title: body.title,
        spec: body.spec,
        target: body.target,
        missedJobPolicy: (body.missedJobPolicy === 'catch_up_once' ? 'catch_up_once' : 'skip_to_next') as MissedJobPolicy,
        runNowIfOverdue: body.runNowIfOverdue === true,
      };
      const deny = await gate({ title: input.title, spec: input.spec, target: input.target });
      if (deny) return deny;
      const record = await service.create(userId, input as { title: string; spec: ScheduleSpec; target: ScheduleTarget; missedJobPolicy: MissedJobPolicy });
      return jsonResponse({ ok: true, schedule: record }, 201, requestId);
    }

    if (['pause', 'resume', 'cancel', 'edit'].includes(action)) {
      if (!scheduleId) return jsonResponse({ ok: false, code: 'INVALID_ARGUMENTS', error: 'scheduleId is required.' }, 400, requestId);
      const deny = await gate({ scheduleId, op: action });
      if (deny) return deny;
      if (action === 'pause') return jsonResponse({ ok: true, schedule: await service.pause(userId, scheduleId) }, 200, requestId);
      if (action === 'resume') return jsonResponse({ ok: true, schedule: await service.resume(userId, scheduleId) }, 200, requestId);
      if (action === 'cancel') return jsonResponse({ ok: true, schedule: await service.cancel(userId, scheduleId) }, 200, requestId);
      const patch = {
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(body.spec && typeof body.spec === 'object' ? { spec: body.spec as ScheduleSpec } : {}),
        ...(body.target && typeof body.target === 'object' ? { target: body.target as ScheduleTarget } : {}),
        ...(body.missedJobPolicy === 'catch_up_once' || body.missedJobPolicy === 'skip_to_next' ? { missedJobPolicy: body.missedJobPolicy as MissedJobPolicy } : {}),
      };
      return jsonResponse({ ok: true, schedule: await service.edit(userId, scheduleId, patch) }, 200, requestId);
    }

    return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
  } catch (err: any) {
    const mapped = mapError(err);
    return jsonResponse(mapped.body, mapped.status, requestId);
  }
};
