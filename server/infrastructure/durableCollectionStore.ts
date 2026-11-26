/**
 * Shared Durable Collection & Atomic Lease Store for Features 01–06.
 *
 * Persists user-scoped records across Upstash Redis REST (with atomic SET NX EX leases)
 * and Firebase Firestore REST (/users/{userId}/{collection}/{docId}), with an explicitly
 * tagged 'ephemeral-dev' in-memory fallback for local development and automated tests.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  FirestoreUserRestStore,
  UpstashRedisRestStore,
  type DurableRequestContext,
  type PersistenceMode,
} from '../sandbox/durableStore';

let cachedFbMeta: { projectId: string; databaseId: string } | null = null;

function resolveFirebaseMeta(): { projectId: string; databaseId: string } | null {
  if (cachedFbMeta) return cachedFbMeta;
  const envProject = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const envDb = process.env.FIREBASE_DATABASE_ID;
  if (envProject) {
    cachedFbMeta = { projectId: envProject, databaseId: envDb || '(default)' };
    return cachedFbMeta;
  }
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed?.projectId) {
        cachedFbMeta = {
          projectId: String(parsed.projectId),
          databaseId: String(parsed.firestoreDatabaseId || '(default)'),
        };
        return cachedFbMeta;
      }
    }
  } catch {
    // Ignore missing config
  }
  return null;
}

export interface DurableLeaseResult {
  acquired: boolean;
  ownerId?: string;
  expiresAtMs?: number;
}

export interface DurableCollectionStore {
  getMode(ctx?: DurableRequestContext): PersistenceMode;
  put<T extends object>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
    record: T,
    ttlSec?: number,
  ): Promise<void>;
  get<T>(ctx: DurableRequestContext, collection: string, docId: string): Promise<T | null>;
  list<T>(ctx: DurableRequestContext, collection: string, limit?: number): Promise<T[]>;
  delete(ctx: DurableRequestContext, collection: string, docId: string): Promise<void>;
  /** Lists across all users for trusted server worker/scheduler dispatchers */
  listAllForSystem<T>(collection: string, limit?: number): Promise<T[]>;
  /** Atomic lease acquisition (SET NX PX equivalent) for concurrent task/token claiming */
  tryAcquireLease(leaseKey: string, ownerId: string, ttlMs: number): Promise<DurableLeaseResult>;
  renewLease(leaseKey: string, ownerId: string, ttlMs: number): Promise<boolean>;
  releaseLease(leaseKey: string, ownerId: string): Promise<void>;
  /** Atomic compare-and-swap update on a document to guard critical state transitions */
  compareAndSwap<T extends object>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
    updater: (current: T | null) => { commit: boolean; next?: T },
  ): Promise<{ committed: boolean; value: T | null }>;
}

/**
 * In-memory durable store with atomic synchronous CAS and TTL lease locks.
 * Used for deterministic unit/integration tests and local development fallback.
 */
export class InMemoryCollectionStore implements DurableCollectionStore {
  private readonly docs = new Map<string, Map<string, { userId: string; value: unknown }>>();
  private readonly leases = new Map<string, { ownerId: string; expiresAtMs: number }>();

  public getMode(): PersistenceMode {
    return 'ephemeral-dev';
  }

  private getCol(collection: string): Map<string, { userId: string; value: unknown }> {
    let col = this.docs.get(collection);
    if (!col) {
      col = new Map();
      this.docs.set(collection, col);
    }
    return col;
  }

  public async put<T extends object>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
    record: T,
  ): Promise<void> {
    const col = this.getCol(collection);
    col.set(`${ctx.userId}:${docId}`, {
      userId: ctx.userId,
      value: structuredClone(record),
    });
  }

  public async get<T>(ctx: DurableRequestContext, collection: string, docId: string): Promise<T | null> {
    const col = this.docs.get(collection);
    if (!col) return null;
    const found = col.get(`${ctx.userId}:${docId}`);
    return found ? (structuredClone(found.value) as T) : null;
  }

  public async list<T>(ctx: DurableRequestContext, collection: string, limit = 100): Promise<T[]> {
    const col = this.docs.get(collection);
    if (!col) return [];
    const results: T[] = [];
    for (const entry of col.values()) {
      if (entry.userId === ctx.userId) {
        results.push(structuredClone(entry.value) as T);
      }
    }
    return results.slice(0, limit);
  }

  public async listAllForSystem<T>(collection: string, limit = 200): Promise<T[]> {
    const col = this.docs.get(collection);
    if (!col) return [];
    const results: T[] = [];
    for (const entry of col.values()) {
      results.push(structuredClone(entry.value) as T);
      if (results.length >= limit) break;
    }
    return results;
  }

  public async delete(ctx: DurableRequestContext, collection: string, docId: string): Promise<void> {
    const col = this.docs.get(collection);
    col?.delete(`${ctx.userId}:${docId}`);
  }

  public async tryAcquireLease(leaseKey: string, ownerId: string, ttlMs: number): Promise<DurableLeaseResult> {
    const now = Date.now();
    const existing = this.leases.get(leaseKey);
    if (existing && existing.expiresAtMs > now && existing.ownerId !== ownerId) {
      return { acquired: false, ownerId: existing.ownerId, expiresAtMs: existing.expiresAtMs };
    }
    const expiresAtMs = now + Math.max(1000, ttlMs);
    this.leases.set(leaseKey, { ownerId, expiresAtMs });
    return { acquired: true, ownerId, expiresAtMs };
  }

  public async renewLease(leaseKey: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.leases.get(leaseKey);
    if (!existing || existing.ownerId !== ownerId || existing.expiresAtMs <= now) {
      return false;
    }
    existing.expiresAtMs = now + Math.max(1000, ttlMs);
    return true;
  }

  public async releaseLease(leaseKey: string, ownerId: string): Promise<void> {
    const existing = this.leases.get(leaseKey);
    if (existing && existing.ownerId === ownerId) {
      this.leases.delete(leaseKey);
    }
  }

  public async compareAndSwap<T extends object>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
    updater: (current: T | null) => { commit: boolean; next?: T },
  ): Promise<{ committed: boolean; value: T | null }> {
    const current = await this.get<T>(ctx, collection, docId);
    const decision = updater(current);
    if (!decision.commit || !decision.next) {
      return { committed: false, value: current };
    }
    await this.put(ctx, collection, docId, decision.next);
    return { committed: true, value: structuredClone(decision.next) };
  }
}

/**
 * Composite production durable store combining Upstash Redis REST + Firestore User REST + in-memory cache.
 */
export class CompositeCollectionStore implements DurableCollectionStore {
  private readonly redisUrl: string;
  private readonly redisToken: string;
  private readonly redis: UpstashRedisRestStore | null;
  private readonly firestore: FirestoreUserRestStore | null;
  private readonly memory = new InMemoryCollectionStore();

  constructor() {
    this.redisUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
    this.redisToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
    this.redis = this.redisUrl && this.redisToken ? new UpstashRedisRestStore(this.redisUrl, this.redisToken) : null;
    const fb = resolveFirebaseMeta();
    this.firestore = fb ? new FirestoreUserRestStore(fb.projectId, fb.databaseId) : null;
  }

  private async redisRaw<T = unknown>(args: Array<string | number>): Promise<T | null> {
    if (!this.redisUrl || !this.redisToken) return null;
    try {
      const res = await fetch(this.redisUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.redisToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: T };
      return body.result ?? null;
    } catch {
      return null;
    }
  }

  public getMode(ctx?: DurableRequestContext): PersistenceMode {
    const hasRedis = Boolean(this.redis);
    const hasFs = Boolean(this.firestore && ctx?.authToken);
    if (hasRedis && hasFs) return 'hybrid';
    if (hasRedis) return 'upstash-redis';
    if (hasFs) return 'firestore-rest';
    return 'ephemeral-dev';
  }

  public async put<T extends object>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
    record: T,
    ttlSec = 86400 * 30,
  ): Promise<void> {
    await this.memory.put(ctx, collection, docId, record);
    if (this.redis) {
      const itemKey = `manus:col:${collection}:${ctx.userId}:${docId}`;
      await this.redis.setJson(itemKey, record, ttlSec);
      await this.redis.addToSet(`manus:idx:${collection}:${ctx.userId}`, docId, ttlSec);
      await this.redis.addToSet(`manus:sysidx:${collection}`, `${ctx.userId}:${docId}`, ttlSec);
    }
    if (this.firestore && ctx.authToken) {
      await this.firestore.put(ctx, collection, docId, record);
    }
  }

  public async get<T>(ctx: DurableRequestContext, collection: string, docId: string): Promise<T | null> {
    if (this.redis) {
      const fromRedis = await this.redis.getJson<T>(`manus:col:${collection}:${ctx.userId}:${docId}`);
      if (fromRedis) return fromRedis;
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.get<T>(ctx, collection, docId);
      if (fromFs) return fromFs;
    }
    return this.memory.get<T>(ctx, collection, docId);
  }

  public async list<T>(ctx: DurableRequestContext, collection: string, limit = 100): Promise<T[]> {
    if (this.redis) {
      const ids = await this.redis.listSet(`manus:idx:${collection}:${ctx.userId}`);
      if (ids.length > 0) {
        const docs = await Promise.all(
          ids.slice(0, limit).map((id) => this.redis!.getJson<T>(`manus:col:${collection}:${ctx.userId}:${id}`)),
        );
        const valid = docs.filter((d): d is NonNullable<typeof d> => Boolean(d)) as T[];
        if (valid.length > 0) return valid;
      }
    }
    if (this.firestore && ctx.authToken) {
      const fromFs = await this.firestore.list<T>(ctx, collection, limit);
      if (fromFs.length > 0) return fromFs;
    }
    return this.memory.list<T>(ctx, collection, limit);
  }

  public async listAllForSystem<T>(collection: string, limit = 200): Promise<T[]> {
    if (this.redis) {
      const keys = await this.redis.listSet(`manus:sysidx:${collection}`);
      if (keys.length > 0) {
        const docs = await Promise.all(
          keys.slice(0, limit).map((composite) => this.redis!.getJson<T>(`manus:col:${collection}:${composite}`)),
        );
        const valid = docs.filter((d): d is NonNullable<typeof d> => Boolean(d)) as T[];
        if (valid.length > 0) return valid;
      }
    }
    return this.memory.listAllForSystem<T>(collection, limit);
  }

  public async delete(ctx: DurableRequestContext, collection: string, docId: string): Promise<void> {
    await this.memory.delete(ctx, collection, docId);
    if (this.redis) {
      await this.redisRaw(['DEL', `manus:col:${collection}:${ctx.userId}:${docId}`]);
      await this.redisRaw(['SREM', `manus:idx:${collection}:${ctx.userId}`, docId]);
      await this.redisRaw(['SREM', `manus:sysidx:${collection}`, `${ctx.userId}:${docId}`]);
    }
  }

  public async tryAcquireLease(leaseKey: string, ownerId: string, ttlMs: number): Promise<DurableLeaseResult> {
    const safeTtlMs = Math.max(1000, ttlMs);
    if (this.redis) {
      const result = await this.redisRaw<string>([
        'SET',
        `manus:lease:${leaseKey}`,
        ownerId,
        'PX',
        safeTtlMs,
        'NX',
      ]);
      if (result === 'OK') {
        return { acquired: true, ownerId, expiresAtMs: Date.now() + safeTtlMs };
      }
      const holder = await this.redisRaw<string>(['GET', `manus:lease:${leaseKey}`]);
      if (holder === ownerId) {
        await this.redisRaw(['PEXPIRE', `manus:lease:${leaseKey}`, safeTtlMs]);
        return { acquired: true, ownerId, expiresAtMs: Date.now() + safeTtlMs };
      }
      return { acquired: false, ownerId: holder || undefined };
    }
    return this.memory.tryAcquireLease(leaseKey, ownerId, safeTtlMs);
  }

  public async renewLease(leaseKey: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const safeTtlMs = Math.max(1000, ttlMs);
    if (this.redis) {
      const holder = await this.redisRaw<string>(['GET', `manus:lease:${leaseKey}`]);
      if (holder !== ownerId) return false;
      const res = await this.redisRaw<number>(['PEXPIRE', `manus:lease:${leaseKey}`, safeTtlMs]);
      return res === 1;
    }
    return this.memory.renewLease(leaseKey, ownerId, safeTtlMs);
  }

  public async releaseLease(leaseKey: string, ownerId: string): Promise<void> {
    if (this.redis) {
      const holder = await this.redisRaw<string>(['GET', `manus:lease:${leaseKey}`]);
      if (holder === ownerId) {
        await this.redisRaw(['DEL', `manus:lease:${leaseKey}`]);
      }
      return;
    }
    await this.memory.releaseLease(leaseKey, ownerId);
  }

  public async compareAndSwap<T extends object>(
    ctx: DurableRequestContext,
    collection: string,
    docId: string,
    updater: (current: T | null) => { commit: boolean; next?: T },
  ): Promise<{ committed: boolean; value: T | null }> {
    const lockOwner = `cas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lockKey = `cas:${collection}:${ctx.userId}:${docId}`;
    const lock = await this.tryAcquireLease(lockKey, lockOwner, 5000);
    if (!lock.acquired) {
      const current = await this.get<T>(ctx, collection, docId);
      return { committed: false, value: current };
    }
    try {
      const current = await this.get<T>(ctx, collection, docId);
      const decision = updater(current);
      if (!decision.commit || !decision.next) {
        return { committed: false, value: current };
      }
      await this.put(ctx, collection, docId, decision.next);
      return { committed: true, value: structuredClone(decision.next) };
    } finally {
      await this.releaseLease(lockKey, lockOwner);
    }
  }
}

export const defaultCollectionStore = new CompositeCollectionStore();
