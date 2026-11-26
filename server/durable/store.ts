/**
 * Durable store abstraction shared by Features 01-06.
 *
 * Production state lives in Firestore (Firebase Admin, server-only). Tests and
 * explicit non-production local runs may use the in-memory backend, but it is
 * never permitted to back a production deployment: callers must configure
 * Firestore credentials or accept an explicit `unavailable` backend that fails
 * closed rather than silently emulating durability.
 */

export interface DurableFilter {
  field: string;
  op: 'eq' | 'gte' | 'lte' | 'in';
  value: any;
}

export interface DurableQuery {
  filters?: DurableFilter[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface TransactionOps {
  get(id: string): Promise<Record<string, any> | null>;
  create(id: string, data: Record<string, any>): void;
  update(id: string, patch: Record<string, any>): void;
}

export interface DurableStore {
  readonly kind: 'firestore' | 'memory' | 'unavailable';
  get(collection: string, id: string): Promise<Record<string, any> | null>;
  set(collection: string, id: string, data: Record<string, any>): Promise<void>;
  create(collection: string, id: string, data: Record<string, any>): Promise<boolean>;
  update(collection: string, id: string, patch: Record<string, any>): Promise<boolean>;
  delete(collection: string, id: string): Promise<boolean>;
  query(collection: string, q: DurableQuery): Promise<Record<string, any>[]>;
  /**
   * Atomic compare-and-set update. The mutator receives the current doc (or
   * null) and returns the new merged doc plus optional result. Backends must
   * serialize concurrent mutations per document.
   */
  transact(
    collection: string,
    id: string,
    mutator: (current: Record<string, any> | null) => { next: Record<string, any> | null; result?: any } | null,
  ): Promise<{ applied: boolean; result?: any }>;
}

export class UnavailableDurableStore implements DurableStore {
  readonly kind = 'unavailable' as const;

  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new Error(`Durable store unavailable: ${this.reason}`);
  }

  async get(): Promise<Record<string, any> | null> {
    this.fail();
  }
  async set(): Promise<void> {
    this.fail();
  }
  async create(): Promise<boolean> {
    this.fail();
  }
  async update(): Promise<boolean> {
    this.fail();
  }
  async delete(): Promise<boolean> {
    this.fail();
  }
  async query(): Promise<Record<string, any>[]> {
    this.fail();
  }
  async transact(): Promise<{ applied: boolean }> {
    this.fail();
  }
}

/** Memory backend: development/tests only, never used as production default. */
export class InMemoryDurableStore implements DurableStore {
  readonly kind = 'memory' as const;
  private data = new Map<string, Map<string, Record<string, any>>>();

  public resetForTests(): void {
    this.data.clear();
  }

  private col(collection: string): Map<string, Record<string, any>> {
    let col = this.data.get(collection);
    if (!col) {
      col = new Map();
      this.data.set(collection, col);
    }
    return col;
  }

  async get(collection: string, id: string): Promise<Record<string, any> | null> {
    return this.col(collection).get(id) ? { ...(this.col(collection).get(id) as Record<string, any>) } : null;
  }

  async set(collection: string, id: string, data: Record<string, any>): Promise<void> {
    this.col(collection).set(id, { ...data });
  }

  async create(collection: string, id: string, data: Record<string, any>): Promise<boolean> {
    const col = this.col(collection);
    if (col.has(id)) return false;
    col.set(id, { ...data });
    return true;
  }

  async update(collection: string, id: string, patch: Record<string, any>): Promise<boolean> {
    const col = this.col(collection);
    const existing = col.get(id);
    if (!existing) return false;
    col.set(id, { ...existing, ...patch });
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    return this.col(collection).delete(id);
  }

  async query(collection: string, q: DurableQuery): Promise<Record<string, any>[]> {
    let rows = Array.from(this.col(collection).values()).map((r) => ({ ...r }));
    for (const filter of q.filters ?? []) {
      rows = rows.filter((row) => {
        const current = (row as any)[filter.field];
        switch (filter.op) {
          case 'eq':
            return current === filter.value;
          case 'gte':
            return current >= filter.value;
          case 'lte':
            return current <= filter.value;
          case 'in':
            return Array.isArray(filter.value) && filter.value.includes(current);
          default:
            return false;
        }
      });
    }
    if (q.orderBy) {
      const { field, direction } = q.orderBy;
      rows.sort((a, b) => {
        const av = (a as any)[field];
        const bv = (b as any)[field];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return direction === 'asc' ? cmp : -cmp;
      });
    }
    if (q.limit !== undefined) rows = rows.slice(0, q.limit);
    return rows;
  }

  /**
   * Single-threaded per-document compare-and-set. Tests exercise the same
   * contract as the Firestore transaction backend.
   */
  async transact(
    collection: string,
    id: string,
    mutator: (current: Record<string, any> | null) => { next: Record<string, any> | null; result?: any } | null,
  ): Promise<{ applied: boolean; result?: any }> {
    const col = this.col(collection);
    const current = col.get(id) ? { ...(col.get(id) as Record<string, any>) } : null;
    const mutation = mutator(current);
    if (!mutation) return { applied: false };
    if (mutation.next) {
      col.set(id, { ...mutation.next });
    } else {
      col.delete(id);
    }
    return { applied: true, result: mutation.result };
  }
}

interface FirestoreLike {
  collection(path: string): any;
}

/**
 * Firestore backend via Firebase Admin. Returns null when no credentials are
 * configured so callers can fail closed with an explicit unavailable status.
 */
export function createFirestoreDurableStore(): DurableStore | null {
  let fs: FirestoreLike | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getFirestore } = require('firebase-admin/firestore') as { getFirestore: () => FirestoreLike };
    fs = getFirestore();
  } catch {
    return null;
  }
  if (!fs) return null;
  return fromFirestoreClient(fs as any);
}

/** Wrap a firestore-like client with retriable write/read helpers. */
export function fromFirestoreClient(db: {
  collection(path: string): any;
  runTransaction(fn: (t: any) => Promise<any>): Promise<any>;
}): DurableStore {
  const normalize = (snap: any): Record<string, any> | null => {
    if (!snap || !snap.exists) return null;
    const data = snap.data() ?? {};
    if (data && typeof data === 'object') {
      // Firestore Timestamps are converted to ISO strings for a stable wire/product format.
      for (const [k, v] of Object.entries(data as Record<string, any>)) {
        if (v && typeof v === 'object' && typeof (v as any).toDate === 'function') {
          (data as any)[k] = (v as any).toDate().toISOString();
        }
      }
    }
    return data as Record<string, any>;
  };

  return {
    kind: 'firestore',
    async get(collection, id) {
      const snap = await db.collection(collection).doc(id).get();
      return normalize(snap);
    },
    async set(collection, id, data) {
      await db.collection(collection).doc(id).set(data);
    },
    async create(collection, id, data) {
      const ref = db.collection(collection).doc(id);
      const existing = await ref.get();
      if (existing.exists) return false;
      await ref.set(data);
      return true;
    },
    async update(collection, id, patch) {
      const ref = db.collection(collection).doc(id);
      const existing = await ref.get();
      if (!existing.exists) return false;
      await ref.update(patch);
      return true;
    },
    async delete(collection, id) {
      const ref = db.collection(collection).doc(id);
      const existing = await ref.get();
      if (!existing.exists) return false;
      await ref.delete();
      return true;
    },
    async query(collection, q) {
      let cursor: any = db.collection(collection);
      for (const filter of q.filters ?? []) {
        cursor = cursor.where(filter.field, filter.op === 'eq' ? '==' : filter.op, filter.value);
      }
      if (q.orderBy) cursor = cursor.orderBy(q.orderBy.field, q.orderBy.direction);
      if (q.limit !== undefined) cursor = cursor.limit(q.limit);
      const snapshot = await cursor.get();
      return snapshot.docs.map((d: any) => normalize(d)).filter(Boolean) as Record<string, any>[];
    },
    async transact(collection, id, mutator) {
      let result: any = undefined;
      await db.runTransaction(async (t: any) => {
        const ref = db.collection(collection).doc(id);
        const snap = await t.get(ref);
        const current = normalize(snap);
        const mutation = mutator(current);
        if (!mutation) return;
        result = mutation.result;
        if (mutation.next) {
          if (current) t.update(ref, mutation.next);
          else t.set(ref, mutation.next);
        } else {
          t.delete(ref);
        }
      });
      return { applied: result !== undefined, result };
    },
  };
}

let defaultStore: DurableStore | null | undefined;

/**
 * Resolve the production durable store. Only Firestore is accepted in
 * production; if credentials are absent the caller receives an unavailable
 * store and must fail closed.
 */
export function getDefaultDurableStore(): DurableStore {
  if (defaultStore) return defaultStore;
  const explicit = (process.env as Record<string, string | undefined>).DURABLE_STORE_BACKEND;
  if (explicit === 'memory') {
    defaultStore = new InMemoryDurableStore();
    return defaultStore;
  }
  const fs = createFirestoreDurableStore();
  defaultStore = fs ?? new UnavailableDurableStore('Firestore admin credentials are not configured on this instance.');
  return defaultStore;
}

export function setDefaultDurableStoreForTests(store: DurableStore): void {
  defaultStore = store;
}
