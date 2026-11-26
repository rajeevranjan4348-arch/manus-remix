/**
 * Persistent scheduler & automation engine (Feature 05).
 *
 * CRUD + phase logic for durable schedules. Due occurrences are claimed
 * atomically against nextRunAt, dispatched into the Feature 01 durable task
 * queue with an occurrence-scoped idempotency key, and only recorded as
 * succeeded/failed after the worker reports back verified execution.
 * Notifications surface through the existing task/notification client which
 * reacts to the durable task record; the server never fabricates a "sent"
 * notification.
 */

import crypto from 'crypto';
import { SCHEDULE_HARD_LIMITS, type MissedJobPolicy, type ScheduleRecord, type ScheduleRunRecord, type ScheduleSpec, type ScheduleTarget } from './types';
import type { ScheduleStore } from './scheduleStore';
import { resolveScheduleStore } from './scheduleStore';
import { nextOccurrence, isValidTimezone, parseCron } from './recurrence';
import { validateNavigationUrl } from '../sandbox/urlPolicy';
import { enqueueTask } from '../tasks/taskQueue';

const SCHEDULE_ID_RE = /^sch_[a-zA-Z0-9]{10,40}$/;
const TASK_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/;

export function newScheduleId(): string {
  return 'sch_' + crypto.randomBytes(10).toString('hex');
}

export interface ScheduleValidation {
  valid: boolean;
  error?: string;
}

export function validateSpec(spec: ScheduleSpec): ScheduleValidation {
  if (!spec || typeof spec !== 'object') return { valid: false, error: 'A schedule spec object is required.' };
  if (!['once', 'recurring', 'cron'].includes(spec.kind)) return { valid: false, error: 'kind must be once, recurring or cron.' };
  if (!isValidTimezone(String(spec.timezone || ''))) return { valid: false, error: 'timezone must be a valid IANA tz name.' };
  if (spec.kind === 'once') {
    if (!spec.runAt || Number.isNaN(Date.parse(spec.runAt))) return { valid: false, error: 'once schedules need a valid ISO runAt.' };
    return { valid: true };
  }
  if (spec.kind === 'recurring') {
    const hasInterval = spec.everyMinutes != null;
    const hasDaily = spec.dailyAt && Number.isInteger(spec.dailyAt.hour) && Number.isInteger(spec.dailyAt.minute);
    if (hasInterval === hasDaily) return { valid: false, error: 'recurring schedules need exactly one of everyMinutes or dailyAt.' };
    if (hasInterval) {
      if (spec.everyMinutes! < SCHEDULE_HARD_LIMITS.everyMinutesMin || spec.everyMinutes! > SCHEDULE_HARD_LIMITS.everyMinutesMax) {
        return { valid: false, error: 'everyMinutes must be between ' + SCHEDULE_HARD_LIMITS.everyMinutesMin + ' and ' + SCHEDULE_HARD_LIMITS.everyMinutesMax + '.' };
      }
      return { valid: true };
    }
    const { hour, minute } = spec.dailyAt!;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { valid: false, error: 'dailyAt must use hour 0-23 and minute 0-59.' };
    return { valid: true };
  }
  // cron
  if (!spec.cron) return { valid: false, error: 'cron schedules need a 5-field cron expression.' };
  const parsed = parseCron(spec.cron);
  if (!parsed.ok) return { valid: false, error: parsed.error };
  if (nextOccurrence({ ...spec, timezone: String(spec.timezone) }, Date.now()) === null) {
    return { valid: false, error: 'This cron expression has no occurrence within the ' + Math.round(SCHEDULE_HARD_LIMITS.cronScanMinutesMax / 1440) + '-day planning window and is refused.' };
  }
  return { valid: true };
}

export function validateTarget(target: ScheduleTarget): ScheduleValidation {
  if (!target || typeof target !== 'object') return { valid: false, error: 'A schedule target object is required.' };
  if (target.type === 'agents_run') {
    if (typeof target.objective !== 'string' || !target.objective.trim() || target.objective.length > 4000) {
      return { valid: false, error: 'agents_run target needs an objective (max 4000 chars).' };
    }
    return { valid: true };
  }
  if (target.type === 'task') {
    if (!TASK_TYPE_RE.test(String(target.taskType || ''))) return { valid: false, error: 'task target needs a valid taskType.' };
    const bytes = new TextEncoder().encode(JSON.stringify(target.payload || {})).length;
    if (bytes > SCHEDULE_HARD_LIMITS.maxPayloadBytes) return { valid: false, error: 'task payload exceeds ' + SCHEDULE_HARD_LIMITS.maxPayloadBytes + ' bytes.' };
    return { valid: true };
  }
  if (target.type === 'webhook') {
    const decision = validateNavigationUrl(String(target.url || ''));
    if (!decision.allowed) return { valid: false, error: 'webhook URL rejected: ' + decision.reason };
    return { valid: true };
  }
  return { valid: false, error: 'Unsupported target type.' };
}

export interface CreateScheduleInput {
  title: string;
  spec: ScheduleSpec;
  target: ScheduleTarget;
  missedJobPolicy?: MissedJobPolicy;
  runNowIfOverdue?: boolean;
}

export class SchedulerService {
  constructor(private readonly store: ScheduleStore) {}

  static async create(): Promise<SchedulerService> {
    return new SchedulerService(await resolveScheduleStore());
  }

  async create(userId: string, input: CreateScheduleInput): Promise<ScheduleRecord> {
    const title = String(input.title || '').trim();
    if (!title || title.length > SCHEDULE_HARD_LIMITS.maxTitleChars) {
      throw Object.assign(new Error('A schedule title of at most ' + SCHEDULE_HARD_LIMITS.maxTitleChars + ' characters is required.'), { code: 'INVALID_ARGUMENTS', status: 400 });
    }
    const specCheck = validateSpec(input.spec);
    if (!specCheck.valid) throw Object.assign(new Error(specCheck.error || 'Invalid schedule.'), { code: 'INVALID_SCHEDULE', status: 400 });
    const targetCheck = validateTarget(input.target);
    if (!targetCheck.valid) throw Object.assign(new Error(targetCheck.error || 'Invalid schedule target.'), { code: 'INVALID_SCHEDULE', status: 400 });

    const existing = await this.store.listForUser(userId);
    if (existing.filter((s) => s.status !== 'cancelled').length >= SCHEDULE_HARD_LIMITS.maxSchedulesPerUser) {
      throw Object.assign(new Error('Schedule limit reached (' + SCHEDULE_HARD_LIMITS.maxSchedulesPerUser + ').'), { code: 'SCHEDULE_LIMIT_REACHED', status: 409 });
    }

    const now = Date.now();
    const nextMs = nextOccurrence(input.spec, now);
    if (nextMs === null && !(input.spec.kind === 'once' && input.runNowIfOverdue)) {
      throw Object.assign(new Error('Schedule has no upcoming occurrence.'), { code: 'INVALID_SCHEDULE', status: 400 });
    }
    const nowIso = new Date(now).toISOString();
    const record: ScheduleRecord = {
      scheduleId: newScheduleId(),
      userId,
      title,
      spec: input.spec,
      target: input.target,
      status: 'active',
      missedJobPolicy: input.missedJobPolicy || 'skip_to_next',
      nextRunAt: nextMs === null ? null : new Date(nextMs).toISOString(),
      lastRunAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      durable: this.store.durable,
    };
    await this.store.putSchedule(record);
    return record;
  }

  async get(userId: string, scheduleId: string): Promise<ScheduleRecord | null> {
    return this.store.getSchedule(scheduleId, userId);
  }

  async list(userId: string): Promise<ScheduleRecord[]> {
    return this.store.listForUser(userId);
  }

  async listRuns(userId: string, scheduleId?: string, limit = 50): Promise<ScheduleRunRecord[]> {
    return this.store.listRuns(userId, scheduleId, limit);
  }

  private async requireOwned(userId: string, scheduleId: string): Promise<ScheduleRecord> {
    if (!SCHEDULE_ID_RE.test(scheduleId)) {
      throw Object.assign(new Error('Invalid schedule id.'), { code: 'INVALID_SCHEDULE_ID', status: 400 });
    }
    const record = await this.store.getSchedule(scheduleId, userId);
    if (!record) throw Object.assign(new Error('Schedule not found for this user.'), { code: 'SCHEDULE_NOT_FOUND', status: 404 });
    return record;
  }

  async pause(userId: string, scheduleId: string): Promise<ScheduleRecord> {
    const record = await this.requireOwned(userId, scheduleId);
    if (record.status !== 'active') return record;
    record.status = 'paused';
    record.updatedAt = new Date().toISOString();
    await this.store.putSchedule(record);
    return record;
  }

  async resume(userId: string, scheduleId: string): Promise<ScheduleRecord> {
    const record = await this.requireOwned(userId, scheduleId);
    if (record.status !== 'paused') return record;
    record.status = 'active';
    const nextMs = nextOccurrence(record.spec, Date.now());
    record.nextRunAt = nextMs === null ? null : new Date(nextMs).toISOString();
    record.updatedAt = new Date().toISOString();
    await this.store.putSchedule(record);
    return record;
  }

  async cancel(userId: string, scheduleId: string): Promise<ScheduleRecord> {
    const record = await this.requireOwned(userId, scheduleId);
    if (record.status === 'cancelled') return record;
    record.status = 'cancelled';
    record.nextRunAt = null;
    record.updatedAt = new Date().toISOString();
    await this.store.putSchedule(record);
    return record;
  }

  async edit(userId: string, scheduleId: string, patch: { title?: string; spec?: ScheduleSpec; target?: ScheduleTarget; missedJobPolicy?: MissedJobPolicy }): Promise<ScheduleRecord> {
    const record = await this.requireOwned(userId, scheduleId);
    if (record.status === 'cancelled') {
      throw Object.assign(new Error('Cancelled schedules cannot be edited.'), { code: 'SCHEDULE_CANCELLED', status: 409 });
    }
    if (patch.title !== undefined) {
      const title = String(patch.title || '').trim();
      if (!title || title.length > SCHEDULE_HARD_LIMITS.maxTitleChars) {
        throw Object.assign(new Error('A schedule title of at most ' + SCHEDULE_HARD_LIMITS.maxTitleChars + ' characters is required.'), { code: 'INVALID_ARGUMENTS', status: 400 });
      }
      record.title = title;
    }
    if (patch.spec) {
      const check = validateSpec(patch.spec);
      if (!check.valid) throw Object.assign(new Error(check.error || 'Invalid schedule.'), { code: 'INVALID_SCHEDULE', status: 400 });
      record.spec = patch.spec;
    }
    if (patch.target) {
      const check = validateTarget(patch.target);
      if (!check.valid) throw Object.assign(new Error(check.error || 'Invalid schedule target.'), { code: 'INVALID_SCHEDULE', status: 400 });
      record.target = patch.target;
    }
    if (patch.missedJobPolicy) record.missedJobPolicy = patch.missedJobPolicy;
    const nextMs = nextOccurrence(record.spec, Date.now());
    record.nextRunAt = nextMs === null ? null : new Date(nextMs).toISOString();
    record.updatedAt = new Date().toISOString();
    await this.store.putSchedule(record);
    return record;
  }

  /**
   * Tick: claim all due occurrences and dispatch them as durable tasks.
   * Safe to call concurrently; atomic CAS claims make duplicate dispatch impossible.
   */
  async processDue(nowMs: number, opts: { graceMs?: number } = {}): Promise<{ claimed: number; skipped: number; results: Array<{ scheduleId: string; runId?: string; status: string; detail?: string }> }> {
    const graceMs = opts.graceMs ?? SCHEDULE_HARD_LIMITS.defaultGraceMs;
    const due = (await this.store.listActive()).filter((s) => s.nextRunAt && Date.parse(s.nextRunAt) <= nowMs);
    const results: Array<{ scheduleId: string; runId?: string; status: string; detail?: string }> = [];
    let claimed = 0;
    let skipped = 0;

    for (const sched of due) {
      const plannedMs = Date.parse(sched.nextRunAt as string);
      const overdue = nowMs - plannedMs > graceMs;

      const claimPatch = (r: ScheduleRecord): ScheduleRecord | null => {
        if (r.status !== 'active') return null;
        let nextMs: number | null;
        if (overdue && r.missedJobPolicy === 'skip_to_next' && r.spec.kind !== 'once') {
          nextMs = nextOccurrence(r.spec, nowMs);
        } else {
          nextMs = nextOccurrence(r.spec, plannedMs);
        }
        return { ...r, nextRunAt: nextMs === null ? null : new Date(nextMs).toISOString(), lastRunAt: new Date(plannedMs).toISOString(), updatedAt: new Date(nowMs).toISOString() };
      };

      const claimedRecord = await this.store.claimOccurrence(sched.scheduleId, sched.nextRunAt as string, claimPatch);
      if (!claimedRecord) {
        results.push({ scheduleId: sched.scheduleId, status: 'claim-conflict' });
        skipped += 1;
        continue;
      }

      const runId = 'occ_' + sched.scheduleId + '_' + plannedMs;
      const runRecord: ScheduleRunRecord = {
        runId,
        scheduleId: sched.scheduleId,
        userId: sched.userId,
        occurrenceMs: plannedMs,
        plannedFor: sched.nextRunAt as string,
        status: 'dispatched',
        createdAt: new Date(nowMs).toISOString(),
      };

      if (overdue && sched.missedJobPolicy === 'skip_to_next') {
        runRecord.status = 'skipped';
        runRecord.detail = 'Missed the ' + Math.round(overdue / 60000) + ' minute grace window; skipped per schedule policy.';
        await this.store.putRun(runRecord);
        results.push({ scheduleId: sched.scheduleId, runId, status: 'skipped' });
        skipped += 1;
        continue;
      }

      let taskId: string | undefined;
      let dispatchDetail = '';
      try {
        const target = sched.target;
        const enqueued = await enqueueTask({
          userId: sched.userId,
          type: 'automation.run',
          payload: { scheduleId: sched.scheduleId, runId, target },
          idempotencyKey: runId,
          timeoutSeconds: 600,
          maxAttempts: 3,
        });
        taskId = enqueued.task.id;
        dispatchDetail = enqueued.dispatch.dispatched
          ? 'dispatched to worker'
          : 'durably queued; worker dispatch unavailable: ' + enqueued.dispatch.reason;
      } catch (err: any) {
        runRecord.status = 'failed';
        runRecord.detail = 'ENQUEUE_FAILED: ' + String(err?.message || 'task enqueue failed');
        await this.store.putRun(runRecord);
        results.push({ scheduleId: sched.scheduleId, runId, status: 'failed', detail: runRecord.detail });
        continue;
      }

      runRecord.taskId = taskId;
      runRecord.detail = dispatchDetail;
      await this.store.putRun(runRecord);
      results.push({ scheduleId: sched.scheduleId, runId, status: 'dispatched' });
      claimed += 1;
    }
    return { claimed, skipped, results };
  }

  /** Worker verification callback: flips a dispatched occurrence to succeeded/failed. */
  async verifyOccurrence(scheduleId: string, runId: string, status: 'succeeded' | 'failed', detail: string): Promise<ScheduleRunRecord | null> {
    const run = await this.store.getRun(runId);
    if (!run || run.scheduleId !== scheduleId) return null;
    if (run.status !== 'dispatched') return null; // single verification per occurrence
    run.status = status;
    run.detail = String(detail || '').slice(0, 1000);
    run.verifiedAt = new Date().toISOString();
    await this.store.putRun(run);
    return run;
  }
}
