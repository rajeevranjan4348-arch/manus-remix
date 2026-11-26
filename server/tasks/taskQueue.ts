/**
 * Durable task queue service (Feature 01).
 *
 * Wraps the transactional TaskStore with platform policy: idempotency keys,
 * bounded limits, exponential backoff with deterministic jitter, dispatch to
 * the external worker, and honest dispatch status reporting. Netlify functions
 * enqueue/observe only; execution happens exclusively in the worker.
 */

import type { TaskEnqueueParams, TaskRecord } from './types';
import { TASK_HARD_LIMITS } from './types';
import { resolveTaskStore } from './taskStore';

function deterministicId(parts: string[]): string {
  // Ids must be stable for idempotency; derive from content without randomness.
  let hash = 2166136261;
  const input = parts.join('|');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'task_' + (hash >>> 0).toString(36) + '_' + input.length.toString(36);
}

/** Exponential backoff with deterministic per-task jitter (30s .. 1h). */
export function backoffMs(task: TaskRecord): number {
  let jitterSeed = 0;
  for (const ch of task.id) jitterSeed = (jitterSeed * 31 + ch.charCodeAt(0)) >>> 0;
  const jitter = jitterSeed % 10000; // 0..10s deterministic
  const base = Math.min(30_000 * Math.pow(2, task.attempts), 3_600_000);
  return base + jitter;
}

export interface DispatchOutcome {
  dispatched: boolean;
  reason: string;
}

/**
 * Notify the external worker that work is available. When no worker is
 * configured the task stays durably queued and this reports honestly.
 */
export async function dispatchToWorker(task: TaskRecord): Promise<DispatchOutcome> {
  const workerUrl = (process.env.TASK_WORKER_URL || '').trim();
  const secret = (process.env.INFRA_DISPATCH_SECRET || '').trim();
  if (!workerUrl) return { dispatched: false, reason: 'worker_unavailable: TASK_WORKER_URL not configured' };
  if (!secret) return { dispatched: false, reason: 'worker_unavailable: INFRA_DISPATCH_SECRET not configured' };
  try {
    const res = await fetch(workerUrl.replace(/\/$/, '') + '/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dispatch-secret': secret },
      body: JSON.stringify({ taskId: task.id }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok
      ? { dispatched: true, reason: 'worker notified' }
      : { dispatched: false, reason: 'worker_unavailable: dispatch returned HTTP ' + res.status };
  } catch (err: any) {
    return { dispatched: false, reason: 'worker_unavailable: ' + String(err?.message || 'dispatch failed') };
  }
}

export type EnqueueResult = {
  task: TaskRecord;
  idempotent: boolean;
  dispatch: DispatchOutcome;
};

export async function enqueueTask(params: TaskEnqueueParams): Promise<EnqueueResult> {
  const store = await resolveTaskStore();
  const type = String(params.type || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(type)) {
    throw Object.assign(new Error('Task type must be 2-64 chars of [a-zA-Z0-9._-].'), { code: 'INVALID_TASK_TYPE', status: 400 });
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(params.payload || {})).length;
  if (payloadBytes > TASK_HARD_LIMITS.payloadMaxBytes) {
    throw Object.assign(new Error('Payload exceeds 64KB.'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  }
  const priority = Math.max(0, Math.min(TASK_HARD_LIMITS.priorityMax, Math.round(params.priority ?? 0)));
  const maxAttempts = Math.max(1, Math.min(TASK_HARD_LIMITS.maxAttempts, Math.round(params.maxAttempts ?? 3)));
  const timeoutSeconds = Math.max(5, Math.min(TASK_HARD_LIMITS.timeoutSeconds, Math.round(params.timeoutSeconds ?? 900)));
  const leaseSeconds = Math.max(30, Math.min(TASK_HARD_LIMITS.leaseSeconds, Math.round(params.leaseSeconds ?? 120)));
  const now = new Date().toISOString();
  const runAt = params.runAt && !Number.isNaN(Date.parse(params.runAt)) ? new Date(params.runAt).toISOString() : now;

  const id = params.idempotencyKey
    ? deterministicId([params.userId, type, params.idempotencyKey])
    : deterministicId([params.userId, type, now, String(payloadBytes)]);

  const record: TaskRecord = {
    id,
    userId: params.userId,
    type,
    payload: params.payload || {},
    priority,
    status: 'queued',
    attempts: 0,
    maxAttempts,
    runAt,
    leaseSeconds,
    idempotencyKey: params.idempotencyKey,
    timeoutSeconds,
    createdAt: now,
    updatedAt: now,
    events: [{ at: now, type: 'enqueued', by: params.userId }],
    durable: store.durable,
  };

  const createOutcome = await store.createTask(record);
  if (createOutcome === 'existing') {
    const existing = await store.getTask(id, params.userId);
    if (existing) {
      return { task: existing, idempotent: true, dispatch: { dispatched: false, reason: 'idempotent-replay: task already exists' } };
    }
  }
  const dispatch = await dispatchToWorker(record);
  const fresh = await store.getTask(id, params.userId);
  return { task: fresh || record, idempotent: false, dispatch };
}

export function describeDispatch(dispatch: DispatchOutcome): { enqueued: boolean; execution: string; reason: string } {
  if (dispatch.dispatched) return { enqueued: true, execution: 'dispatched', reason: dispatch.reason };
  return { enqueued: true, execution: 'blocked_worker_unavailable', reason: dispatch.reason };
}
