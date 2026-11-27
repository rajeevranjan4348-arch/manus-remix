/**
 * Feature 01 — Durable Cloud Background Agent & Task Queue Engine.
 *
 * Architecture:
 * - Persists background tasks in Firestore / Upstash Redis via DurableCollectionStore.
 * - Enforces atomic task leasing (SET NX PX / CAS) so concurrent workers never execute
 *   the same task twice.
 * - Supports priority ordering, per-user concurrency caps, exponential backoff retries,
 *   dead-letter routing, execution timeouts, expired-lease recovery, idempotency keys,
 *   cancellation, real-time execution phases, execution history, and durable notifications.
 * - Dispatches work to an external durable worker (BACKGROUND_WORKER_URL + HMAC-SHA256)
 *   or Upstash QStash (QSTASH_URL + QSTASH_TOKEN). Netlify Functions are NEVER treated as
 *   permanent background daemon workers.
 */

import crypto from 'node:crypto';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from '../infrastructure/durableCollectionStore';
import {
  permissionsGateway,
  type PermissionsGatewayService,
} from '../permissionsGateway';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
  type PersistenceMode,
} from '../sandbox/durableStore';
import { defaultLiveSyncHub, type LiveSyncHub } from '../realtime/liveSyncHub';

export type BackgroundTaskStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

export type BackgroundTaskPhase =
  | 'queued'
  | 'waiting_for_approval'
  | 'running'
  | 'waiting_for_agent'
  | 'executing_command'
  | 'browser_session_active'
  | 'testing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type BackgroundTaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type BackgroundTaskType =
  | 'research'
  | 'coding'
  | 'automation'
  | 'multi_agent'
  | 'scheduled'
  | 'skill'
  | 'general';

export interface BackgroundTaskHistoryEntry {
  timestamp: string;
  event:
    | 'queued'
    | 'dispatched'
    | 'claimed'
    | 'started'
    | 'progress'
    | 'retry_scheduled'
    | 'lease_recovered'
    | 'completed'
    | 'failed'
    | 'dead_lettered'
    | 'cancelled';
  message: string;
  workerId?: string;
  attempt?: number;
  phase?: BackgroundTaskPhase;
  metadata?: Record<string, unknown>;
}

export interface BackgroundTaskRecord {
  taskId: string;
  userId: string;
  type: BackgroundTaskType;
  title: string;
  prompt: string;
  payload: Record<string, unknown>;
  status: BackgroundTaskStatus;
  phase: BackgroundTaskPhase;
  priority: BackgroundTaskPriority;
  priorityScore: number;
  progress: number;
  idempotencyKey?: string;
  scheduleId?: string;
  attempt: number;
  maxAttempts: number;
  baseBackoffMs: number;
  timeoutMs: number;
  nextAttemptAt: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  workerDispatchState: 'not_configured' | 'dispatched' | 'failed';
  workerDispatchDetail?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  history: BackgroundTaskHistoryEntry[];
}

export interface DurableNotificationRecord {
  notificationId: string;
  userId: string;
  kind: 'task_completed' | 'task_failed' | 'approval_required' | 'schedule_reminder' | 'schedule_executed' | 'system';
  title: string;
  body: string;
  taskId?: string;
  scheduleId?: string;
  read: boolean;
  createdAt: string;
  readAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalWorkerDispatchResult {
  dispatched: boolean;
  provider: 'external_worker' | 'qstash' | 'none';
  messageId?: string;
  detail: string;
}

export interface ExternalWorkerDispatcher {
  isConfigured(): boolean;
  getProviderName(): 'external_worker' | 'qstash' | 'none';
  dispatch(task: BackgroundTaskRecord): Promise<ExternalWorkerDispatchResult>;
}

export class BackgroundTaskEngineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'TASK_ENGINE_ERROR', statusCode = 400) {
    super(message);
    this.name = 'BackgroundTaskEngineError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const PRIORITY_SCORES: Record<BackgroundTaskPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
};

const TASKS_COLLECTION = 'background_tasks';
const IDEMPOTENCY_COLLECTION = 'background_task_idempotency';
const NOTIFICATIONS_COLLECTION = 'notifications';

export function computeWorkerSignature(rawBody: string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyWorkerSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!secret || secret.length < 16 || !signatureHeader) return false;
  const expected = computeWorkerSignature(rawBody, secret);
  const provided = signatureHeader.trim();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Default external durable worker dispatcher:
 * 1) Upstash QStash (QSTASH_URL + QSTASH_TOKEN + BACKGROUND_WORKER_URL)
 * 2) Direct HMAC-signed webhook to an external long-running worker (BACKGROUND_WORKER_URL + BACKGROUND_WORKER_SECRET)
 * If neither is configured, honestly reports 'not_configured' instead of pretending a serverless function is a daemon.
 */
export class DefaultExternalWorkerDispatcher implements ExternalWorkerDispatcher {
  public getProviderName(): 'external_worker' | 'qstash' | 'none' {
    const workerUrl = (process.env.BACKGROUND_WORKER_URL || '').trim();
    const qstashToken = (process.env.QSTASH_TOKEN || '').trim();
    if (workerUrl && qstashToken) return 'qstash';
    if (workerUrl) return 'external_worker';
    return 'none';
  }

  public isConfigured(): boolean {
    return this.getProviderName() !== 'none';
  }

  public async dispatch(task: BackgroundTaskRecord): Promise<ExternalWorkerDispatchResult> {
    const workerUrl = (process.env.BACKGROUND_WORKER_URL || '').trim();
    const workerSecret = (process.env.BACKGROUND_WORKER_SECRET || '').trim();
    const qstashToken = (process.env.QSTASH_TOKEN || '').trim();
    const qstashUrl = (process.env.QSTASH_URL || 'https://qstash.upstash.io/v2/publish').trim().replace(/\/$/, '');

    if (!workerUrl) {
      return {
        dispatched: false,
        provider: 'none',
        detail: 'Task persisted durably in queue; set BACKGROUND_WORKER_URL (and BACKGROUND_WORKER_SECRET or QSTASH_TOKEN) for automatic external cloud worker dispatch.',
      };
    }

    const payloadBody = JSON.stringify({
      event: 'background_task.queued',
      taskId: task.taskId,
      userId: task.userId,
      type: task.type,
      priority: task.priority,
      attempt: task.attempt,
      queuedAt: task.createdAt,
    });

    try {
      if (qstashToken) {
        const publishTarget = `${qstashUrl}/${encodeURIComponent(workerUrl)}`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Deduplication-Id': `${task.taskId}_attempt_${task.attempt}`,
        };
        if (workerSecret) {
          headers['Upstash-Forward-x-worker-signature'] = computeWorkerSignature(payloadBody, workerSecret);
        }
        const res = await fetch(publishTarget, {
          method: 'POST',
          headers,
          body: payloadBody,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          return {
            dispatched: false,
            provider: 'qstash',
            detail: `QStash dispatch rejected with HTTP ${res.status}. Task remains durably queued for retry/claim.`,
          };
        }
        const data = (await res.json().catch(() => ({}))) as { messageId?: string };
        return {
          dispatched: true,
          provider: 'qstash',
          messageId: data.messageId,
          detail: 'Dispatched via Upstash QStash durable queue.',
        };
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (workerSecret) {
        headers['x-worker-signature'] = computeWorkerSignature(payloadBody, workerSecret);
      }
      const res = await fetch(workerUrl, {
        method: 'POST',
        headers,
        body: payloadBody,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return {
          dispatched: false,
          provider: 'external_worker',
          detail: `External worker webhook returned HTTP ${res.status}. Task remains durably queued.`,
        };
      }
      return {
        dispatched: true,
        provider: 'external_worker',
        detail: 'Dispatched to external durable worker endpoint.',
      };
    } catch (err) {
      return {
        dispatched: false,
        provider: this.getProviderName(),
        detail: err instanceof Error ? `Dispatch transport error: ${err.message}` : 'External worker dispatch failed.',
      };
    }
  }
}

export interface BackgroundTaskEngineOptions {
  store?: DurableCollectionStore;
  auditStore?: DurableExecutionStore;
  permissions?: PermissionsGatewayService;
  dispatcher?: ExternalWorkerDispatcher;
  syncHub?: LiveSyncHub;
  maxConcurrentPerUser?: number;
  defaultLeaseMs?: number;
  defaultTimeoutMs?: number;
  defaultMaxAttempts?: number;
  defaultBaseBackoffMs?: number;
  workerSecret?: string;
}

export class BackgroundTaskEngine {
  private readonly store: DurableCollectionStore;
  private readonly auditStore: DurableExecutionStore;
  private readonly permissions: PermissionsGatewayService;
  private readonly dispatcher: ExternalWorkerDispatcher;
  private readonly syncHub: LiveSyncHub;
  private readonly maxConcurrentPerUser: number;
  private readonly defaultLeaseMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxAttempts: number;
  private readonly defaultBaseBackoffMs: number;
  private readonly explicitWorkerSecret?: string;

  constructor(options?: BackgroundTaskEngineOptions) {
    this.store = options?.store ?? defaultCollectionStore;
    this.auditStore = options?.auditStore ?? defaultDurableStore;
    this.permissions = options?.permissions ?? permissionsGateway;
    this.dispatcher = options?.dispatcher ?? new DefaultExternalWorkerDispatcher();
    this.syncHub = options?.syncHub ?? defaultLiveSyncHub;
    this.maxConcurrentPerUser = Math.max(1, options?.maxConcurrentPerUser ?? 3);
    this.defaultLeaseMs = Math.max(5_000, options?.defaultLeaseMs ?? 60_000);
    this.defaultTimeoutMs = Math.max(5_000, options?.defaultTimeoutMs ?? 15 * 60_000);
    this.defaultMaxAttempts = Math.max(1, options?.defaultMaxAttempts ?? 3);
    this.defaultBaseBackoffMs = Math.max(100, options?.defaultBaseBackoffMs ?? 2_000);
    this.explicitWorkerSecret = options?.workerSecret;
  }

  public getHealth(ctx?: DurableRequestContext): {
    persistenceMode: PersistenceMode;
    workerProvider: 'external_worker' | 'qstash' | 'none';
    externalWorkerConfigured: boolean;
    workerAuthConfigured: boolean;
    maxConcurrentPerUser: number;
  } {
    const workerSecret = this.resolveWorkerSecret();
    return {
      persistenceMode: this.store.getMode(ctx),
      workerProvider: this.dispatcher.getProviderName(),
      externalWorkerConfigured: this.dispatcher.isConfigured(),
      workerAuthConfigured: workerSecret.length >= 16,
      maxConcurrentPerUser: this.maxConcurrentPerUser,
    };
  }

  public resolveWorkerSecret(): string {
    return (this.explicitWorkerSecret ?? process.env.BACKGROUND_WORKER_SECRET ?? '').trim();
  }

  public verifyWorkerRequest(rawBody: string, headers: Headers): boolean {
    const secret = this.resolveWorkerSecret();
    if (secret.length < 16) return false;
    const sig = headers.get('x-worker-signature');
    if (sig && verifyWorkerSignature(rawBody, sig, secret)) {
      return true;
    }
    const direct = (headers.get('x-worker-secret') || '').trim();
    if (!direct) return false;
    const a = Buffer.from(direct, 'utf8');
    const b = Buffer.from(secret, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Create & durably persist a background task with idempotency deduplication and optional external worker dispatch.
   */
  public async enqueueTask(
    ctx: DurableRequestContext,
    input: {
      title: string;
      prompt: string;
      type?: BackgroundTaskType;
      priority?: BackgroundTaskPriority;
      payload?: Record<string, unknown>;
      idempotencyKey?: string;
      scheduleId?: string;
      maxAttempts?: number;
      timeoutMs?: number;
      baseBackoffMs?: number;
      skipDispatch?: boolean;
    },
  ): Promise<{ task: BackgroundTaskRecord; deduplicated: boolean; dispatch?: ExternalWorkerDispatchResult }> {
    const title = (input.title || '').trim().slice(0, 180);
    const prompt = (input.prompt || '').trim().slice(0, 20_000);
    if (!title || !prompt) {
      throw new BackgroundTaskEngineError('title and prompt are required.', 'INVALID_TASK_INPUT', 400);
    }

    const idempotencyKey = input.idempotencyKey?.trim().slice(0, 128);
    if (idempotencyKey) {
      const idemDocId = `idem_${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
      const existingRef = await this.store.get<{ taskId: string }>(ctx, IDEMPOTENCY_COLLECTION, idemDocId);
      if (existingRef?.taskId) {
        const existingTask = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, existingRef.taskId);
        if (existingTask) {
          return { task: existingTask, deduplicated: true };
        }
      }
    }

    const priority: BackgroundTaskPriority =
      input.priority && PRIORITY_SCORES[input.priority] ? input.priority : 'normal';
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const taskId = `task_${nowMs}_${crypto.randomBytes(5).toString('hex')}`;

    const task: BackgroundTaskRecord = {
      taskId,
      userId: ctx.userId,
      type: input.type || 'general',
      title,
      prompt,
      payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
      status: 'queued',
      phase: 'queued',
      priority,
      priorityScore: PRIORITY_SCORES[priority],
      progress: 0,
      idempotencyKey,
      scheduleId: input.scheduleId,
      attempt: 0,
      maxAttempts: Math.min(10, Math.max(1, input.maxAttempts ?? this.defaultMaxAttempts)),
      baseBackoffMs: Math.max(50, input.baseBackoffMs ?? this.defaultBaseBackoffMs),
      timeoutMs: Math.min(60 * 60_000, Math.max(1_000, input.timeoutMs ?? this.defaultTimeoutMs)),
      nextAttemptAt: nowMs,
      workerDispatchState: 'not_configured',
      createdAt: nowIso,
      updatedAt: nowIso,
      history: [
        {
          timestamp: nowIso,
          event: 'queued',
          message: `Task queued with priority '${priority}'.`,
          phase: 'queued',
        },
      ],
    };

    await this.store.put(ctx, TASKS_COLLECTION, taskId, task);

    if (idempotencyKey) {
      const idemDocId = `idem_${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
      await this.store.put(ctx, IDEMPOTENCY_COLLECTION, idemDocId, {
        taskId,
        idempotencyKey,
        createdAt: nowIso,
      });
    }

    let dispatchResult: ExternalWorkerDispatchResult | undefined;
    if (!input.skipDispatch) {
      dispatchResult = await this.dispatcher.dispatch(task);
      task.workerDispatchState = dispatchResult.dispatched
        ? 'dispatched'
        : dispatchResult.provider === 'none'
          ? 'not_configured'
          : 'failed';
      task.workerDispatchDetail = dispatchResult.detail;
      task.updatedAt = new Date().toISOString();
      task.history.push({
        timestamp: task.updatedAt,
        event: 'dispatched',
        message: dispatchResult.detail,
        metadata: { provider: dispatchResult.provider, dispatched: dispatchResult.dispatched },
      });
      await this.store.put(ctx, TASKS_COLLECTION, taskId, task);
    }

    await this.permissions.recordSecurityAuditDurable(
      ctx,
      {
        action: 'enqueue_background_task',
        category: 'background_task',
        resourceId: taskId,
        status: 'succeeded',
        details: { type: task.type, priority: task.priority, scheduleId: task.scheduleId || null },
      },
      this.auditStore,
    );

    await this.syncHub.publish(ctx, {
      type: 'task:queued',
      title: `Queued: ${task.title}`,
      message: `Background task queued (${task.priority} priority).`,
      resourceId: task.taskId,
      taskId: task.taskId,
      scheduleId: task.scheduleId,
      severity: 'info',
      notifyUser: false,
      data: { status: task.status, phase: task.phase, progress: task.progress, priority: task.priority },
    });

    return { task, deduplicated: false, dispatch: dispatchResult };
  }

  public async getTask(ctx: DurableRequestContext, taskId: string): Promise<BackgroundTaskRecord | null> {
    const task = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, taskId);
    if (!task || task.userId !== ctx.userId) return null;
    return task;
  }

  public async listTasks(
    ctx: DurableRequestContext,
    options?: { status?: BackgroundTaskStatus; limit?: number },
  ): Promise<BackgroundTaskRecord[]> {
    const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
    const all = await this.store.list<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, 200);
    return all
      .filter((t) => (!options?.status || t.status === options.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Atomically claim the highest-priority eligible task respecting per-user concurrency caps.
   * Safe for concurrent workers: uses per-task atomic leases so only one worker wins.
   */
  public async claimNextTask(
    workerId: string,
    options?: { leaseMs?: number; userId?: string; nowMs?: number },
  ): Promise<BackgroundTaskRecord | null> {
    if (!workerId || !workerId.trim()) {
      throw new BackgroundTaskEngineError('workerId is required to claim tasks.', 'INVALID_WORKER_ID', 400);
    }
    const nowMs = options?.nowMs ?? Date.now();
    const leaseMs = Math.max(1_000, options?.leaseMs ?? this.defaultLeaseMs);

    const allTasks = options?.userId
      ? await this.store.list<BackgroundTaskRecord>({ userId: options.userId }, TASKS_COLLECTION, 200)
      : await this.store.listAllForSystem<BackgroundTaskRecord>(TASKS_COLLECTION, 200);

    // Count active (claimed/running) tasks per user to enforce concurrency limits
    const activeByUser = new Map<string, number>();
    for (const t of allTasks) {
      if ((t.status === 'claimed' || t.status === 'running') && (!t.leaseExpiresAt || t.leaseExpiresAt > nowMs)) {
        activeByUser.set(t.userId, (activeByUser.get(t.userId) || 0) + 1);
      }
    }

    // Eligible queued tasks sorted by priority DESC, then createdAt ASC (FIFO within priority)
    const candidates = allTasks
      .filter((t) => t.status === 'queued' && t.nextAttemptAt <= nowMs)
      .sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

    for (const candidate of candidates) {
      const activeCount = activeByUser.get(candidate.userId) || 0;
      if (activeCount >= this.maxConcurrentPerUser) {
        continue;
      }

      // Per-user concurrency gate lease prevents two workers from both exceeding the cap simultaneously
      const userSlotKey = `task_claim_user:${candidate.userId}`;
      const userSlotLock = await this.store.tryAcquireLease(userSlotKey, workerId, 5_000);
      if (!userSlotLock.acquired) {
        continue;
      }

      try {
        // Re-check user active count under lock
        const freshUserTasks = await this.store.list<BackgroundTaskRecord>(
          { userId: candidate.userId },
          TASKS_COLLECTION,
          200,
        );
        const currentActive = freshUserTasks.filter(
          (t) => (t.status === 'claimed' || t.status === 'running') && (!t.leaseExpiresAt || t.leaseExpiresAt > nowMs),
        ).length;
        if (currentActive >= this.maxConcurrentPerUser) {
          continue;
        }

        const taskLeaseKey = `task_lease:${candidate.taskId}`;
        const lease = await this.store.tryAcquireLease(taskLeaseKey, workerId, leaseMs);
        if (!lease.acquired) {
          continue;
        }

        const taskCtx: DurableRequestContext = { userId: candidate.userId };
        const cas = await this.store.compareAndSwap<BackgroundTaskRecord>(
          taskCtx,
          TASKS_COLLECTION,
          candidate.taskId,
          (current) => {
            if (!current || current.status !== 'queued' || current.nextAttemptAt > nowMs) {
              return { commit: false };
            }
            const claimedIso = new Date(nowMs).toISOString();
            const next: BackgroundTaskRecord = {
              ...current,
              status: 'claimed',
              phase: 'running',
              attempt: current.attempt + 1,
              leaseOwner: workerId,
              leaseExpiresAt: nowMs + leaseMs,
              updatedAt: claimedIso,
              history: [
                ...current.history,
                {
                  timestamp: claimedIso,
                  event: 'claimed',
                  message: `Claimed by worker '${workerId}' (attempt ${current.attempt + 1}/${current.maxAttempts}).`,
                  workerId,
                  attempt: current.attempt + 1,
                  phase: 'running',
                },
              ],
            };
            return { commit: true, next };
          },
        );

        if (cas.committed && cas.value) {
          await this.syncHub.publish(taskCtx, {
            type: 'task:claimed',
            title: `Started: ${cas.value.title}`,
            message: `Claimed by worker '${workerId}' (attempt ${cas.value.attempt}/${cas.value.maxAttempts}).`,
            resourceId: cas.value.taskId,
            taskId: cas.value.taskId,
            scheduleId: cas.value.scheduleId,
            severity: 'info',
            notifyUser: false,
            data: { status: cas.value.status, phase: cas.value.phase, workerId, attempt: cas.value.attempt },
          });
          return cas.value;
        }
        await this.store.releaseLease(taskLeaseKey, workerId);
      } finally {
        await this.store.releaseLease(userSlotKey, workerId);
      }
    }

    return null;
  }

  /**
   * Transition a claimed task into 'running' or update live phase/progress.
   */
  public async updateTaskProgress(
    ctx: DurableRequestContext,
    params: {
      taskId: string;
      workerId: string;
      phase?: BackgroundTaskPhase;
      progress?: number;
      message?: string;
      metadata?: Record<string, unknown>;
      leaseMs?: number;
    },
  ): Promise<BackgroundTaskRecord> {
    const existing = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, params.taskId);
    if (!existing) {
      throw new BackgroundTaskEngineError('Task not found.', 'TASK_NOT_FOUND', 404);
    }
    if (existing.status === 'cancelled') {
      throw new BackgroundTaskEngineError('Task has been cancelled.', 'TASK_CANCELLED', 409);
    }
    if (existing.leaseOwner !== params.workerId) {
      throw new BackgroundTaskEngineError('Worker does not hold the active lease for this task.', 'LEASE_MISMATCH', 409);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const leaseMs = Math.max(1_000, params.leaseMs ?? this.defaultLeaseMs);
    await this.store.renewLease(`task_lease:${params.taskId}`, params.workerId, leaseMs);

    const wasClaimed = existing.status === 'claimed';
    existing.status = 'running';
    if (!existing.startedAt) existing.startedAt = nowIso;
    if (params.phase) existing.phase = params.phase;
    if (typeof params.progress === 'number' && Number.isFinite(params.progress)) {
      existing.progress = Math.min(100, Math.max(0, Math.round(params.progress)));
    }
    existing.leaseExpiresAt = nowMs + leaseMs;
    existing.updatedAt = nowIso;
    existing.history.push({
      timestamp: nowIso,
      event: wasClaimed ? 'started' : 'progress',
      message: params.message || `Task phase updated to '${existing.phase}' (${existing.progress}%).`,
      workerId: params.workerId,
      attempt: existing.attempt,
      phase: existing.phase,
      metadata: params.metadata,
    });

    await this.store.put(ctx, TASKS_COLLECTION, existing.taskId, existing);
    await this.syncHub.publish(ctx, {
      type: 'task:progress',
      title: existing.title,
      message: params.message || `Task phase updated to '${existing.phase}' (${existing.progress}%).`,
      resourceId: existing.taskId,
      taskId: existing.taskId,
      scheduleId: existing.scheduleId,
      severity: 'info',
      notifyUser: false,
      data: { status: existing.status, phase: existing.phase, progress: existing.progress },
    });
    return existing;
  }

  /**
   * Renew an active worker lease (heartbeat) so long-running tasks do not get recovered while alive.
   */
  public async renewTaskLease(
    ctx: DurableRequestContext,
    taskId: string,
    workerId: string,
    leaseMs?: number,
  ): Promise<{ renewed: boolean; leaseExpiresAt?: number }> {
    const existing = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, taskId);
    if (!existing || existing.leaseOwner !== workerId) {
      return { renewed: false };
    }
    if (existing.status !== 'claimed' && existing.status !== 'running') {
      return { renewed: false };
    }
    const ttl = Math.max(1_000, leaseMs ?? this.defaultLeaseMs);
    const ok = await this.store.renewLease(`task_lease:${taskId}`, workerId, ttl);
    if (!ok) return { renewed: false };
    const expiresAt = Date.now() + ttl;
    existing.leaseExpiresAt = expiresAt;
    existing.updatedAt = new Date().toISOString();
    await this.store.put(ctx, TASKS_COLLECTION, taskId, existing);
    return { renewed: true, leaseExpiresAt: expiresAt };
  }

  /**
   * Mark a task completed, release its lease, and emit a durable notification.
   */
  public async completeTask(
    ctx: DurableRequestContext,
    params: { taskId: string; workerId: string; result: unknown; summary?: string },
  ): Promise<BackgroundTaskRecord> {
    const existing = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, params.taskId);
    if (!existing) {
      throw new BackgroundTaskEngineError('Task not found.', 'TASK_NOT_FOUND', 404);
    }
    if (existing.status === 'cancelled') {
      throw new BackgroundTaskEngineError('Task was already cancelled.', 'TASK_CANCELLED', 409);
    }
    if (existing.leaseOwner && existing.leaseOwner !== params.workerId) {
      throw new BackgroundTaskEngineError('Worker does not hold the active lease for this task.', 'LEASE_MISMATCH', 409);
    }

    const nowIso = new Date().toISOString();
    existing.status = 'completed';
    existing.phase = 'completed';
    existing.progress = 100;
    existing.result = params.result;
    existing.error = undefined;
    existing.completedAt = nowIso;
    existing.updatedAt = nowIso;
    existing.leaseOwner = undefined;
    existing.leaseExpiresAt = undefined;
    existing.history.push({
      timestamp: nowIso,
      event: 'completed',
      message: params.summary || 'Task completed successfully.',
      workerId: params.workerId,
      attempt: existing.attempt,
      phase: 'completed',
    });

    await this.store.put(ctx, TASKS_COLLECTION, existing.taskId, existing);
    await this.store.releaseLease(`task_lease:${existing.taskId}`, params.workerId);

    await this.createNotification(ctx, {
      kind: 'task_completed',
      title: `Completed: ${existing.title}`,
      body: params.summary || `Background task '${existing.title}' finished successfully.`,
      taskId: existing.taskId,
      scheduleId: existing.scheduleId,
    });

    await this.syncHub.publish(ctx, {
      type: 'task:completed',
      title: `Completed: ${existing.title}`,
      message: params.summary || `Background task '${existing.title}' finished successfully.`,
      resourceId: existing.taskId,
      taskId: existing.taskId,
      scheduleId: existing.scheduleId,
      severity: 'success',
      notifyUser: true,
      data: { status: existing.status, phase: existing.phase, progress: 100 },
    });

    // Non-blocking outbound webhook dispatch (lazy import prevents circular dependency)
    void import('../webhooks/webhookEngine')
      .then((m) =>
        m.defaultWebhookEngine.dispatchOutboundEvent(ctx, 'task.completed', {
          taskId: existing.taskId,
          title: existing.title,
          summary: params.summary || 'Task completed successfully.',
          completedAt: existing.completedAt,
          scheduleId: existing.scheduleId || null,
        }),
      )
      .catch(() => {});

    return existing;
  }

  /**
   * Record task failure. Applies exponential backoff retry if attempts remain; otherwise moves to dead_letter/failed.
   */
  public async failTask(
    ctx: DurableRequestContext,
    params: {
      taskId: string;
      workerId?: string;
      error: string;
      retryable?: boolean;
      nowMs?: number;
    },
  ): Promise<BackgroundTaskRecord> {
    const existing = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, params.taskId);
    if (!existing) {
      throw new BackgroundTaskEngineError('Task not found.', 'TASK_NOT_FOUND', 404);
    }
    if (existing.status === 'cancelled') {
      return existing;
    }
    if (params.workerId && existing.leaseOwner && existing.leaseOwner !== params.workerId) {
      throw new BackgroundTaskEngineError('Worker does not hold the active lease for this task.', 'LEASE_MISMATCH', 409);
    }

    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const shouldRetry = (params.retryable ?? true) && existing.attempt < existing.maxAttempts;

    const previousLeaseOwner = existing.leaseOwner;
    existing.leaseOwner = undefined;
    existing.leaseExpiresAt = undefined;
    existing.error = params.error.slice(0, 2000);
    existing.updatedAt = nowIso;

    if (shouldRetry) {
      const backoffMs = existing.baseBackoffMs * Math.pow(2, Math.max(0, existing.attempt - 1));
      existing.status = 'queued';
      existing.phase = 'queued';
      existing.nextAttemptAt = nowMs + backoffMs;
      existing.history.push({
        timestamp: nowIso,
        event: 'retry_scheduled',
        message: `Attempt ${existing.attempt}/${existing.maxAttempts} failed (${existing.error}). Retry scheduled in ${backoffMs}ms.`,
        workerId: params.workerId,
        attempt: existing.attempt,
        phase: 'queued',
        metadata: { backoffMs, nextAttemptAt: existing.nextAttemptAt },
      });
    } else {
      existing.status = existing.attempt >= existing.maxAttempts ? 'dead_letter' : 'failed';
      existing.phase = 'failed';
      existing.completedAt = nowIso;
      existing.history.push({
        timestamp: nowIso,
        event: existing.status === 'dead_letter' ? 'dead_lettered' : 'failed',
        message:
          existing.status === 'dead_letter'
            ? `Moved to dead-letter queue after ${existing.attempt} failed attempts: ${existing.error}`
            : `Task failed permanently: ${existing.error}`,
        workerId: params.workerId,
        attempt: existing.attempt,
        phase: 'failed',
      });

      await this.createNotification(ctx, {
        kind: 'task_failed',
        title: `Failed: ${existing.title}`,
        body: existing.error,
        taskId: existing.taskId,
        scheduleId: existing.scheduleId,
      });
    }

    await this.store.put(ctx, TASKS_COLLECTION, existing.taskId, existing);
    if (previousLeaseOwner) {
      await this.store.releaseLease(`task_lease:${existing.taskId}`, previousLeaseOwner);
    }

    if (!shouldRetry) {
      await this.syncHub.publish(ctx, {
        type: 'task:failed',
        title: `Failed: ${existing.title}`,
        message: existing.error,
        resourceId: existing.taskId,
        taskId: existing.taskId,
        scheduleId: existing.scheduleId,
        severity: 'error',
        notifyUser: true,
        data: { status: existing.status, phase: existing.phase, attempt: existing.attempt },
      });

      void import('../webhooks/webhookEngine')
        .then((m) =>
          m.defaultWebhookEngine.dispatchOutboundEvent(ctx, 'task.failed', {
            taskId: existing.taskId,
            title: existing.title,
            status: existing.status,
            error: existing.error,
            attempt: existing.attempt,
          }),
        )
        .catch(() => {});
    }

    return existing;
  }

  /**
   * Cancel a queued, claimed, or running task.
   */
  public async cancelTask(
    ctx: DurableRequestContext,
    taskId: string,
    reason?: string,
  ): Promise<BackgroundTaskRecord> {
    const existing = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, taskId);
    if (!existing || existing.userId !== ctx.userId) {
      throw new BackgroundTaskEngineError('Task not found.', 'TASK_NOT_FOUND', 404);
    }
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return existing;
    }

    const nowIso = new Date().toISOString();
    const prevOwner = existing.leaseOwner;
    existing.status = 'cancelled';
    existing.phase = 'cancelled';
    existing.cancelledAt = nowIso;
    existing.updatedAt = nowIso;
    existing.leaseOwner = undefined;
    existing.leaseExpiresAt = undefined;
    existing.history.push({
      timestamp: nowIso,
      event: 'cancelled',
      message: reason ? `Cancelled by user: ${reason}` : 'Cancelled by user.',
      phase: 'cancelled',
    });

    await this.store.put(ctx, TASKS_COLLECTION, taskId, existing);
    if (prevOwner) {
      await this.store.releaseLease(`task_lease:${taskId}`, prevOwner);
    }
    await this.syncHub.publish(ctx, {
      type: 'task:cancelled',
      title: `Cancelled: ${existing.title}`,
      message: reason ? `Cancelled by user: ${reason}` : 'Cancelled by user.',
      resourceId: existing.taskId,
      taskId: existing.taskId,
      severity: 'warning',
      notifyUser: false,
      data: { status: existing.status, phase: existing.phase },
    });
    return existing;
  }

  /**
   * Manually retry a failed, dead_letter, or cancelled task.
   */
  public async retryTask(ctx: DurableRequestContext, taskId: string): Promise<BackgroundTaskRecord> {
    const existing = await this.store.get<BackgroundTaskRecord>(ctx, TASKS_COLLECTION, taskId);
    if (!existing || existing.userId !== ctx.userId) {
      throw new BackgroundTaskEngineError('Task not found.', 'TASK_NOT_FOUND', 404);
    }
    if (existing.status === 'running' || existing.status === 'claimed' || existing.status === 'queued') {
      return existing;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    existing.status = 'queued';
    existing.phase = 'queued';
    existing.attempt = 0;
    existing.progress = 0;
    existing.error = undefined;
    existing.completedAt = undefined;
    existing.cancelledAt = undefined;
    existing.nextAttemptAt = nowMs;
    existing.updatedAt = nowIso;
    existing.history.push({
      timestamp: nowIso,
      event: 'queued',
      message: 'Manually re-queued by user.',
      phase: 'queued',
    });

    await this.store.put(ctx, TASKS_COLLECTION, taskId, existing);
    const dispatchResult = await this.dispatcher.dispatch(existing);
    existing.workerDispatchState = dispatchResult.dispatched
      ? 'dispatched'
      : dispatchResult.provider === 'none'
        ? 'not_configured'
        : 'failed';
    existing.workerDispatchDetail = dispatchResult.detail;
    await this.store.put(ctx, TASKS_COLLECTION, taskId, existing);
    return existing;
  }

  /**
   * Recover interrupted/orphaned tasks whose worker lease expired or execution timed out.
   */
  public async recoverExpiredLeases(nowMs = Date.now()): Promise<{
    recovered: string[];
    deadLettered: string[];
  }> {
    const allTasks = await this.store.listAllForSystem<BackgroundTaskRecord>(TASKS_COLLECTION, 500);
    const recovered: string[] = [];
    const deadLettered: string[] = [];

    for (const task of allTasks) {
      if (task.status !== 'claimed' && task.status !== 'running') continue;

      const leaseExpired = typeof task.leaseExpiresAt === 'number' && task.leaseExpiresAt <= nowMs;
      const startedMs = task.startedAt ? new Date(task.startedAt).getTime() : 0;
      const timedOut = startedMs > 0 && nowMs - startedMs > task.timeoutMs;

      if (!leaseExpired && !timedOut) continue;

      const reason = timedOut
        ? `Execution exceeded timeout (${task.timeoutMs}ms).`
        : `Worker lease expired (worker '${task.leaseOwner || 'unknown'}' stopped heartbeating).`;

      const updated = await this.failTask(
        { userId: task.userId },
        {
          taskId: task.taskId,
          error: reason,
          retryable: !timedOut,
          nowMs,
        },
      );

      if (updated.status === 'queued') {
        updated.history.push({
          timestamp: new Date(nowMs).toISOString(),
          event: 'lease_recovered',
          message: `Recovered interrupted task for automatic retry.`,
          attempt: updated.attempt,
          phase: 'queued',
        });
        await this.store.put({ userId: task.userId }, TASKS_COLLECTION, updated.taskId, updated);
        recovered.push(updated.taskId);
      } else {
        deadLettered.push(updated.taskId);
      }
    }

    return { recovered, deadLettered };
  }

  // ---------------------------------------------------------------------------
  // Durable Notifications (shared across Feature 01 & Feature 05)
  // ---------------------------------------------------------------------------

  public async createNotification(
    ctx: DurableRequestContext,
    input: {
      kind: DurableNotificationRecord['kind'];
      title: string;
      body: string;
      taskId?: string;
      scheduleId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<DurableNotificationRecord> {
    const notificationId = `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const record: DurableNotificationRecord = {
      notificationId,
      userId: ctx.userId,
      kind: input.kind,
      title: input.title.slice(0, 160),
      body: input.body.slice(0, 1000),
      taskId: input.taskId,
      scheduleId: input.scheduleId,
      read: false,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    await this.store.put(ctx, NOTIFICATIONS_COLLECTION, notificationId, record);
    await this.syncHub.publish(ctx, {
      type: 'notification:created',
      title: record.title,
      message: record.body,
      resourceId: record.notificationId,
      notificationId: record.notificationId,
      taskId: record.taskId,
      scheduleId: record.scheduleId,
      severity: record.kind === 'task_failed' ? 'error' : record.kind === 'approval_required' ? 'warning' : 'info',
      notifyUser: true,
      data: { kind: record.kind },
    });
    return record;
  }

  public async listNotifications(
    ctx: DurableRequestContext,
    options?: { unreadOnly?: boolean; limit?: number },
  ): Promise<DurableNotificationRecord[]> {
    const limit = Math.min(100, Math.max(1, options?.limit ?? 50));
    const all = await this.store.list<DurableNotificationRecord>(ctx, NOTIFICATIONS_COLLECTION, 150);
    return all
      .filter((n) => (!options?.unreadOnly || !n.read))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  public async markNotificationRead(
    ctx: DurableRequestContext,
    notificationId: string,
  ): Promise<DurableNotificationRecord | null> {
    const existing = await this.store.get<DurableNotificationRecord>(ctx, NOTIFICATIONS_COLLECTION, notificationId);
    if (!existing || existing.userId !== ctx.userId) return null;
    existing.read = true;
    existing.readAt = new Date().toISOString();
    await this.store.put(ctx, NOTIFICATIONS_COLLECTION, notificationId, existing);
    return existing;
  }
}

export const defaultBackgroundTaskEngine = new BackgroundTaskEngine();
