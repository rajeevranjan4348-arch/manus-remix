/**
 * Netlify function: durable background task API (Feature 01).
 *
 * Endpoints (all authenticated with a Firebase bearer token):
 *   POST /api/tasks/enqueue   { type, payload, idempotencyKey?, priority?, ... }
 *   POST /api/tasks/cancel    { taskId }
 *   GET  /api/tasks/task?id=  single task with events (owner only)
 *   GET  /api/tasks/list      recent tasks + stats (owner only)
 *
 * Worker endpoints (x-dispatch-secret header; disabled when secret unset):
 *   POST /api/tasks/claim     { workerId, max? }
 *   POST /api/tasks/heartbeat { taskId, workerId }
 *   POST /api/tasks/running   { taskId, workerId }
 *   POST /api/tasks/complete  { taskId, workerId, result }
 *   POST /api/tasks/fail      { taskId, workerId, error }
 *
 * This function never executes task payloads. It is a durable bookkeeper.
 */

import crypto from 'crypto';
import { verifyBearerToken } from '../../src/middleware/auth';
import { resolveTaskStore } from '../../server/tasks/taskStore';
import { enqueueTask, describeDispatch, backoffMs } from '../../server/tasks/taskQueue';
import { TASK_HARD_LIMITS } from '../../server/tasks/types';

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

let durableCached: boolean | null = null;

function workerAuthorized(req: Request): boolean {
  const secret = (process.env.INFRA_DISPATCH_SECRET || '').trim();
  if (!secret) return false; // fail closed: worker routes disabled without configuration
  const provided = (req.headers.get('x-dispatch-secret') || '').trim();
  if (!provided || provided.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

async function readBody(req: Request): Promise<any> {
  const len = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(len) && len > 200_000) throw Object.assign(new Error('Payload too large.'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('x');
    return body;
  } catch {
    throw Object.assign(new Error('Malformed JSON payload.'), { code: 'BAD_REQUEST', status: 400 });
  }
}

function mapError(err: any) {
  const status = Number(err?.status) || 500;
  if (status < 500) return { status, body: { ok: false, code: String(err?.code || 'BAD_REQUEST'), error: String(err?.message || 'Invalid request.') } };
  return { status, body: { ok: false, code: 'INTERNAL_ERROR', error: 'Unexpected error in task API.' } };
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(\.netlify\/functions\/tasks|api\/tasks)/, '');
  try {
    const store = await resolveTaskStore();
    durableCached = store.durable;

    /* -------- Authenticated user routes -------- */
    if (['/enqueue', '/cancel', '/task', '/list'].includes(path) || path === '' || path === '/') {
      const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
      if (!decoded?.uid) return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401, requestId);
      const userId = decoded.uid;

      if (req.method === 'POST' && path === '/enqueue') {
        const body = await readBody(req);
        const result = await enqueueTask({
          userId,
          type: typeof body.type === 'string' ? body.type : '',
          payload: body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {},
          idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.slice(0, 128) : undefined,
          priority: typeof body.priority === 'number' ? body.priority : undefined,
          maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined,
          timeoutSeconds: typeof body.timeoutSeconds === 'number' ? body.timeoutSeconds : undefined,
          leaseSeconds: typeof body.leaseSeconds === 'number' ? body.leaseSeconds : undefined,
          runAt: typeof body.runAt === 'string' ? body.runAt : undefined,
        });
        return jsonResponse({ ok: true, ...describeDispatch(result.dispatch), task: result.task, idempotent: result.idempotent, durable: store.durable }, 202, requestId);
      }

      if (req.method === 'POST' && path === '/cancel') {
        const body = await readBody(req);
        const taskId = String(body.taskId || '');
        if (!taskId) return jsonResponse({ ok: false, code: 'INVALID_TASK_ID', error: 'taskId is required.' }, 400, requestId);
        const cancelled = await store.cancel(taskId, userId, new Date().toISOString(), typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'Cancelled by user');
        return jsonResponse({ ok: cancelled, code: cancelled ? undefined : 'NOT_CANCELLABLE', durable: store.durable }, cancelled ? 200 : 409, requestId);
      }

      if (req.method === 'GET' && path === '/task') {
        const taskId = url.searchParams.get('id') || '';
        const task = await store.getTask(taskId, userId);
        if (!task) return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Task not found for this user.' }, 404, requestId);
        return jsonResponse({ ok: true, task, durable: store.durable }, 200, requestId);
      }

      if (req.method === 'GET' && (path === '/list' || path === '')) {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
        const tasks = await store.listForUser(userId, limit);
        const stats = await store.statsForUser(userId);
        return jsonResponse({ ok: true, tasks, stats, durable: store.durable }, 200, requestId);
      }
    }

    /* -------- Worker routes (secret-authenticated) -------- */
    if (['/claim', '/heartbeat', '/running', '/complete', '/fail', '/recover'].includes(path)) {
      if (req.method !== 'POST') return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'POST required.' }, 405, requestId);
      if (!workerAuthorized(req)) return jsonResponse({ ok: false, code: 'WORKER_FORBIDDEN', error: 'Valid x-dispatch-secret required; worker routes fail closed when INFRA_DISPATCH_SECRET is unset.' }, 403, requestId);
      const body = await readBody(req);
      const nowIso = new Date().toISOString();
      const workerId = String(body.workerId || 'worker').slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '') || 'worker';

      if (path === '/claim') {
        const max = Math.min(10, Math.max(1, Number(body.max || 1)));
        const due = await store.findDueTasks(nowIso, max);
        const claimed: any[] = [];
        for (const t of due) {
          const claimedRecord = await store.claimTask(t.id, workerId, nowIso, t.leaseSeconds || 120);
          if (claimedRecord) claimed.push(claimedRecord);
        }
        return jsonResponse({ ok: true, tasks: claimed, durable: store.durable }, 200, requestId);
      }
      if (!body.taskId) return jsonResponse({ ok: false, code: 'INVALID_TASK_ID', error: 'taskId is required.' }, 400, requestId);
      if (path === '/heartbeat') {
        const t = await store.heartbeat(String(body.taskId), workerId, nowIso, Number(body.leaseSeconds || 120));
        return jsonResponse({ ok: Boolean(t), code: t ? undefined : 'LEASE_LOST', task: t }, t ? 200 : 409, requestId);
      }
      if (path === '/running') {
        const t = await store.markRunning(String(body.taskId), workerId, nowIso);
        return jsonResponse({ ok: Boolean(t), code: t ? undefined : 'LEASE_LOST' }, t ? 200 : 409, requestId);
      }
      if (path === '/complete') {
        const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result) ? body.result : null;
        const t = await store.complete(String(body.taskId), workerId, nowIso, result);
        return jsonResponse({ ok: Boolean(t), code: t ? undefined : 'LEASE_LOST', task: t }, t ? 200 : 409, requestId);
      }
      if (path === '/fail') {
        const t = await store.getTask(String(body.taskId), '*');
        const verdict = await store.fail(String(body.taskId), workerId, nowIso, String(body.error || 'Worker reported failure'), 30_000);
        return jsonResponse({ ok: verdict !== 'conflict', verdict }, verdict !== 'conflict' ? 200 : 409, requestId);
      }
    }

    if (req.method === 'POST' && path === '/recover') {
      // Lease-expiry sweep; also callable by an external cron with the worker secret.
      if (!workerAuthorized(req)) return jsonResponse({ ok: false, code: 'WORKER_FORBIDDEN', error: 'Valid x-dispatch-secret required.' }, 403, requestId);
      const recovered = await store.recoverExpiredLeases(new Date().toISOString());
      return jsonResponse({ ok: true, recovered, durable: store.durable }, 200, requestId);
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Unknown tasks route.' }, 404, requestId);
  } catch (err: any) {
    const mapped = mapError(err);
    return jsonResponse(mapped.body, mapped.status, requestId);
  }
};
