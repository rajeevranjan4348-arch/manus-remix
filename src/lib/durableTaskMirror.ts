/**
 * Client-side mirror that forwards background jobs to the durable cloud task
 * queue (Feature 01). The local queue remains for optimistic UI; the durable
 * record is authoritative for execution. Mirroring is fire-and-forget and
 * silently skipped for unauthenticated sessions.
 */

import { observability } from './observability';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

export interface DurableTaskMirror {
  mirrorEnqueue(job: { id: string; type: string; payload: Record<string, any>; idempotencyKey?: string; maxRetries?: number }): Promise<void>;
}

export function createDurableTaskMirror(): DurableTaskMirror {
  const mirrored = new Set<string>();

  return {
    async mirrorEnqueue(job): Promise<void> {
      const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
      if (!authHeader) return;
      if (mirrored.has(job.id)) return;
      mirrored.add(job.id);
      if (mirrored.size > 100) {
        // Bound the local dedupe set.
        const first = mirrored.values().next().value;
        if (first) mirrored.delete(first);
      }
      try {
        const response = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({
            action: 'enqueue',
            type: job.type,
            payload: job.payload,
            idempotencyKey: job.idempotencyKey ?? `local-job:${job.id}`,
          }),
        });
        if (!response.ok && response.status !== 202) {
          observability.log({
            level: 'warning',
            category: 'durable_task_mirror',
            message: `Durable task mirror rejected for job ${job.id} (HTTP ${response.status}).`,
            details: { jobId: job.id, status: response.status },
          });
        }
      } catch {
        // Offline or endpoint unavailable: the local queue keeps functioning; a
        // later enqueue can re-mirror. Never surface fake durable success.
      }
    },
  };
}
