/**
 * Feature 05 — Persistent Scheduler & Automation Engine.
 *
 * Implements durable, timezone- and DST-aware scheduling backed by DurableCollectionStore
 * and wired directly into Feature 01 (BackgroundTaskEngine) and durable notifications.
 *
 * Capabilities:
 * - Schedule types: once, interval, daily, weekly, monthly, and full 5-field cron expressions.
 * - Explicit IANA timezone validation and wall-clock DST-aware next-run calculation.
 * - Conditional automations (always, expression, url_status).
 * - Pause, resume, edit, cancel, and run-now lifecycle operations.
 * - Missed-job recovery policies: skip, run_once, catch_up (capped).
 * - Atomic due-job dispatching with per-schedule leases & deterministic idempotency keys
 *   into Feature 01 BackgroundTaskEngine (preventing duplicate executions across serverless ticks).
 * - Durable execution history & notifications; never claims a job ran unless durably verified.
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
  defaultBackgroundTaskEngine,
  type BackgroundTaskEngine,
  type BackgroundTaskPriority,
  type BackgroundTaskType,
} from '../queue/backgroundTaskEngine';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
  type PersistenceMode,
} from '../sandbox/durableStore';
import { parseReminderIntent } from '../scheduledTasks';

export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type MissedJobPolicy = 'skip' | 'run_once' | 'catch_up';

export interface ScheduleCondition {
  type: 'always' | 'expression' | 'url_status';
  /** For 'expression': safe key/value match against evaluation context (e.g. "marketOpen==true") */
  expression?: string;
  /** For 'url_status': HTTP endpoint expected to return expectedStatus (default 200) */
  url?: string;
  expectedStatus?: number;
}

export interface ScheduleRecord {
  scheduleId: string;
  userId: string;
  name: string;
  description?: string;
  kind: ScheduleKind;
  status: ScheduleStatus;
  timeZone: string;
  /** ISO timestamp for 'once' or initial anchor */
  runAt?: string;
  /** Interval in minutes for 'interval' */
  intervalMinutes?: number;
  /** HH:MM local wall-clock time for daily/weekly/monthly */
  timeOfDay?: string;
  /** 0=Sun..6=Sat for weekly */
  dayOfWeek?: number;
  /** 1..28 for monthly */
  dayOfMonth?: number;
  /** Standard 5-field cron expression: "min hour dom mon dow" */
  cronExpression?: string;
  missedJobPolicy: MissedJobPolicy;
  maxCatchUpRuns: number;
  condition: ScheduleCondition;
  taskTemplate: {
    title: string;
    prompt: string;
    type: BackgroundTaskType;
    priority: BackgroundTaskPriority;
    maxAttempts: number;
    payload?: Record<string, unknown>;
  };
  notifyOnRun: boolean;
  nextRunAt: string | null;
  lastRunAt?: string;
  lastRunStatus?: 'dispatched' | 'skipped_condition' | 'failed';
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRunRecord {
  runId: string;
  scheduleId: string;
  userId: string;
  scheduledFor: string;
  executedAt: string;
  status: 'dispatched' | 'skipped_condition' | 'failed';
  taskId?: string;
  deduplicated?: boolean;
  reason: string;
}

export class SchedulerEngineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'SCHEDULER_ERROR', statusCode = 400) {
    super(message);
    this.name = 'SchedulerEngineError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const SCHEDULES_COLLECTION = 'schedules';
const SCHEDULE_RUNS_COLLECTION = 'schedule_runs';

// -----------------------------------------------------------------------------
// Timezone, DST & 5-Field Cron Utilities (Zero external dependencies)
// -----------------------------------------------------------------------------

export function validateTimeZone(timeZone: string): string {
  const tz = (timeZone || 'UTC').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    throw new SchedulerEngineError(`Invalid IANA timezone '${tz}'.`, 'INVALID_TIMEZONE', 400);
  }
}

interface ZonedDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  dayOfWeek: number; // 0=Sun..6=Sat
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hourVal = Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: hourVal === 24 ? 0 : hourVal,
    minute: Number(map.minute),
    dayOfWeek: WEEKDAY_MAP[map.weekday] ?? 0,
  };
}

function getZoneOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  // Truncate seconds/ms from reference date for exact minute-level offset
  const refMinuteUtc = Math.floor(date.getTime() / 60_000) * 60_000;
  return asUtc - refMinuteUtc;
}

/**
 * Convert a local wall-clock date/time in an IANA timezone to a UTC Date,
 * running two refinement passes to accurately resolve DST transitions.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = new Date(wallUtc);
  instant = new Date(wallUtc - getZoneOffsetMs(instant, timeZone));
  instant = new Date(wallUtc - getZoneOffsetMs(instant, timeZone));
  return instant;
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  const trimmed = field.trim();
  if (!trimmed) throw new SchedulerEngineError('Empty cron field.', 'INVALID_CRON', 400);

  for (const part of trimmed.split(',')) {
    const seg = part.trim();
    if (!seg) continue;

    let rangePart = seg;
    let step = 1;
    if (seg.includes('/')) {
      const pieces = seg.split('/');
      if (pieces.length !== 2) {
        throw new SchedulerEngineError(`Invalid cron step '${seg}'.`, 'INVALID_CRON', 400);
      }
      rangePart = pieces[0];
      step = Number(pieces[1]);
      if (!Number.isInteger(step) || step <= 0) {
        throw new SchedulerEngineError(`Invalid cron step value '${pieces[1]}'.`, 'INVALID_CRON', 400);
      }
    }

    let start = min;
    let end = max;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [aStr, bStr] = rangePart.split('-');
      start = Number(aStr);
      end = Number(bStr);
    } else {
      start = Number(rangePart);
      end = seg.includes('/') ? max : start;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new SchedulerEngineError(`Cron value '${seg}' out of range [${min}-${max}].`, 'INVALID_CRON', 400);
    }

    for (let v = start; v <= end; v += step) {
      out.add(v);
    }
  }

  if (out.size === 0) {
    throw new SchedulerEngineError(`Cron field '${field}' produced no valid values.`, 'INVALID_CRON', 400);
  }
  return out;
}

export interface ParsedCronExpression {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export function parseCronExpression(expr: string): ParsedCronExpression {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new SchedulerEngineError(
      'Cron expression must have exactly 5 fields: "minute hour day-of-month month day-of-week".',
      'INVALID_CRON',
      400,
    );
  }
  const rawDow = parseCronField(parts[4], 0, 7);
  if (rawDow.has(7)) {
    rawDow.delete(7);
    rawDow.add(0);
  }
  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: rawDow,
  };
}

function parseTimeOfDay(timeOfDay?: string): { hour: number; minute: number } {
  const raw = (timeOfDay || '09:00').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new SchedulerEngineError('timeOfDay must be in HH:MM (24-hour) format.', 'INVALID_TIME_OF_DAY', 400);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new SchedulerEngineError('timeOfDay out of valid range (00:00-23:59).', 'INVALID_TIME_OF_DAY', 400);
  }
  return { hour, minute };
}

/**
 * Compute the next UTC ISO execution timestamp strictly after `afterMs` (or >= for initial once).
 */
export function computeNextRunAt(
  schedule: Pick<
    ScheduleRecord,
    'kind' | 'timeZone' | 'runAt' | 'intervalMinutes' | 'timeOfDay' | 'dayOfWeek' | 'dayOfMonth' | 'cronExpression'
  >,
  afterMs: number,
  inclusive = false,
): string | null {
  const tz = validateTimeZone(schedule.timeZone);
  const threshold = inclusive ? afterMs - 1 : afterMs;

  if (schedule.kind === 'once') {
    if (!schedule.runAt) return null;
    const targetMs = new Date(schedule.runAt).getTime();
    if (!Number.isFinite(targetMs)) {
      throw new SchedulerEngineError('Invalid runAt ISO timestamp.', 'INVALID_RUN_AT', 400);
    }
    return targetMs > threshold ? new Date(targetMs).toISOString() : null;
  }

  if (schedule.kind === 'interval') {
    const mins = Math.max(1, schedule.intervalMinutes ?? 60);
    const intervalMs = mins * 60_000;
    const anchorMs = schedule.runAt ? new Date(schedule.runAt).getTime() : afterMs;
    if (!Number.isFinite(anchorMs)) {
      return new Date(afterMs + intervalMs).toISOString();
    }
    if (anchorMs > threshold) return new Date(anchorMs).toISOString();
    const steps = Math.floor((threshold - anchorMs) / intervalMs) + 1;
    return new Date(anchorMs + steps * intervalMs).toISOString();
  }

  if (schedule.kind === 'daily') {
    const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
    const refParts = getZonedParts(new Date(afterMs), tz);
    for (let dayOffset = 0; dayOffset <= 3; dayOffset++) {
      const localDate = new Date(Date.UTC(refParts.year, refParts.month - 1, refParts.day + dayOffset));
      const candidate = zonedWallClockToUtc(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth() + 1,
        localDate.getUTCDate(),
        hour,
        minute,
        tz,
      );
      if (candidate.getTime() > threshold) {
        return candidate.toISOString();
      }
    }
    return null;
  }

  if (schedule.kind === 'weekly') {
    const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
    const targetDow = Math.min(6, Math.max(0, schedule.dayOfWeek ?? 1));
    const refParts = getZonedParts(new Date(afterMs), tz);
    for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
      const localDate = new Date(Date.UTC(refParts.year, refParts.month - 1, refParts.day + dayOffset));
      const candidate = zonedWallClockToUtc(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth() + 1,
        localDate.getUTCDate(),
        hour,
        minute,
        tz,
      );
      const candParts = getZonedParts(candidate, tz);
      if (candParts.dayOfWeek === targetDow && candidate.getTime() > threshold) {
        return candidate.toISOString();
      }
    }
    return null;
  }

  if (schedule.kind === 'monthly') {
    const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
    const targetDom = Math.min(28, Math.max(1, schedule.dayOfMonth ?? 1));
    const refParts = getZonedParts(new Date(afterMs), tz);
    for (let monthOffset = 0; monthOffset <= 13; monthOffset++) {
      const localMonth = new Date(Date.UTC(refParts.year, refParts.month - 1 + monthOffset, targetDom));
      const candidate = zonedWallClockToUtc(
        localMonth.getUTCFullYear(),
        localMonth.getUTCMonth() + 1,
        targetDom,
        hour,
        minute,
        tz,
      );
      if (candidate.getTime() > threshold) {
        return candidate.toISOString();
      }
    }
    return null;
  }

  if (schedule.kind === 'cron') {
    if (!schedule.cronExpression) {
      throw new SchedulerEngineError('cronExpression is required for cron schedules.', 'INVALID_CRON', 400);
    }
    const parsed = parseCronExpression(schedule.cronExpression);
    // Step minute-by-minute (fast skip by day/hour when non-matching) up to 366 days ahead
    let cursorMs = Math.floor(afterMs / 60_000) * 60_000 + (inclusive ? 0 : 60_000);
    const maxCursorMs = afterMs + 366 * 86_400_000;
    let iterations = 0;

    while (cursorMs <= maxCursorMs && iterations < 530_000) {
      iterations += 1;
      const dt = new Date(cursorMs);
      const p = getZonedParts(dt, tz);

      if (!parsed.months.has(p.month) || !parsed.daysOfMonth.has(p.day) || !parsed.daysOfWeek.has(p.dayOfWeek)) {
        // Jump ahead by 1 hour until date changes
        cursorMs += 60 * 60_000;
        continue;
      }
      if (!parsed.hours.has(p.hour)) {
        cursorMs += (60 - p.minute) * 60_000;
        continue;
      }
      if (parsed.minutes.has(p.minute) && cursorMs > threshold) {
        return dt.toISOString();
      }
      cursorMs += 60_000;
    }
    return null;
  }

  return null;
}

export function computeSchedulerSignature(rawBody: string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifySchedulerSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!secret || secret.length < 16 || !signatureHeader) return false;
  const expected = computeSchedulerSignature(rawBody, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader.trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface SchedulerEngineOptions {
  store?: DurableCollectionStore;
  auditStore?: DurableExecutionStore;
  permissions?: PermissionsGatewayService;
  taskEngine?: BackgroundTaskEngine;
  schedulerSecret?: string;
}

export class PersistentSchedulerEngine {
  private readonly store: DurableCollectionStore;
  private readonly auditStore: DurableExecutionStore;
  private readonly permissions: PermissionsGatewayService;
  private readonly taskEngine: BackgroundTaskEngine;
  private readonly explicitSecret?: string;

  constructor(options?: SchedulerEngineOptions) {
    this.store = options?.store ?? defaultCollectionStore;
    this.auditStore = options?.auditStore ?? defaultDurableStore;
    this.permissions = options?.permissions ?? permissionsGateway;
    this.taskEngine = options?.taskEngine ?? defaultBackgroundTaskEngine;
    this.explicitSecret = options?.schedulerSecret;
  }

  public resolveSchedulerSecret(): string {
    return (this.explicitSecret ?? process.env.SCHEDULER_SECRET ?? '').trim();
  }

  public verifySchedulerRequest(rawBody: string, headers: Headers): boolean {
    const secret = this.resolveSchedulerSecret();
    if (secret.length < 16) return false;
    const sig = headers.get('x-scheduler-signature');
    if (sig && verifySchedulerSignature(rawBody, sig, secret)) return true;
    const direct = (headers.get('x-scheduler-secret') || '').trim();
    if (!direct) return false;
    const a = Buffer.from(direct, 'utf8');
    const b = Buffer.from(secret, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  public getHealth(ctx?: DurableRequestContext): {
    persistenceMode: PersistenceMode;
    schedulerSecretConfigured: boolean;
    supportedKinds: ScheduleKind[];
  } {
    return {
      persistenceMode: this.store.getMode(ctx),
      schedulerSecretConfigured: this.resolveSchedulerSecret().length >= 16,
      supportedKinds: ['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'],
    };
  }

  /**
   * Create a persistent schedule from explicit fields OR natural language reminder text.
   */
  public async createSchedule(
    ctx: DurableRequestContext,
    input: {
      name?: string;
      description?: string;
      naturalLanguageReminder?: string;
      kind?: ScheduleKind;
      timeZone?: string;
      runAt?: string;
      intervalMinutes?: number;
      timeOfDay?: string;
      dayOfWeek?: number;
      dayOfMonth?: number;
      cronExpression?: string;
      missedJobPolicy?: MissedJobPolicy;
      maxCatchUpRuns?: number;
      condition?: ScheduleCondition;
      taskTitle?: string;
      taskPrompt?: string;
      taskType?: BackgroundTaskType;
      priority?: BackgroundTaskPriority;
      maxAttempts?: number;
      payload?: Record<string, unknown>;
      notifyOnRun?: boolean;
      nowMs?: number;
    },
  ): Promise<ScheduleRecord> {
    const nowMs = input.nowMs ?? Date.now();
    const tz = validateTimeZone(input.timeZone || 'UTC');

    let kind: ScheduleKind = input.kind || 'once';
    let runAt = input.runAt;
    let name = (input.name || '').trim();
    let taskTitle = (input.taskTitle || '').trim();
    let taskPrompt = (input.taskPrompt || '').trim();

    if (input.naturalLanguageReminder) {
      const parsed = parseReminderIntent(input.naturalLanguageReminder, {
        now: new Date(nowMs),
        timeZone: tz,
      });
      if (!parsed) {
        throw new SchedulerEngineError(
          'Could not parse an unambiguous reminder schedule from input.',
          'AMBIGUOUS_REMINDER',
          400,
        );
      }
      kind = parsed.recurrence;
      runAt = parsed.dueAt;
      if (!name) name = parsed.title;
      if (!taskTitle) taskTitle = parsed.title;
      if (!taskPrompt) taskPrompt = parsed.message;
    }

    if (!name) name = taskTitle || 'Scheduled Automation';
    if (!taskTitle) taskTitle = name;
    if (!taskPrompt) {
      throw new SchedulerEngineError('taskPrompt is required for scheduled jobs.', 'INVALID_SCHEDULE_INPUT', 400);
    }

    if (kind === 'cron' && input.cronExpression) {
      parseCronExpression(input.cronExpression);
    }

    const scheduleBase = {
      kind,
      timeZone: tz,
      runAt,
      intervalMinutes: input.intervalMinutes,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      dayOfMonth: input.dayOfMonth,
      cronExpression: input.cronExpression,
    };

    const nextRunAt = computeNextRunAt(scheduleBase, nowMs, true);
    if (!nextRunAt) {
      throw new SchedulerEngineError(
        'Schedule produces no valid future run time.',
        'NO_FUTURE_RUN_TIME',
        400,
      );
    }

    const nowIso = new Date(nowMs).toISOString();
    const scheduleId = `sched_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const record: ScheduleRecord = {
      scheduleId,
      userId: ctx.userId,
      name: name.slice(0, 160),
      description: input.description?.slice(0, 500),
      ...scheduleBase,
      status: 'active',
      missedJobPolicy: input.missedJobPolicy || 'run_once',
      maxCatchUpRuns: Math.min(10, Math.max(1, input.maxCatchUpRuns ?? 3)),
      condition: input.condition || { type: 'always' },
      taskTemplate: {
        title: taskTitle.slice(0, 180),
        prompt: taskPrompt.slice(0, 10_000),
        type: input.taskType || 'scheduled',
        priority: input.priority || 'normal',
        maxAttempts: Math.min(5, Math.max(1, input.maxAttempts ?? 3)),
        payload: input.payload,
      },
      notifyOnRun: input.notifyOnRun ?? true,
      nextRunAt,
      runCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.put(ctx, SCHEDULES_COLLECTION, scheduleId, record);

    await this.permissions.recordSecurityAuditDurable(
      ctx,
      {
        action: 'create_schedule',
        category: 'scheduler',
        resourceId: scheduleId,
        status: 'succeeded',
        details: { kind: record.kind, timeZone: record.timeZone, nextRunAt: record.nextRunAt },
      },
      this.auditStore,
    );

    return record;
  }

  public async getSchedule(ctx: DurableRequestContext, scheduleId: string): Promise<ScheduleRecord | null> {
    const found = await this.store.get<ScheduleRecord>(ctx, SCHEDULES_COLLECTION, scheduleId);
    if (!found || found.userId !== ctx.userId) return null;
    return found;
  }

  public async listSchedules(ctx: DurableRequestContext, limit = 100): Promise<ScheduleRecord[]> {
    const all = await this.store.list<ScheduleRecord>(ctx, SCHEDULES_COLLECTION, limit);
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async updateSchedule(
    ctx: DurableRequestContext,
    scheduleId: string,
    patch: Partial<{
      name: string;
      description: string;
      timeZone: string;
      timeOfDay: string;
      cronExpression: string;
      intervalMinutes: number;
      dayOfWeek: number;
      dayOfMonth: number;
      missedJobPolicy: MissedJobPolicy;
      condition: ScheduleCondition;
      notifyOnRun: boolean;
      taskPrompt: string;
      taskTitle: string;
      priority: BackgroundTaskPriority;
    }>,
    nowMs = Date.now(),
  ): Promise<ScheduleRecord> {
    const existing = await this.getSchedule(ctx, scheduleId);
    if (!existing) {
      throw new SchedulerEngineError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
    }
    if (existing.status === 'cancelled') {
      throw new SchedulerEngineError('Cannot edit a cancelled schedule.', 'SCHEDULE_CANCELLED', 409);
    }

    if (patch.timeZone) existing.timeZone = validateTimeZone(patch.timeZone);
    if (patch.name) existing.name = patch.name.trim().slice(0, 160);
    if (patch.description !== undefined) existing.description = patch.description.slice(0, 500);
    if (patch.timeOfDay) existing.timeOfDay = patch.timeOfDay;
    if (patch.cronExpression) {
      parseCronExpression(patch.cronExpression);
      existing.cronExpression = patch.cronExpression;
    }
    if (patch.intervalMinutes !== undefined) existing.intervalMinutes = Math.max(1, patch.intervalMinutes);
    if (patch.dayOfWeek !== undefined) existing.dayOfWeek = patch.dayOfWeek;
    if (patch.dayOfMonth !== undefined) existing.dayOfMonth = patch.dayOfMonth;
    if (patch.missedJobPolicy) existing.missedJobPolicy = patch.missedJobPolicy;
    if (patch.condition) existing.condition = patch.condition;
    if (patch.notifyOnRun !== undefined) existing.notifyOnRun = patch.notifyOnRun;
    if (patch.taskPrompt) existing.taskTemplate.prompt = patch.taskPrompt.slice(0, 10_000);
    if (patch.taskTitle) existing.taskTemplate.title = patch.taskTitle.slice(0, 180);
    if (patch.priority) existing.taskTemplate.priority = patch.priority;

    if (existing.status === 'active') {
      existing.nextRunAt = computeNextRunAt(existing, nowMs, false);
    }
    existing.updatedAt = new Date(nowMs).toISOString();
    await this.store.put(ctx, SCHEDULES_COLLECTION, scheduleId, existing);
    return existing;
  }

  public async pauseSchedule(ctx: DurableRequestContext, scheduleId: string): Promise<ScheduleRecord> {
    const existing = await this.getSchedule(ctx, scheduleId);
    if (!existing) throw new SchedulerEngineError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
    if (existing.status === 'cancelled' || existing.status === 'completed') return existing;
    existing.status = 'paused';
    existing.updatedAt = new Date().toISOString();
    await this.store.put(ctx, SCHEDULES_COLLECTION, scheduleId, existing);
    return existing;
  }

  public async resumeSchedule(
    ctx: DurableRequestContext,
    scheduleId: string,
    nowMs = Date.now(),
  ): Promise<ScheduleRecord> {
    const existing = await this.getSchedule(ctx, scheduleId);
    if (!existing) throw new SchedulerEngineError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
    if (existing.status === 'cancelled') {
      throw new SchedulerEngineError('Cannot resume a cancelled schedule.', 'SCHEDULE_CANCELLED', 409);
    }
    existing.status = 'active';
    existing.nextRunAt = computeNextRunAt(existing, nowMs, false);
    existing.updatedAt = new Date(nowMs).toISOString();
    await this.store.put(ctx, SCHEDULES_COLLECTION, scheduleId, existing);
    return existing;
  }

  public async cancelSchedule(ctx: DurableRequestContext, scheduleId: string): Promise<ScheduleRecord> {
    const existing = await this.getSchedule(ctx, scheduleId);
    if (!existing) throw new SchedulerEngineError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
    existing.status = 'cancelled';
    existing.nextRunAt = null;
    existing.updatedAt = new Date().toISOString();
    await this.store.put(ctx, SCHEDULES_COLLECTION, scheduleId, existing);
    return existing;
  }

  public async listScheduleRuns(
    ctx: DurableRequestContext,
    scheduleId?: string,
    limit = 50,
  ): Promise<ScheduleRunRecord[]> {
    const all = await this.store.list<ScheduleRunRecord>(ctx, SCHEDULE_RUNS_COLLECTION, 150);
    return all
      .filter((r) => !scheduleId || r.scheduleId === scheduleId)
      .sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
      .slice(0, Math.min(100, Math.max(1, limit)));
  }

  /**
   * Evaluate conditional automation rule safely (no eval / no arbitrary JS execution).
   */
  public async evaluateCondition(
    condition: ScheduleCondition,
    contextData: Record<string, unknown> = {},
  ): Promise<{ passed: boolean; reason: string }> {
    if (!condition || condition.type === 'always') {
      return { passed: true, reason: 'Unconditional schedule.' };
    }

    if (condition.type === 'expression') {
      const expr = (condition.expression || '').trim();
      const match = expr.match(/^([a-zA-Z0-9_.-]+)\s*(==|!=|>|<|>=|<=)\s*([a-zA-Z0-9_.-]+)$/);
      if (!match) {
        return { passed: false, reason: `Unsupported condition expression syntax '${expr}'.` };
      }
      const [, key, op, expectedRaw] = match;
      const actualVal = contextData[key];
      if (actualVal === undefined) {
        return { passed: false, reason: `Condition variable '${key}' is missing in evaluation context.` };
      }
      const actualNum = Number(actualVal);
      const expectedNum = Number(expectedRaw);
      const bothNumeric = Number.isFinite(actualNum) && Number.isFinite(expectedNum) && expectedRaw !== '';

      let passed = false;
      if (op === '==') passed = String(actualVal) === expectedRaw;
      else if (op === '!=') passed = String(actualVal) !== expectedRaw;
      else if (bothNumeric && op === '>') passed = actualNum > expectedNum;
      else if (bothNumeric && op === '<') passed = actualNum < expectedNum;
      else if (bothNumeric && op === '>=') passed = actualNum >= expectedNum;
      else if (bothNumeric && op === '<=') passed = actualNum <= expectedNum;

      return {
        passed,
        reason: passed
          ? `Condition '${expr}' satisfied (${key}=${String(actualVal)}).`
          : `Condition '${expr}' not met (${key}=${String(actualVal)}).`,
      };
    }

    if (condition.type === 'url_status') {
      const targetUrl = (condition.url || '').trim();
      if (!targetUrl.startsWith('https://')) {
        return { passed: false, reason: 'Conditional url_status check requires an https:// URL.' };
      }
      const expectedStatus = condition.expectedStatus ?? 200;
      try {
        const res = await fetch(targetUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        const passed = res.status === expectedStatus;
        return {
          passed,
          reason: passed
            ? `Endpoint returned expected HTTP ${res.status}.`
            : `Endpoint returned HTTP ${res.status} (expected ${expectedStatus}).`,
        };
      } catch (err) {
        return {
          passed: false,
          reason: err instanceof Error ? `Condition probe failed: ${err.message}` : 'Condition probe failed.',
        };
      }
    }

    return { passed: false, reason: 'Unknown condition type.' };
  }

  /**
   * Atomically dispatch all due schedules as real Feature 01 background tasks.
   * Handles missed-job recovery policies ('skip', 'run_once', 'catch_up') safely without duplicates.
   */
  public async dispatchDueSchedules(options?: {
    nowMs?: number;
    userId?: string;
    scheduleId?: string;
    conditionContext?: Record<string, unknown>;
    forceRunNow?: boolean;
  }): Promise<{
    evaluated: number;
    dispatched: ScheduleRunRecord[];
    skipped: ScheduleRunRecord[];
  }> {
    const nowMs = options?.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();

    let schedules: ScheduleRecord[];
    if (options?.userId && options?.scheduleId) {
      const one = await this.getSchedule({ userId: options.userId }, options.scheduleId);
      schedules = one ? [one] : [];
    } else if (options?.userId) {
      schedules = await this.listSchedules({ userId: options.userId }, 200);
    } else {
      schedules = await this.store.listAllForSystem<ScheduleRecord>(SCHEDULES_COLLECTION, 300);
    }

    const dispatched: ScheduleRunRecord[] = [];
    const skipped: ScheduleRunRecord[] = [];
    let evaluated = 0;

    for (const sched of schedules) {
      if (sched.status !== 'active') continue;
      if (!sched.nextRunAt && !options?.forceRunNow) continue;

      const nextRunMs = sched.nextRunAt ? new Date(sched.nextRunAt).getTime() : nowMs;
      if (!options?.forceRunNow && nextRunMs > nowMs) continue;

      evaluated += 1;

      // Atomic per-schedule dispatch lease prevents overlapping cron ticks from double-dispatching
      const leaseOwner = `sched_tick_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
      const leaseKey = `sched_dispatch:${sched.scheduleId}`;
      const lease = await this.store.tryAcquireLease(leaseKey, leaseOwner, 10_000);
      if (!lease.acquired) continue;

      try {
        const ctx: DurableRequestContext = { userId: sched.userId };
        const fresh = await this.store.get<ScheduleRecord>(ctx, SCHEDULES_COLLECTION, sched.scheduleId);
        if (!fresh || fresh.status !== 'active') continue;

        const dueTimestamps: string[] = [];
        if (options?.forceRunNow) {
          dueTimestamps.push(nowIso);
        } else if (fresh.nextRunAt) {
          // Determine all missed slots between fresh.nextRunAt and nowMs
          const missedSlots: string[] = [];
          let cursorIso: string | null = fresh.nextRunAt;
          let guard = 0;
          while (cursorIso && new Date(cursorIso).getTime() <= nowMs && guard < 50) {
            missedSlots.push(cursorIso);
            guard += 1;
            if (fresh.kind === 'once') break;
            cursorIso = computeNextRunAt(fresh, new Date(cursorIso).getTime(), false);
          }

          const isMissedBacklog = missedSlots.length > 1;
          if (isMissedBacklog) {
            if (fresh.missedJobPolicy === 'skip') {
              // Skip all overdue slots and jump cleanly to next future run
              fresh.nextRunAt = fresh.kind === 'once' ? null : computeNextRunAt(fresh, nowMs, false);
              if (fresh.kind === 'once') fresh.status = 'completed';
              fresh.updatedAt = nowIso;
              await this.store.put(ctx, SCHEDULES_COLLECTION, fresh.scheduleId, fresh);
              const skipRec: ScheduleRunRecord = {
                runId: `srun_${nowMs}_${crypto.randomBytes(4).toString('hex')}`,
                scheduleId: fresh.scheduleId,
                userId: fresh.userId,
                scheduledFor: missedSlots[0],
                executedAt: nowIso,
                status: 'skipped_condition',
                reason: `Missed ${missedSlots.length} overdue slot(s); skipped per missedJobPolicy='skip'.`,
              };
              await this.store.put(ctx, SCHEDULE_RUNS_COLLECTION, skipRec.runId, skipRec);
              skipped.push(skipRec);
              continue;
            } else if (fresh.missedJobPolicy === 'run_once') {
              dueTimestamps.push(missedSlots[missedSlots.length - 1]);
            } else {
              // catch_up: execute up to maxCatchUpRuns most recent missed occurrences
              dueTimestamps.push(...missedSlots.slice(-fresh.maxCatchUpRuns));
            }
          } else if (missedSlots.length === 1) {
            dueTimestamps.push(missedSlots[0]);
          }
        }

        for (const dueIso of dueTimestamps) {
          const cond = await this.evaluateCondition(fresh.condition, options?.conditionContext);
          const runId = `srun_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

          if (!cond.passed) {
            const skipRecord: ScheduleRunRecord = {
              runId,
              scheduleId: fresh.scheduleId,
              userId: fresh.userId,
              scheduledFor: dueIso,
              executedAt: nowIso,
              status: 'skipped_condition',
              reason: cond.reason,
            };
            await this.store.put(ctx, SCHEDULE_RUNS_COLLECTION, runId, skipRecord);
            fresh.lastRunAt = nowIso;
            fresh.lastRunStatus = 'skipped_condition';
            skipped.push(skipRecord);
            continue;
          }

          const idempotencyKey = `sched_${fresh.scheduleId}_${dueIso}`;
          const enqueued = await this.taskEngine.enqueueTask(ctx, {
            title: fresh.taskTemplate.title,
            prompt: fresh.taskTemplate.prompt,
            type: fresh.taskTemplate.type,
            priority: fresh.taskTemplate.priority,
            maxAttempts: fresh.taskTemplate.maxAttempts,
            scheduleId: fresh.scheduleId,
            idempotencyKey,
            payload: {
              ...(fresh.taskTemplate.payload || {}),
              scheduleId: fresh.scheduleId,
              scheduledFor: dueIso,
              timeZone: fresh.timeZone,
            },
          });

          const runRecord: ScheduleRunRecord = {
            runId,
            scheduleId: fresh.scheduleId,
            userId: fresh.userId,
            scheduledFor: dueIso,
            executedAt: nowIso,
            status: 'dispatched',
            taskId: enqueued.task.taskId,
            deduplicated: enqueued.deduplicated,
            reason: enqueued.deduplicated
              ? `Idempotent hit: task '${enqueued.task.taskId}' was already queued for ${dueIso}.`
              : `Dispatched durable background task '${enqueued.task.taskId}'.`,
          };
          await this.store.put(ctx, SCHEDULE_RUNS_COLLECTION, runId, runRecord);

          fresh.lastRunAt = nowIso;
          fresh.lastRunStatus = 'dispatched';
          if (!enqueued.deduplicated) {
            fresh.runCount += 1;
            if (fresh.notifyOnRun) {
              await this.taskEngine.createNotification(ctx, {
                kind: 'schedule_executed',
                title: `Scheduled Job Dispatched: ${fresh.name}`,
                body: `Queued background task '${enqueued.task.title}' (${enqueued.task.taskId}) for ${dueIso}.`,
                taskId: enqueued.task.taskId,
                scheduleId: fresh.scheduleId,
              });
            }
          }

          dispatched.push(runRecord);
        }

        // Advance nextRunAt for future ticks
        if (!options?.forceRunNow) {
          if (fresh.kind === 'once') {
            fresh.status = 'completed';
            fresh.nextRunAt = null;
          } else {
            fresh.nextRunAt = computeNextRunAt(fresh, nowMs, false);
          }
        }
        fresh.updatedAt = nowIso;
        await this.store.put(ctx, SCHEDULES_COLLECTION, fresh.scheduleId, fresh);
      } finally {
        await this.store.releaseLease(leaseKey, leaseOwner);
      }
    }

    return { evaluated, dispatched, skipped };
  }
}

export const defaultSchedulerEngine = new PersistentSchedulerEngine();
