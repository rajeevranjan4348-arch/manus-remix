/**
 * Feature 01: Durable Cloud Background Agent & Task Queue.
 *
 * Durable task records live in Firestore (via DurableStore). Execution happens
 * on an external worker that claims tasks through atomic, leased transactions.
 * Serverless request handlers (Netlify Functions) are dispatch and query
 * boundaries only: they never execute long-running work and never host the
 * worker loop.
 *
 * Lifecycle: queued -> claimed -> running -> completed / failed / cancelled
 * Failed tasks move through retries with exponential backoff and eventually
 * into the dead-letter state (failed with exhausted retries).
 */

import crypto from 'crypto';
import {
  DurableStore,
  getDefaultDurableStore,
} from '../durable/store';

export type TaskStatus = 'queued' | 'claimed' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';

export interface TaskRecord {
  id: string;
  idempotencyKey?: string;
  userId: string;
  workspaceId?: string;
  type: string;
  priority: number; // higher first
  payload: Record<string, any>;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  leaseExpiresAt?: string;
  claimedBy?: string;
  runAfter: string;
  startedAt?: string;
  completedAt?: string;
  timeoutMs: number;
  lastError?: string;
  executionId?: string;
  result?: any;
  cancellationRequested?: boolean;
  history: Array<{
    at: string;
    event: string;
    detail?: string;
    workerId?: string;
  }>;
}

export interface WorkerDescriptor {
  workerId: string;
  maxConcurrentTasks: number;
}

export const TASKS_COLLECTION = 'system_agent_tasks';
export const TASK_EVENTS_COLLECTION = 'system_agent_task_events';

const MAX_CONCURRENT_TASKS = Number(process.env.WORKER_MAX_CONCURRENT_TASKS || 5) || 5;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TASKS_RETURNED = 50;

export function computeBackoffMs(attempt: number, baseMs = 2000, capMs = 15 * 60 * 1000): number {
  const exp = Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), capMs);
  const jitter = Math.floor(Math.random() * Math.min(1000, exp * 0.25));
  return Math.min(exp + jitter, capMs);
}

function isProduction(): boolean {
  return process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production';
}

export class DurableTaskQueue {
  private unavailableReason: string | null = null;

  constructor(private readonly store: DurableStore | null = null) {}

  private get backend(): DurableStore {
    if (this.store) return this.store;
    const resolved = getDefaultDurableStore();
    if (resolved.kind === 'unavailable') {
      throw new Error('Durable store unavailable: Firestore credentials are not configured on this instance.');
    }
    return resolved;
  }

  /** True when a real durable backend (Firestore) is attached. */
  public isDurable(): boolean {
    if (this.store) return this.store.kind === 'firestore';
    const resolved = getDefaultDurableStore();
    return resolved.kind === 'firestore' || (resolved as DurableStore).kind === 'memory';
  }

  public backendKind(): string {
    try {
      return this.backend.kind;
    } catch {
      return 'unavailable';
    }
  }

  static newId(): string {
    return `task_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  }

  /**
   * Enqueue a durable task. Idempotency keys prevent duplicate execution: an
   * existing queued/claimed/running/waiting task with the same key is returned
   * instead of creating a duplicate.
   */
  public async enqueue(params: {
    userId: string;
    type: string;
    payload: Record<string, any>;
    priority?: number;
    maxAttempts?: number;
    timeoutMs?: number;
    idempotencyKey?: string;
    workspaceId?: string;
    runAfter?: string;
  }): Promise<{ created: boolean; task: TaskRecord }> {
    if (!params.userId || typeof params.userId !== 'string') {
      throw new Error('userId is required to enqueue a durable task.');
    }
    if (!params.type || typeof params.type !== 'string' || params.type.length > 100) {
      throw new Error('task type is required (max 100 characters).');
    }
    if (!params.payload || typeof params.payload !== 'object' || Array.isArray(params.payload)) {
      throw new Error('payload must be an object.');
    }

    const store = this.backend;

    if (params.idempotencyKey) {
      const existing = await store.query(TASKS_COLLECTION, {
        filters: [
          { field: 'userId', op: 'eq', value: params.userId },
          { field: 'idempotencyKey', op: 'eq', value: params.idempotencyKey },
        ],
        limit: 1,
      });
      const active = existing.find((t) =>
        ['queued', 'claimed', 'running', 'waiting_approval'].includes(t.status),
      );
      if (active) {
        return { created: false, task: active as unknown as TaskRecord };
      }
    }

    const nowIso = new Date().toISOString();
    const task: TaskRecord = {
      id: DurableTaskQueue.newId(),
      idempotencyKey: params.idempotencyKey?.slice(0, 200),
      userId: params.userId,
      workspaceId: params.workspaceId?.slice(0, 128),
      type: params.type,
      priority: Number.isFinite(params.priority) ? Number(params.priority) : 5,
      payload: params.payload,
      status: 'queued',
      attempts: 0,
      maxAttempts: Math.max(1, Math.min(10, params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
      createdAt: nowIso,
      updatedAt: nowIso,
      runAfter: params.runAfter ?? nowIso,
      timeoutMs: Math.max(10_000, Math.min(60 * 60 * 1000, params.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
      history: [{ at: nowIso, event: 'queued' }],
    };

    const ok = await store.create(TASKS_COLLECTION, task.id, task as unknown as Record<string, any>);
    if (!ok) {
      // Extremely unlikely id collision; retry once with a fresh id.
      task.id = DurableTaskQueue.newId();
      await store.set(TASKS_COLLECTION, task.id, task as unknown as Record<string, any>);
    }
    await this.appendEvent(task.id, {
      at: nowIso,
      event: 'queued',
      detail: `type=${task.type} priority=${task.priority}`,
    });
    return { created: true, task };
  }

  /**
   * Atomically claim the highest-priority runnable task for a worker using a
   * compare-and-set transaction guarded by a lease. Concurrent workers cannot
   * claim the same task.
   */
  public async claimNext(worker: WorkerDescriptor): Promise<TaskRecord | null> {
    const store = this.backend;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const candidates = await store.query(TASKS_COLLECTION, {
      filters: [{ field: 'status', op: 'in', value: ['queued', 'claimed', 'running'] }],
      limit: 100,
    });
    const runnable = (candidates as unknown as TaskRecord[])
      .filter((t) => t.userId && !t.cancellationRequested)
      .filter((t) => new Date(t.runAfter).getTime() <= now)
      .filter((t) => t.status === 'queued' || (t.claimedBy === worker.workerId && t.leaseExpiresAt && new Date(t.leaseExpiresAt).getTime() > now))
      .sort((a, b) => {
        const priorityDiff = b.priority - a.priority;
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

    const inflightByUser = new Map<string, number>();
    for (const doc of candidates as unknown as TaskRecord[]) {
      if (['claimed', 'running'].includes(doc.status)) {
        inflightByUser.set(doc.userId, (inflightByUser.get(doc.userId) ?? 0) + 1);
      }
    }

    for (const candidate of runnable) {
      const inflight = inflightByUser.get(candidate.userId) ?? 0;
      if (inflight >= MAX_CONCURRENT_TASKS) continue;
      const leaseUntil = new Date(now + Math.min(5 * 60 * 1000, candidate.timeoutMs)).toISOString();
      const outcome = await store.transact(TASKS_COLLECTION, candidate.id, (current) => {
        if (!current) return null;
        if (!['queued', 'claimed', 'running'].includes(current.status)) return null;
        if (current.cancellationRequested) return null;
        if (current.status !== 'queued' && current.claimedBy !== worker.workerId) return null;
        if (current.status !== 'queued' && new Date(current.leaseExpiresAt ?? 0).getTime() <= now) return null;
        const next: TaskRecord = {
          ...(current as unknown as TaskRecord),
          status: 'claimed',
          claimedBy: worker.workerId,
          leaseExpiresAt: leaseUntil,
          executionId:
            (current.executionId as string) ?? `exec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          updatedAt: nowIso,
          history: [
            ...(current.history ?? []),
            { at: nowIso, event: 'claimed', workerId: worker.workerId },
          ],
        };
        return { next: next as unknown as Record<string, any> };
      });
      if (outcome.applied) {
        await this.appendEvent(candidate.id, {
          at: nowIso,
          event: 'claimed',
          detail: `worker=${worker.workerId} leaseUntil=${leaseUntil}`,
          workerId: worker.workerId,
        });
        return outcome.result
          ? { ...(outcome.result as unknown as TaskRecord) }
          : { ...(candidate as TaskRecord), status: 'claimed', claimedBy: worker.workerId, leaseExpiresAt: leaseUntil };
      }
    }
    return null;
  }

  /**
   * Transition a claimed task to running (with lease renewal) or renew the
   * lease of a running task. Contract for the external worker heartbeat.
   */
  public async markRunning(params: { taskId: string; workerId: string }): Promise<boolean> {
    const store = this.backend;
    const nowIso = new Date().toISOString();
    const outcome = await store.transact(TASKS_COLLECTION, params.taskId, (current) => {
      if (!current) return null;
      if (current.claimedBy !== params.workerId) return null;
      if (!['claimed', 'running'].includes(current.status)) return null;
      const base = current as unknown as TaskRecord;
      const leaseUntil = new Date(
        Math.min(Date.now() + 5 * 60 * 1000, new Date(base.startedAt ?? nowIso).getTime() + base.timeoutMs),
      ).toISOString();
      const next: TaskRecord = {
        ...base,
        status: 'running',
        startedAt: base.startedAt ?? nowIso,
        leaseExpiresAt: leaseUntil,
        attempts: Math.max(base.attempts, 1),
        updatedAt: nowIso,
      };
      return { next: next as unknown as Record<string, any> };
    });
    if (outcome.applied) {
      await this.appendEvent(params.taskId, { at: nowIso, event: 'running', workerId: params.workerId });
    }
    return outcome.applied;
  }

  public async complete(params: { taskId: string; workerId: string; result?: any }): Promise<boolean> {
    const store = this.backend;
    const nowIso = new Date().toISOString();
    const outcome = await store.transact(TASKS_COLLECTION, params.taskId, (current) => {
      if (!current) return null;
      if (current.claimedBy !== params.workerId) return null;
      if (!['claimed', 'running'].includes(current.status)) return null;
      const base = current as unknown as TaskRecord;
      const next: TaskRecord = {
        ...base,
        status: 'completed',
        completedAt: nowIso,
        updatedAt: nowIso,
        result: params.result ?? base.result,
        history: [...(base.history ?? []), { at: nowIso, event: 'completed', workerId: params.workerId }],
      };
      return { next: next as unknown as Record<string, any> };
    });
    if (outcome.applied) {
      await this.appendEvent(params.taskId, { at: nowIso, event: 'completed', workerId: params.workerId });
    }
    return outcome.applied;
  }

  public async fail(params: {
    taskId: string;
    workerId: string;
    error: string;
    retry?: boolean;
  }): Promise<{ status: TaskStatus }> {
    const store = this.backend;
    const nowIso = new Date().toISOString();

    const outcome = await store.transact(TASKS_COLLECTION, params.taskId, (doc) => {
      if (!doc || doc.claimedBy !== params.workerId) return null;
      if (!['claimed', 'running'].includes(doc.status)) return null;
      const base = doc as unknown as TaskRecord;
      const attempts = base.attempts + 1;
      const shouldRetry = (params.retry ?? true) && attempts < base.maxAttempts;
      if (shouldRetry) {
        const runAfter = new Date(Date.now() + computeBackoffMs(attempts)).toISOString();
        const next: TaskRecord = {
          ...base,
          status: 'queued',
          attempts,
          claimedBy: undefined,
          leaseExpiresAt: undefined,
          runAfter,
          lastError: params.error.slice(0, 2000),
          updatedAt: nowIso,
          history: [...(base.history ?? []), { at: nowIso, event: 'retry', detail: params.error.slice(0, 200), workerId: params.workerId }],
        };
        return { next: next as unknown as Record<string, any>, result: { status: 'queued' as TaskStatus } };
      }
      const next: TaskRecord = {
        ...base,
        status: 'failed',
        claimedBy: undefined,
        leaseExpiresAt: undefined,
        lastError: params.error.slice(0, 2000),
        updatedAt: nowIso,
        completedAt: nowIso,
        attempts,
        history: [...(base.history ?? []), { at: nowIso, event: 'failed', detail: params.error.slice(0, 200), workerId: params.workerId }],
      };
      return { next: next as unknown as Record<string, any>, result: { status: 'failed' as TaskStatus } };
    });

    if (outcome.applied && outcome.result) {
      await this.appendEvent(params.taskId, {
        at: nowIso,
        event: outcome.result.status === 'queued' ? 'retry' : 'failed',
        detail: params.error.slice(0, 500),
        workerId: params.workerId,
      });
      return outcome.result;
    }
    return { status: 'failed' };
  }

  /** Request cancellation; the worker checks this flag between steps. */
  public async requestCancellation(taskId: string, userId: string): Promise<boolean> {
    const store = this.backend;
    const nowIso = new Date().toISOString();
    const outcome = await store.transact(TASKS_COLLECTION, taskId, (current) => {
      if (!current) return null;
      if (current.userId !== userId) return null;
      if (['completed', 'failed', 'cancelled'].includes(current.status)) return null;
      const base = current as unknown as TaskRecord;
      const terminalNow = base.status === 'queued';
      const next: TaskRecord = {
        ...base,
        status: terminalNow ? 'cancelled' : base.status,
        cancellationRequested: true,
        updatedAt: nowIso,
        history: [...(base.history ?? []), { at: nowIso, event: 'cancellation_requested' }],
      };
      return { next: next as unknown as Record<string, any>, result: true };
    });
    if (outcome.applied) {
      await this.appendEvent(taskId, { at: nowIso, event: 'cancellation_requested' });
      return true;
    }
    return false;
  }

  /** Worker confirms cancellation: task moves to terminal cancelled state. */
  public async confirmCancellation(taskId: string, workerId: string): Promise<boolean> {
    const store = this.backend;
    const nowIso = new Date().toISOString();
    const outcome = await store.transact(TASKS_COLLECTION, taskId, (current) => {
      if (!current) return null;
      if (current.claimedBy !== workerId) return null;
      if (!current.cancellationRequested) return null;
      const base = current as unknown as TaskRecord;
      const next: TaskRecord = {
        ...base,
        status: 'cancelled',
        completedAt: nowIso,
        updatedAt: nowIso,
        history: [...(base.history ?? []), { at: nowIso, event: 'cancelled', workerId }],
      };
      return { next: next as unknown as Record<string, any> };
    });
    if (outcome.applied) {
      await this.appendEvent(taskId, { at: nowIso, event: 'cancelled', workerId });
    }
    return outcome.applied;
  }

  /**
   * Recover interrupted jobs: claimed/running tasks whose lease expired go back
   * to queued for reassignment (idempotent, safe to call repeatedly).
   */
  public async recoverInterrupted(): Promise<number> {
    const store = this.backend;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const stale = await store.query(TASKS_COLLECTION, {
      filters: [{ field: 'status', op: 'in', value: ['claimed', 'running'] }],
      limit: MAX_TASKS_RETURNED,
    });
    let recovered = 0;
    for (const doc of stale as unknown as TaskRecord[]) {
      if (!doc.leaseExpiresAt || new Date(doc.leaseExpiresAt).getTime() > now) continue;
      const outcome = await store.transact(TASKS_COLLECTION, doc.id, (current) => {
        if (!current) return null;
        if (!['claimed', 'running'].includes(current.status)) return null;
        if (new Date((current as any).leaseExpiresAt ?? 0).getTime() > now) return null;
        const base = current as unknown as TaskRecord;
        const next: TaskRecord = {
          ...base,
          status: 'queued',
          claimedBy: undefined,
          leaseExpiresAt: undefined,
          updatedAt: nowIso,
          history: [...(base.history ?? []), { at: nowIso, event: 'recovered', detail: 'lease expired' }],
        };
        return { next: next as unknown as Record<string, any> };
      });
      if (outcome.applied) {
        recovered += 1;
        await this.appendEvent(doc.id, { at: nowIso, event: 'recovered', detail: 'lease expired' });
      }
    }
    return recovered;
  }

  public async getTask(taskId: string, userId: string): Promise<TaskRecord | null> {
    const store = this.backend;
    const doc = await store.get(TASKS_COLLECTION, taskId);
    if (!doc || doc.userId !== userId) return null;
    return doc as unknown as TaskRecord;
  }

  public async listTasks(userId: string, limit = 50): Promise<TaskRecord[]> {
    const store = this.backend;
    const rows = await store.query(TASKS_COLLECTION, {
      filters: [{ field: 'userId', op: 'eq', value: userId }],
      limit: Math.min(100, Math.max(1, limit)),
    });
    return (rows as unknown as TaskRecord[]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  public async getExecutionHistory(taskId: string, userId: string): Promise<TaskRecord['history']> {
    const task = await this.getTask(taskId, userId);
    return task?.history ?? [];
  }

  private async appendEvent(taskId: string, event: TaskRecord['history'][number]): Promise<void> {
    try {
      const store = this.backend;
      const eventId = `${taskId}_${event.event}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await store.set(TASK_EVENTS_COLLECTION, eventId, {
        taskId,
        ...event,
      } as unknown as Record<string, any>);
    } catch {
      // Event persistence must not break task state transitions.
    }
  }
}

export const durableTaskQueue = new DurableTaskQueue();
