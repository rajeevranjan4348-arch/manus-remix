/**
 * Feature 05: Persistent Scheduler & Automation Engine.
 *
 * Schedules are durable Firestore documents. A tick function (Netlify
 * scheduled function or an external cron service hitting the authenticated
 * tick endpoint) atomically claims due schedules via transactions, enqueues
 * execution into the Feature 01 durable task queue, and records run history.
 * A run counts as executed only when the durable task it spawned actually
 * completes; nothing reports success based on "the timer fired".
 *
 * Timezone-awareness comes from server/scheduler/cronTime.ts (DST-safe).
 * Missed jobs follow a configured policy: 'run_once' or 'skip'.
 */

import crypto from 'crypto';
import { DurableStore, getDefaultDurableStore } from '../durable/store';
import {
  ScheduleSpec,
  computeNextRun,
  parseCronExpression,
} from './cronTime';
export type { ScheduleSpec };
import { dispatchTaskReady, workerConfigured } from '../taskQueue/workerDispatch';

export type ScheduleStatus = 'active' | 'paused' | 'cancelled';
export type ScheduleKind = 'once' | 'recurring' | 'cron';
export type MissedJobPolicy = 'run_once' | 'skip';

export interface ScheduleRecord {
  id: string;
  userId: string;
  title: string;
  taskType: 'research' | 'coding_job' | 'report' | 'reminder' | 'website_check' | 'quality_check' | 'automation';
  payload: Record<string, any>;
  kind: ScheduleKind;
  spec: ScheduleSpec;
  timeZone: string;
  status: ScheduleStatus;
  missedPolicy: MissedJobPolicy;
  maxRetries: number;
  nextRunAt: string | null;
  lastRunAt?: string;
  executionCount: number;
  lastResultSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  userId: string;
  taskId?: string;
  status: 'dispatched' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  triggeredAt: string;
  finishedAt?: string;
  resultSummary?: string;
  error?: string;
  verified: boolean;
}

const SCHEDULES_COLLECTION = 'system_schedules';
const SCHEDULE_RUNS_COLLECTION = 'system_schedule_runs';

export const MAX_SCHEDULES_PER_USER = 100;

function validateTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type DurableEnqueue = (p: {
  userId: string;
  type: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  priority?: number;
}) => Promise<{ task: { id: string } }>;

export class ScheduleEngine {
  constructor(
    private readonly store: DurableStore | null = null,
    private readonly queueEnqueue?: DurableEnqueue,
  ) {}

  private get backend(): DurableStore {
    if (this.store) return this.store;
    return getDefaultDurableStore();
  }

  static newId(): string {
    return `sched_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Create a durable, timezone-aware schedule. Recurring and cron schedules
   * compute their next run from the timezone-correct wall clock.
   */
  public async createSchedule(params: {
    userId: string;
    title: string;
    taskType: ScheduleRecord['taskType'];
    payload: Record<string, any>;
    spec: ScheduleSpec;
    missedPolicy?: MissedJobPolicy;
    maxRetries?: number;
  }): Promise<ScheduleRecord> {
    const store = this.backend;
    if (store.kind === 'unavailable') {
      throw new Error('Durable store unavailable: Firestore credentials are not configured.');
    }
    if (!params.userId || typeof params.userId !== 'string') {
      throw new Error('Authenticated user identity is required.');
    }
    if (typeof params.title !== 'string' || params.title.trim().length < 1) {
      throw new Error('A schedule title is required.');
    }
    if (!params.payload || typeof params.payload !== 'object' || Array.isArray(params.payload)) {
      throw new Error('Schedule payload must be an object.');
    }

    if (params.spec.kind === 'cron') {
      if (!parseCronExpression(params.spec.expression)) {
        throw new Error(`Invalid cron expression: '${params.spec.expression}'.`);
      }
      if (!validateTimeZone(params.spec.timeZone)) {
        throw new Error(`Invalid IANA timezone: '${params.spec.timeZone}'.`);
      }
    }

    const allForUser = await store.query(SCHEDULES_COLLECTION, {
      filters: [{ field: 'userId', op: 'eq', value: params.userId }],
      limit: MAX_SCHEDULES_PER_USER + 1,
    });
    if (allForUser.length >= MAX_SCHEDULES_PER_USER) {
      throw new Error(`Schedule limit reached (${MAX_SCHEDULES_PER_USER} per user).`);
    }

    const now = new Date();
    const nextRunAt = computeNextRun(params.spec, now);
    const nowIso = now.toISOString();
    const record: ScheduleRecord = {
      id: ScheduleEngine.newId(),
      userId: params.userId,
      title: params.title.slice(0, 200),
      taskType: params.taskType,
      payload: params.payload,
      kind: params.spec.kind === 'once' ? 'once' : params.spec.kind === 'cron' ? 'cron' : 'recurring',
      spec: params.spec,
      timeZone: params.spec.kind === 'cron' ? params.spec.timeZone : 'UTC',
      status: 'active',
      missedPolicy: params.missedPolicy ?? 'run_once',
      maxRetries: Math.max(0, Math.min(5, params.maxRetries ?? 1)),
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
      executionCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (!nextRunAt) {
      throw new Error('Schedule produces no future run; nothing was created.');
    }
    await store.set(SCHEDULES_COLLECTION, record.id, record as unknown as Record<string, any>);
    return record;
  }

  public async getSchedule(scheduleId: string, userId: string): Promise<ScheduleRecord | null> {
    const doc = await this.backend.get(SCHEDULES_COLLECTION, scheduleId);
    if (!doc || doc.userId !== userId) return null;
    return doc as unknown as ScheduleRecord;
  }

  public async listSchedules(userId: string): Promise<ScheduleRecord[]> {
    const store = this.backend;
    if (store.kind === 'unavailable') {
      throw new Error('Durable store unavailable: Firestore credentials are not configured.');
    }
    const rows = await store.query(SCHEDULES_COLLECTION, {
      filters: [{ field: 'userId', op: 'eq', value: userId }],
      limit: 200,
    });
    return (rows as unknown as ScheduleRecord[]).sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''));
  }

  /** Pause / resume / edit / cancel — always owner-checked, durable. */
  public async setScheduleStatus(scheduleId: string, userId: string, status: ScheduleStatus): Promise<boolean> {
    const schedule = await this.getSchedule(scheduleId, userId);
    if (!schedule) return false;
    const patch: Partial<ScheduleRecord> = { status, updatedAt: new Date().toISOString() };
    if (status === 'active') {
      const next = computeNextRun(schedule.spec, new Date());
      patch.nextRunAt = next ? next.toISOString() : null;
    }
    return this.backend.update(SCHEDULES_COLLECTION, scheduleId, patch as Record<string, any>);
  }

  public async editSchedule(
    scheduleId: string,
    userId: string,
    changes: Partial<Pick<ScheduleRecord, 'title' | 'spec' | 'timeZone' | 'missedPolicy' | 'taskType' | 'payload'>>,
  ): Promise<boolean> {
    const schedule = await this.getSchedule(scheduleId, userId);
    if (!schedule) return false;
    if (changes.spec?.kind === 'cron' && !parseCronExpression(changes.spec.expression)) {
      throw new Error(`Invalid cron expression: '${changes.spec.expression}'.`);
    }
    const spec = (changes.spec ?? schedule.spec) as ScheduleSpec;
    const next = computeNextRun(spec, new Date());
    return this.backend.update(SCHEDULES_COLLECTION, scheduleId, {
      ...changes,
      nextRunAt: next ? next.toISOString() : null,
      updatedAt: new Date().toISOString(),
    } as Record<string, any>);
  }

  public async cancelSchedule(scheduleId: string, userId: string): Promise<boolean> {
    return this.setScheduleStatus(scheduleId, userId, 'cancelled');
  }

  /**
   * Tick: claim due schedules and enqueue their tasks durably. Each claim is a
   * transaction so concurrent tick invocations (Netlify + external cron) cannot
   * double-dispatch. Dispatch goes to the Feature 01 queue; execution runs on
   * the external worker only when one is configured.
   */
  public async tick(options: { now?: Date; maxSchedules?: number; userId?: string; enqueue?: (p: { userId: string; type: string; payload: Record<string, any>; idempotencyKey: string; priority?: number }) => Promise<{ task: { id: string } }> }): Promise<{
    checked: number;
    dispatched: Array<{ scheduleId: string; taskId?: string }>;
    skipped: Array<{ scheduleId: string; reason: string }>;
    dispatchUnavailable: boolean;
  }> {
    const store = this.backend;
    if (store.kind === 'unavailable') {
      throw new Error('Durable store unavailable: Firestore credentials are not configured.');
    }
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const maxSchedules = Math.min(50, options.maxSchedules ?? 25);

    const due = await store.query(SCHEDULES_COLLECTION, {
      filters: [{ field: 'status', op: 'eq', value: 'active' }],
      limit: 200,
    });
    const claimable = (due as unknown as ScheduleRecord[])
      .filter((s) => (!options.userId || s.userId === options.userId))
      .filter((s) => s.nextRunAt && new Date(s.nextRunAt).getTime() <= now.getTime())
      .slice(0, maxSchedules);

    const dispatched: Array<{ scheduleId: string; taskId?: string }> = [];
    const skipped: Array<{ scheduleId: string; reason: string }> = [];
    let dispatchUnavailable = false;

    for (const schedule of claimable) {
      const outcome = await store.transact(SCHEDULES_COLLECTION, schedule.id, (current) => {
        if (!current || current.status !== 'active') return null;
        if (!current.nextRunAt || new Date(current.nextRunAt).getTime() > now.getTime()) return null;
        const spec = current.spec as ScheduleSpec;
        const next = computeNextRun(spec, now);
        const nextRunAt = next ? next.toISOString() : null;
        const missWindowMs = 24 * 60 * 60 * 1000;
        const missed = new Date(current.nextRunAt).getTime() < now.getTime() - missWindowMs;
        // Missed-job recovery policy
        if (missed && current.missedPolicy === 'skip') {
          return {
            next: { ...current, nextRunAt, updatedAt: nowIso },
            result: { skip: true as const },
          };
        }
        return {
          next: {
            ...current,
            nextRunAt,
            lastRunAt: nowIso,
            executionCount: (current.executionCount ?? 0) + 1,
            updatedAt: nowIso,
          },
          result: { skip: false as const },
        };
      });

      if (!outcome.applied || !outcome.result) {
        continue;
      }
      if (outcome.result.skip) {
        skipped.push({ scheduleId: schedule.id, reason: 'missed beyond policy window; skipped' });
        await store.set(SCHEDULE_RUNS_COLLECTION, `run_${schedule.id}_${now.getTime()}`, {
          id: `run_${schedule.id}_${now.getTime()}`,
          scheduleId: schedule.id,
          userId: schedule.userId,
          status: 'skipped',
          triggeredAt: nowIso,
          verified: false,
          error: 'Missed execution beyond recovery policy window.',
        } as unknown as Record<string, any>);
        continue;
      }

      // Record the dispatch attempt (durable, unverified until task completes).
      const runId = `run_${schedule.id}_${now.getTime()}_${crypto.randomBytes(2).toString('hex')}`;
      const runRecord: ScheduleRunRecord = {
        id: runId,
        scheduleId: schedule.id,
        userId: schedule.userId,
        status: 'dispatched',
        triggeredAt: nowIso,
        verified: false,
      };
      await store.set(SCHEDULE_RUNS_COLLECTION, runId, runRecord as unknown as Record<string, any>);

      const enqueue = options.enqueue ?? this.queueEnqueue;
      if (enqueue) {
        try {
          const enqueued = await enqueue({
            userId: schedule.userId,
            type: `schedule.${schedule.taskType}`,
            payload: { scheduleId: schedule.id, runId, ...schedule.payload },
            idempotencyKey: `schedule:${schedule.id}:${nowIso}`,
            priority: 5,
          });
          runRecord.taskId = enqueued.task.id;
          await store.update(SCHEDULE_RUNS_COLLECTION, runId, {
            taskId: enqueued.task.id,
            status: 'dispatched',
          });
          dispatched.push({ scheduleId: schedule.id, taskId: enqueued.task.id });
        } catch (error) {
          dispatchUnavailable = true;
          await store.update(SCHEDULE_RUNS_COLLECTION, runId, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'enqueue failed',
            finishedAt: new Date().toISOString(),
          });
          skipped.push({ scheduleId: schedule.id, reason: 'durable queue unavailable' });
        }
      } else {
        const dispatch = await dispatchTaskReady({
          taskId: runId,
          userId: schedule.userId,
          type: `schedule.${schedule.taskType}`,
        });
        if (!dispatch.ok) dispatchUnavailable = true;
        dispatched.push({ scheduleId: schedule.id });
      }
    }

    return { checked: claimable.length, dispatched, skipped, dispatchUnavailable };
  }

  /**
   * Called by the worker when the schedule-spawned task reaches a terminal
   * state. A run is only marked completed (verified) from an actual durable
   * task completion.
   */
  public async acknowledgeRunCompletion(params: {
    runId: string;
    userId: string;
    status: 'completed' | 'failed' | 'cancelled';
    resultSummary?: string;
    error?: string;
  }): Promise<boolean> {
    const store = this.backend;
    if (store.kind === 'unavailable') return false;
    const runDoc = await store.get(SCHEDULE_RUNS_COLLECTION, params.runId);
    if (!runDoc || runDoc.userId !== params.userId) return false;
    await store.update(SCHEDULE_RUNS_COLLECTION, params.runId, {
      status: params.status,
      finishedAt: new Date().toISOString(),
      resultSummary: params.resultSummary?.slice(0, 2000),
      error: params.error?.slice(0, 2000),
      verified: params.status === 'completed',
    });
    if (params.status === 'failed') {
      // Failure notification record consumed by the notification dispatcher.
      await store.set(
        'system_notifications',
        `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        {
          userId: params.userId,
          kind: 'schedule_failure',
          scheduleId: runDoc.scheduleId,
          message: `Scheduled task "${runDoc.title ?? runDoc.scheduleId}" failed: ${params.error?.slice(0, 300) ?? 'unknown error'}`,
          createdAt: new Date().toISOString(),
          read: false,
        } as unknown as Record<string, any>,
      ).catch(() => undefined);
    }
    return true;
  }

  public async getRunHistory(userId: string, scheduleId?: string, limit = 50): Promise<ScheduleRunRecord[]> {
    const store = this.backend;
    if (store.kind === 'unavailable') {
      throw new Error('Durable store unavailable: Firestore credentials are not configured.');
    }
    const filters = [{ field: 'userId', op: 'eq' as const, value: userId }];
    if (scheduleId) filters.push({ field: 'scheduleId', op: 'eq' as const, value: scheduleId });
    const rows = await store.query(SCHEDULE_RUNS_COLLECTION, { filters, limit });
    return (rows as unknown as ScheduleRunRecord[]).sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  }

  /** Expose whether an external worker is configured for real dispatch. */
  public workerIntegrationReady(): boolean {
    return workerConfigured() || Boolean(this.queueEnqueue);
  }
}

export const scheduleEngine = new ScheduleEngine();
