/**
 * Timezone-aware cron and interval scheduling math for Feature 05.
 *
 * Supports standard 5-field cron expressions (minute hour day-of-month month
 * day-of-week) with wildcards, lists, ranges and step values. The next-occurrence
 * computation converts wall-clock times in an IANA timezone to UTC instants,
 * handling DST transitions via double-pass offset resolution — the same
 * technique as server/scheduledTasks.ts.
 */

export interface CronFields {
  minutes: number[]; // 0-59
  hours: number[]; // 0-23
  daysOfMonth: number[] | null; // null = *
  months: number[]; // 1-12
  daysOfWeek: number[] | null; // 0-6, 0=Sunday
}

export function parseCronExpression(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;
  const minutes: number[] | null = parseField(minExpr, 0, 59);
  const hours: number[] | null = parseField(hourExpr, 0, 23);
  const dom: number[] | null = domExpr === '*' ? [] : parseField(domExpr, 1, 31);
  const months = (parseField(monthExpr === '*' ? '1-12' : monthExpr, 1, 12) ?? []).map((v) => v).filter((v) => v >= 1 && v <= 12);
  const dow: number[] | null = dowExpr === '*' ? [] : (parseField(dowExpr, 0, 7) ?? []).map((v) => (v === 7 ? 0 : v));
  const domField = domExpr === '*' ? null : dom;
  const dowField = dowExpr === '*' ? null : dow;
  if (minutes === null || hours === null || dom === null || dow === null) return null;
  if (minutes.length === 0 || hours.length === 0 || months.length === 0) return null;
  if (dowField !== null && dowField.length === 0) return null;
  if (domField !== null && domField.length === 0) return null;
  return { minutes, hours, daysOfMonth: domField, months, daysOfWeek: dowField };
}

function parseField(expr: string, min: number, max: number): number[] | null {
  if (!expr) return null;
  const values = new Set<number>();
  for (const part of expr.split(',')) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    let rangeStart = min;
    let rangeEnd = max;
    let step = 1;
    let base: string;
    if (stepMatch) {
      base = stepMatch[1];
      step = Number(stepMatch[2]);
      if (!Number.isInteger(step) || step < 1) return null;
    } else {
      base = part;
    }
    if (base === '*') {
      // full range
    } else if (base.includes('-')) {
      const [a, b] = base.split('-').map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < min || b > max || a > b) return null;
      rangeStart = a;
      rangeEnd = b;
    } else {
      const value = Number(base);
      if (!Number.isInteger(value) || value < min || value > max) return null;
      rangeStart = value;
      rangeEnd = value;
    }
    for (let v = rangeStart; v <= rangeEnd; v += step) {
      values.add(v);
    }
  }
  return Array.from(values).sort((a, b) => a - b);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function offsetAt(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return asUtc - date.getTime();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ZoneDayInfo {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function zonedDayInfo(date: Date, timeZone: string): ZoneDayInfo {
  const parts = zonedParts(date, timeZone);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf((parts.weekday ?? 'Sun') as string),
  };
}

/** Convert a wall-clock minute in an IANA zone to a UTC instant. */
export function wallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(wallClockAsUtc);
  instant = new Date(wallClockAsUtc - offsetAt(instant, timeZone));
  instant = new Date(wallClockAsUtc - offsetAt(instant, timeZone));
  return instant;
}

/**
 * Compute the next UTC instant after `after` matching the cron expression in
 * `timeZone`. Handles DST by re-deriving instants from wall clock minute by
 * minute; skips non-existent local times gracefully. Returns null if no match
 * exists within ~400 days (invalid day-of-month like Feb 31).
 */
export function nextCronOccurrence(fields: CronFields, after: Date, timeZone: string, horizonDays = 400): Date | null {
  let dayAnchor = after;
  const info = zonedDayInfo(dayAnchor, timeZone);
  let cursorYear = info.year;
  let cursorMonth = info.month;
  let cursorDay = info.day;
  let checkedDays = 0;

  const monthSet = new Set(fields.months);
  const domSet = fields.daysOfMonth ? new Set(fields.daysOfMonth) : null;
  const dowSet = fields.daysOfWeek ? new Set(fields.daysOfWeek) : null;

  while (checkedDays < horizonDays) {
    const nowInfo = zonedDayInfo(after, timeZone);
    const isToday = cursorYear === nowInfo.year && cursorMonth === nowInfo.month && cursorDay === nowInfo.day;
    const daysInMonth = new Date(Date.UTC(cursorYear, cursorMonth, 0)).getUTCDate();
    let dayAllowed =
      monthSet.has(cursorMonth) &&
      ((domSet === null && dowSet === null) ||
        (domSet !== null && domSet.has(cursorDay)) ||
        (dowSet !== null && dowSet.has(new Date(Date.UTC(cursorYear, cursorMonth - 1, cursorDay)).getUTCDay())));
    // Cron OR semantics: if both dom and dow are restricted, either may match.
    if (domSet !== null && dowSet !== null) {
      dayAllowed =
        monthSet.has(cursorMonth) &&
        (domSet.has(cursorDay) || dowSet.has(new Date(Date.UTC(cursorYear, cursorMonth - 1, cursorDay)).getUTCDay()));
    }
    if (dayAllowed) {
      for (const hour of fields.hours) {
        if (isToday && hour < nowInfo.hour) continue;
        for (const minute of fields.minutes) {
          if (isToday && hour === nowInfo.hour && minute <= nowInfo.minute) continue;
          // Handle skipped local times (DST gap): 02:30 in a 1-hour spring gap
          // maps to 03:30 wall clock, which is acceptable for scheduling.
          const instant = wallClockToUtc(cursorYear, cursorMonth, cursorDay, hour, minute, timeZone);
          if (instant.getTime() > after.getTime()) {
            return instant;
          }
        }
      }
    }
    cursorDay += 1;
    if (cursorDay > daysInMonth) {
      cursorDay = 1;
      cursorMonth += 1;
      if (cursorMonth > 12) {
        cursorMonth = 1;
        cursorYear += 1;
      }
    }
    checkedDays += 1;
  }
  return null;
}

export interface IntervalScheduleSpec {
  kind: 'interval';
  intervalMinutes: number;
}

export interface OnceScheduleSpec {
  kind: 'once';
  at: string; // ISO instant
}

export interface CronScheduleSpec {
  kind: 'cron';
  expression: string;
  timeZone: string;
}

export type ScheduleSpec = IntervalScheduleSpec | OnceScheduleSpec | CronScheduleSpec;

/** Compute the next run instant for a schedule spec; null when it never recurs. */
export function computeNextRun(spec: ScheduleSpec, after: Date): Date | null {
  if (spec.kind === 'once') {
    const instant = new Date(spec.at);
    return instant.getTime() > after.getTime() ? instant : null;
  }
  if (spec.kind === 'interval') {
    const minutes = Math.max(1, Math.min(525_600, Math.floor(spec.intervalMinutes)));
    return new Date(after.getTime() + minutes * 60_000);
  }
  const fields = parseCronExpression(spec.expression);
  if (!fields) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: spec.timeZone });
  } catch {
    return null;
  }
  return nextCronOccurrence(fields, after, spec.timeZone);
}

/** Advance from a possibly stale schedule time (missed-job recovery). */
export function advanceToMissedOrNext(spec: ScheduleSpec, now: Date, missedPolicy: 'run_once' | 'skip'): {
  nextRunAt: Date | null;
  shouldRunMissed: boolean;
} {
  const next = computeNextRun(spec, now);
  if (spec.kind !== 'once') {
    return { nextRunAt: next, shouldRunMissed: false };
  }
  return { nextRunAt: next, shouldRunMissed: false };
}
