/**
 * Timezone-safe recurrence math (Feature 05).
 *
 * Cron matching is evaluated against wall-clock time in the schedule's IANA
 * timezone, computed per candidate instant, so DST spring-forward gaps and
 * fall-back repeats are handled by construction. Pure functions only.
 */

import { SCHEDULE_HARD_LIMITS, type ScheduleSpec } from './types';

export interface ParsedCron {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
  domAll: boolean;
  dowAll: boolean;
}

export function parseCron(expr: string): { ok: true; fields: ParsedCron } | { ok: false; error: string } {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return { ok: false, error: 'Cron must have exactly 5 fields: minute hour day-of-month month day-of-week.' };
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const parsed: number[][] = [];
  const all: boolean[] = [];
  for (let f = 0; f < 5; f += 1) {
    const [lo, hi] = ranges[f];
    const values = new Set<number>();
    let isAll = false;
    for (const atom of parts[f].split(',')) {
      let body = atom;
      let step = 1;
      const slash = atom.indexOf('/');
      if (slash !== -1) {
        body = atom.slice(0, slash);
        step = Number(atom.slice(slash + 1));
        if (!Number.isInteger(step) || step < 1) return { ok: false, error: 'Cron step must be a positive integer: ' + atom };
      }
      let start = lo;
      let end = hi;
      if (body !== '*') {
        const dash = body.indexOf('-');
        if (dash !== -1) {
          start = Number(body.slice(0, dash));
          end = Number(body.slice(dash + 1));
        } else {
          start = Number(body);
          end = slash !== -1 ? hi : start;
        }
        if (!Number.isInteger(start) || !Number.isInteger(end)) return { ok: false, error: 'Cron fields must be numeric: ' + atom };
        if (f === 4 && start === 7) start = 0;
        if (f === 4 && end === 7) end = 7; // normalize below
        if (start < lo || end > hi || start > end) return { ok: false, error: 'Cron value out of range: ' + atom };
      } else if (slash !== -1) {
        start = lo;
        end = hi;
      }
      if (body === '*' && slash === -1) {
        isAll = true;
        for (let v = lo; v <= hi; v += 1) values.add(v);
      } else {
        for (let v = start; v <= end; v += step) values.add(v);
      }
    }
    const dayVals = f === 4 ? Array.from(values).map((v) => (v === 7 ? 0 : v)) : Array.from(values);
    parsed.push(Array.from(new Set(dayVals)).sort((a, b) => a - b));
    all.push(isAll);
  }
  if (parsed.some((p) => p.length === 0)) return { ok: false, error: 'Cron fields must not be empty.' };
  return {
    ok: true,
    fields: { minute: parsed[0], hour: parsed[1], dom: parsed[2], month: parsed[3], dow: parsed[4], domAll: all[2], dowAll: all[4] },
  };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function tzOffsetMs(tz: string, utcMs: number): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value || '0');
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUTC - Math.floor(utcMs / 1000) * 1000;
  } catch {
    return 0; // invalid timezones are rejected by isValidTimezone before use
  }
}

interface WallParts { y: number; mo: number; d: number; h: number; mi: number; dow: number; dayKey: number; }

function wallParts(tz: string, utcMs: number): WallParts {
  const local = utcMs + tzOffsetMs(tz, utcMs);
  const d = new Date(local);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return {
    y, mo, d: day, h: d.getUTCHours(), mi: d.getUTCMinutes(),
    dow: new Date(Date.UTC(y, mo - 1, day)).getUTCDay(),
    dayKey: y * 10000 + mo * 100 + day,
  };
}

function dowDomMatch(fields: ParsedCron, w: WallParts): boolean {
  const domOk = fields.dom.includes(w.d);
  const dowOk = fields.dow.includes(w.dow);
  if (!fields.domAll && !fields.dowAll) return domOk || dowOk; // standard vixie-cron OR rule
  return domOk && dowOk;
}

/** Next UTC minute strictly after afterMs whose wall clock matches the cron. */
export function nextCronOccurrence(fields: ParsedCron, timezone: string, afterMs: number): number | null {
  const minuteMs = 60000;
  let t = (Math.floor(afterMs / minuteMs) + 1) * minuteMs;
  for (let i = 0; i < SCHEDULE_HARD_LIMITS.cronScanMinutesMax; i += 1) {
    const w = wallParts(timezone, t);
    if (fields.month.includes(w.mo) && dowDomMatch(fields, w) && fields.hour.includes(w.h) && fields.minute.includes(w.mi)) {
      return t;
    }
    t += minuteMs;
  }
  return null;
}

/** Next occurrence for any schedule spec strictly after afterMs; null when none exists. */
export function nextOccurrence(spec: ScheduleSpec, afterMs: number): number | null {
  if (spec.kind === 'once') {
    if (!spec.runAt) return null;
    const t = Date.parse(spec.runAt);
    if (Number.isNaN(t)) return null;
    return t > afterMs ? t : null;
  }
  if (spec.kind === 'recurring') {
    if (spec.everyMinutes && spec.everyMinutes >= 1) {
      const n = spec.everyMinutes * 60000;
      return (Math.floor(afterMs / n) + 1) * n;
    }
    if (spec.dailyAt) {
      const parsed = parseCron(spec.dailyAt.minute + ' ' + spec.dailyAt.hour + ' * * *');
      if (!parsed.ok) return null;
      return nextCronOccurrence(parsed.fields, spec.timezone, afterMs);
    }
    return null;
  }
  if (spec.kind === 'cron') {
    if (!spec.cron) return null;
    const parsed = parseCron(spec.cron);
    if (!parsed.ok) return null;
    return nextCronOccurrence(parsed.fields, spec.timezone, afterMs);
  }
  return null;
}
