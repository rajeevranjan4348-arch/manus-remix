/**
 * Feature 05: scheduler tick. Deployed as a Netlify scheduled function; the
 * schedule frequency is fixed to @hourly (Netlify requires a static cron
 * setting). For tighter recovery windows an external cron service may call the
 * worker endpoint with the shared worker token instead.
 */
import { scheduleEngine } from '../../server/scheduler/scheduleEngine';
import { durableTaskQueue } from '../../server/taskQueue/durableTaskQueue';
import { DurableEnqueue } from '../../server/scheduler/scheduleEngine';

const jsonResponse = (data: unknown, status = 200, requestId: string = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
  });

function verifyWorkerToken(req: Request): boolean {
  const expected = (process.env.WORKER_API_TOKEN || '').trim();
  if (expected.length < 32) return false;
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();

  if (req && typeof req === 'object' && 'headers' in req) {
    const isManual = req.headers.get('x-manual-invocation') === 'true' || (req.headers.get('authorization') || '').startsWith('Bearer ');
    if (isManual && !verifyWorkerToken(req)) {
      return jsonResponse({ ok: false, error: 'Worker token required for manual tick invocation.', code: 'UNAUTHENTICATED' }, 401, requestId);
    }
  }

  try {
    // Recover interrupted durable tasks first, then claim due schedules and
    // enqueue their executions into the Feature 01 queue.
    const recovered = durableTaskQueue.isDurable() ? await durableTaskQueue.recoverInterrupted() : 0;
    const enqueue: DurableEnqueue = async (p) => {
      const { task } = await durableTaskQueue.enqueue({
        userId: p.userId,
        type: p.type,
        payload: p.payload,
        idempotencyKey: p.idempotencyKey,
        priority: p.priority,
      });
      return { task: { id: task.id } };
    };
    const result = await scheduleEngine.tick({ enqueue });
    return jsonResponse({ ok: true, recovered, ...result, requestId }, 200, requestId);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: 'Scheduler tick failed.',
        detail: (error instanceof Error ? error.message : 'unknown').slice(0, 300),
        code: 'SCHEDULER_TICK_FAILED',
      },
      503,
      requestId,
    );
  }
};

export const config = {
  schedule: '@hourly',
};
