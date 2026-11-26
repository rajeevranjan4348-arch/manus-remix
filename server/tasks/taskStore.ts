/**
 * Task stores (Feature 01): Firestore-backed durable store with a transparent
 * non-durable fallback for local development. All multi-step state transitions
 * run inside Firestore transactions so concurrent workers can never
 * double-claim a task.
 */

import type { TaskRecord, TaskStore } from './types';
import { TASK_HARD_LIMITS } from './types';

export class MemoryTaskStore implements TaskStore {
  readonly durable = false;
  private tasks = new Map<string, TaskRecord>();

  async init() {}

  private ref(task: TaskRecord) {
    this.tasks.set(task.id, task);
  }

  async createTask(task: TaskRecord): Promise<'created' | 'existing'> {
    if (this.tasks.has(task.id)) return 'existing';
    this.ref({ ...task, events: task.events.slice() });
    return 'created';
  }

  async getTask(id: string, userId: string): Promise<TaskRecord | null> {
    const t = this.tasks.get(id);
    return t && t.userId === userId ? this.clone(t) : null;
  }

  async listForUser(userId: string, limit: number): Promise<TaskRecord[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(limit, TASK_HARD_LIMITS.listLimit))
      .map((t) => this.clone(t));
  }

  async findDueTasks(nowIso: string, limit: number): Promise<TaskRecord[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === 'queued' && t.runAt <= nowIso)
      .sort((a, b) => (b.priority - a.priority) || a.runAt.localeCompare(b.runAt) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.min(limit, 50))
      .map((t) => this.clone(t));
  }

  async claimTask(id: string, workerId: string, nowIso: string, leaseSeconds: number): Promise<TaskRecord | null> {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'queued' || t.runAt > nowIso) return null;
    if (t.leaseExpiresAt && t.leaseExpiresAt > nowIso && t.status === 'queued' && t.attemptsEverLeased) {
      // A cancelled-pending marker is modeled via status 'cancelled'; nothing extra here.
    }
    t.status = 'claimed';
    t.claimedBy = workerId;
    t.leaseExpiresAt = new Date(Date.parse(nowIso) + leaseSeconds * 1000).toISOString();
    t.updatedAt = nowIso;
    t.events = t.events.concat([{ at: nowIso, type: 'claimed', by: workerId }]);
    return this.clone(t);
  }

  async heartbeat(id: string, workerId: string, nowIso: string, leaseSeconds: number): Promise<TaskRecord | null> {
    const t = this.tasks.get(id);
    if (!t || t.claimedBy !== workerId || !['claimed', 'running'].includes(t.status)) return null;
    t.leaseExpiresAt = new Date(Date.parse(nowIso) + leaseSeconds * 1000).toISOString();
    t.updatedAt = nowIso;
    return this.clone(t);
  }

  async markRunning(id: string, workerId: string, nowIso: string): Promise<TaskRecord | null> {
    const t = this.tasks.get(id);
    if (!t || t.claimedBy !== workerId || !['claimed', 'running'].includes(t.status)) return null;
    t.status = 'running';
    if (!t.startedAt) t.startedAt = nowIso;
    t.updatedAt = nowIso;
    t.events = t.events.concat([{ at: nowIso, type: 'running', by: workerId }]);
    return this.clone(t);
  }

  async complete(id: string, workerId: string, nowIso: string, result: Record<string, unknown> | null): Promise<TaskRecord | null> {
    const t = this.tasks.get(id);
    if (!t || t.claimedBy !== workerId || !['claimed', 'running'].includes(t.status)) return null;
    t.status = 'completed';
    t.result = result || null;
    t.finishedAt = nowIso;
    t.updatedAt = nowIso;
    t.events = t.events.concat([{ at: nowIso, type: 'completed', by: workerId }]);
    return this.clone(t);
  }

  async fail(id: string, workerId: string, nowIso: string, error: string, backoffMs: number): Promise<'retry' | 'dead' | 'conflict'> {
    const t = this.tasks.get(id);
    if (!t || t.claimedBy !== workerId || !['claimed', 'running'].includes(t.status)) return 'conflict';
    t.attempts += 1;
    t.lastError = error;
    t.events = t.events.concat([{ at: nowIso, type: 'failed', detail: error.slice(0, 500), by: workerId }]);
    if (t.attempts >= t.maxAttempts) {
      t.status = 'dead';
      t.finishedAt = nowIso;
      t.updatedAt = nowIso;
      t.events = t.events.concat([{ at: nowIso, type: 'dead-lettered', detail: 'Retry budget exhausted' }]);
      return 'dead';
    }
    t.status = 'queued';
    t.runAt = new Date(Date.parse(nowIso) + backoffMs).toISOString();
    t.claimedBy = undefined;
    t.leaseExpiresAt = undefined;
    t.updatedAt = nowIso;
    return 'retry';
  }

  async cancel(id: string, userId: string, nowIso: string, reason: string): Promise<boolean> {
    const t = this.tasks.get(id);
    if (!t || t.userId !== userId || ['completed', 'failed', 'cancelled', 'dead'].includes(t.status)) return false;
    t.status = 'cancelled';
    t.finishedAt = nowIso;
    t.updatedAt = nowIso;
    t.lastError = reason;
    t.events = t.events.concat([{ at: nowIso, type: 'cancelled', detail: reason, by: userId }]);
    return true;
  }

  async recoverExpiredLeases(nowIso: string): Promise<number> {
    let recovered = 0;
    for (const t of this.tasks.values()) {
      if (['claimed', 'running'].includes(t.status) && t.leaseExpiresAt && t.leaseExpiresAt < nowIso) {
        t.attempts += 1;
        t.claimedBy = undefined;
        t.leaseExpiresAt = undefined;
        if (t.attempts >= t.maxAttempts) {
          t.status = 'dead';
          t.finishedAt = nowIso;
          t.events = t.events.concat([{ at: nowIso, type: 'dead-lettered', detail: 'Lease expired with retry budget exhausted' }]);
        } else {
          t.status = 'queued';
          t.runAt = nowIso;
          t.events = t.events.concat([{ at: nowIso, type: 'recovered', detail: 'Expired lease requeued' }]);
        }
        t.updatedAt = nowIso;
        recovered += 1;
      }
    }
    return recovered;
  }

  async statsForUser(userId: string): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const t of this.tasks.values()) {
      if (t.userId !== userId) continue;
      stats[t.status] = (stats[t.status] || 0) + 1;
      stats.attemptsTotal = (stats.attemptsTotal || 0) + t.attempts;
    }
    return stats;
  }

  private clone(t: TaskRecord): TaskRecord {
    return JSON.parse(JSON.stringify(t));
  }
}

/** Firestore-backed store using Admin SDK transactions for every transition. */
class FirestoreTaskStore implements TaskStore {
  readonly durable = true;
  private dbInstance: any = null;

  private async db(): Promise<any> {
    if (!this.dbInstance) {
      const { getFirestore } = await import('firebase-admin/firestore');
      this.dbInstance = getFirestore();
    }
    return this.dbInstance;
  }

  private col() {
    return this.db().then((db) => db.collection('agentTasks'));
  }

  async init() {
    await this.db();
  }

  private stripMeta(data: any): TaskRecord {
    const { events, ...rest } = data as TaskRecord & { __events?: any };
    return { ...(data as TaskRecord), events: (data.events || []) as TaskRecord['events'] };
  }

  async createTask(task: TaskRecord): Promise<'created' | 'existing'> {
    const col = await this.col();
    const ref = col.doc(task.id);
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    let outcome: 'created' | 'existing' = 'created';
    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        outcome = 'existing';
        return;
      }
      tx.create(ref, task);
    });
    return outcome;
  }

  async getTask(id: string, userId: string): Promise<TaskRecord | null> {
    const col = await this.col();
    const snap = await col.doc(id).get();
    if (!snap.exists) return null;
    const data = this.stripMeta(snap.data());
    return data.userId === userId ? data : null;
  }

  async listForUser(userId: string, limit: number): Promise<TaskRecord[]> {
    const col = await this.col();
    try {
      const snap = await col.where('userId', '==', userId).orderBy('createdAt', 'desc').limit(Math.min(limit, TASK_HARD_LIMITS.listLimit)).get();
      return snap.docs.map((d: any) => this.stripMeta(d.data()));
    } catch {
      // Missing composite index: single-field fallback.
      const snap = await col.where('userId', '==', userId).limit(TASK_HARD_LIMITS.listLimit).get();
      return snap.docs.map((d: any) => this.stripMeta(d.data()))
        .sort((a: TaskRecord, b: TaskRecord) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    }
  }

  async findDueTasks(nowIso: string, limit: number): Promise<TaskRecord[]> {
    const col = await this.col();
    try {
      const snap = await col
        .where('status', '==', 'queued')
        .where('runAt', '<=', nowIso)
        .orderBy('priority', 'desc')
        .orderBy('runAt', 'asc')
        .limit(Math.min(limit, 50))
        .get();
      return snap.docs.map((d: any) => this.stripMeta(d.data()));
    } catch {
      const snap = await col.where('status', '==', 'queued').limit(200).get();
      return snap.docs
        .map((d: any) => this.stripMeta(d.data()))
        .filter((t: TaskRecord) => t.runAt <= nowIso)
        .sort((a: TaskRecord, b: TaskRecord) => (b.priority - a.priority) || a.runAt.localeCompare(b.runAt))
        .slice(0, limit);
    }
  }

  private async transition(
    id: string,
    workerId: string | null,
    nowIso: string,
    mutate: (t: TaskRecord) => boolean,
  ): Promise<TaskRecord | null> {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const col = await this.col();
    const ref = col.doc(id);
    let result: TaskRecord | null = null;
    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = this.stripMeta(snap.data());
      if (workerId !== null && data.claimedBy !== workerId) return;
      if (!mutate(data)) return;
      data.updatedAt = nowIso;
      tx.set(ref, data);
      result = data;
    });
    return result;
  }

  async claimTask(id: string, workerId: string, nowIso: string, leaseSeconds: number): Promise<TaskRecord | null> {
    return this.transition(id, null, nowIso, (t) => {
      if (t.status !== 'queued' || t.runAt > nowIso) return false;
      if (t.status === 'cancelled') return false;
      t.status = 'claimed';
      t.claimedBy = workerId;
      t.leaseExpiresAt = new Date(Date.parse(nowIso) + leaseSeconds * 1000).toISOString();
      t.updatedAt = nowIso;
      t.events = (t.events || []).concat([{ at: nowIso, type: 'claimed', by: workerId }]);
      return true;
    });
  }
  // The cancel-inside-claim check is redundant with status !== 'queued'; kept simple.

  async heartbeat(id: string, workerId: string, nowIso: string, leaseSeconds: number): Promise<TaskRecord | null> {
    return this.transition(id, workerId, nowIso, (t) => {
      if (!['claimed', 'running'].includes(t.status)) return false;
      t.leaseExpiresAt = new Date(Date.parse(nowIso) + leaseSeconds * 1000).toISOString();
      return true;
    });
  }

  async markRunning(id: string, workerId: string, nowIso: string): Promise<TaskRecord | null> {
    return this.transition(id, workerId, nowIso, (t) => {
      if (!['claimed', 'running'].includes(t.status)) return false;
      t.status = 'running';
      if (!t.startedAt) t.startedAt = nowIso;
      t.events = (t.events || []).concat([{ at: nowIso, type: 'running', by: workerId }]);
      return true;
    });
  }

  async complete(id: string, workerId: string, nowIso: string, result: Record<string, unknown> | null): Promise<TaskRecord | null> {
    return this.transition(id, workerId, nowIso, (t) => {
      if (!['claimed', 'running'].includes(t.status)) return false;
      t.status = 'completed';
      t.result = result || null;
      t.finishedAt = nowIso;
      t.events = (t.events || []).concat([{ at: nowIso, type: 'completed', by: workerId }]);
      return true;
    });
  }

  async fail(id: string, workerId: string, nowIso: string, error: string, backoffMs: number): Promise<'retry' | 'dead' | 'conflict'> {
    let verdict: 'retry' | 'dead' | 'conflict' = 'conflict';
    await this.transition(id, workerId, nowIso, (t) => {
      if (!['claimed', 'running'].includes(t.status)) return false;
      t.attempts += 1;
      t.lastError = error.slice(0, 2000);
      t.events = (t.events || []).concat([{ at: nowIso, type: 'failed', detail: error.slice(0, 500), by: workerId }]);
      if (t.attempts >= t.maxAttempts) {
        t.status = 'dead';
        t.finishedAt = nowIso;
        t.events = (t.events || []).concat([{ at: nowIso, type: 'dead-lettered', detail: 'Retry budget exhausted' }]);
        verdict = 'dead';
      } else {
        t.status = 'queued';
        t.runAt = new Date(Date.parse(nowIso) + backoffMs).toISOString();
        t.claimedBy = '';
        t.leaseExpiresAt = '';
        verdict = 'retry';
      }
      return true;
    });
    return verdict;
  }

  async cancel(id: string, userId: string, nowIso: string, reason: string): Promise<boolean> {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const col = await this.col();
    const ref = col.doc(id);
    let cancelled = false;
    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = this.stripMeta(snap.data());
      if (data.userId !== userId) return;
      if (['completed', 'failed', 'cancelled', 'dead'].includes(data.status)) return;
      data.status = 'cancelled';
      data.finishedAt = nowIso;
      data.lastError = reason.slice(0, 500);
      data.updatedAt = nowIso;
      data.events = (data.events || []).concat([{ at: nowIso, type: 'cancelled', detail: reason.slice(0, 200), by: userId }]);
      tx.set(ref, data);
      cancelled = true;
    });
    return cancelled;
  }

  async recoverExpiredLeases(nowIso: string): Promise<number> {
    const col = await this.col();
    let snap;
    try {
      snap = await col.where('status', 'in', ['claimed', 'running']).limit(200).get();
    } catch {
      return 0;
    }
    let recovered = 0;
    for (const doc of snap.docs) {
      const t = this.stripMeta(doc.data());
      if (!t.leaseExpiresAt || t.leaseExpiresAt >= nowIso) continue;
      const ref = col.doc(t.id);
      const { getFirestore } = await import('firebase-admin/firestore');
      const db = getFirestore();
      try {
        await db.runTransaction(async (tx: any) => {
          const fresh = await tx.get(ref);
          if (!fresh.exists) return;
          const cur = this.stripMeta(fresh.data());
          if (!['claimed', 'running'].includes(cur.status) || !cur.leaseExpiresAt || cur.leaseExpiresAt >= nowIso) return;
          cur.attempts += 1;
          cur.claimedBy = '';
          cur.leaseExpiresAt = '';
          if (cur.attempts >= cur.maxAttempts) {
            cur.status = 'dead';
            cur.finishedAt = nowIso;
            cur.events = (cur.events || []).concat([{ at: nowIso, type: 'dead-lettered', detail: 'Lease expired with retry budget exhausted' }]);
          } else {
            cur.status = 'queued';
            cur.runAt = nowIso;
            cur.events = (cur.events || []).concat([{ at: nowIso, type: 'recovered', detail: 'Expired lease requeued' }]);
          }
          cur.updatedAt = nowIso;
          tx.set(ref, cur);
          recovered += 1;
        });
      } catch { /* next sweep retries */ }
    }
    return recovered;
  }

  async statsForUser(userId: string): Promise<Record<string, number>> {
    const col = await this.col();
    const snap = await col.where('userId', '==', userId).limit(500).get();
    const stats: Record<string, number> = {};
    for (const doc of snap.docs) {
      const t = this.stripMeta(doc.data());
      stats[t.status] = (stats[t.status] || 0) + 1;
    }
    return stats;
  }
}

let cached: TaskStore | null = null;

/** Resolve the best available store; Firestore when credentials exist. */
export async function resolveTaskStore(): Promise<TaskStore> {
  if (cached) return cached;
  try {
    const store = new FirestoreTaskStore();
    await store.init();
    cached = store;
  } catch {
    cached = new MemoryTaskStore();
  }
  return cached;
}

/** Test/bootstrapping hook to force a store (used by unit tests). */
export function setTaskStoreForTesting(store: TaskStore): void {
  cached = store;
}
