/**
 * Persistent scheduler & automation engine types (Feature 05).
 *
 * Schedules are durable Firestore records. Every due occurrence is claimed
 * atomically (compare-and-set on nextRunAt) and dispatched as a durable
 * Feature 01 task with an occurrence-scoped idempotency key, so a tick storm
 * or serverless restart can never double-execute. Occurrences are only marked
 * succeeded after verified worker confirmation.
 */

export type ScheduleKind = 'once' | 'recurring' | 'cron';

export interface ScheduleSpec {
  kind: ScheduleKind;
  runAt?: string | null;        // once: ISO instant
  everyMinutes?: number | null; // recurring UTC interval (1..10080); use cron/dailyAt for timezone-aware local times
  dailyAt?: { hour: number; minute: number } | null; // recurring daily local time in timezone
  cron?: string | null;         // 5-field cron
  timezone: string;             // IANA tz name
}

export type ScheduleTarget =
  | { type: 'agents_run'; objective: string }
  | { type: 'task'; taskType: string; payload: Record<string, unknown> }
  | { type: 'webhook'; url: string; method?: string; body?: Record<string, unknown> };

export type ScheduleStatus = 'active' | 'paused' | 'cancelled';

export type MissedJobPolicy = 'skip_to_next' | 'catch_up_once';

export interface ScheduleRecord {
  scheduleId: string;
  userId: string;
  title: string;
  spec: ScheduleSpec;
  target: ScheduleTarget;
  status: ScheduleStatus;
  missedJobPolicy: MissedJobPolicy;
  nextRunAt: string | null;  // ISO instant (UTC) of the next due occurrence
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  durable: boolean;
}

export type OccurrenceStatus = 'dispatched' | 'succeeded' | 'failed' | 'skipped';

export interface ScheduleRunRecord {
  runId: string; // deterministic: occ_<scheduleId>_<occurrenceMs>
  scheduleId: string;
  userId: string;
  occurrenceMs: number;
  plannedFor: string;
  status: OccurrenceStatus;
  taskId?: string;
  detail?: string;
  verifiedAt?: string;
  createdAt: string;
}

export const SCHEDULE_HARD_LIMITS = {
  maxSchedulesPerUser: 50,
  maxTitleChars: 200,
  everyMinutesMin: 1,
  everyMinutesMax: 7 * 24 * 60,
  cronScanMinutesMax: 40 * 1440, // crons must fire within ~40 days or creation is refused
  maxPayloadBytes: 8192,
  defaultGraceMs: 5 * 60 * 1000,
} as const;
