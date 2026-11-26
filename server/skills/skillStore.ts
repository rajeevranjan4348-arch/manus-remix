/**
 * Durable skill store (Feature 04).
 *
 * Firestore collections 'skills' (per-user installs) and 'skillExecutions'
 * (execution history). A clearly-flagged memory fallback exists for tests/dev.
 */

import crypto from 'crypto';
import type { SkillExecutionRecord, SkillInstallState } from './types';

export interface SkillStore {
  readonly durable: boolean;
  putInstall(state: SkillInstallState): Promise<void>;
  getInstall(skillId: string, userId: string): Promise<SkillInstallState | null>;
  listInstalls(userId: string): Promise<SkillInstallState[]>;
  deleteInstall(skillId: string, userId: string): Promise<void>;
  appendExecution(record: SkillExecutionRecord): Promise<void>;
  listExecutions(userId: string, skillId: string | undefined, limit: number): Promise<SkillExecutionRecord[]>;
}

export function skillDocId(skillId: string, userId: string): string {
  return crypto.createHash('sha256').update(userId + '|' + skillId).digest('hex').slice(0, 48);
}

export class MemorySkillStore implements SkillStore {
  readonly durable = false;
  private skills = new Map<string, SkillInstallState>();
  private executions: SkillExecutionRecord[] = [];

  async putInstall(state: SkillInstallState) {
    this.skills.set(skillDocId(state.skillId, state.userId), JSON.parse(JSON.stringify(state)));
  }
  async getInstall(skillId: string, userId: string) {
    const s = this.skills.get(skillDocId(skillId, userId));
    return s ? JSON.parse(JSON.stringify(s)) : null;
  }
  async listInstalls(userId: string) {
    return Array.from(this.skills.values())
      .filter((s) => s.userId === userId)
      .map((s) => JSON.parse(JSON.stringify(s)));
  }
  async deleteInstall(skillId: string, userId: string) {
    this.skills.delete(skillDocId(skillId, userId));
  }
  async appendExecution(record: SkillExecutionRecord) {
    this.executions.push(JSON.parse(JSON.stringify(record)));
    if (this.executions.length > 500) this.executions = this.executions.slice(-400);
  }
  async listExecutions(userId: string, skillId: string | undefined, limit: number) {
    return this.executions
      .filter((r) => r.userId === userId && (!skillId || r.skillId === skillId))
      .slice(-Math.min(limit, 100))
      .reverse();
  }
}

class FirestoreSkillStore implements SkillStore {
  readonly durable = true;
  private dbInstance: any = null;

  async init() {
    await this.db();
  }

  private async db(): Promise<any> {
    if (!this.dbInstance) {
      const { getFirestore } = await import('firebase-admin/firestore');
      this.dbInstance = getFirestore();
    }
    return this.dbInstance;
  }

  async putInstall(state: SkillInstallState) {
    const db = await this.db();
    await db.collection('skills').doc(skillDocId(state.skillId, state.userId)).set({ ...state }, { merge: true });
  }
  async getInstall(skillId: string, userId: string) {
    const db = await this.db();
    const snap = await db.collection('skills').doc(skillDocId(skillId, userId)).get();
    return snap.exists ? (snap.data() as SkillInstallState) : null;
  }
  async listInstalls(userId: string) {
    const db = await this.db();
    const snap = await db.collection('skills').where('userId', '==', userId).limit(100).get();
    return snap.docs.map((d: any) => d.data() as SkillInstallState);
  }
  async deleteInstall(skillId: string, userId: string) {
    const db = await this.db();
    await db.collection('skills').doc(skillDocId(skillId, userId)).delete();
  }
  async appendExecution(record: SkillExecutionRecord) {
    const db = await this.db();
    await db.collection('skillExecutions').doc(record.executionId).set({ ...record });
  }
  async listExecutions(userId: string, skillId: string | undefined, limit: number) {
    const db = await this.db();
    let query: any = db.collection('skillExecutions').where('userId', '==', userId);
    if (skillId) query = query.where('skillId', '==', skillId);
    const snap = await query.limit(Math.min(limit, 100)).get();
    const records = snap.docs.map((d: any) => d.data() as SkillExecutionRecord);
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, Math.min(limit, 100));
  }
}

let cached: SkillStore | null = null;

export async function resolveSkillStore(): Promise<SkillStore> {
  if (cached) return cached;
  try {
    const store = new FirestoreSkillStore();
    await store.init();
    cached = store;
  } catch {
    cached = new MemorySkillStore();
  }
  return cached;
}

export function setSkillStoreForTesting(store: SkillStore): void {
  cached = store;
}
