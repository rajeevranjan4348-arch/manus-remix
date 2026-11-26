/**
 * Durable permission & audit store (Feature 02).
 *
 * Persistent permission challenges, single-use approval tokens and immutable
 * audit events live in Firestore through the Admin SDK. A process-local
 * implementation exists ONLY as a test/dev fallback and is always flagged
 * non-durable. Never rely on process-local maps for production authorization.
 */

import crypto from 'crypto';

export type ChallengeStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';

export interface StoredChallenge {
  challengeId: string;
  toolName: string;
  displayName: string;
  riskLevel: string;
  target?: string;
  parametersHash: string;
  parametersSummary: Record<string, unknown>;
  consequences: string[];
  userId: string;
  createdAt: number;
  expiresAt: number;
  status: ChallengeStatus;
  approvalToken?: string;
  resolvedAt?: number;
  consumedAt?: number;
  workspaceId?: string;
}

export interface StoredAuditRecord {
  id: string;
  timestamp: string;
  userId: string;
  category:
    | 'tool_execution' | 'filesystem_change' | 'terminal_execution' | 'browser_interaction'
    | 'external_api_access' | 'permission_approved' | 'permission_rejected'
    | 'auth_failure' | 'admin_action';
  toolName: string;
  riskLevel: string;
  status: 'allowed' | 'challenged' | 'approved' | 'rejected' | 'consumed' | 'denied';
  reason: string;
  target?: string;
  challengeId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface UserPolicyOverride {
  userId: string;
  toolName: string;
  effect: 'allow' | 'deny';
  updatedAt: string;
}

export interface PermissionStore {
  readonly durable: boolean;
  init(): Promise<void>;
  putChallenge(challenge: StoredChallenge): Promise<void>;
  getChallenge(challengeId: string, userId: string): Promise<StoredChallenge | null>;
  getChallengeByTokenHash(tokenHash: string): Promise<StoredChallenge | null>;
  /** Atomic status transition; returns the updated record or null on conflict. */
  transitionChallenge(challengeId: string, from: ChallengeStatus[], to: (c: StoredChallenge) => StoredChallenge | null): Promise<StoredChallenge | null>;
  appendAudit(record: StoredAuditRecord): Promise<void>;
  listAudit(userId: string, limit: number): Promise<StoredAuditRecord[]>;
  setUserPolicy(override: UserPolicyOverride): Promise<void>;
  getUserPolicies(userId: string): Promise<UserPolicyOverride[]>;
}

export function hashApprovalToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class MemoryPermissionStore implements PermissionStore {
  readonly durable = false;
  private challenges = new Map<string, StoredChallenge>();
  private audits: StoredAuditRecord[] = [];
  private userPolicies = new Map<string, UserPolicyOverride>();

  async init() {}
  async putChallenge(c: StoredChallenge) { this.challenges.set(c.challengeId, { ...c }); }
  async getChallenge(id: string, userId: string) {
    const c = this.challenges.get(id);
    return c && c.userId === userId ? { ...c } : null;
  }
  async getChallengeByTokenHash(h: string) {
    for (const c of this.challenges.values()) {
      if (c.approvalToken && hashApprovalToken(c.approvalToken) === h) {
        // Token lookup is not identity-scoped: identity binding is enforced at verify time.
        return { ...c };
      }
    }
    return null;
  }
  async transitionChallenge(id: string, from: ChallengeStatus[], to: (c: StoredChallenge) => StoredChallenge | null) {
    const c = this.challenges.get(id);
    if (!c) return null;
    if (!from.includes(c.status)) return null;
    const next = to({ ...c });
    if (!next) return null;
    this.challenges.set(id, next);
    return { ...next };
  }
  async appendAudit(r: StoredAuditRecord) {
    this.audits.push({ ...r });
    if (this.audits.length > 500) this.audits = this.audits.slice(-400);
  }
  async listAudit(userId: string, limit: number) {
    return this.audits.filter((r) => r.userId === userId).slice(-limit).reverse().map((r) => ({ ...r }));
  }
  async setUserPolicy(o: UserPolicyOverride) { this.userPolicies.set(o.userId + '|' + o.toolName, { ...o }); }
  async getUserPolicies(userId: string) {
    return Array.from(this.userPolicies.values()).filter((p) => p.userId === userId).map((p) => ({ ...p }));
  }
}

class FirestorePermissionStore implements PermissionStore {
  readonly durable = true;
  private dbInstance: any = null;

  private async db(): Promise<any> {
    if (!this.dbInstance) {
      const { getFirestore } = await import('firebase-admin/firestore');
      this.dbInstance = getFirestore();
    }
    return this.dbInstance;
  }

  private async col(name: string) { return (await this.db()).collection(name); }

  async init() { await this.db(); }

  async putChallenge(c: StoredChallenge) {
    const col = await this.col('permissionChallenges');
    await col.doc(c.challengeId).set(c, { merge: true });
  }

  async getChallenge(id: string, userId: string) {
    const col = await this.col('permissionChallenges');
    const snap = await col.doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() as StoredChallenge;
    return data && data.userId === userId ? data : null;
  }

  async getChallengeByTokenHash(h: string) {
    const col = await this.col('permissionChallenges');
    try {
      const snap = await col.where('approvalTokenHash', '==', h).limit(1).get();
      return snap.empty ? null : (snap.docs[0].data() as StoredChallenge);
    } catch {
      return null; // missing index: token verification fails closed via challengeId path
    }
  }

  async transitionChallenge(id: string, from: ChallengeStatus[], to: (c: StoredChallenge) => StoredChallenge | null) {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const ref = (await this.col('permissionChallenges')).doc(id);
    let result: StoredChallenge | null = null;
    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const cur = snap.data() as StoredChallenge;
      if (!from.includes(cur.status)) return;
      const next = to({ ...cur });
      if (!next) return;
      tx.set(ref, next);
      result = next;
    });
    return result;
  }

  async appendAudit(r: StoredAuditRecord) {
    const col = await this.col('securityAudit');
    await col.add({ ...r });
  }

  async listAudit(userId: string, limit: number) {
    const col = await this.col('securityAudit');
    try {
      const snap = await col.where('userId', '==', userId).orderBy('timestamp', 'desc').limit(Math.min(limit, 100)).get();
      return snap.docs.map((d: any) => d.data() as StoredAuditRecord);
    } catch {
      const snap = await col.where('userId', '==', userId).limit(200).get();
      return snap.docs.map((d: any) => d.data() as StoredAuditRecord)
        .sort((a: StoredAuditRecord, b: StoredAuditRecord) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit);
    }
  }

  async setUserPolicy(o: UserPolicyOverride) {
    const col = await this.col('userPermissionPolicies');
    // Deny records are looked up per tool; document id is deterministic.
    await col.doc(hashApprovalToken(o.userId + '|' + o.toolName).slice(0, 48)).set(o, { merge: true });
  }

  async getUserPolicies(userId: string) {
    const col = await this.col('userPermissionPolicies');
    const snap = await col.where('userId', '==', userId).limit(100).get();
    return snap.docs.map((d: any) => d.data() as UserPolicyOverride);
  }
}

let cached: PermissionStore | null = null;

const STORE_PROBE_TIMEOUT_MS = 3000;

/**
 * Firestore only fails when credentials are actually used, so a successful
 * init() does not prove durability. Probe with a bounded read: on error or
 * timeout fall back to the explicit non-durable memory store rather than
 * hanging requests or failing them 13s late.
 */
export async function resolvePermissionStore(): Promise<PermissionStore> {
  if (cached) return cached;
  if ((process.env.DURABLE_STORE_BACKEND || '').trim().toLowerCase() === 'memory') {
    cached = new MemoryPermissionStore();
    return cached;
  }
  try {
    const store = new FirestorePermissionStore();
    await store.init();
    const probe = store
      .getChallenge('__resolution_probe__', '__resolution_probe__')
      .then(() => true as const);
    const reachable = await Promise.race([
      probe,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STORE_PROBE_TIMEOUT_MS)),
    ]);
    cached = reachable ? store : new MemoryPermissionStore();
  } catch {
    cached = new MemoryPermissionStore();
  }
  return cached;
}

export function setPermissionStoreForTesting(store: PermissionStore): void {
  cached = store;
}
