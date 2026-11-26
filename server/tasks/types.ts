/**
 * Durable background task types (Feature 01).
 *
 * The authoritative record lives in Firestore. Process-local copies are caches
 * at best; every state transition is transactional in the durable store.
 * Lifecycle: queued -> claimed -> running -> completed | failed | cancelled | dead
 */

export type TaskStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead';

export interface TaskEvent {
  at: string;
  type: string;
  detail?: string;
  by?: string;
}

export interface TaskRecord {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  /** 0 (lowest) .. 10 (highest); higher priority is claimed first. */
  priority: number;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  /** Earliest time the task may be claimed (ISO). Drives backoff. */
  runAt: string;
  leaseSeconds: number;
  leaseExpiresAt?: string;
  claimedBy?: string;
  idempotencyKey?: string;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  result?: Record<string, unknown> | null;
  events: TaskEvent[];
  /** false when the backing store is process-local (non-durable degradation). */
  durable: boolean;
}

export interface TaskEnqueueParams {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  timeoutSeconds?: number;
  leaseSeconds?: number;
  idempotencyKey?: string;
  runAt?: string;
}

export interface TaskStore {
  readonly durable: boolean;
  init(): Promise<void>;
  /** Creates the task, or returns 'existing' when an idempotent duplicate exists. */
  createTask(task: TaskRecord): Promise<'created' | 'existing'>;
  getTask(id: string, userId: string): Promise<TaskRecord | null>;
  listForUser(userId: string, limit: number): Promise<TaskRecord[]>;
  /** Due = queued AND runAt <= now, highest priority first. */
  findDueTasks(nowIso: string, limit: number): Promise<TaskRecord[]>;
  /** Atomically transitions queued -> claimed for one worker. */
  claimTask(id: string, workerId: string, nowIso: string, leaseSeconds: number): Promise<TaskRecord | null>;
  /** Renews an owned lease (claimed or running). */
  heartbeat(id: string, workerId: string, nowIso: string, leaseSeconds: number): Promise<TaskRecord | null>;
  markRunning(id: string, workerId: string, nowIso: string): Promise<TaskRecord | null>;
  complete(id: string, workerId: string, nowIso: string, result: Record<string, unknown> | null): Promise<TaskRecord | null>;
  /** Records a failure; returns 'retry' | 'dead' | 'conflict'. */
  fail(id: string, workerId: string, nowIso: string, error: string, backoffMs: number): Promise<'retry' | 'dead' | 'conflict'>;
  /** Owner cancellation of a non-terminal task. */
  cancel(id: string, userId: string, nowIso: string, reason: string): Promise<boolean>;
  /** Requeues tasks whose lease expired without completion. */
  recoverExpiredLeases(nowIso: string, leaseSeconds: number): Promise<number>;
  /** User-scoped execution history count and recent stats. */
  statsForUser(userId: string): Promise<Record<string, number>>;
}

export const TASK_HARD_LIMITS = {
  maxAttempts: 10,
  maxConcurrentPerUser: 20,
  timeoutSeconds: 3600,
  leaseSeconds: 900,
  priorityMax: 10,
  payloadMaxBytes: 64 * 1024,
  listLimit: 100,
};
