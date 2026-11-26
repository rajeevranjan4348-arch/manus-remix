/**
 * Feature 01 API: durable background task endpoints.
 * Request/dispatch boundary only — it never executes tasks itself.
 */
import { verifyBearerToken } from '../../src/middleware/auth';
import { durableTaskQueue } from '../../server/taskQueue/durableTaskQueue';
import { dispatchTaskReady, workerConfigured } from '../../server/taskQueue/workerDispatch';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';

const jsonResponse = (data: unknown, status = 200, requestId: string = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Request-ID': requestId,
    },
  });

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405, requestId);
  }
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401, requestId);
  }
  const userId = decodedToken.uid;
  const rateCheck = await checkSharedRateLimit(`tasks:${userId}`, 60, 60);
  if (!rateCheck.allowed) {
    return jsonResponse({ ok: false, error: 'Too many requests.', code: 'RATE_LIMITED' }, 429, requestId);
  }

  const parsed = await parseJsonBodyLimited(req, 512 * 1024);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error, code: parsed.code }, parsed.status, requestId);
  }
  const body: any = parsed.value;
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    if (action === 'enqueue') {
      if (typeof body.type !== 'string' || !body.type.trim()) {
        return jsonResponse({ ok: false, error: 'Task type is required.', code: 'INVALID_TASK_TYPE' }, 400, requestId);
      }
      if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload))) {
        return jsonResponse({ ok: false, error: 'Payload must be an object.', code: 'INVALID_PAYLOAD' }, 400, requestId);
      }
      const { created, task } = await durableTaskQueue.enqueue({
        userId,
        type: body.type.slice(0, 100),
        payload: body.payload ?? {},
        priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 5,
        maxAttempts: Number.isFinite(Number(body.maxAttempts)) ? Number(body.maxAttempts) : undefined,
        timeoutMs: Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : undefined,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.slice(0, 200) : undefined,
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId.slice(0, 128) : undefined,
      });
      const dispatch = dispatchTaskReady({ taskId: task.id, userId, type: task.type, executionId: task.executionId });
      void dispatch;
      return jsonResponse(
        {
          ok: true,
          created,
          task: {
            id: task.id,
            type: task.type,
            status: task.status,
            priority: task.priority,
            executionId: task.executionId ?? null,
            createdAt: task.createdAt,
          },
          execution: {
            // Honest execution contract: queued durably; real execution depends
            // on the configured external worker.
            workerConfigured: workerConfigured(),
            resumeAfterRelaunch: true,
          },
          requestId,
        },
        202,
        requestId,
      );
    }

    if (action === 'cancel') {
      if (typeof body.taskId !== 'string') {
        return jsonResponse({ ok: false, error: 'taskId is required.', code: 'INVALID_TASK_ID' }, 400, requestId);
      }
      const cancelled = await durableTaskQueue.requestCancellation(body.taskId.slice(0, 200), userId);
      if (!cancelled) {
        return jsonResponse({ ok: false, error: 'Task not found or already terminal.', code: 'NOT_FOUND' }, 404, requestId);
      }
      return jsonResponse({ ok: true, status: 'cancellation_requested', requestId }, 200, requestId);
    }

    if (action === 'list') {
      const tasks = await durableTaskQueue.listTasks(userId, Math.min(100, Math.max(1, Number(body.limit) || 50)));
      return jsonResponse({ ok: true, tasks, requestId }, 200, requestId);
    }

    if (action === 'get') {
      if (typeof body.taskId !== 'string') {
        return jsonResponse({ ok: false, error: 'taskId is required.', code: 'INVALID_TASK_ID' }, 400, requestId);
      }
      const task = await durableTaskQueue.getTask(body.taskId.slice(0, 200), userId);
      if (!task) {
        return jsonResponse({ ok: false, error: 'Task not found.', code: 'NOT_FOUND' }, 404, requestId);
      }
      return jsonResponse({ ok: true, task, requestId }, 200, requestId);
    }

    if (action === 'history') {
      if (typeof body.taskId !== 'string') {
        return jsonResponse({ ok: false, error: 'taskId is required.', code: 'INVALID_TASK_ID' }, 400, requestId);
      }
      const history = await durableTaskQueue.getExecutionHistory(body.taskId.slice(0, 200), userId);
      return jsonResponse({ ok: true, history, requestId }, 200, requestId);
    }

    return jsonResponse({ ok: false, error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task operation failed.';
    return jsonResponse(
      {
        ok: false,
        error: 'Durable task storage is unavailable.',
        detail: message.slice(0, 300),
        code: 'DURABLE_STORE_UNAVAILABLE',
      },
      503,
      requestId,
    );
  }
};
