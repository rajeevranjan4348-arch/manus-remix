import { describe, it, expect, beforeEach } from 'vitest';
import {
  DurableTaskQueue,
  TASKS_COLLECTION,
  computeBackoffMs,
  type TaskRecord,
} from '../server/taskQueue/durableTaskQueue';
import { InMemoryDurableStore, setDefaultDurableStoreForTests } from '../server/durable/store';

function freshQueue() {
  const store = new InMemoryDurableStore();
  setDefaultDurableStoreForTests(store);
  return { store, queue: new DurableTaskQueue(store) };
}

describe('Feature 01: Durable cloud task queue', () => {
  beforeEach(() => {
    const store = new InMemoryDurableStore();
    setDefaultDurableStoreForTests(store);
  });

  it('persists tasks with the full queued-state record and execution history', async () => {
    const { queue } = freshQueue();
    const { task } = await queue.enqueue({
      userId: 'usr_a',
      type: 'research_job',
      payload: { topic: 'durable queues' },
      priority: 5,
    });
    expect(task.id).toMatch(/^task_/);
    expect(task.status).toBe('queued');
    expect(task.history).toHaveLength(1);
    expect(task.history[0].event).toBe('queued');

    const fetched = await queue.getTask(task.id, 'usr_a');
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe('queued');
    expect(fetched!.payload).toEqual({ topic: 'durable queues' });
  });

  it('prevents duplicate execution with idempotency keys', async () => {
    const { queue } = freshQueue();
    const first = await queue.enqueue({
      userId: 'usr_a',
      type: 'research_job',
      payload: { topic: 'x' },
      idempotencyKey: 'dedupe-1',
    });
    expect(first.created).toBe(true);
    const second = await queue.enqueue({
      userId: 'usr_a',
      type: 'research_job',
      payload: { topic: 'x' },
      idempotencyKey: 'dedupe-1',
    });
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
  });

  it('claims tasks atomically so two concurrent workers never get the same task', async () => {
    const { queue } = freshQueue();
    await queue.enqueue({ userId: 'usr_a', type: 'a', payload: {} });
    await queue.enqueue({ userId: 'usr_a', type: 'b', payload: {} });

    const [w1, w2] = await Promise.all([
      queue.claimNext({ workerId: 'worker_1', maxConcurrentTasks: 2 }),
      queue.claimNext({ workerId: 'worker_2', maxConcurrentTasks: 2 }),
    ]);
    expect(w1).not.toBeNull();
    expect(w2).not.toBeNull();
    expect(w1!.id).not.toBe(w2!.id);
    expect(w1!.status).toBe('claimed');
    expect(w2!.status).toBe('claimed');

    const w3 = await queue.claimNext({ workerId: 'worker_3', maxConcurrentTasks: 2 });
    expect(w3).toBeNull();
  });

  it('claims higher-priority tasks first', async () => {
    const { queue } = freshQueue();
    await queue.enqueue({ userId: 'usr_a', type: 'low', payload: {}, priority: 1 });
    await queue.enqueue({ userId: 'usr_a', type: 'high', payload: {}, priority: 10 });

    const claimed = await queue.claimNext({ workerId: 'worker_1', maxConcurrentTasks: 2 });
    expect(claimed!.type).toBe('high');
  });

  it('enforces the per-user concurrency cap', async () => {
    const { queue } = freshQueue();
    for (let i = 0; i < 7; i += 1) {
      await queue.enqueue({ userId: 'usr_cap', type: `t${i}`, payload: {} });
    }
    const claimed: TaskRecord[] = [];
    for (let i = 0; i < 7; i += 1) {
      const next = await queue.claimNext({ workerId: `worker_${i}`, maxConcurrentTasks: 5 });
      if (next) claimed.push(next);
    }
    expect(claimed).toHaveLength(5);
    expect(claimed.every((t) => t.userId === 'usr_cap')).toBe(true);
  });

  it('keeps the task durably visible across claim → running → completed with history', async () => {
    const { queue, store } = freshQueue();
    const { task } = await queue.enqueue({ userId: 'usr_a', type: 'coding_job', payload: {} });
    const claimed = await queue.claimNext({ workerId: 'worker_1', maxConcurrentTasks: 2 });
    expect(claimed!.id).toBe(task.id);
    expect(await queue.markRunning({ taskId: task.id, workerId: 'worker_1' })).toBe(true);
    expect(await queue.complete({ taskId: task.id, workerId: 'worker_1', result: { ok: true } })).toBe(true);

    const raw = (await store.get(TASKS_COLLECTION, task.id)) as unknown as TaskRecord;
    expect(raw.status).toBe('completed');
    expect(raw.history.map((h) => h.event)).toEqual(['queued', 'claimed', 'completed']);

    const timeline = await queue.getExecutionHistory(task.id, 'usr_a');
    expect(timeline.map((h) => h.event)).toEqual(['queued', 'claimed', 'completed']);
  });

  it('only the claiming worker may complete or fail a task', async () => {
    const { queue } = freshQueue();
    const { task } = await queue.enqueue({ userId: 'usr_a', type: 't', payload: {} });
    await queue.claimNext({ workerId: 'worker_1', maxConcurrentTasks: 2 });
    expect(await queue.complete({ taskId: task.id, workerId: 'worker_impersonator' })).toBe(false);
    expect(await queue.fail({ taskId: task.id, workerId: 'worker_impersonator', error: 'boom' }).then((r) => r.status)).toBe('failed');
  });

  it('retries failed tasks with exponential backoff, then fails permanently at maxAttempts', async () => {
    const { queue, store } = freshQueue();
    const { task } = await queue.enqueue({ userId: 'usr_a', type: 't', payload: {}, maxAttempts: 3 });

    for (const [round, workerId] of [
      [1, 'w1'],
      [2, 'w2'],
    ] as const) {
      await queue.claimNext({ workerId, maxConcurrentTasks: 2 }).then((c) => expect(c!.id).toBe(task.id));
      const outcome = await queue.fail({ taskId: task.id, workerId, error: `transient failure ${round}`, retry: true });
      expect(outcome.status).toBe('queued');
      const current = (await queue.getTask(task.id, 'usr_a'))!;
      expect(current.attempts).toBe(round);
      expect(new Date(current.runAfter).getTime()).toBeGreaterThan(Date.now() - 1000);
      expect(new Date(current.runAfter).getTime()).toBeGreaterThan(new Date(current.createdAt).getTime());
      await store.set(TASKS_COLLECTION, task.id, { ...current, runAfter: new Date().toISOString() } as unknown as Record<string, any>);
    }

    await queue.claimNext({ workerId: 'w3', maxConcurrentTasks: 2 }).then((c) => expect(c!.id).toBe(task.id));
    const final = await queue.fail({ taskId: task.id, workerId: 'w3', error: 'permanent failure', retry: true });
    expect(final.status).toBe('failed');
    const current = (await queue.getTask(task.id, 'usr_a'))!;
    expect(current.status).toBe('failed');
    expect(current.lastError).toContain('permanent failure');
  });

  it('recovers interrupted jobs whose lease expired', async () => {
    const { queue, store } = freshQueue();
    const { task } = await queue.enqueue({ userId: 'usr_a', type: 't', payload: {}, maxAttempts: 3 });
    await queue.claimNext({ workerId: 'worker_gone', maxConcurrentTasks: 2 });

    const doc = (await store.get(TASKS_COLLECTION, task.id)) as unknown as TaskRecord;
    await store.set(TASKS_COLLECTION, task.id, {
      ...doc,
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const recovered = await queue.recoverInterrupted();
    expect(recovered).toBe(1);
    const after = (await queue.getTask(task.id, 'usr_a'))!;
    expect(after.status).toBe('queued');
    expect(after.claimedBy).toBeUndefined();

    const reclaimed = await queue.claimNext({ workerId: 'worker_new', maxConcurrentTasks: 2 });
    expect(reclaimed!.id).toBe(task.id);
  });

  it('supports task cancellation with owner verification', async () => {
    const { queue } = freshQueue();
    const { task } = await queue.enqueue({ userId: 'usr_a', type: 't', payload: {} });

    expect(await queue.requestCancellation(task.id, 'usr_stranger')).toBe(false);
    expect(await queue.requestCancellation(task.id, 'usr_a')).toBe(true);
    expect((await queue.getTask(task.id, 'usr_a'))!.status).toBe('cancelled');

    await queue.enqueue({ userId: 'usr_b', type: 't2', payload: {} });
    const claimed = await queue.claimNext({ workerId: 'w1', maxConcurrentTasks: 2 });
    expect(claimed).not.toBeNull();
    expect(await queue.requestCancellation(claimed!.id, 'usr_stranger')).toBe(false);
    expect(await queue.requestCancellation(claimed!.id, 'usr_b')).toBe(true);
    expect(await queue.confirmCancellation(claimed!.id, 'w1')).toBe(true);
    expect((await queue.getTask(claimed!.id, 'usr_b'))!.status).toBe('cancelled');
  });

  it('isolates task records by user', async () => {
    const { queue, store } = freshQueue();
    const { task } = await queue.enqueue({ userId: 'usr_a', type: 'secret_job', payload: {} });
    const other = await queue.getTask(task.id, 'usr_b');
    expect(other).toBeNull();
    const raw = (await store.get(TASKS_COLLECTION, task.id)) as unknown as TaskRecord;
    expect(raw.userId).toBe('usr_a');
  });

  it('computes exponential backoff', () => {
    const first = computeBackoffMs(1);
    const second = computeBackoffMs(2);
    const third = computeBackoffMs(3);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(computeBackoffMs(30)).toBe(computeBackoffMs(29));
  });
});
