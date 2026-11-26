/**
 * Feature 01 worker API: task claiming and lifecycle transitions.
 *
 * Authenticated with the shared worker token (WORKER_API_TOKEN), NOT a user
 * token: only the separately deployed durable worker may claim tasks. Each
 * mutation is an atomic transaction in Firestore, so concurrent workers cannot
 * double-execute a task.
 */
import { durableTaskQueue } from '../../server/taskQueue/durableTaskQueue';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';

const jsonResponse = (data: unknown, status = 200, requestId: string = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': requestId,
    },
  });

function verifyWorkerToken(req: Request): { ok: true } | { ok: false } {
  const expected = (process.env.WORKER_API_TOKEN || '').trim();
  if (expected.length < 32) return { ok: false };
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length !== expected.length || !timingSafeEqual(token, expected)) return { ok: false };
  return { ok: true };
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405, requestId);
  }
  const workerAuth = verifyWorkerToken(req);
  if (!workerAuth.ok) {
    return jsonResponse({ ok: false, error: 'Worker token required.', code: 'UNAUTHENTICATED' }, 401, requestId);
  }
  if (!durableTaskQueue.isDurable()) {
    return jsonResponse(
      { ok: false, error: 'Durable task store is not configured on this instance.', code: 'DURABLE_STORE_UNAVAILABLE' },
      503,
      requestId,
    );
  }

  const parsed = await parseJsonBodyLimited(req, 256 * 1024);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error, code: parsed.code }, parsed.status, requestId);
  }
  const body: any = parsed.value;
  const workerId = (typeof body.workerId === 'string' ? body.workerId : '').slice(0, 100);
  if (!workerId) {
    return jsonResponse({ ok: false, error: 'workerId is required.', code: 'INVALID_WORKER_ID' }, 400, requestId);
  }
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    switch (action) {
      case 'recover': {
        const recovered = await durableTaskQueue.recoverInterrupted();
        return jsonResponse({ ok: true, recovered, requestId }, 200, requestId);
      }
      case 'claim': {
        const task = await durableTaskQueue.claimNext({ workerId, maxConcurrentTasks: Number(body.maxConcurrentTasks) || 5 });
        if (!task) return jsonResponse({ ok: true, task: null, requestId }, 200, requestId);
        return jsonResponse({ ok: true, task, requestId }, 200, requestId);
      }
      case 'running': {
        const ok = await durableTaskQueue.markRunning({ taskId: String(body.taskId).slice(0, 200), workerId });
        return jsonResponse({ ok, requestId }, ok ? 200 : 409, requestId);
      }
      case 'complete': {
        const ok = await durableTaskQueue.complete({
          taskId: String(body.taskId).slice(0, 200),
          workerId,
          result: body.result ?? null,
        });
        return jsonResponse({ ok, requestId }, ok ? 200 : 409, requestId);
      }
      case 'fail': {
        const result = await durableTaskQueue.fail({
          taskId: String(body.taskId).slice(0, 200),
          workerId,
          error: String(body.error ?? 'worker reported failure').slice(0, 2000),
          retry: body.retry !== false,
        });
        return jsonResponse({ ok: true, ...result, requestId }, 200, requestId);
      }
      case 'confirm_cancel': {
        const ok = await durableTaskQueue.confirmCancellation(String(body.taskId).slice(0, 200), workerId);
        return jsonResponse({ ok, requestId }, ok ? 200 : 409, requestId);
      }
      default:
        return jsonResponse({ ok: false, error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, requestId);
    }
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: 'Durable task operation failed.',
        detail: (error instanceof Error ? error.message : 'unknown').slice(0, 300),
        code: 'TASK_OPERATION_FAILED',
      },
      500,
      requestId,
    );
  }
};
