/**
 * Durable schedule store (Feature 05).
 *
 * Firestore collections 'schedules' and 'scheduleRuns'. Occurrence claiming is
 * a transactional compare-and-set on nextRunAt so concurrent ticks cannot
 * double-claim. A clearly-flagged memory fallback exists for tests/dev.
 */

import type { ScheduleRecord, ScheduleRunRecord } from './types';

export interface ScheduleStore {
  readonly durable: boolean;
  putSchedule(s: ScheduleRecord): Promise<void>;
  getSchedule(id: string, userId?: string): Promise<ScheduleRecord | null>;
  listForUser(userId: string): Promise<ScheduleRecord[]>;
  listActive(): Promise<ScheduleRecord[]>;
  /** Atomic claim: fires patch(doc) only when nextRunAt is unchanged and status active. */
  claimOccurrence(id: string, expectedNextRunAt: string, patch: (r: ScheduleRecord) => ScheduleRecord | null): Promise<ScheduleRecord | null>;
  putRun(r: ScheduleRunRecord): Promise<void>;
  getRun(runId: string): Promise<ScheduleRunRecord | null>;
  listRuns(userId: string, scheduleId: string | undefined, limit: number): Promise<ScheduleRunRecord[]>;
}

export class MemoryScheduleStore implements ScheduleStore {
  readonly durable = false;
  private schedules = new Map<string, ScheduleRecord>();
  private runs = new Map<string, ScheduleRunRecord>();

  async putSchedule(s: ScheduleRecord) { this.schedules.set(s.scheduleId, JSON.parse(JSON.stringify(s))); }
  async getSchedule(id: string, userId?: string) {
    const s = this.schedules.get(id);
    if (!s) return null;
    if (userId && s.userId !== userId) return null;
    return JSON.parse(JSON.stringify(s));
  }
  async listForUser(userId: string) {
    return Array.from(this.schedules.values()).filter((s) => s.userId === userId).map((s) => JSON.parse(JSON.stringify(s)));
  }
  async listActive() {
    return Array.from(this.schedules.values()).filter((s) => s.status === 'active').map((s) => JSON.parse(JSON.stringify(s)));
  }
  async claimOccurrence(id: string, expectedNextRunAt: string, patch: (r: ScheduleRecord) => ScheduleRecord | null) {
    const cur = this.schedules.get(id);
    if (!cur || cur.status !== 'active' || cur.nextRunAt !== expectedNextRunAt) return null;
    const next = patch(JSON.parse(JSON.stringify(cur)));
    if (!next) return null;
    this.schedules.set(id, next);
    if (next.nextRunAt !== expectedNextRunAt) return JSON.parse(JSON.stringify(next));
    return JSON.parse(JSON.stringify(next));
  }
  async putRun(r: ScheduleRunRecord) { this.runs.set(r.runId, JSON.parse(JSON.stringify(r))); }
  async getRun(runId: string) {
    const r = this.runs.get(runId);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }
  async listRuns(userId: string, scheduleId: string | undefined, limit: number) {
    return Array.from(this.runs.values())
      .filter((r) => r.userId === userId && (!scheduleId || r.scheduleId === scheduleId))
      .sort((a, b) => b.occurrenceMs - a.occurrenceMs)
      .slice(0, Math.min(limit, 200));
  }
}

class FirestoreScheduleStore implements ScheduleStore {
  readonly durable = true;
  private dbInstance: any = null;

  async init() { await this.db(); }

  private async db(): Promise<any> {
    if (!this.dbInstance) {
      const { getFirestore } = await import('firebase-admin/firestore');
      this.dbInstance = getFirestore();
    }
    return this.dbInstance;
  }

  async putSchedule(s: ScheduleRecord) {
    const db = await this.db();
    await db.collection('schedules').doc(s.scheduleId).set({ ...s }, { merge: true });
  }
  async getSchedule(id: string, userId?: string) {
    const db = await this.db();
    const snap = await db.collection('schedules').doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() as ScheduleRecord;
    if (userId && data.userId !== userId) return null;
    return data;
  }
  async listForUser(userId: string) {
    const db = await this.db();
    const snap = await db.collection('schedules').where('userId', '==', userId).limit(200).get();
    return snap.docs.map((d: any) => d.data() as ScheduleRecord);
  }
  async listActive() {
    const db = await this.db();
    const snap = await db.collection('schedules').where('status', '==', 'active').limit(500).get();
    return snap.docs.map((d: any) => d.data() as ScheduleRecord);
  }
  async claimOccurrence(id: string, expectedNextRunAt: string, patch: (r: ScheduleRecord) => ScheduleRecord | null) {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const ref = db.collection('schedules').doc(id);
    let result: ScheduleRecord | null = null;
    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const cur = snap.data() as ScheduleRecord;
      if (cur.status !== 'active' || cur.nextRunAt !== expectedNextRunAt) return;
      const next = patch({ ...cur });
      if (!next) return;
      tx.set(ref, next);
      result = next;
    });
    return result;
  }
  async putRun(r: ScheduleRunRecord) {
    const db = await this.db();
    await db.collection('scheduleRuns').doc(r.runId).set({ ...r });
  }
  async getRun(runId: string) {
    const db = await this.db();
    const snap = await db.collection('scheduleRuns').doc(runId).get();
    return snap.exists ? (snap.data() as ScheduleRunRecord) : null;
  }
  async listRuns(userId: string, scheduleId: string | undefined, limit: number) {
    const db = await this.db();
    let query: any = db.collection('scheduleRuns').where('userId', '==', userId);
    if (scheduleId) query = query.where('scheduleId', '==', scheduleId);
    try {
      const snap = await query.orderBy('occurrenceMs', 'desc').limit(Math.min(limit, 200)).get();
      return snap.docs.map((d: any) => d.data() as ScheduleRunRecord);
    } catch {
      const snap = await query.limit(300).get();
      return snap.docs.map((d: any) => d.data() as ScheduleRunRecord)
        .sort((a: ScheduleRunRecord, b: ScheduleRunRecord) => b.occurrenceMs - a.occurrenceMs)
        .slice(0, Math.min(limit, 200));
    }
  }
}

let cached: ScheduleStore | null = null;

export async function resolveScheduleStore(): Promise<ScheduleStore> {
  if (cached) return cached;
  try {
    const store = new FirestoreScheduleStore();
    await store.init();
    cached = store;
  } catch {
    cached = new MemoryScheduleStore();
  }
  return cached;
}

export function setScheduleStoreForTesting(store: ScheduleStore): void {
  cached = store;
}
