/**
 * Durable execution persistence layer for Netlify serverless functions.
 *
 * Supports three backends:
 * 1. Upstash Redis REST API (when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set)
 * 2. Firebase Firestore REST API authenticated with the caller's verified Firebase ID token
 *    (strictly scoped to /users/{userId}/{collection}/{docId}, governed by firestore.rules)
 * 3. Ephemeral in-memory fallback (explicitly tagged 'ephemeral-dev' for local dev & unit tests)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PermissionChallenge } from '../permissionsGateway';
import type {
  BrowserSessionRecord,
  EngineActionAuditEntry,
  SandboxWorkspaceRecord,
  TerminalExecutionRecord,
} from './types';

export type PersistenceMode = 'upstash-redis' | 'firestore-rest' | 'hybrid' | 'ephemeral-dev';

export interface DurableRequestContext {
  userId: string;
  /** Verified Firebase ID token from the caller's Authorization header, used for Firestore REST */
  authToken?: string;
}

export interface IdempotencyRecord<T = unknown> {
  key: string;
  userId: string;
  result: T;
  createdAt: string;
  expiresAt: string;
}

export interface DurableExecutionStore {
  getMode(ctx?: DurableRequestContext): PersistenceMode;

  saveSandbox(ctx: DurableRequestContext, record: SandboxWorkspaceRecord): Promise<void>;
  getSandbox(ctx: DurableRequestContext, sandboxId: string): Promise<SandboxWorkspaceRecord | null>;
  listSandboxes(ctx: DurableRequestContext): Promise<SandboxWorkspaceRecord[]>;
  findSandboxByProviderId(providerSandboxId: string): Promise<SandboxWorkspaceRecord | null>;

  saveExecution(ctx: DurableRequestContext, record: TerminalExecutionRecord): Promise<void>;
  getExecution(ctx: DurableRequestContext, executionId: string): Promise<TerminalExecutionRecord | null>;
  listExecutions(ctx: DurableRequestContext, sandboxId?: string): Promise<TerminalExecutionRecord[]>;

  saveBrowserSession(ctx: DurableRequestContext, record: BrowserSessionRecord): Promise<void>;
  getBrowserSession(ctx: DurableRequestContext, sessionId: string): Promise<BrowserSessionRecord | null>;
  listBrowserSessions(ctx: DurableRequestContext): Promise<BrowserSessionRecord[]>;

  saveApproval(ctx: DurableRequestContext, challenge: PermissionChallenge): Promise<void>;
  getApproval(ctx: DurableRequestContext, challengeId: string): Promise<PermissionChallenge | null>;
  findApprovalByToken(ctx: DurableRequestContext, token: string): Promise<PermissionChallenge | null>;

  appendAudit(ctx: DurableRequestContext, entry: EngineActionAuditEntry): Promise<void>;
  listAudit(ctx: DurableRequestContext, limit?: number): Promise<EngineActionAuditEntry[]>;

  getIdempotency<T = unknown>(ctx: DurableRequestContext, key: string): Promise<IdempotencyRecord<T> | null>;
  saveIdempotency<T = unknown>(
    ctx: DurableRequestContext,
    key: string,
    result: T,
    ttlSec?: number,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Firebase Applet Config Loader (projectId + firestoreDatabaseId)
// ---------------------------------------------------------------------------

let cachedFirebaseMeta: { projectId: string; databaseId: string } | null = null;

function getFirebaseRestMeta(): { projectId: string; databaseId: string } | null {
  if (cachedFirebaseMeta) return cachedFirebaseMeta;

  const envProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const envDbId = process.env.FIREBASE_DATABASE_ID;
  if (envProjectId) {
    cachedFirebaseMeta = {
      projectId: envProjectId,
      databaseId: envDbId || '(default)',
    };
    return cachedFirebaseMeta;
  }

  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed?.projectId) {
        cachedFirebaseMeta = {
          projectId: String(parsed.projectId),
          databaseId: String(parsed.firestoreDatabaseId || '(default)'),
        };
        return cachedFirebaseMeta;
      }
    }
  } catch {
    // Config not available
  }

  return null;
}

// ---------------------------------------------------------------------------
// Firestore REST Value Encoding / Decoding
// ---------------------------------------------------------------------------

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

function encodeFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { nullValue: null };
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function decodeFirestoreValue(fv: FirestoreValue | undefined): unknown {
  if (!fv || typeof fv !== 'object') return undefined;
  if ('nullValue' in fv) return null;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue' in fv) return Number(fv.doubleValue);
  if ('stringValue' in fv) return fv.stringValue;
  if ('arrayValue' in fv) {
    return (fv.arrayValue.values || []).map((v) => decodeFirestoreValue(v));
  }
  if ('mapValue' in fv) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fv.mapValue.fields || {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function toFirestoreDocument(record: Record<string, unknown>): { fields: Record<string, FirestoreValue> } {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  return { fields };
}

function fromFirestoreDocument<T>(doc: { fields?: Record<string, FirestoreValue> }): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = decodeFirestoreValue(v);
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// 1. Firestore User-Token REST Store
// ---------------------------------------------------------------------------

export class FirestoreUserRestStore {
  private readonly projectId: string;
  private readonly databaseId: string;

  constructor(projectId: string, databaseId = '(default)') {
    this.projectId = projectId;
    this.databaseId = databaseId;
  }

  private docUrl(userId: string, collection: string, docId: string): string {
    const db = encodeURIComponent(this.databaseId);
    const uid = encodeURIComponent(userId);
    const col = encodeURIComponent(collection);
    const id = encodeURIComponent(docId);
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/${db}/documents/users/${uid}/${col}/${id}`;
  }

  private collectionUrl(userId: string, collection: string, pageSize = 100): string {
    const db = encodeURIComponent(this.databaseId);
    const uid = encodeURIComponent(userId);
    const col = encodeURIComponent(collection);
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/${db}/documents/users/${uid}/${col}?pageSize=${pageSize}`;
  }

  public async put<T extends object>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
    data: T,
  ): Promise<boolean> {
    if (!ctx.authToken || !ctx.userId) return false;
    try {
      const res = await fetch(this.docUrl(ctx.userId, collection, docId), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ctx.authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toFirestoreDocument(data as unknown as Record<string, unknown>)),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async get<T>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
  ): Promise<T | null> {
    if (!ctx.authToken || !ctx.userId) return null;
    try {
      const res = await fetch(this.docUrl(ctx.userId, collection, docId), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ctx.authToken}`,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const doc = (await res.json()) as { fields?: Record<string, FirestoreValue> };
      return fromFirestoreDocument<T>(doc);
    } catch {
      return null;
    }
  }

  public async list<T>(
    ctx: DurableRequestContext,
    collection: string,
    pageSize = 100,
  ): Promise<T[]> {
    if (!ctx.authToken || !ctx.userId) return [];
    try {
      const res = await fetch(this.collectionUrl(ctx.userId, collection, pageSize), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ctx.authToken}`,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as { documents?: Array<{ fields?: Record<string, FirestoreValue> }> };
      return (payload.documents || []).map((doc) => fromFirestoreDocument<T>(doc));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Upstash Redis REST Store
// ---------------------------------------------------------------------------

export class UpstashRedisRestStore {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  private async cmd<T = unknown>(args: Array<string | number>): Promise<T | null> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: T };
      return body.result ?? null;
    } catch {
      return null;
    }
  }

  public async setJson(key: string, value: unknown, ttlSec = 86400): Promise<boolean> {
    const res = await this.cmd<string>(['SET', key, JSON.stringify(value), 'EX', ttlSec]);
    return res === 'OK';
  }

  public async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.cmd<string>(['GET', key]);
    if (!raw || typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public async addToSet(setKey: string, member: string, ttlSec = 86400): Promise<void> {
    await this.cmd(['SADD', setKey, member]);
    await this.cmd(['EXPIRE', setKey, ttlSec]);
  }

  public async listSet(setKey: string): Promise<string[]> {
    const members = await this.cmd<string[]>(['SMEMBERS', setKey]);
    return Array.isArray(members) ? members : [];
  }

  public async pushList(listKey: string, value: unknown, maxLen = 200, ttlSec = 86400): Promise<void> {
    await this.cmd(['LPUSH', listKey, JSON.stringify(value)]);
    await this.cmd(['LTRIM', listKey, 0, maxLen - 1]);
    await this.cmd(['EXPIRE', listKey, ttlSec]);
  }

  public async readList<T>(listKey: string, limit = 100): Promise<T[]> {
    const items = await this.cmd<string[]>(['LRANGE', listKey, 0, Math.max(0, limit - 1)]);
    if (!Array.isArray(items)) return [];
    const parsed: T[] = [];
    for (const item of items) {
      try {
        parsed.push(JSON.parse(item) as T);
      } catch {
        // Ignore corrupt entries
      }
    }
    return parsed;
  }
}

// ---------------------------------------------------------------------------
// 3. In-Memory Store (Used for deterministic tests & local dev fallback)
// ---------------------------------------------------------------------------

export class InMemoryDurableStore implements DurableExecutionStore {
  private sandboxes = new Map<string, SandboxWorkspaceRecord>();
  private sandboxesByProviderId = new Map<string, string>();
  private executions = new Map<string, TerminalExecutionRecord>();
  private browserSessions = new Map<string, BrowserSessionRecord>();
  private approvals = new Map<string, PermissionChallenge>();
  private approvalByToken = new Map<string, string>();
  private audits: EngineActionAuditEntry[] = [];
  private idempotency = new Map<string, IdempotencyRecord<unknown>>();

  public getMode(): PersistenceMode {
    return 'ephemeral-dev';
  }

  public async saveSandbox(_ctx: DurableRequestContext, record: SandboxWorkspaceRecord): Promise<void> {
    this.sandboxes.set(record.sandboxId, structuredClone(record));
    if (record.providerSandboxId) {
      this.sandboxesByProviderId.set(record.providerSandboxId, record.sandboxId);
    }
  }

  public async getSandbox(_ctx: DurableRequestContext, sandboxId: string): Promise<SandboxWorkspaceRecord | null> {
    const found = this.sandboxes.get(sandboxId);
    return found ? structuredClone(found) : null;
  }

  public async listSandboxes(ctx: DurableRequestContext): Promise<SandboxWorkspaceRecord[]> {
    return Array.from(this.sandboxes.values())
      .filter((s) => s.userId === ctx.userId)
      .map((s) => structuredClone(s));
  }

  public async findSandboxByProviderId(providerSandboxId: string): Promise<SandboxWorkspaceRecord | null> {
    const sandboxId = this.sandboxesByProviderId.get(providerSandboxId);
    if (!sandboxId) return null;
    const found = this.sandboxes.get(sandboxId);
    return found ? structuredClone(found) : null;
  }

  public async saveExecution(_ctx: DurableRequestContext, record: TerminalExecutionRecord): Promise<void> {
    this.executions.set(record.executionId, structuredClone(record));
  }

  public async getExecution(_ctx: DurableRequestContext, executionId: string): Promise<TerminalExecutionRecord | null> {
    const found = this.executions.get(executionId);
    return found ? structuredClone(found) : null;
  }

  public async listExecutions(ctx: DurableRequestContext, sandboxId?: string): Promise<TerminalExecutionRecord[]> {
    return Array.from(this.executions.values())
      .filter((e) => e.userId === ctx.userId && (!sandboxId || e.sandboxId === sandboxId))
      .map((e) => structuredClone(e));
  }

  public async saveBrowserSession(_ctx: DurableRequestContext, record: BrowserSessionRecord): Promise<void> {
    this.browserSessions.set(record.sessionId, structuredClone(record));
  }

  public async getBrowserSession(_ctx: DurableRequestContext, sessionId: string): Promise<BrowserSessionRecord | null> {
    const found = this.browserSessions.get(sessionId);
    return found ? structuredClone(found) : null;
  }

  public async listBrowserSessions(ctx: DurableRequestContext): Promise<BrowserSessionRecord[]> {
    return Array.from(this.browserSessions.values())
      .filter((s) => s.userId === ctx.userId)
      .map((s) => structuredClone(s));
  }

  public async saveApproval(_ctx: DurableRequestContext, challenge: PermissionChallenge): Promise<void> {
    this.approvals.set(challenge.challengeId, structuredClone(challenge));
    if (challenge.approvalToken) {
      this.approvalByToken.set(challenge.approvalToken, challenge.challengeId);
    }
  }

  public async getApproval(_ctx: DurableRequestContext, challengeId: string): Promise<PermissionChallenge | null> {
    const found = this.approvals.get(challengeId);
    return found ? structuredClone(found) : null;
  }

  public async findApprovalByToken(_ctx: DurableRequestContext, token: string): Promise<PermissionChallenge | null> {
    const challengeId = this.approvalByToken.get(token);
    if (!challengeId) return null;
    const found = this.approvals.get(challengeId);
    return found ? structuredClone(found) : null;
  }

  public async appendAudit(_ctx: DurableRequestContext, entry: EngineActionAuditEntry): Promise<void> {
    this.audits.push(structuredClone(entry));
    if (this.audits.length > 1000) {
      this.audits = this.audits.slice(-800);
    }
  }

  public async listAudit(ctx: DurableRequestContext, limit = 100): Promise<EngineActionAuditEntry[]> {
    return this.audits
      .filter((a) => a.userId === ctx.userId)
      .slice(-limit)
      .reverse()
      .map((a) => structuredClone(a));
  }

  public async getIdempotency<T = unknown>(
    ctx: DurableRequestContext,
    key: string,
  ): Promise<IdempotencyRecord<T> | null> {
    const composite = `${ctx.userId}:${key}`;
    const entry = this.idempotency.get(composite);
    if (!entry) return null;
    if (Date.now() > Date.parse(entry.expiresAt)) {
      this.idempotency.delete(composite);
      return null;
    }
    return structuredClone(entry) as IdempotencyRecord<T>;
  }

  public async saveIdempotency<T = unknown>(
    ctx: DurableRequestContext,
    key: string,
    result: T,
    ttlSec = 3600,
  ): Promise<void> {
    const composite = `${ctx.userId}:${key}`;
    const now = Date.now();
    this.idempotency.set(composite, {
      key,
      userId: ctx.userId,
      result: structuredClone(result),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSec * 1000).toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// 4. Composite Production Durable Store
// ---------------------------------------------------------------------------

export class CompositeDurableStore implements DurableExecutionStore {
  private readonly redis: UpstashRedisRestStore | null;
  private readonly firestore: FirestoreUserRestStore | null;
  private readonly memory = new InMemoryDurableStore();

  constructor() {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    this.redis = redisUrl && redisToken ? new UpstashRedisRestStore(redisUrl, redisToken) : null;

    const fbMeta = getFirebaseRestMeta();
    this.firestore = fbMeta ? new FirestoreUserRestStore(fbMeta.projectId, fbMeta.databaseId) : null;
  }

  public getMode(ctx?: DurableRequestContext): PersistenceMode {
    const hasRedis = Boolean(this.redis);
    const hasFirestore = Boolean(this.firestore && ctx?.authToken);
    if (hasRedis && hasFirestore) return 'hybrid';
    if (hasRedis) return 'upstash-redis';
    if (hasFirestore) return 'firestore-rest';
    return 'ephemeral-dev';
  }

  public async saveSandbox(ctx: DurableRequestContext, record: SandboxWorkspaceRecord): Promise<void> {
    await this.memory.saveSandbox(ctx, record);
    if (this.redis) {
      await this.redis.setJson(`manus:sb:${record.sandboxId}`, record, 86400);
      await this.redis.addToSet(`manus:u:${ctx.userId}:sandboxes`, record.sandboxId, 86400);
      if (record.providerSandboxId) {
        await this.redis.setJson(`manus:sb_prov:${record.providerSandboxId}`, record.sandboxId, 86400);
      }
    }
    if (this.firestore && ctx.authToken) {
      await this.firestore.put(ctx, 'sandboxes', record.sandboxId, record);
    }
  }

  public async getSandbox(ctx: DurableRequestContext, sandboxId: string): Promise<SandboxWorkspaceRecord | null> {
    if (this.redis) {
      const fromRedis = await this.redis.getJson<SandboxWorkspaceRecord>(`manus:sb:${sandboxId}`);
      if (fromRedis) return fromRedis;
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.get<SandboxWorkspaceRecord>(ctx, 'sandboxes', sandboxId);
      if (fromFs) return fromFs;
    }
    return this.memory.getSandbox(ctx, sandboxId);
  }

  public async listSandboxes(ctx: DurableRequestContext): Promise<SandboxWorkspaceRecord[]> {
    if (this.redis) {
      const ids = await this.redis.listSet(`manus:u:${ctx.userId}:sandboxes`);
      const items = await Promise.all(
        ids.map((id) => this.redis!.getJson<SandboxWorkspaceRecord>(`manus:sb:${id}`)),
      );
      const valid = items.filter((i): i is SandboxWorkspaceRecord => Boolean(i && i.userId === ctx.userId));
      if (valid.length > 0) return valid;
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.list<SandboxWorkspaceRecord>(ctx, 'sandboxes');
      if (fromFs.length > 0) return fromFs;
    }
    return this.memory.listSandboxes(ctx);
  }

  public async findSandboxByProviderId(providerSandboxId: string): Promise<SandboxWorkspaceRecord | null> {
    if (this.redis) {
      const sandboxId = await this.redis.getJson<string>(`manus:sb_prov:${providerSandboxId}`);
      if (sandboxId) {
        const record = await this.redis.getJson<SandboxWorkspaceRecord>(`manus:sb:${sandboxId}`);
        if (record) return record;
      }
    }
    return this.memory.findSandboxByProviderId(providerSandboxId);
  }

  public async saveExecution(ctx: DurableRequestContext, record: TerminalExecutionRecord): Promise<void> {
    await this.memory.saveExecution(ctx, record);
    if (this.redis) {
      await this.redis.setJson(`manus:exec:${record.executionId}`, record, 86400);
      await this.redis.addToSet(`manus:u:${ctx.userId}:executions`, record.executionId, 86400);
    }
    if (this.firestore && ctx.authToken) {
      await this.firestore.put(ctx, 'executions', record.executionId, record);
    }
  }

  public async getExecution(ctx: DurableRequestContext, executionId: string): Promise<TerminalExecutionRecord | null> {
    if (this.redis) {
      const fromRedis = await this.redis.getJson<TerminalExecutionRecord>(`manus:exec:${executionId}`);
      if (fromRedis) return fromRedis;
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.get<TerminalExecutionRecord>(ctx, 'executions', executionId);
      if (fromFs) return fromFs;
    }
    return this.memory.getExecution(ctx, executionId);
  }

  public async listExecutions(ctx: DurableRequestContext, sandboxId?: string): Promise<TerminalExecutionRecord[]> {
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.list<TerminalExecutionRecord>(ctx, 'executions');
      if (fromFs.length > 0) {
        return sandboxId ? fromFs.filter((e) => e.sandboxId === sandboxId) : fromFs;
      }
    }
    return this.memory.listExecutions(ctx, sandboxId);
  }

  public async saveBrowserSession(ctx: DurableRequestContext, record: BrowserSessionRecord): Promise<void> {
    await this.memory.saveBrowserSession(ctx, record);
    if (this.redis) {
      await this.redis.setJson(`manus:bs:${record.sessionId}`, record, 43200);
      await this.redis.addToSet(`manus:u:${ctx.userId}:browser_sessions`, record.sessionId, 43200);
    }
    if (this.firestore && ctx.authToken) {
      await this.firestore.put(ctx, 'browser_sessions', record.sessionId, record);
    }
  }

  public async getBrowserSession(ctx: DurableRequestContext, sessionId: string): Promise<BrowserSessionRecord | null> {
    if (this.redis) {
      const fromRedis = await this.redis.getJson<BrowserSessionRecord>(`manus:bs:${sessionId}`);
      if (fromRedis) return fromRedis;
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.get<BrowserSessionRecord>(ctx, 'browser_sessions', sessionId);
      if (fromFs) return fromFs;
    }
    return this.memory.getBrowserSession(ctx, sessionId);
  }

  public async listBrowserSessions(ctx: DurableRequestContext): Promise<BrowserSessionRecord[]> {
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.list<BrowserSessionRecord>(ctx, 'browser_sessions');
      if (fromFs.length > 0) return fromFs;
    }
    return this.memory.listBrowserSessions(ctx);
  }

  public async saveApproval(ctx: DurableRequestContext, challenge: PermissionChallenge): Promise<void> {
    await this.memory.saveApproval(ctx, challenge);
    if (this.redis) {
      await this.redis.setJson(`manus:appr:${challenge.challengeId}`, challenge, 3600);
      if (challenge.approvalToken) {
        await this.redis.setJson(`manus:appr_tok:${challenge.approvalToken}`, challenge.challengeId, 3600);
      }
    }
    if (this.firestore && ctx.authToken) {
      await this.firestore.put(ctx, 'approvals', challenge.challengeId, challenge);
    }
  }

  public async getApproval(ctx: DurableRequestContext, challengeId: string): Promise<PermissionChallenge | null> {
    if (this.redis) {
      const fromRedis = await this.redis.getJson<PermissionChallenge>(`manus:appr:${challengeId}`);
      if (fromRedis) return fromRedis;
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.get<PermissionChallenge>(ctx, 'approvals', challengeId);
      if (fromFs) return fromFs;
    }
    return this.memory.getApproval(ctx, challengeId);
  }

  public async findApprovalByToken(ctx: DurableRequestContext, token: string): Promise<PermissionChallenge | null> {
    if (this.redis) {
      const challengeId = await this.redis.getJson<string>(`manus:appr_tok:${token}`);
      if (challengeId) {
        const challenge = await this.redis.getJson<PermissionChallenge>(`manus:appr:${challengeId}`);
        if (challenge) return challenge;
      }
    }
    if (this.firestore && ctx.authToken) {
      const list = await this.firestore.list<PermissionChallenge>(ctx, 'approvals', 100);
      const matched = list.find((c) => c.approvalToken === token);
      if (matched) return matched;
    }
    return this.memory.findApprovalByToken(ctx, token);
  }

  public async appendAudit(ctx: DurableRequestContext, entry: EngineActionAuditEntry): Promise<void> {
    await this.memory.appendAudit(ctx, entry);
    if (this.redis) {
      await this.redis.pushList(`manus:u:${ctx.userId}:audit`, entry, 300, 86400 * 7);
    }
    if (this.firestore && ctx.authToken) {
      await this.firestore.put(ctx, 'audit_logs', entry.auditId, entry);
    }
  }

  public async listAudit(ctx: DurableRequestContext, limit = 100): Promise<EngineActionAuditEntry[]> {
    if (this.redis) {
      const items = await this.redis.readList<EngineActionAuditEntry>(`manus:u:${ctx.userId}:audit`, limit);
      if (items.length > 0) return items;
    }
    if (this.firestore && ctx.authToken) {
      const items = await this.firestore.list<EngineActionAuditEntry>(ctx, 'audit_logs', limit);
      if (items.length > 0) {
        return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
      }
    }
    return this.memory.listAudit(ctx, limit);
  }

  public async getIdempotency<T = unknown>(
    ctx: DurableRequestContext,
    key: string,
  ): Promise<IdempotencyRecord<T> | null> {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
    if (this.redis) {
      const fromRedis = await this.redis.getJson<IdempotencyRecord<T>>(`manus:idem:${ctx.userId}:${safeKey}`);
      if (fromRedis) return fromRedis;
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.get<IdempotencyRecord<T>>(ctx, 'idempotency', safeKey);
      if (fromFs && Date.now() <= Date.parse(fromFs.expiresAt)) return fromFs;
    }
    return this.memory.getIdempotency<T>(ctx, safeKey);
  }

  public async saveIdempotency<T = unknown>(
    ctx: DurableRequestContext,
    key: string,
    result: T,
    ttlSec = 3600,
  ): Promise<void> {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
    await this.memory.saveIdempotency(ctx, safeKey, result, ttlSec);
    const now = Date.now();
    const record: IdempotencyRecord<T> = {
      key: safeKey,
      userId: ctx.userId,
      result,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSec * 1000).toISOString(),
    };
    if (this.redis) {
      await this.redis.setJson(`manus:idem:${ctx.userId}:${safeKey}`, record, ttlSec);
    }
    if (this.firestore && ctx.authToken) {
      await this.firestore.put(ctx, 'idempotency', safeKey, record);
    }
  }
}

export const defaultDurableStore = new CompositeDurableStore();
