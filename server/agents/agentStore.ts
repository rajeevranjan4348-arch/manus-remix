/**
 * Durable agent run store (Feature 03).
 *
 * Firestore collection 'agentRuns' with a clearly-flagged memory fallback for
 * tests/dev. Run records are always scoped to the verified user id.
 */

import crypto from 'crypto';
import type { AgentRunRecord } from './types';

export interface AgentRunFilter {
  status?: string;
  limit?: number;
}

export interface AgentStore {
  readonly durable: boolean;
  putRun(run: AgentRunRecord): Promise<void>;
  getRun(runId: string, userId: string): Promise<AgentRunRecord | null>;
  listRuns(userId: string, filter?: AgentRunFilter): Promise<AgentRunRecord[]>;
}

export class MemoryAgentStore implements AgentStore {
  readonly durable = false;
  private runs = new Map<string, AgentRunRecord>();

  async putRun(run: AgentRunRecord) {
    this.runs.set(run.runId, JSON.parse(JSON.stringify(run)));
  }

  async getRun(runId: string, userId: string) {
    const r = this.runs.get(runId);
    return r && r.userId === userId ? JSON.parse(JSON.stringify(r)) : null;
  }

  async listRuns(userId: string, filter?: AgentRunFilter) {
    return Array.from(this.runs.values())
      .filter((r) => r.userId === userId && (!filter?.status || r.status === filter.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(filter?.limit ?? 50, 100))
      .map((r) => JSON.parse(JSON.stringify(r)));
  }
}

class FirestoreAgentStore implements AgentStore {
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

  async putRun(run: AgentRunRecord) {
    const db = await this.db();
    await db.collection('agentRuns').doc(run.runId).set({ ...run }, { merge: true });
  }

  async getRun(runId: string, userId: string) {
    const db = await this.db();
    const snap = await db.collection('agentRuns').doc(runId).get();
    if (!snap.exists) return null;
    const data = snap.data() as AgentRunRecord;
    return data && data.userId === userId ? data : null;
  }

  async listRuns(userId: string, filter?: AgentRunFilter) {
    const db = await this.db();
    let query: any = db.collection('agentRuns').where('userId', '==', userId);
    if (filter?.status) query = query.where('status', '==', filter.status);
    try {
      const snap = await query.orderBy('createdAt', 'desc').limit(Math.min(filter?.limit ?? 50, 100)).get();
      return snap.docs.map((d: any) => d.data() as AgentRunRecord);
    } catch {
      // Missing composite index: fall back to a bounded unsorted scan.
      const snap = await db.collection('agentRuns').where('userId', '==', userId).limit(200).get();
      return snap.docs.map((d: any) => d.data() as AgentRunRecord)
        .sort((a: AgentRunRecord, b: AgentRunRecord) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.min(filter?.limit ?? 50, 100));
    }
  }
}

let cached: AgentStore | null = null;

export async function resolveAgentStore(): Promise<AgentStore> {
  if (cached) return cached;
  try {
    const store = new FirestoreAgentStore();
    await store.init();
    cached = store;
  } catch {
    cached = new MemoryAgentStore();
  }
  return cached;
}

export function setAgentStoreForTesting(store: AgentStore): void {
  cached = store;
}

export function newRunId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : String(Date.now()) + String(Math.floor(Math.random() * 1e9));
  return 'run_' + random;
}
