import { describe, it, expect, beforeEach } from 'vitest';
import {
  ScheduleEngine,
  type ScheduleRecord,
} from '../server/scheduler/scheduleEngine';
import {
  parseCronExpression,
  computeNextRun,
  wallClockToUtc,
  nextCronOccurrence,
} from '../server/scheduler/cronTime';
import { InMemoryDurableStore, type DurableStore, type DurableQuery } from '../server/durable/store';

const SCHEDULES_COLLECTION = 'system_schedules';
const NOTIFICATIONS_COLLECTION = 'system_notifications';

function freshEngine() {
  const store = new InMemoryDurableStore();
  const dispatched: Array<{ idempotencyKey: string; userId: string; type: string }> = [];
  const enqueue = async (p: { userId: string; type: string; payload: Record<string, any>; idempotencyKey: string; priority?: number }) => {
    dispatched.push({ idempotencyKey: p.idempotencyKey, userId: p.userId, type: p.type });
    return { task: { id: `task_${dispatched.length}` } };
  };
  return { store, engine: new ScheduleEngine(store, enqueue), dispatched };
}

describe('Feature 05: Persistent scheduler & automation engine', () => {
  let ctx: ReturnType<typeof freshEngine>;

  beforeEach(() => {
    ctx = freshEngine();
  });

  it('parses valid cron expressions and rejects invalid ones', () => {
    expect(parseCronExpression('0 9 * * 1-5')).not.toBeNull();
    expect(parseCronExpression('*/15 0 1,15 * *')).not.toBeNull();
    expect(parseCronExpression('0 9 * *')).toBeNull();
    expect(parseCronExpression('* * * * * *')).toBeNull();
    expect(parseCronExpression('99 * * * *')).toBeNull();
    expect(parseCronExpression('garbage')).toBeNull();
  });

  it('converts wall-clock time in an IANA timezone to the correct UTC instant', () => {
    const jan = wallClockToUtc(2025, 1, 15, 9, 0, 'America/New_York');
    expect(jan.toISOString()).toBe('2025-01-15T14:00:00.000Z');
    const jul = wallClockToUtc(2025, 7, 15, 9, 0, 'America/New_York');
    expect(jul.toISOString()).toBe('2025-07-15T13:00:00.000Z');
  });

  it('handles US daylight-saving spring-forward without shifting off the wall clock', () => {
    const afterSpring = wallClockToUtc(2025, 3, 10, 9, 0, 'America/New_York');
    expect(afterSpring.toISOString()).toBe('2025-03-10T13:00:00.000Z');
    const beforeSpring = wallClockToUtc(2025, 3, 8, 9, 0, 'America/New_York');
    expect(beforeSpring.toISOString()).toBe('2025-03-08T14:00:00.000Z');
  });

  it('finds the next cron occurrence respecting a timezone', () => {
    const fields = parseCronExpression('0 9 * * 1-5')!;
    const after = new Date('2025-01-17T12:00:00.000Z');
    const next = nextCronOccurrence(fields, after, 'America/New_York')!;
    expect(next.toISOString()).toBe('2025-01-17T14:00:00.000Z');
    const nextMonday = nextCronOccurrence(fields, new Date('2025-01-17T15:00:00.000Z'), 'America/New_York')!;
    expect(nextMonday.getUTCDay()).toBe(1);
    expect(nextMonday.toISOString()).toBe('2025-01-20T14:00:00.000Z');
  });

  it('computes next runs for each schedule kind', () => {
    const future = new Date('2025-06-01T00:00:00.000Z');
    const once = computeNextRun({ kind: 'once', at: '2025-06-01T10:00:00.000Z' }, future);
    expect(once!.toISOString()).toBe('2025-06-01T10:00:00.000Z');
    const past = computeNextRun({ kind: 'once', at: '2025-05-01T10:00:00.000Z' }, future);
    expect(past).toBeNull();
    const interval = computeNextRun({ kind: 'interval', intervalMinutes: 30 }, future);
    expect(interval!.toISOString()).toBe('2025-06-01T00:30:00.000Z');
  });

  it('creates a durable schedule with a computed next run', async () => {
    const record = await ctx.engine.createSchedule({
      userId: 'usr_a',
      title: 'Morning research',
      taskType: 'research',
      payload: { topic: 'AI agents' },
      spec: { kind: 'once', at: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(record.id).toMatch(/^sched_/);
    expect(record.status).toBe('active');
    expect(record.nextRunAt).toBeTruthy();
    expect(new Date(record.nextRunAt!).getTime()).toBeGreaterThan(Date.now());

    const fetched = await ctx.engine.getSchedule(record.id, 'usr_a');
    expect(fetched).not.toBeNull();
    const stranger = await ctx.engine.getSchedule(record.id, 'usr_other');
    expect(stranger).toBeNull();
  });

  it('validates cron expressions and timezones at creation', async () => {
    await expect(
      ctx.engine.createSchedule({
        userId: 'usr_a',
        title: 'Bad cron',
        taskType: 'reminder',
        payload: {},
        spec: { kind: 'cron', expression: 'not cron', timeZone: 'UTC' },
      }),
    ).rejects.toThrow(/Invalid cron/);
    await expect(
      ctx.engine.createSchedule({
        userId: 'usr_a',
        title: 'Bad timezone',
        taskType: 'reminder',
        payload: {},
        spec: { kind: 'cron', expression: '0 9 * * *', timeZone: 'Mars/Olympus' },
      }),
    ).rejects.toThrow(/Invalid IANA timezone/);
  });

  it('dispatches a due one-time schedule exactly once', async () => {
    const record = await ctx.engine.createSchedule({
      userId: 'usr_once',
      title: 'One-shot reminder',
      taskType: 'reminder',
      payload: { message: 'hi' },
      spec: { kind: 'once', at: new Date(Date.now() + 30).toISOString() },
    });
    await new Promise((r) => setTimeout(r, 80));

    const tick1 = await ctx.engine.tick({ now: new Date() });
    expect(tick1.dispatched).toHaveLength(1);
    expect(tick1.dispatched[0].scheduleId).toBe(record.id);
    expect(ctx.dispatched[0].userId).toBe('usr_once');
    expect(ctx.dispatched[0].idempotencyKey).toBeTruthy();

    const tick2 = await ctx.engine.tick({ now: new Date() });
    expect(tick2.dispatched).toHaveLength(0);
    const after = await ctx.engine.getSchedule(record.id, 'usr_once');
    expect(after!.executionCount).toBe(1);
    expect(after!.status).toBe('active');
    expect(after!.nextRunAt).toBeNull();
  });

  it('dispatches recurring schedules only when due and advances nextRunAt', async () => {
    const record = await ctx.engine.createSchedule({
      userId: 'usr_rec',
      title: 'Interval check',
      taskType: 'website_check',
      payload: { url: 'https://example.com' },
      spec: { kind: 'interval', intervalMinutes: 1 },
    });
    const tick0 = await ctx.engine.tick({ now: new Date() });
    expect(tick0.dispatched).toHaveLength(0);

    const doc = (await ctx.store.get(SCHEDULES_COLLECTION, record.id)) as unknown as ScheduleRecord;
    await ctx.store.set(SCHEDULES_COLLECTION, record.id, {
      ...doc,
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
    } as unknown as Record<string, any>);

    const tick1 = await ctx.engine.tick({ now: new Date() });
    expect(tick1.dispatched).toHaveLength(1);

    const after = await ctx.engine.getSchedule(record.id, 'usr_rec');
    expect(after!.executionCount).toBe(1);
    expect(new Date(after!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('cancels and pauses schedules so their jobs stop dispatching', async () => {
    const cancelled = await ctx.engine.createSchedule({
      userId: 'usr_ctl',
      title: 'Cancelled job',
      taskType: 'reminder',
      payload: {},
      spec: { kind: 'interval', intervalMinutes: 1 },
    });
    const paused = await ctx.engine.createSchedule({
      userId: 'usr_ctl',
      title: 'Paused job',
      taskType: 'reminder',
      payload: {},
      spec: { kind: 'interval', intervalMinutes: 1 },
    });

    expect(await ctx.engine.cancelSchedule(cancelled.id, 'usr_stranger')).toBe(false);
    expect(await ctx.engine.cancelSchedule(cancelled.id, 'usr_ctl')).toBe(true);
    expect((await ctx.engine.getSchedule(cancelled.id, 'usr_ctl'))!.status).toBe('cancelled');

    expect(await ctx.engine.setScheduleStatus(paused.id, 'usr_ctl', 'paused')).toBe(true);

    await ctx.store.query(SCHEDULES_COLLECTION, {
      filters: [{ field: 'userId', op: 'eq', value: 'usr_ctl' }],
    } as DurableQuery).then(async (rows) => {
      for (const row of rows) {
        await ctx.store.set(SCHEDULES_COLLECTION, row.id as string, {
          ...(row as unknown as ScheduleRecord),
          nextRunAt: new Date(Date.now() - 1000).toISOString(),
        } as unknown as Record<string, any>);
      }
    });

    const tick = await ctx.engine.tick({ now: new Date(), userId: 'usr_ctl' });
    expect(tick.dispatched).toHaveLength(0);

    expect(await ctx.engine.setScheduleStatus(paused.id, 'usr_ctl', 'active')).toBe(true);
    const resumed = await ctx.engine.getSchedule(paused.id, 'usr_ctl');
    expect(resumed!.nextRunAt).not.toBeNull();
    expect(new Date(resumed!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('recovers missed jobs per policy: run_once dispatches once, skip does not', async () => {
    const missedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const runOnce = await ctx.engine.createSchedule({
      userId: 'usr_miss',
      title: 'Run late once',
      taskType: 'research',
      payload: {},
      spec: { kind: 'interval', intervalMinutes: 1 },
      missedPolicy: 'run_once',
    });
    const doc1 = (await ctx.store.get(SCHEDULES_COLLECTION, runOnce.id)) as unknown as ScheduleRecord;
    await ctx.store.set(SCHEDULES_COLLECTION, runOnce.id, { ...doc1, nextRunAt: missedAt } as unknown as Record<string, any>);

    const skipIt = await ctx.engine.createSchedule({
      userId: 'usr_miss',
      title: 'Skip late',
      taskType: 'research',
      payload: {},
      spec: { kind: 'interval', intervalMinutes: 1 },
      missedPolicy: 'skip',
    });
    const doc2 = (await ctx.store.get(SCHEDULES_COLLECTION, skipIt.id)) as unknown as ScheduleRecord;
    await ctx.store.set(SCHEDULES_COLLECTION, skipIt.id, { ...doc2, nextRunAt: missedAt } as unknown as Record<string, any>);

    const tick = await ctx.engine.tick({ now: new Date(), userId: 'usr_miss' });
    expect(tick.dispatched.map((d) => d.scheduleId)).toEqual([runOnce.id]);
    expect(tick.skipped.map((s) => s.scheduleId)).toEqual([skipIt.id]);
    expect(tick.skipped[0].reason).toContain('missed');

    const runs = await ctx.engine.getRunHistory('usr_miss');
    const statuses = new Set(runs.map((r) => r.status));
    expect(statuses).toContain('dispatched');
    expect(statuses).toContain('skipped');
  });

  it('only acknowledges verified completions and writes failure notifications', async () => {
    const record = await ctx.engine.createSchedule({
      userId: 'usr_ack',
      title: 'Acked job',
      taskType: 'report',
      payload: {},
      spec: { kind: 'once', at: new Date(Date.now() + 30).toISOString() },
    });
    await new Promise((r) => setTimeout(r, 80));
    const tick = await ctx.engine.tick({ now: new Date() });
    expect(tick.dispatched).toHaveLength(1);

    const runs = await ctx.engine.getRunHistory('usr_ack', record.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('dispatched');
    expect(runs[0].verified).toBe(false);

    expect(await ctx.engine.acknowledgeRunCompletion({ runId: runs[0].id, userId: 'usr_ack', status: 'completed', resultSummary: 'Report generated' })).toBe(true);
    const completed = (await ctx.engine.getRunHistory('usr_ack', record.id))[0];
    expect(completed.status).toBe('completed');
    expect(completed.verified).toBe(true);
    expect(completed.resultSummary).toContain('Report generated');

    expect(await ctx.engine.acknowledgeRunCompletion({ runId: runs[0].id, userId: 'usr_stranger', status: 'failed' })).toBe(false);

    const failedRec = await ctx.engine.createSchedule({
      userId: 'usr_fail',
      title: 'Failing job',
      taskType: 'report',
      payload: {},
      spec: { kind: 'once', at: new Date(Date.now() + 30).toISOString() },
    });
    await new Promise((r) => setTimeout(r, 80));
    await ctx.engine.tick({ now: new Date(), userId: 'usr_fail' });
    const failRuns = await ctx.engine.getRunHistory('usr_fail', failedRec.id);
    await ctx.engine.acknowledgeRunCompletion({ runId: failRuns[0].id, userId: 'usr_fail', status: 'failed', error: 'provider exploded' });
    const notifications = await ctx.store.query(NOTIFICATIONS_COLLECTION, {
      filters: [{ field: 'userId', op: 'eq', value: 'usr_fail' }],
    });
    expect(notifications.length).toBe(1);
    expect((notifications[0] as any).kind).toBe('schedule_failure');
    expect((notifications[0] as any).message).toContain('provider exploded');
  });

  it('unverifiable claims stay unverified: dispatched runs are never silently marked completed', async () => {
    const record = await ctx.engine.createSchedule({
      userId: 'usr_lazy',
      title: 'Never actually runs',
      taskType: 'coding_job',
      payload: {},
      spec: { kind: 'once', at: new Date(Date.now() + 30).toISOString() },
    });
    await new Promise((r) => setTimeout(r, 80));
    await ctx.engine.tick({ now: new Date() });
    const runs = await ctx.engine.getRunHistory('usr_lazy', record.id);
    expect(runs[0].status).toBe('dispatched');
    expect(runs[0].verified).toBe(false);
    expect(runs[0].finishedAt).toBeUndefined();
  });
});
