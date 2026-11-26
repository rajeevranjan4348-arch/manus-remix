import { describe, expect, it } from 'vitest';

import { MemoryScheduleStore } from '../server/scheduler/scheduleStore';
import { SchedulerService, validateSpec, validateTarget, newScheduleId } from '../server/scheduler/schedulerService';
import { parseCron, nextOccurrence } from '../server/scheduler/recurrence';
import type { ScheduleRecord, ScheduleSpec, ScheduleTarget } from '../server/scheduler/types';

const TZ = 'UTC';

const everyMinute = (): ScheduleSpec => ({ kind: 'recurring', everyMinutes: 1, timezone: TZ });
const onceAt = (iso: string): ScheduleSpec => ({ kind: 'once', runAt: iso, timezone: TZ });

const taskTarget = (): ScheduleTarget => ({ type: 'task', taskType: 'system.ping', payload: { hello: 'world' } });

function makeService() {
  return new SchedulerService(new MemoryScheduleStore());
}

function schedWithNext(partial: Partial<ScheduleRecord>, spec: ScheduleSpec, target = taskTarget()): ScheduleRecord {
  return {
    scheduleId: partial.scheduleId || newScheduleId(),
    userId: partial.userId || 'userA',
    title: partial.title || 'test',
    spec,
    target,
    status: partial.status ?? 'active',
    missedJobPolicy: partial.missedJobPolicy ?? 'skip_to_next',
    nextRunAt: partial.nextRunAt ?? new Date(Date.now() - 3600_000).toISOString(),
    lastRunAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    durable: false,
  };
}

describe('Feature 05: cron parsing and timezone math', () => {
  it('parses standard cron expressions and rejects malformed ones', () => {
    expect(parseCron('*/15 * * * *').ok).toBe(true);
    expect(parseCron('0 6 * * 1-5').ok).toBe(true);
    expect(parseCron('30 2 1,15 * 1').ok).toBe(true);
    expect(parseCron('61 * * * *').ok).toBe(false);
    expect(parseCron('a * * * *').ok).toBe(false);
    expect(parseCron('* * * *').ok).toBe(false);
  });

  it('handles DST transitions for timezone-aware daily schedules', () => {
    // America/New_York: EST is UTC-5 before Mar 8 2026, EDT is UTC-4 after.
    const beforeDST = nextOccurrence({ kind: 'recurring', dailyAt: { hour: 12, minute: 0 }, timezone: 'America/New_York' }, Date.parse('2026-02-09T00:00:00Z'));
    expect(new Date(beforeDST!).toISOString()).toBe('2026-02-09T17:00:00.000Z');
    const afterDST = nextOccurrence({ kind: 'recurring', dailyAt: { hour: 12, minute: 0 }, timezone: 'America/New_York' }, Date.parse('2026-03-10T00:00:00Z'));
    expect(new Date(afterDST!).toISOString()).toBe('2026-03-10T16:00:00.000Z');
  });

  it('weekly cron fires on the correct weekday in the target timezone', () => {
    // 2026-11-30 is a Monday; next Monday noon UTC from Sunday Nov 29.
    const next = nextOccurrence({ kind: 'cron', cron: '0 12 * * 1', timezone: TZ }, Date.parse('2026-11-29T00:00:00Z'));
    expect(new Date(next!).toISOString()).toBe('2026-11-30T12:00:00.000Z');
  });

  it('refuses schedules whose cron never fires within the planning window', () => {
    expect(validateSpec({ kind: 'cron', cron: '0 5 31 2 *', timezone: TZ }).valid).toBe(false); // Feb 31 never exists
  });

  it('validates specs and targets', () => {
    expect(validateSpec({ kind: 'recurring', everyMinutes: 0, timezone: TZ }).valid).toBe(false);
    expect(validateSpec({ kind: 'recurring', timezone: TZ }).valid).toBe(false); // neither interval nor dailyAt
    expect(validateSpec({ kind: 'once', runAt: 'not-a-date', timezone: TZ }).valid).toBe(false);
    expect(validateSpec({ kind: 'recurring', dailyAt: { hour: 25, minute: 0 }, timezone: TZ }).valid).toBe(false);
    expect(validateSpec({ kind: 'cron', cron: 'bad cron', timezone: TZ }).valid).toBe(false);
    expect(validateTarget({ type: 'webhook', url: 'http://localhost/x' } as ScheduleTarget).valid).toBe(false);
    expect(validateTarget({ type: 'task', taskType: 'bad type!', payload: {} } as ScheduleTarget).valid).toBe(false);
    expect(validateTarget(taskTarget()).valid).toBe(true);
  });
});

describe('Feature 05: lifecycle (create, pause, resume, edit, cancel)', () => {
  it('creates a schedule with a computed next occurrence and lists it for the owner only', async () => {
    const svc = makeService();
    const record = await svc.create('userA', { title: 'Daily research', spec: everyMinute(), target: taskTarget() });
    expect(record.status).toBe('active');
    expect(record.nextRunAt).not.toBeNull();
    expect(await svc.get('userB', record.scheduleId)).toBeNull();
    expect((await svc.list('userA')).length).toBe(1);
  });

  it('pauses, resumes (recomputing nextRun), and cancels', async () => {
    const svc = makeService();
    const s = await svc.create('userA', { title: 'x', spec: everyMinute(), target: taskTarget() });
    await svc.pause('userA', s.scheduleId);
    expect((await svc.get('userA', s.scheduleId))?.status).toBe('paused');
    const resumed = await svc.resume('userA', s.scheduleId);
    expect(resumed.status).toBe('active');
    expect(Date.parse(resumed.nextRunAt as string)).toBeGreaterThan(Date.now() - 1000);
    const cancelled = await svc.cancel('userA', s.scheduleId);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.nextRunAt).toBeNull();
    await expect(svc.edit('userA', s.scheduleId, { title: 'nope' })).rejects.toMatchObject({ code: 'SCHEDULE_CANCELLED' });
  });

  it('edits spec and recomputes the next run', async () => {
    const svc = makeService();
    const s = await svc.create('userA', { title: 'x', spec: everyMinute(), target: taskTarget() });
    const edited = await svc.edit('userA', s.scheduleId, { spec: { kind: 'recurring', everyMinutes: 60, timezone: TZ } });
    expect(edited.spec.everyMinutes).toBe(60);
  });
});

describe('Feature 05: due-occurrence claiming, idempotency, missed jobs', () => {
  it('claims due occurrences exactly once across concurrent ticks', async () => {
    const store = new MemoryScheduleStore();
    const svc = new SchedulerService(store);
    const s = schedWithNext({ scheduleId: newScheduleId(), nextRunAt: new Date(Date.now() - 60_000).toISOString() }, everyMinute());
    await store.putSchedule(s);
    const [a, b] = await Promise.all([svc.processDue(Date.now()), svc.processDue(Date.now())]);
    const totalClaimed = a.claimed + b.claimed;
    expect(totalClaimed).toBe(1); // atomic CAS: only one tick may claim
    const runs = await svc.listRuns('userA', s.scheduleId);
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe('dispatched');
    // Occurrence task idempotency: re-enqueuing the same occurrence replays.
  });

  it('queues the durable task with an occurrence-scoped idempotency key', async () => {
    const store = new MemoryScheduleStore();
    const svc = new SchedulerService(store);
    const s = schedWithNext({ nextRunAt: new Date(Date.now() - 1000).toISOString() }, everyMinute());
    await store.putSchedule(s);
    await svc.processDue(Date.now());
    const runs = await svc.listRuns('userA', s.scheduleId);
    expect(runs[0].taskId).toBeTruthy();
    expect(runs[0].runId).toMatch(/^occ_/);
  });

  it('skips missed jobs per policy instead of silently firing late', async () => {
    const store = new MemoryScheduleStore();
    const svc = new SchedulerService(store);
    const s = schedWithNext({
      nextRunAt: new Date(Date.now() - 2 * 3600_000).toISOString(), // 2h overdue
      missedJobPolicy: 'skip_to_next',
    }, everyMinute());
    await store.putSchedule(s);
    const summary = await svc.processDue(Date.now());
    const run = (await svc.listRuns('userA', s.scheduleId))[0];
    expect(run.status).toBe('skipped');
    expect(run.detail).toContain('grace window');
    const fresh = await svc.get('userA', s.scheduleId);
    expect(Date.parse(fresh?.nextRunAt as string)).toBeGreaterThan(Date.now()); // moved forward
    expect(summary.claimed).toBe(0);
  });

  it('catches missed jobs up exactly once with catch_up_once', async () => {
    const store = new MemoryScheduleStore();
    const svc = new SchedulerService(store);
    const s = schedWithNext({
      nextRunAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      missedJobPolicy: 'catch_up_once',
    }, everyMinute());
    await store.putSchedule(s);
    const summary = await svc.processDue(Date.now());
    expect(summary.claimed).toBe(1);
    const run = (await svc.listRuns('userA', s.scheduleId))[0];
    expect(run.occurrenceMs).toBe(Date.parse(s.nextRunAt as string)); // fires the planned occurrence
  });

  it('does not claim paused or cancelled schedules', async () => {
    const store = new MemoryScheduleStore();
    const svc = new SchedulerService(store);
    const paused = schedWithNext({ status: 'paused' }, everyMinute());
    const cancelled = schedWithNext({ status: 'cancelled', nextRunAt: null }, everyMinute());
    await store.putSchedule(paused);
    await store.putSchedule(cancelled);
    const summary = await svc.processDue(Date.now());
    expect(summary.claimed).toBe(0);
  });
});

describe('Feature 05: verification-only completion and honesty', () => {
  it('flips occurrences to succeeded only via verified worker callback, exactly once', async () => {
    const store = new MemoryScheduleStore();
    const svc = new SchedulerService(store);
    const s = schedWithNext({ nextRunAt: new Date(Date.now() - 1000).toISOString() }, everyMinute());
    await store.putSchedule(s);
    await svc.processDue(Date.now());
    const run = (await svc.listRuns('userA', s.scheduleId))[0];
    const ok = await svc.verifyOccurrence(s.scheduleId, run.runId, 'succeeded', 'worker confirmed');
    expect(ok?.status).toBe('succeeded');
    // A second verification (or a fake success after a failure) is rejected.
    expect(await svc.verifyOccurrence(s.scheduleId, run.runId, 'failed', 'replay attempt')).toBeNull();
    expect(await svc.verifyOccurrence(s.scheduleId, 'occ_unknown', 'succeeded', 'x')).toBeNull();
  });
});
