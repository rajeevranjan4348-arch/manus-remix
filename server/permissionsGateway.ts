import crypto from 'crypto';
import {
  DurableStore,
  InMemoryDurableStore,
  getDefaultDurableStore,
} from './durable/store';

export type PolicyRiskLevel = 'read-only' | 'destructive' | 'privileged';

export interface PolicyActionDefinition {
  toolName: string;
  displayName: string;
  riskLevel: PolicyRiskLevel;
  description: string;
  consequences: string[];
  requiresConfirmation: boolean;
  category: 'web' | 'coding' | 'filesystem' | 'system' | 'workspace' | 'memory' | 'device';
}

export interface PermissionChallenge {
  challengeId: string;
  toolName: string;
  displayName: string;
  riskLevel: PolicyRiskLevel;
  target?: string;
  parametersHash: string;
  parametersSummary: Record<string, any>;
  consequences: string[];
  userId: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';
  approvalToken?: string;
  resolvedAt?: number;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  userId: string;
  toolName: string;
  riskLevel: PolicyRiskLevel | string;
  status: 'allowed' | 'challenged' | 'approved' | 'rejected' | 'consumed' | 'denied' | 'revoked';
  reason: string;
  target?: string;
  challengeId?: string;
  requestId?: string;
  executionId?: string;
  eventCategory?: string;
}

export interface UserPermissionPolicy {
  userId: string;
  toolName: string;
  mode: 'deny' | 'allow-window';
  expiresAt?: number;
  updatedAt: number;
  updatedBy: string;
}

export const CHALLENGES_COLLECTION = 'system_permission_challenges';
const TOKEN_INDEX_COLLECTION = 'system_permission_tokens';
const AUDIT_COLLECTION = 'system_permission_audit';
const POLICY_COLLECTION = 'system_permission_policies';
const REVOKE_COLLECTION = 'system_permission_revocations';

function isProduction(): boolean {
  return process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production';
}

export type PersistenceMode = 'firestore' | 'memory';

/**
 * Durable authorization gateway.
 *
 * Challenge, token and audit state is persisted through a DurableStore. A
 * Firestore backend gives cross-instance durability with atomic single-use
 * token consumption via transactions. Without configured credentials the
 * gateway falls back to an explicitly non-durable memory backend that is only
 * acceptable outside production.
 */
export class PermissionsGatewayService {
  private policies = new Map<string, PolicyActionDefinition>();
  private durableStore: DurableStore | null = null;
  private readonly memoryStore = new InMemoryDurableStore();
  private persistenceMode: PersistenceMode = 'memory';
  private readonly DEFAULT_EXPIRY_MS = 5 * 60 * 1000;
  private readonly secretConfigured: boolean;
  private readonly stableSecret: string;
  private readonly userPolicyCache = new Map<string, UserPermissionPolicy>();
  private readonly revocationCache = new Map<string, number>();
  private readonly auditRing: AuditRecord[] = [];

  constructor() {
    const configured = process.env.POLICY_GATEWAY_SECRET;
    this.secretConfigured = Boolean(configured && configured.length >= 32);
    if (this.secretConfigured) {
      this.stableSecret = configured as string;
    } else if (isProduction()) {
      // Production fails closed below: a stable signing secret is mandatory and
      // must come from environment configuration, never a random replacement.
      this.stableSecret = '';
    } else {
      this.stableSecret = crypto.randomBytes(32).toString('hex');
    }
    this.registerDefaultPolicies();
  }

  public attachDurableStore(store: DurableStore): void {
    this.durableStore = store;
    this.persistenceMode = store.kind === 'firestore' ? 'firestore' : 'memory';
  }

  /** Test hook: exposes the active backend so tests can seed or expire durable records. */
  public getDurableStoreForTests(): DurableStore {
    return this.resolveBackend();
  }

  public getPersistenceMode(): PersistenceMode {
    return this.persistenceMode;
  }

  public isSecretConfigured(): boolean {
    return this.secretConfigured;
  }

  /** True when the gateway can durably authorize sensitive actions. */
  public durableReady(): boolean {
    if (isProduction()) {
      return this.secretConfigured && this.durableStore?.kind === 'firestore';
    }
    return true;
  }

  public registerPolicy(def: PolicyActionDefinition): void {
    this.policies.set(def.toolName, def);
  }

  public getPolicy(toolName: string): PolicyActionDefinition {
    const existing = this.policies.get(toolName);
    if (existing) return existing;
    return {
      toolName,
      displayName: toolName,
      riskLevel: 'privileged',
      description: `Unregistered tool '${toolName}'. Treated as privileged for system safety.`,
      consequences: ['Executes an unregistered external or system action.'],
      requiresConfirmation: true,
      category: 'system',
    };
  }

  public getAllPolicies(): PolicyActionDefinition[] {
    return Array.from(this.policies.values());
  }

  public hashParameters(args: Record<string, any>): string {
    const sortedKeys = Object.keys(args || {}).sort();
    const normalized: Record<string, any> = {};
    for (const key of sortedKeys) {
      normalized[key] = args[key];
    }
    return crypto.createHmac('sha256', this.stableSecret).update(JSON.stringify(normalized)).digest('hex');
  }

  private resolveBackend(): DurableStore {
    if (!this.durableStore) {
      if (isProduction()) {
        const store = getDefaultDurableStore();
        if (store.kind !== 'unavailable') this.attachDurableStore(store);
        else return store;
      } else {
        this.attachDurableStore(this.memoryStore);
      }
    }
    return this.durableStore as DurableStore;
  }

  failClosedReason(): string | null {
    if (isProduction() && !this.secretConfigured) {
      return 'POLICY_GATEWAY_SECRET is missing or shorter than 32 characters; authorization fails closed.';
    }
    const backend = this.resolveBackend();
    if (isProduction() && backend.kind !== 'firestore') {
      return 'Production authorization requires a durable Firestore backend; none is configured.';
    }
    return null;
  }

  /**
   * Evaluate a requested tool invocation against policy.
   * `approvalToken`, when present, is verified and consumed atomically.
   */
  public evaluateAction(params: {
    toolName: string;
    args: Record<string, any>;
    userId?: string;
    target?: string;
    approvalToken?: string;
    requestId?: string;
    executionId?: string;
  }): {
    allowed: boolean;
    riskLevel: PolicyRiskLevel;
    requiresApproval: boolean;
    reason: string;
    challenge?: PermissionChallenge;
    unavailable?: boolean;
  } {
    if (!params.userId) {
      return {
        allowed: false,
        riskLevel: this.getPolicy(params.toolName).riskLevel,
        requiresApproval: true,
        reason: 'An authenticated user identity is required for permission checks.',
        unavailable: true,
      };
    }

    const policy = this.getPolicy(params.toolName);

    // Read-only actions do not depend on the signing secret or challenge state.
    if (policy.riskLevel === 'read-only' && !policy.requiresConfirmation) {
      this.recordAudit({
        userId: params.userId,
        toolName: params.toolName,
        riskLevel: 'read-only',
        status: 'allowed',
        reason: 'Read-only operation allowed automatically by policy gateway',
        target: params.target,
        requestId: params.requestId,
        executionId: params.executionId,
      });
      return {
        allowed: true,
        riskLevel: 'read-only',
        requiresApproval: false,
        reason: 'Read-only operation verified and allowed.',
      };
    }

    // Fail closed for any sensitive action when the required secret is absent.
    const closed = this.failClosedReason();
    if (closed) {
      this.recordAuditSafe({
        userId: params.userId,
        toolName: params.toolName,
        riskLevel: policy.riskLevel,
        status: 'denied',
        reason: `Authorization unavailable: ${closed}`,
        target: params.target,
        requestId: params.requestId,
        executionId: params.executionId,
      });
      return {
        allowed: false,
        riskLevel: policy.riskLevel,
        requiresApproval: true,
        reason: closed,
        unavailable: true,
      };
    }

    const paramsHash = this.hashParameters(params.args);

    // User-level grant/deny policy check (hydrated cache).
    const userPolicy = this.userPolicyCache.get(`${params.userId}:${params.toolName}`);
    if (userPolicy?.mode === 'deny' && (!userPolicy.expiresAt || userPolicy.expiresAt > Date.now())) {
      this.recordAudit({
        userId: params.userId,
        toolName: params.toolName,
        riskLevel: policy.riskLevel,
        status: 'denied',
        reason: 'User permission policy explicitly denies this tool.',
        target: params.target,
        requestId: params.requestId,
        executionId: params.executionId,
      });
      return {
        allowed: false,
        riskLevel: policy.riskLevel,
        requiresApproval: false,
        reason: 'Blocked by explicit user-level deny policy.',
      };
    }

    if (this.revocationCache.has(`${params.userId}:${params.toolName}`) && params.approvalToken) {
      return {
        allowed: false,
        riskLevel: policy.riskLevel,
        requiresApproval: false,
        reason: 'Approval capability has been revoked for this tool.',
      };
    }

    if (params.approvalToken) {
      // Synchronous callers pass tokens through the async path first; the sync
      // path supports backends where the token doc was already loaded in cache.
      const cachedChallenge = this.tokenCache.get(params.approvalToken);
      if (cachedChallenge) {
        const verdict = this.validateTokenBinding(cachedChallenge, params, paramsHash);
        if (verdict.valid) {
          this.markConsumed(cachedChallenge, params);
          return {
            allowed: true,
            riskLevel: policy.riskLevel,
            requiresApproval: false,
            reason: 'Explicit user confirmation token verified.',
          };
        }
        return {
          allowed: false,
          riskLevel: policy.riskLevel,
          requiresApproval: false,
          reason: verdict.reason,
        };
      }
      // Token not loaded in this instance yet: require the async verification
      // endpoint rather than failing silently.
      return {
        allowed: false,
        riskLevel: policy.riskLevel,
        requiresApproval: true,
        reason: 'Approval token not recognized in this execution context. Verify through the approval endpoint.',
      };
    }

    const challengeId = `chg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    const challenge: PermissionChallenge = {
      challengeId,
      toolName: params.toolName,
      displayName: policy.displayName,
      riskLevel: policy.riskLevel,
      target: params.target || (params.args.path || params.args.url || params.args.command || params.args.target),
      parametersHash: paramsHash,
      parametersSummary: this.sanitizeArgsForSummary(params.args),
      consequences: policy.consequences,
      userId: params.userId,
      createdAt: now,
      expiresAt: now + this.DEFAULT_EXPIRY_MS,
      status: 'pending',
    };

    void this.getStore()
      .set(CHALLENGES_COLLECTION, challengeId, challenge as unknown as Record<string, any>)
      .catch(() => undefined);

    this.recordAudit({
      userId: params.userId,
      toolName: params.toolName,
      riskLevel: policy.riskLevel,
      status: 'challenged',
      reason: `Explicit confirmation required for ${policy.riskLevel} operation: ${policy.displayName}`,
      target: challenge.target,
      challengeId,
      requestId: params.requestId,
      executionId: params.executionId,
    });

    return {
      allowed: false,
      riskLevel: policy.riskLevel,
      requiresApproval: true,
      reason: `Explicit user approval required for ${policy.riskLevel} action.`,
      challenge,
    };
  }

  private getStore(): DurableStore {
    return this.durableStore ?? this.memoryStore;
  }

  /**
   * Approve or reject a challenge with an atomic transaction so an approval can
   * never be applied twice or across instances.
   */
  public async resolveChallenge(params: {
    challengeId: string;
    confirmed: boolean;
    userId?: string;
    reason?: string;
  }): Promise<{
    success: boolean;
    status: 'approved' | 'rejected' | 'expired' | 'invalid';
    approvalToken?: string;
    expiresAt?: number;
    error?: string;
  }> {
    if (!params.userId) {
      return { success: false, status: 'invalid', error: 'An authenticated user identity is required.' };
    }
    const backendCheck = this.failClosedReason();
    if (backendCheck) return { success: false, status: 'invalid', error: backendCheck };
    const store = this.resolveBackend();

    const outcome = await store.transact(CHALLENGES_COLLECTION, params.challengeId, (current) => {
      if (!current) return null;
      if (current.userId !== params.userId) return null;
      if (current.status !== 'pending') return null;
      if (Date.now() > current.expiresAt) {
        return {
          next: { ...current, status: 'expired' },
          result: { success: false, status: 'expired', error: 'Confirmation challenge has expired.' },
        };
      }
      if (!params.confirmed) {
        return {
          next: { ...current, status: 'rejected', resolvedAt: Date.now() },
          result: { success: true, status: 'rejected' as const },
        };
      }
      const approvalToken = `appr_${crypto
        .createHmac('sha256', this.stableSecret)
        .update(`${params.challengeId}:${current.parametersHash}:${current.userId}:${Date.now()}`)
        .digest('hex')
        .substring(0, 32)}`;
      return {
        next: { ...current, status: 'approved', approvalToken, resolvedAt: Date.now() },
        result: { success: true, status: 'approved' as const, approvalToken, expiresAt: current.expiresAt },
      };
    });

    if (!outcome.applied || !outcome.result) {
      const existing = await store.get(CHALLENGES_COLLECTION, params.challengeId);
      if (!existing || existing.userId !== params.userId) {
        return { success: false, status: 'invalid', error: 'Challenge not found.' };
      }
      return {
        success: false,
        status: 'invalid',
        error: `Challenge is no longer pending (status: ${existing.status}).`,
      };
    }

    const result = outcome.result as { success: boolean; status: 'approved' | 'rejected' | 'expired'; approvalToken?: string };
    const challengeDoc = (await store.get(CHALLENGES_COLLECTION, params.challengeId)) as unknown as
      | PermissionChallenge
      | null;
    if (result.approvalToken && challengeDoc) {
      // Durable token index allows verification from any instance.
      await store
        .set(
          TOKEN_INDEX_COLLECTION,
          result.approvalToken,
          { challengeId: params.challengeId, expiresAt: challengeDoc.expiresAt } as unknown as Record<string, any>,
        )
        .catch(() => undefined);
      this.tokenCache.set(result.approvalToken, challengeDoc);
    }
    this.recordAudit({
      userId: params.userId,
      toolName: challengeDoc?.toolName ?? 'unknown',
      riskLevel: challengeDoc?.riskLevel ?? 'privileged',
      status:
        (result.status === 'approved' ? 'approved' : result.status === 'rejected' ? 'rejected' : 'denied') as AuditRecord['status'],
      reason:
        result.status === 'approved'
          ? 'User explicitly confirmed authorization'
          : params.reason || 'User explicitly denied authorization',
      challengeId: params.challengeId,
    });
    return result;
  }

  /**
   * Atomically verify and consume a single-use approval token. Replay from any
   * instance is rejected because consumption mutates durable state in a
   * transaction keyed by the challenge document.
   */
  public async verifyApprovalToken(params: {
    approvalToken: string;
    toolName: string;
    args: Record<string, any>;
    userId?: string;
    requestId?: string;
    executionId?: string;
  }): Promise<{ valid: boolean; reason: string }> {
    if (!params.userId) {
      return { valid: false, reason: 'An authenticated user identity is required.' };
    }
    const backendCheck = this.failClosedReason();
    if (backendCheck) return { valid: false, reason: backendCheck };
    const store = this.resolveBackend();

    const indexDoc = await store.get(TOKEN_INDEX_COLLECTION, params.approvalToken);
    const challengeId = indexDoc?.challengeId;
    if (!challengeId) {
      return { valid: false, reason: 'Invalid or unknown approval token.' };
    }

    const paramsHash = this.hashParameters(params.args);
    const outcome = await store.transact(CHALLENGES_COLLECTION, challengeId, (current) => {
      if (!current) return null;
      const challenge = current as unknown as PermissionChallenge;
      if (challenge.userId !== params.userId) {
        return { next: current, result: { valid: false, reason: 'Approval token is bound to a different user identity.' } };
      }
      if (Date.now() > challenge.expiresAt) {
        return { next: { ...challenge, status: 'expired' }, result: { valid: false, reason: 'Approval token has expired.' } };
      }
      if (challenge.status === 'consumed') {
        return {
          next: current,
          result: { valid: false, reason: 'Approval token has already been consumed (replay attack rejected).' },
        };
      }
      if (challenge.status !== 'approved') {
        return { next: current, result: { valid: false, reason: `Challenge status is '${challenge.status}', not approved.` } };
      }
      if (challenge.toolName !== params.toolName) {
        return { next: current, result: { valid: false, reason: 'Approval token does not match requested tool.' } };
      }
      if (challenge.parametersHash !== paramsHash) {
        return {
          next: current,
          result: { valid: false, reason: 'Parameter hash mismatch. Arguments were altered after approval.' },
        };
      }
      return {
        next: { ...challenge, status: 'consumed', resolvedAt: Date.now() },
        result: { valid: true, reason: 'Approval token valid and consumed.' },
      };
    });

    if (!outcome.applied || !outcome.result) {
      return { valid: false, reason: 'Invalid or unknown approval token.' };
    }
    const verdict = outcome.result as { valid: boolean; reason: string };
    this.recordAudit({
      userId: params.userId,
      toolName: params.toolName,
      riskLevel: this.getPolicy(params.toolName).riskLevel,
      status: verdict.valid ? 'consumed' : 'denied',
      reason: verdict.reason,
      challengeId,
      requestId: params.requestId,
      executionId: params.executionId,
    });
    return verdict;
  }

  /** Revoke previously granted approval capability for a user/tool pair. */
  public async revokePermission(params: {
    userId: string;
    toolName: string;
    reason?: string;
  }): Promise<{ success: boolean }> {
    const store = this.resolveBackend();
    await store.set(REVOKE_COLLECTION, `${params.userId}:${params.toolName}`, {
      userId: params.userId,
      toolName: params.toolName,
      revokedAt: Date.now(),
      reason: params.reason?.slice(0, 300) ?? 'Revoked by user or administrator.',
    } as unknown as Record<string, any>);
    this.revocationCache.set(`${params.userId}:${params.toolName}`, Date.now());
    this.recordAudit({
      userId: params.userId,
      toolName: params.toolName,
      riskLevel: this.getPolicy(params.toolName).riskLevel,
      status: 'revoked',
      reason: params.reason || 'Approval capability revoked.',
    });
    return { success: true };
  }

  public async setUserPolicy(policy: {
    userId: string;
    toolName: string;
    mode: 'deny' | 'allow-window';
    expiresAt?: number;
    updatedBy: string;
  }): Promise<{ success: boolean }> {
    const store = this.resolveBackend();
    const record: UserPermissionPolicy = {
      userId: policy.userId,
      toolName: policy.toolName,
      mode: policy.mode,
      expiresAt: policy.expiresAt,
      updatedAt: Date.now(),
      updatedBy: policy.updatedBy,
    };
    await store.set(POLICY_COLLECTION, `${policy.userId}:${policy.toolName}`, record as unknown as Record<string, any>);
    this.userPolicyCache.set(`${policy.userId}:${policy.toolName}`, record);
    this.recordAudit({
      userId: policy.userId,
      toolName: policy.toolName,
      riskLevel: this.getPolicy(policy.toolName).riskLevel,
      status: policy.mode === 'deny' ? 'denied' : 'allowed',
      reason: `User policy set to '${policy.mode}' by ${policy.updatedBy}.`,
    });
    return { success: true };
  }

  /** Hydrate the user policy/revocation cache for synchronous decisions. */
  public async hydrateUserContext(userId: string, toolNames: string[]): Promise<void> {
    const store = this.resolveBackend();
    if (store.kind === 'unavailable') return;
    for (const toolName of toolNames.slice(0, 25)) {
      if (!this.userPolicyCache.has(`${userId}:${toolName}`)) {
        const record = await store.get(POLICY_COLLECTION, `${userId}:${toolName}`);
        if (record) {
          this.userPolicyCache.set(`${userId}:${toolName}`, record as unknown as UserPermissionPolicy);
        }
        if (!this.revocationCache.has(`${userId}:${toolName}`)) {
          const revoked = await store.get(REVOKE_COLLECTION, `${userId}:${toolName}`);
          if (revoked) this.revocationCache.set(`${userId}:${toolName}`, revoked.revokedAt as number);
        }
      }
    }
  }

  /** Durable audit records for a user (latest first). */
  public async getDurableAuditLog(limit = 100, userId?: string): Promise<AuditRecord[]> {
    const store = this.resolveBackend();
    if (!userId) return [];
    const rows = await store.query(AUDIT_COLLECTION, {
      filters: [{ field: 'userId', op: 'eq', value: userId }],
      orderBy: { field: 'timestamp', direction: 'desc' },
      limit,
    });
    return rows as unknown as AuditRecord[];
  }

  public getAuditLog(limit = 100, userId?: string): AuditRecord[] {
    if (!userId) return [];
    return this.auditRing.filter((record) => record.userId === userId).slice(-limit).reverse();
  }

  private tokenCache = new Map<string, PermissionChallenge>();

  /** Load a durable approval token into this instance's cache so a
   * synchronous evaluateAction call can verify and consume it. */
  public async hydrateToken(approvalToken: string): Promise<boolean> {
    const store = this.resolveBackend();
    const indexDoc = await store.get(TOKEN_INDEX_COLLECTION, approvalToken);
    if (!indexDoc?.challengeId) return false;
    if (this.tokenCache.has(approvalToken)) return true;
    const challenge = await store.get(CHALLENGES_COLLECTION, indexDoc.challengeId);
    if (!challenge) return false;
    this.tokenCache.set(approvalToken, challenge as unknown as PermissionChallenge);
    return true;
  }

  private validateTokenBinding(
    challenge: PermissionChallenge,
    params: { toolName: string; userId?: string },
    paramsHash: string,
  ): { valid: boolean; reason: string } {
    if (challenge.userId !== params.userId) {
      return { valid: false, reason: 'Approval token is bound to a different user identity.' };
    }
    if (challenge.toolName !== params.toolName) {
      return { valid: false, reason: 'Approval token does not match requested tool.' };
    }
    if (challenge.parametersHash !== paramsHash) {
      return { valid: false, reason: 'Parameter hash mismatch. Arguments were altered after approval.' };
    }
    if (Date.now() > challenge.expiresAt) {
      return { valid: false, reason: 'Approval token has expired.' };
    }
    if (challenge.status === 'consumed') {
      return { valid: false, reason: 'Approval token has already been consumed (replay attack rejected).' };
    }
    if (challenge.status !== 'approved') {
      return { valid: false, reason: `Challenge status is '${challenge.status}', not approved.` };
    }
    return { valid: true, reason: 'Approval token valid and consumed.' };
  }

  private markConsumed(challenge: PermissionChallenge, params: { requestId?: string; executionId?: string }): void {
    challenge.status = 'consumed';
    void this.getStore()
      .update(CHALLENGES_COLLECTION, challenge.challengeId, { status: 'consumed', resolvedAt: Date.now() })
      .catch(() => undefined);
    this.recordAudit({
      userId: challenge.userId,
      toolName: challenge.toolName,
      riskLevel: challenge.riskLevel,
      status: 'consumed',
      reason: 'Approval token successfully verified and consumed for execution',
      challengeId: challenge.challengeId,
      requestId: params.requestId,
      executionId: params.executionId,
    });
  }

  private recordAudit(record: { userId: string; toolName: string; riskLevel: string; status: AuditRecord['status']; reason: string; target?: string; challengeId?: string; requestId?: string; executionId?: string }) {
    const audit: AuditRecord = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      userId: record.userId,
      toolName: record.toolName,
      riskLevel: record.riskLevel,
      status: record.status,
      reason: record.reason.slice(0, 400),
      target: record.target ? String(record.target).slice(0, 300) : undefined,
      challengeId: record.challengeId,
      requestId: record.requestId,
      executionId: record.executionId,
    };
    this.auditRing.push(audit);
    if (this.auditRing.length > 500) this.auditRing.splice(0, this.auditRing.length - 400);
    void this.getStore()
      .set(AUDIT_COLLECTION, audit.id, audit as unknown as Record<string, any>)
      .catch(() => undefined);
  }

  private recordAuditSafe(record: Parameters<PermissionsGatewayService['recordAudit']>[0]): void {
    try {
      this.recordAudit(record);
    } catch {
      // Audit persistence must never throw into the authorization path.
    }
  }

  private sanitizeArgsForSummary(args: Record<string, any>): Record<string, any> {
    const summary: Record<string, any> = {};
    for (const [k, v] of Object.entries(args || {})) {
      if (/key|secret|token|password|auth/i.test(k)) {
        summary[k] = '[REDACTED]';
      } else if (typeof v === 'string') {
        summary[k] = v.length > 200 ? v.slice(0, 197) + '...' : v;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        summary[k] = v;
      } else if (v && typeof v === 'object') {
        summary[k] = Array.isArray(v) ? `[Array (${v.length})]` : '[Object]';
      }
    }
    return summary;
  }

  private registerDefaultPolicies() {
    const readOnlyTools: Array<Omit<PolicyActionDefinition, 'riskLevel' | 'requiresConfirmation'>> = [
      {
        toolName: 'web_search',
        displayName: 'Web Search',
        category: 'web',
        description: 'Queries public search engines and encyclopedic sources for current facts.',
        consequences: ['Reads public internet data without side effects.'],
      },
      {
        toolName: 'fetch_webpage',
        displayName: 'Read Webpage',
        category: 'web',
        description: 'Fetches and parses public web page content.',
        consequences: ['Retrieves external public HTML content.'],
      },
      {
        toolName: 'calculate',
        displayName: 'Mathematical Calculator',
        category: 'system',
        description: 'Evaluates arithmetic and algebraic calculations.',
        consequences: ['Pure computation without side effects.'],
      },
      {
        toolName: 'get_file',
        displayName: 'Read File',
        category: 'filesystem',
        description: 'Reads contents of an existing workspace file.',
        consequences: ['Reads sandboxed workspace state through the durable execution provider.'],
      },
      { toolName: 'filesystem_list', displayName: 'List Sandbox Files', category: 'filesystem', description: 'Lists files and folders within an isolated sandbox workspace.', consequences: ['Inspects file tree hierarchy in an isolated sandbox.'] },
      { toolName: 'filesystem_read', displayName: 'Read Sandboxed File', category: 'filesystem', description: 'Reads a file inside an isolated sandbox workspace.', consequences: ['Reads sandbox workspace content without host access.'] },
      {
        toolName: 'list_files',
        displayName: 'List Files',
        category: 'filesystem',
        description: 'Lists files and folders within the project workspace.',
        consequences: ['Inspects file tree hierarchy.'],
      },
      {
        toolName: 'get_git_status',
        displayName: 'Inspect Git Status',
        category: 'coding',
        description: 'Checks current git branch and uncommitted modifications.',
        consequences: ['Read-only git repository query.'],
      },
      {
        toolName: 'read_memory',
        displayName: 'Read Memory Records',
        category: 'memory',
        description: 'Retrieves long-term preferences and facts from user memory vault.',
        consequences: ['Reads stored user memories.'],
      },
      {
        toolName: 'check_weather',
        displayName: 'Weather Forecast',
        category: 'web',
        description: 'Fetches open meteorological forecasts.',
        consequences: ['Reads public weather information.'],
      },
      {
        toolName: 'read_checkpoint',
        displayName: 'Read Task Checkpoint',
        category: 'system',
        description: 'Reads stored task checkpoint state.',
        consequences: ['Inspects persisted execution status.'],
      },
      { toolName: 'sandbox_status', displayName: 'Inspect Sandbox Status', category: 'coding', description: 'Reports the status of an existing isolated execution sandbox.', consequences: ['Reads sandbox liveness metadata.'] },
      { toolName: 'browser_inspect', displayName: 'Inspect Browser Page', category: 'web', description: 'Inspect DOM structure and console state of an active browser session.', consequences: ['Reads the current page state of an existing session.'] },
      { toolName: 'preview_status', displayName: 'Inspect Preview Status', category: 'coding', description: 'Reports existing development preview readiness and URL.', consequences: ['Reads existing preview metadata.'] },
      { toolName: 'terminal_stream', displayName: 'Read Terminal Output', category: 'coding', description: 'Reads captured stdout/stderr of an existing sandbox process.', consequences: ['Reads existing process output.'] },
    ];

    for (const r of readOnlyTools) {
      this.registerPolicy({ ...r, riskLevel: 'read-only', requiresConfirmation: false });
    }

    const destructiveTools: Array<Omit<PolicyActionDefinition, 'riskLevel' | 'requiresConfirmation'>> = [
      {
        toolName: 'delete_file',
        displayName: 'Delete File',
        category: 'filesystem',
        description: 'Permanently deletes a file from the repository or disk.',
        consequences: ['The specified file will be permanently removed.', 'Uncommitted changes in this file cannot be recovered.'],
      },
      { toolName: 'filesystem_delete', displayName: 'Delete Sandboxed File', category: 'filesystem', description: 'Deletes a file inside an isolated sandbox workspace.', consequences: ['The specified sandbox file will be permanently removed.'] },
      {
        toolName: 'drop_database',
        displayName: 'Drop or Truncate Database',
        category: 'system',
        description: 'Purges or resets database records and collections.',
        consequences: ['All matching records will be permanently deleted.', 'Database state cannot be restored without a prior backup.'],
      },
      {
        toolName: 'git_reset_hard',
        displayName: 'Hard Git Reset',
        category: 'coding',
        description: 'Discards uncommitted changes across the entire working tree.',
        consequences: ['All modified, uncommitted work in the repository will be lost.'],
      },
      {
        toolName: 'purge_memories',
        displayName: 'Purge Memory Vault',
        category: 'memory',
        description: 'Erases all saved user memory records and preferences.',
        consequences: ['All stored memories and context will be permanently wiped.'],
      },
      {
        toolName: 'delete_project',
        displayName: 'Delete Workspace Project',
        category: 'filesystem',
        description: 'Deletes a project workspace and all associated conversation history.',
        consequences: ['Project files and chat sessions will be permanently removed.'],
      },
      {
        toolName: 'cancel_all_tasks',
        displayName: 'Cancel All Active Tasks',
        category: 'system',
        description: 'Force terminates all running and queued background tasks.',
        consequences: ['All in-flight autonomous agent executions will be stopped immediately.'],
      },
      { toolName: 'sandbox_cleanup', displayName: 'Destroy Sandbox Environment', category: 'coding', description: 'Terminates an isolated sandbox and deletes its transient workspace state.', consequences: ['The sandbox environment and its processes will be terminated.'] },
    ];

    for (const d of destructiveTools) {
      this.registerPolicy({ ...d, riskLevel: 'destructive', requiresConfirmation: true });
    }

    const privilegedTools: Array<Omit<PolicyActionDefinition, 'riskLevel' | 'requiresConfirmation'>> = [
      {
        toolName: 'git_push',
        displayName: 'Push to Remote Repository',
        category: 'coding',
        description: 'Pushes local commits to the remote GitHub repository branch.',
        consequences: ['Commits will be sent to the remote origin.', 'May trigger CI/CD pipelines and production deployments.'],
      },
      {
        toolName: 'commit_changes',
        displayName: 'Create Git Commit',
        category: 'coding',
        description: 'Creates a signed git commit with modified workspace files.',
        consequences: ['Stages and commits code changes to git history.'],
      },
      {
        toolName: 'run_command',
        displayName: 'Execute System Command',
        category: 'system',
        description: 'Runs a shell command or script in the execution environment.',
        consequences: ['Executes arbitrary system commands with host environment permissions.'],
      },
      { toolName: 'terminal_execute', displayName: 'Execute Sandbox Terminal Command', category: 'coding', description: 'Runs a shell command inside an isolated sandbox workspace.', consequences: ['Executes commands with sandbox-scoped CPU, memory and time limits.'] },
      {
        toolName: 'send_webhook',
        displayName: 'Send External Webhook',
        category: 'workspace',
        description: 'Transmits a payload to an external HTTP webhook endpoint.',
        consequences: ['Sends data payload to an external third-party server.'],
      },
      {
        toolName: 'modify_credentials',
        displayName: 'Modify System Credentials',
        category: 'system',
        description: 'Updates API keys, connector tokens, or authentication secrets.',
        consequences: ['Alters sensitive security credentials for the user account.'],
      },
      {
        toolName: 'trigger_scheduled_workflow',
        displayName: 'Deploy Scheduled Agent',
        category: 'system',
        description: 'Enables an autonomous agent to execute on a recurring timer in the background.',
        consequences: ['Agent will run automatically at scheduled intervals without active prompt.'],
      },
      {
        toolName: 'device_action',
        displayName: 'Execute Device Action',
        category: 'device',
        description: 'Triggers Android device native intent (camera, storage, haptics).',
        consequences: ['Interacts with native mobile device hardware.'],
      },
      { toolName: 'browser_session_create', displayName: 'Start Browser Session', category: 'web', description: 'Launches an isolated real browser session at a public URL.', consequences: ['Creates an external browser process bound to public network access policies.'] },
      { toolName: 'browser_navigate', displayName: 'Navigate Browser Session', category: 'web', description: 'Drives an existing browser session to another public page.', consequences: ['Loads a new public page in an active browser session.'] },
      { toolName: 'browser_click', displayName: 'Click In Browser', category: 'web', description: 'Clicks an element inside an active browser session.', consequences: ['Interacts with an external website on the user’s behalf.'] },
      { toolName: 'browser_fill', displayName: 'Fill Form In Browser', category: 'web', description: 'Fills fields inside an active browser session.', consequences: ['Submits data into external web form fields.'] },
      { toolName: 'preview_start', displayName: 'Start Live Preview', category: 'coding', description: 'Installs dependencies and starts a dev server inside a sandbox.', consequences: ['Exposes a temporary preview URL for the sandboxed application.'] },
      { toolName: 'install_skill', displayName: 'Install Agent Skill', category: 'system', description: 'Installs a third-party skill package into the user catalog.', consequences: ['Adds third-party instructions and tool grants that are audited on execution.'] },
      { toolName: 'filesystem_write', displayName: 'Write Sandboxed File', category: 'filesystem', description: 'Creates or modifies files in an isolated sandbox workspace.', consequences: ['Sandbox workspace contents will change.'] },
    ];

    for (const p of privilegedTools) {
      this.registerPolicy({ ...p, riskLevel: 'privileged', requiresConfirmation: true });
    }
  }
}

export const permissionsGateway = new PermissionsGatewayService();
