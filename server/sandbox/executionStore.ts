/**
 * Durable execution & session store (Feature 06).
 *
 * Sandbox sessions and command executions are persisted to Firestore via
 * firebase-admin when the deployment provides Application Default Credentials.
 * When Firestore is not reachable the module degrades to a process-local
 * Map and marks every record durable=false, so the UI can honestly signal
 * that records will not survive a function restart. Process-local state is
 * never treated as durable.
 */

import type { BrowserSessionStatus, CommandExecutionRecord, SandboxCreateOptions, SandboxLimits, SandboxSessionRecord } from './types';

export interface BrowserSessionRecord {
  browserSessionId: string;
  sessionId: string;
  userId: string;
  status: BrowserSessionStatus;
  createdAt: string;
  closedAt?: string;
}

export interface ExecutionStore {
  readonly durable: boolean;
  init(): Promise<void>;
  putSession(record: SandboxSessionRecord): Promise<void>;
  getSession(sessionId: string, userId: string): Promise<SandboxSessionRecord | null>;
  listSessionsForUser(userId: string): Promise<SandboxSessionRecord[]>;
  deleteSession(sessionId: string, userId: string): Promise<void>;
  putExecution(record: CommandExecutionRecord): Promise<void>;
  getExecution(executionId: string, userId: string): Promise<CommandExecutionRecord | null>;
  findExecutionByIdempotencyKey(userId: string, key: string): Promise<CommandExecutionRecord | null>;
  putBrowserSession(record: BrowserSessionRecord): Promise<void>;
  getBrowserSession(browserSessionId: string, userId: string): Promise<BrowserSessionRecord | null>;
  deleteBrowserSession(browserSessionId: string, userId: string): Promise<void>;
}

export class MemoryExecutionStore implements ExecutionStore {
  readonly durable = false;
  private sessions = new Map<string, SandboxSessionRecord>();
  private execs = new Map<string, CommandExecutionRecord>();
  private idempotency = new Map<string, string>();
  private browserSessions = new Map<string, BrowserSessionRecord>();

  async init() {}

  private scopingKey(sessionId: string, userId: string) {
    return userId + ':' + sessionId; // records are always scoped to their verified owner
  }

  async putSession(record: SandboxSessionRecord) {
    this.sessions.set(this.scopingKey(record.sessionId, record.userId), { ...record });
  }
  async getSession(sessionId: string, userId: string) {
    const found = this.sessions.get(this.scopingKey(sessionId, userId));
    return found ? { ...found } : null;
  }
  async listSessionsForUser(userId: string) {
    const out: SandboxSessionRecord[] = [];
    for (const [key, record] of this.sessions) {
      if (key.startsWith(userId + ':')) out.push({ ...record });
    }
    return out;
  }
  async deleteSession(sessionId: string, userId: string) {
    this.sessions.delete(this.scopingKey(sessionId, userId));
  }
  async putExecution(record: CommandExecutionRecord) {
    this.execs.set(this.scopingKey(record.executionId, record.userId), { ...record });
    if (record.idempotencyKey) {
      this.idempotency.set(record.userId + ':' + record.idempotencyKey, record.executionId);
    }
  }
  async getExecution(executionId: string, userId: string) {
    const found = this.execs.get(this.scopingKey(executionId, userId));
    return found ? { ...found } : null;
  }
  async findExecutionByIdempotencyKey(userId: string, key: string) {
    const executionId = this.idempotency.get(userId + ':' + key);
    if (!executionId) return null;
    return this.getExecution(executionId, userId);
  }
  async putBrowserSession(record: BrowserSessionRecord) {
    this.browserSessions.set(this.scopingKey(record.browserSessionId, record.userId), { ...record });
  }
  async getBrowserSession(browserSessionId: string, userId: string) {
    const found = this.browserSessions.get(this.scopingKey(browserSessionId, userId));
    return found ? { ...found } : null;
  }
  async deleteBrowserSession(browserSessionId: string, userId: string) {
    this.browserSessions.delete(this.scopingKey(browserSessionId, userId));
  }
}

/** Lazy, failure-tolerant Firestore-backed store. */
class FirestoreExecutionStore implements ExecutionStore {
  readonly durable = true;

  private async db(): Promise<any> {
    const { getFirestore } = await import('firebase-admin/firestore');
    return getFirestore();
  }

  async init() {
    await this.db(); // throws when credentials are absent; caller downgrades to memory
  }

  async putSession(record: SandboxSessionRecord) {
    const db = await this.db();
    await db.collection('sandboxSessions').doc(record.sessionId).set(record, { merge: true });
  }
  async getSession(sessionId: string, userId: string) {
    const db = await this.db();
    const snap = await db.collection('sandboxSessions').doc(sessionId).get();
    if (!snap.exists) return null;
    const data = snap.data() as SandboxSessionRecord;
    return data && data.userId === userId ? data : null;
  }
  async listSessionsForUser(userId: string) {
    const db = await this.db();
    const snap = await db.collection('sandboxSessions').where('userId', '==', userId).limit(100).get();
    return snap.docs.map((d: any) => d.data() as SandboxSessionRecord);
  }
  async deleteSession(sessionId: string, _userId: string) {
    const db = await this.db();
    await db.collection('sandboxSessions').doc(sessionId).delete();
  }
  async putExecution(record: CommandExecutionRecord) {
    const db = await this.db();
    await db.collection('sandboxExecutions').doc(record.executionId).set(record, { merge: true });
  }
  async getExecution(executionId: string, userId: string) {
    const db = await this.db();
    const snap = await db.collection('sandboxExecutions').doc(executionId).get();
    if (!snap.exists) return null;
    const data = snap.data() as CommandExecutionRecord;
    return data && data.userId === userId ? data : null;
  }
  async findExecutionByIdempotencyKey(userId: string, key: string) {
    const db = await this.db();
    const snap = await db
      .collection('sandboxExecutions')
      .where('userId', '==', userId)
      .where('idempotencyKey', '==', key)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data() as CommandExecutionRecord;
  }
  async putBrowserSession(record: BrowserSessionRecord) {
    const db = await this.db();
    await db.collection('sandboxBrowserSessions').doc(record.browserSessionId).set(record, { merge: true });
  }
  async getBrowserSession(browserSessionId: string, userId: string) {
    const db = await this.db();
    const snap = await db.collection('sandboxBrowserSessions').doc(browserSessionId).get();
    if (!snap.exists) return null;
    const data = snap.data() as BrowserSessionRecord;
    return data && data.userId === userId ? data : null;
  }
  async deleteBrowserSession(browserSessionId: string, _userId: string) {
    const db = await this.db();
    await db.collection('sandboxBrowserSessions').doc(browserSessionId).delete();
  }
}

let cached: { store: ExecutionStore; durable: boolean } | null = null;

/**
 * Resolve the best available store. Firestore when usable; otherwise a
 * process-local store explicitly flagged non-durable.
 */
export async function resolveExecutionStore(): Promise<ExecutionStore> {
  if (cached) return cached.store;
  try {
    const firestoreStore = new FirestoreExecutionStore();
    await firestoreStore.init();
    cached = { store: firestoreStore, durable: true };
  } catch {
    cached = { store: new MemoryExecutionStore(), durable: false };
  }
  return cached.store;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  maxLifetimeSeconds: 30 * 60,
  idleTimeoutSeconds: 5 * 60,
  commandTimeoutSeconds: 120,
  cpuCores: 2,
  memoryMB: 2048,
  maxConcurrentPerUser: 2,
};

/** Merge user-supplied limits with defaults; hard caps keep costs bounded. */
export function boundsCheckLimits(partial?: Partial<SandboxLimits>): SandboxLimits {
  const merged: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS };
  if (partial) {
    if (typeof partial.maxLifetimeSeconds === 'number' && partial.maxLifetimeSeconds > 0) {
      merged.maxLifetimeSeconds = Math.min(partial.maxLifetimeSeconds, 4 * 60 * 60);
    }
    if (typeof partial.idleTimeoutSeconds === 'number' && partial.idleTimeoutSeconds > 0) {
      merged.idleTimeoutSeconds = Math.min(partial.idleTimeoutSeconds, 60 * 60);
    }
    if (typeof partial.commandTimeoutSeconds === 'number' && partial.commandTimeoutSeconds > 0) {
      merged.commandTimeoutSeconds = Math.min(partial.commandTimeoutSeconds, 600);
    }
    if (typeof partial.cpuCores === 'number' && partial.cpuCores > 0) merged.cpuCores = Math.min(partial.cpuCores, 8);
    if (typeof partial.memoryMB === 'number' && partial.memoryMB > 0) merged.memoryMB = Math.min(partial.memoryMB, 8192);
    if (typeof partial.maxConcurrentPerUser === 'number' && partial.maxConcurrentPerUser > 0) {
      merged.maxConcurrentPerUser = Math.min(partial.maxConcurrentPerUser, 5);
    }
  }
  return merged;
}

export interface SessionInitContext {
  userId: string;
  options: SandboxCreateOptions;
  limits: SandboxLimits;
}
