/**
 * Feature 01: external worker dispatch adapter.
 *
 * Netlify Functions are request/dispatch boundaries, not workers. After a
 * durable task is enqueued, this adapter notifies an external durable worker
 * (separately deployed service, queue, or scheduled job provider) to claim and
 * execute it. When no worker integration is configured the status is an
 * explicit `unavailable`; enqueue still persists the task and it will be picked
 * up on the next worker poll, but callers are never told execution is
 * guaranteed when it is not.
 */

export type DispatchProvider = 'worker-webhook' | 'qstash';

export type DispatchStatus =
  | { ok: true; provider: DispatchProvider }
  | { ok: false; provider: DispatchProvider | null; unavailableReason: string };

function isProduction(): boolean {
  return process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production';
}

export interface WorkerDispatchConfig {
  url?: string;
  token?: string;
  qstashToken?: string;
  qstashUrl?: string;
}

export function resolveWorkerDispatchConfig(): WorkerDispatchConfig {
  const env = process.env as Record<string, string | undefined>;
  return {
    url: env.WORKER_DISPATCH_URL?.trim() || undefined,
    token: env.WORKER_DISPATCH_TOKEN?.trim() || undefined,
    qstashToken: env.QSTASH_TOKEN?.trim() || undefined,
    qstashUrl: env.QSTASH_URL?.trim() || undefined,
  };
}

export function workerConfigured(): boolean {
  const cfg = resolveWorkerDispatchConfig();
  return Boolean(cfg.url || cfg.qstashToken);
}

/** Notify the external worker that a durable task is ready to claim. */
export async function dispatchTaskReady(params: {
  taskId: string;
  userId: string;
  type: string;
  executionId?: string;
}): Promise<DispatchStatus> {
  const cfg = resolveWorkerDispatchConfig();

  if (cfg.url) {
    try {
      const response = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
        },
        body: JSON.stringify({
          event: 'task.ready',
          taskId: params.taskId,
          userId: params.userId,
          type: params.type,
          executionId: params.executionId,
          dispatchedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return {
          ok: false,
          provider: 'worker-webhook',
          unavailableReason: `Worker dispatch endpoint returned HTTP ${response.status}.`,
        };
      }
      return { ok: true, provider: 'worker-webhook' };
    } catch (error) {
      return {
        ok: false,
        provider: 'worker-webhook' as const,
        unavailableReason: `Worker dispatch failed: ${error instanceof Error ? error.message : 'request failed'}.`,
      };
    }
  }

  if (cfg.qstashToken && cfg.qstashUrl) {
    try {
      const response = await fetch(`https://qstash.upstash.io/v2/publish/${cfg.qstashUrl}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.qstashToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'task.ready',
          taskId: params.taskId,
          userId: params.userId,
          type: params.type,
          executionId: params.executionId,
          dispatchedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return {
          ok: false,
          provider: 'qstash' as const,
          unavailableReason: `QStash publish returned HTTP ${response.status}.`,
        };
      }
      return { ok: true, provider: 'qstash' };
    } catch (error) {
      return {
        ok: false,
        provider: 'qstash' as const,
        unavailableReason: `QStash dispatch failed: ${error instanceof Error ? error.message : 'request failed'}.`,
      };
    }
  }

  return {
    ok: false,
    provider: null,
    unavailableReason: isProduction()
      ? 'No durable worker integration is configured. Tasks stay queued until a worker claims them.'
      : 'No durable worker integration is configured in this environment.',
  };
}
