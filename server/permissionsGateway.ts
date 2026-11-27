import crypto from 'crypto';
import type { DurableExecutionStore, DurableRequestContext } from './sandbox/durableStore';
import { defaultDurableStore } from './sandbox/durableStore';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from './infrastructure/durableCollectionStore';
import { defaultLiveSyncHub, type LiveSyncHub } from './realtime/liveSyncHub';

export type PolicyRiskLevel = 'read-only' | 'destructive' | 'privileged';

export type UserPolicyMode = 'default' | 'always_require_approval' | 'auto_allow_non_destructive' | 'deny';

export type SecurityAuditCategory =
  | 'tool_execution'
  | 'filesystem_change'
  | 'terminal_execution'
  | 'browser_interaction'
  | 'external_api_access'
  | 'permission_approval'
  | 'permission_rejection'
  | 'permission_revocation'
  | 'auth_failure'
  | 'admin_action'
  | 'background_task'
  | 'multi_agent'
  | 'skill_execution'
  | 'scheduler';

export interface PolicyActionDefinition {
  toolName: string;
  displayName: string;
  riskLevel: PolicyRiskLevel;
  description: string;
  consequences: string[];
  requiresConfirmation: boolean;
  category: 'web' | 'coding' | 'filesystem' | 'system' | 'workspace' | 'memory' | 'device';
}

export interface UserPermissionPolicy {
  policyId: string;
  userId: string;
  toolName: string;
  mode: UserPolicyMode;
  updatedAt: string;
  updatedBy: string;
  note?: string;
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
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed' | 'revoked';
  approvalToken?: string;
  resolvedAt?: number;
  revokedAt?: number;
  revocationReason?: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  userId: string;
  toolName: string;
  riskLevel: PolicyRiskLevel;
  category?: SecurityAuditCategory;
  status: 'allowed' | 'challenged' | 'approved' | 'rejected' | 'consumed' | 'denied' | 'revoked';
  reason: string;
  target?: string;
  challengeId?: string;
}

export class PermissionsGatewayConfigError extends Error {
  public readonly code = 'PERMISSIONS_SECRET_MISSING';
  public readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'PermissionsGatewayConfigError';
  }
}

export interface PermissionsGatewayOptions {
  /** Override secret for deterministic tests or explicit injection */
  signingSecret?: string;
  /** Enforce fail-closed behavior when secret is missing or too short */
  requireStableSecret?: boolean;
  /** Durable collection store for user policies, approval history, and atomic CAS locks */
  collectionStore?: DurableCollectionStore;
  /** LiveSyncHub for real-time approval challenge & resolution events */
  syncHub?: LiveSyncHub;
}

export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.NETLIFY === 'true' ||
    process.env.CONTEXT === 'production'
  );
}

export class PermissionsGatewayService {
  private policies = new Map<string, PolicyActionDefinition>();
  private challenges = new Map<string, PermissionChallenge>();
  private auditLog: AuditRecord[] = [];
  private readonly DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly explicitSecret?: string;
  private readonly requireStableSecret: boolean;
  private readonly collectionStore: DurableCollectionStore;
  private readonly syncHub: LiveSyncHub;
  private ephemeralDevSecret: string | null = null;

  constructor(options?: PermissionsGatewayOptions) {
    this.explicitSecret = options?.signingSecret;
    this.requireStableSecret = options?.requireStableSecret ?? false;
    this.collectionStore = options?.collectionStore ?? defaultCollectionStore;
    this.syncHub = options?.syncHub ?? defaultLiveSyncHub;
    this.registerDefaultPolicies();
  }

  /**
   * Resolves the cryptographic signing secret.
   *
   * SECURITY (Feature 02):
   * - In production (or when requireStableSecret=true), FAIL CLOSED if POLICY_GATEWAY_SECRET
   *   is absent or shorter than 32 characters. Never silently invent an ephemeral secret in production.
   * - In non-production dev/test environments, allows a process-scoped random secret so local
   *   development and unit tests remain usable without embedding a weak hardcoded key.
   */
  public resolveSigningSecret(): string {
    const candidate = (this.explicitSecret ?? process.env.POLICY_GATEWAY_SECRET ?? '').trim();
    if (candidate.length >= 32) {
      return candidate;
    }

    if (this.requireStableSecret || isProductionRuntime()) {
      throw new PermissionsGatewayConfigError(
        'POLICY_GATEWAY_SECRET (min 32 chars) is required in production. Authorization is disabled fail-closed until configured.',
      );
    }

    if (!this.ephemeralDevSecret) {
      this.ephemeralDevSecret = crypto.randomBytes(32).toString('hex');
    }
    return this.ephemeralDevSecret;
  }

  /**
   * Inspect cryptographic secret readiness without exposing secret material.
   */
  public validateSecretReadiness(): { configured: boolean; productionReady: boolean; error?: string } {
    const candidate = (this.explicitSecret ?? process.env.POLICY_GATEWAY_SECRET ?? '').trim();
    const configured = candidate.length >= 32;
    if (configured) {
      return { configured: true, productionReady: true };
    }
    return {
      configured: false,
      productionReady: false,
      error: 'POLICY_GATEWAY_SECRET must be set to a stable secret of at least 32 characters in production.',
    };
  }

  /**
   * Register or override a tool's policy classification
   */
  public registerPolicy(def: PolicyActionDefinition): void {
    this.policies.set(def.toolName, def);
  }

  /**
   * Get policy definition for a tool (defaults to privileged if unknown for safe-by-default posture)
   */
  public getPolicy(toolName: string): PolicyActionDefinition {
    const existing = this.policies.get(toolName);
    if (existing) return existing;

    // Default-deny / safe-by-default: unrecognized tools default to privileged
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

  /**
   * Retrieve all registered policy action definitions
   */
  public getAllPolicies(): PolicyActionDefinition[] {
    return Array.from(this.policies.values());
  }

  /**
   * Compute deterministic canonical HMAC hash of parameters to prevent tampering
   */
  public hashParameters(args: Record<string, any>): string {
    const secret = this.resolveSigningSecret();
    const sortedKeys = Object.keys(args || {}).sort();
    const normalized: Record<string, any> = {};
    for (const key of sortedKeys) {
      normalized[key] = args[key];
    }
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  private mapToolToAuditCategory(toolName: string): SecurityAuditCategory {
    if (toolName.startsWith('filesystem_') || toolName === 'delete_file' || toolName === 'get_file' || toolName === 'list_files') {
      return 'filesystem_change';
    }
    if (toolName.startsWith('terminal_') || toolName === 'run_command') return 'terminal_execution';
    if (toolName.startsWith('browser_')) return 'browser_interaction';
    if (toolName === 'send_webhook' || toolName === 'web_search' || toolName === 'fetch_webpage') return 'external_api_access';
    if (toolName.startsWith('skill_')) return 'skill_execution';
    if (toolName.startsWith('schedule_') || toolName === 'trigger_scheduled_workflow') return 'scheduler';
    if (toolName === 'modify_credentials' || toolName === 'drop_database') return 'admin_action';
    return 'tool_execution';
  }

  /**
   * Evaluate a requested tool invocation against policy rules (synchronous)
   */
  public evaluateAction(params: {
    toolName: string;
    args: Record<string, any>;
    userId?: string;
    target?: string;
    approvalToken?: string;
    forceConfirmation?: boolean;
    reasonOverride?: string;
    userPolicyOverride?: UserPolicyMode;
  }): {
    allowed: boolean;
    riskLevel: PolicyRiskLevel;
    requiresApproval: boolean;
    reason: string;
    challenge?: PermissionChallenge;
  } {
    if (!params.userId) {
      return {
        allowed: false,
        riskLevel: this.getPolicy(params.toolName).riskLevel,
        requiresApproval: true,
        reason: 'An authenticated user identity is required for permission checks.',
      };
    }

    // Fail closed if production secret is missing
    const policy = this.getPolicy(params.toolName);
    const userId = params.userId;

    // User-level explicit deny policy blocks action unconditionally
    if (params.userPolicyOverride === 'deny') {
      this.recordAudit({
        userId,
        toolName: params.toolName,
        riskLevel: policy.riskLevel,
        category: this.mapToolToAuditCategory(params.toolName),
        status: 'denied',
        reason: `Blocked by user permission policy for '${params.toolName}'.`,
        target: params.target,
      });
      return {
        allowed: false,
        riskLevel: policy.riskLevel,
        requiresApproval: false,
        reason: `Action '${params.toolName}' is denied by your workspace permission policy.`,
      };
    }

    const paramsHash = this.hashParameters(params.args);
    let needsConfirmation = params.forceConfirmation ?? policy.requiresConfirmation;
    if (params.userPolicyOverride === 'always_require_approval') {
      needsConfirmation = true;
    } else if (
      params.userPolicyOverride === 'auto_allow_non_destructive' &&
      policy.riskLevel !== 'destructive' &&
      !params.forceConfirmation
    ) {
      needsConfirmation = false;
    }

    // 1. Operations that do not require confirmation are allowed automatically
    if (!needsConfirmation) {
      this.recordAudit({
        userId,
        toolName: params.toolName,
        riskLevel: policy.riskLevel,
        category: this.mapToolToAuditCategory(params.toolName),
        status: 'allowed',
        reason:
          policy.riskLevel === 'read-only'
            ? 'Read-only operation allowed automatically by policy gateway'
            : 'Scoped workspace operation allowed by policy gateway',
        target: params.target,
      });

      return {
        allowed: true,
        riskLevel: policy.riskLevel,
        requiresApproval: false,
        reason: 'Operation verified and allowed.',
      };
    }

    // 2. If approvalToken is supplied, verify validity
    if (params.approvalToken) {
      const verification = this.verifyApprovalToken({
        approvalToken: params.approvalToken,
        toolName: params.toolName,
        args: params.args,
        userId,
      });

      if (verification.valid) {
        return {
          allowed: true,
          riskLevel: policy.riskLevel,
          requiresApproval: false,
          reason: 'Explicit user confirmation token verified.',
        };
      }
    }

    // 3. Otherwise, create a pending challenge requiring explicit confirmation
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
      userId,
      createdAt: now,
      expiresAt: now + this.DEFAULT_EXPIRY_MS,
      status: 'pending',
    };

    this.challenges.set(challengeId, challenge);

    const challengeReason =
      params.reasonOverride || `Explicit confirmation required for ${policy.riskLevel} operation: ${policy.displayName}`;

    this.recordAudit({
      userId,
      toolName: params.toolName,
      riskLevel: policy.riskLevel,
      category: this.mapToolToAuditCategory(params.toolName),
      status: 'challenged',
      reason: challengeReason,
      target: challenge.target,
      challengeId,
    });

    return {
      allowed: false,
      riskLevel: policy.riskLevel,
      requiresApproval: true,
      reason: params.reasonOverride || `Explicit user approval required for ${policy.riskLevel} action.`,
      challenge,
    };
  }

  /**
   * Explicitly confirm (approve or reject) a challenge
   */
  public resolveChallenge(params: {
    challengeId: string;
    confirmed: boolean;
    userId?: string;
    reason?: string;
  }): {
    success: boolean;
    status: 'approved' | 'rejected' | 'expired' | 'invalid';
    approvalToken?: string;
    expiresAt?: number;
    error?: string;
  } {
    const challenge = this.challenges.get(params.challengeId);
    if (!challenge) {
      return { success: false, status: 'invalid', error: 'Challenge not found.' };
    }

    if (!params.userId || challenge.userId !== params.userId) {
      return { success: false, status: 'invalid', error: 'Challenge not found.' };
    }
    if (challenge.status !== 'pending') {
      return { success: false, status: 'invalid', error: 'Challenge is no longer pending.' };
    }

    if (Date.now() > challenge.expiresAt) {
      challenge.status = 'expired';
      this.recordAudit({
        userId: params.userId,
        toolName: challenge.toolName,
        riskLevel: challenge.riskLevel,
        category: 'permission_rejection',
        status: 'denied',
        reason: 'Challenge confirmation expired before decision',
        challengeId: challenge.challengeId,
      });
      return { success: false, status: 'expired', error: 'Confirmation challenge has expired.' };
    }

    if (!params.confirmed) {
      challenge.status = 'rejected';
      challenge.resolvedAt = Date.now();
      this.recordAudit({
        userId: params.userId,
        toolName: challenge.toolName,
        riskLevel: challenge.riskLevel,
        category: 'permission_rejection',
        status: 'rejected',
        reason: params.reason || 'User explicitly denied authorization',
        challengeId: challenge.challengeId,
      });
      return { success: true, status: 'rejected' };
    }

    // Approved: Mint single-use, cryptographic approval token using stable secret
    const secret = this.resolveSigningSecret();
    const nonce = crypto.randomBytes(8).toString('hex');
    const tokenPayload = `${challenge.challengeId}:${challenge.parametersHash}:${challenge.userId}:${Date.now()}:${nonce}`;
    const approvalToken = `appr_${crypto.createHmac('sha256', secret).update(tokenPayload).digest('hex').substring(0, 32)}`;

    challenge.status = 'approved';
    challenge.approvalToken = approvalToken;
    challenge.resolvedAt = Date.now();

    this.recordAudit({
      userId: params.userId,
      toolName: challenge.toolName,
      riskLevel: challenge.riskLevel,
      category: 'permission_approval',
      status: 'approved',
      reason: 'User explicitly confirmed authorization',
      challengeId: challenge.challengeId,
    });

    return {
      success: true,
      status: 'approved',
      approvalToken,
      expiresAt: challenge.expiresAt,
    };
  }

  /**
   * Verify approval token and immediately burn it to prevent replay attacks
   */
  public verifyApprovalToken(params: {
    approvalToken: string;
    toolName: string;
    args: Record<string, any>;
    userId?: string;
  }): { valid: boolean; reason: string } {
    if (!params.userId) {
      return { valid: false, reason: 'An authenticated user identity is required.' };
    }
    let matchedChallenge: PermissionChallenge | null = null;

    for (const [, c] of this.challenges) {
      if (c.approvalToken === params.approvalToken) {
        matchedChallenge = c;
        break;
      }
    }

    if (!matchedChallenge) {
      return { valid: false, reason: 'Invalid or unknown approval token.' };
    }

    if (matchedChallenge.status === 'consumed') {
      return { valid: false, reason: 'Approval token has already been consumed (replay attack rejected).' };
    }

    if (matchedChallenge.status === 'revoked') {
      return { valid: false, reason: 'Approval token has been revoked by the user.' };
    }

    if (matchedChallenge.status !== 'approved') {
      return { valid: false, reason: `Challenge status is '${matchedChallenge.status}', not approved.` };
    }

    if (Date.now() > matchedChallenge.expiresAt) {
      matchedChallenge.status = 'expired';
      return { valid: false, reason: 'Approval token has expired.' };
    }

    if (matchedChallenge.toolName !== params.toolName) {
      return { valid: false, reason: 'Approval token does not match requested tool.' };
    }

    const currentHash = this.hashParameters(params.args);
    if (matchedChallenge.parametersHash !== currentHash) {
      return { valid: false, reason: 'Parameter hash mismatch. Arguments were altered after approval.' };
    }

    if (matchedChallenge.userId !== params.userId) {
      return { valid: false, reason: 'Approval token is bound to a different user identity.' };
    }

    // Burn token: single-use enforcement
    matchedChallenge.status = 'consumed';

    this.recordAudit({
      userId: matchedChallenge.userId,
      toolName: matchedChallenge.toolName,
      riskLevel: matchedChallenge.riskLevel,
      category: 'permission_approval',
      status: 'consumed',
      reason: 'Approval token successfully verified and consumed for execution',
      challengeId: matchedChallenge.challengeId,
    });

    return { valid: true, reason: 'Approval token valid and consumed.' };
  }

  /**
   * Retrieve in-memory audit logs with optional limit
   */
  public getAuditLog(limit = 100, userId?: string): AuditRecord[] {
    if (!userId) return [];
    return this.auditLog.filter((record) => record.userId === userId).slice(-limit).reverse();
  }

  // -------------------------------------------------------------------------
  // Durable Serverless-Safe Async Methods (Feature 02: Firestore + Upstash Redis)
  // -------------------------------------------------------------------------

  public async setUserPolicyDurable(
    ctx: DurableRequestContext,
    input: { toolName: string; mode: UserPolicyMode; note?: string },
  ): Promise<UserPermissionPolicy> {
    const safeTool = input.toolName.trim().slice(0, 100);
    const policyId = `pol_${safeTool.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const record: UserPermissionPolicy = {
      policyId,
      userId: ctx.userId,
      toolName: safeTool,
      mode: input.mode,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.userId,
      note: input.note ? input.note.slice(0, 300) : undefined,
    };
    await this.collectionStore.put(ctx, 'permission_policies', policyId, record);
    return record;
  }

  public async getUserPolicyDurable(
    ctx: DurableRequestContext,
    toolName: string,
  ): Promise<UserPermissionPolicy | null> {
    const policyId = `pol_${toolName.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
    return this.collectionStore.get<UserPermissionPolicy>(ctx, 'permission_policies', policyId);
  }

  public async listUserPoliciesDurable(ctx: DurableRequestContext): Promise<UserPermissionPolicy[]> {
    return this.collectionStore.list<UserPermissionPolicy>(ctx, 'permission_policies', 100);
  }

  public async listApprovalHistoryDurable(
    ctx: DurableRequestContext,
    limit = 50,
  ): Promise<PermissionChallenge[]> {
    const all = await this.collectionStore.list<PermissionChallenge>(ctx, 'approvals', limit);
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
  }

  public async recordSecurityAuditDurable(
    ctx: DurableRequestContext,
    params: {
      action: string;
      category: SecurityAuditCategory;
      resourceId: string;
      status: 'allowed' | 'denied' | 'challenged' | 'succeeded' | 'failed';
      details?: Record<string, unknown>;
    },
    store: DurableExecutionStore = defaultDurableStore,
  ): Promise<void> {
    await store.appendAudit(ctx, {
      auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      userId: ctx.userId,
      action: params.action,
      resourceType: 'permission',
      resourceId: params.resourceId,
      status: params.status,
      details: { category: params.category, ...(params.details || {}) },
      timestamp: new Date().toISOString(),
    });
  }

  public async listAuditDurable(
    ctx: DurableRequestContext,
    limit = 100,
    store: DurableExecutionStore = defaultDurableStore,
  ) {
    return store.listAudit(ctx, limit);
  }

  public async evaluateActionDurable(
    params: {
      toolName: string;
      args: Record<string, any>;
      userId?: string;
      target?: string;
      approvalToken?: string;
      forceConfirmation?: boolean;
      reasonOverride?: string;
    },
    ctx?: DurableRequestContext,
    store: DurableExecutionStore = defaultDurableStore,
  ): Promise<{
    allowed: boolean;
    riskLevel: PolicyRiskLevel;
    requiresApproval: boolean;
    reason: string;
    challenge?: PermissionChallenge;
  }> {
    if (!params.userId) {
      return {
        allowed: false,
        riskLevel: this.getPolicy(params.toolName).riskLevel,
        requiresApproval: true,
        reason: 'An authenticated user identity is required for permission checks.',
      };
    }

    // Validate signing secret fail-closed before evaluating any authorization
    this.resolveSigningSecret();

    const reqCtx: DurableRequestContext = ctx || { userId: params.userId };
    const policy = this.getPolicy(params.toolName);
    const userPolicy = await this.getUserPolicyDurable(reqCtx, params.toolName);

    if (userPolicy?.mode === 'deny') {
      await this.recordSecurityAuditDurable(
        reqCtx,
        {
          action: params.toolName,
          category: this.mapToolToAuditCategory(params.toolName),
          resourceId: params.target || params.toolName,
          status: 'denied',
          details: { reason: 'Blocked by user permission policy' },
        },
        store,
      );
      return {
        allowed: false,
        riskLevel: policy.riskLevel,
        requiresApproval: false,
        reason: `Action '${params.toolName}' is denied by your workspace permission policy.`,
      };
    }

    let needsConfirmation = params.forceConfirmation ?? policy.requiresConfirmation;
    if (userPolicy?.mode === 'always_require_approval') {
      needsConfirmation = true;
    } else if (
      userPolicy?.mode === 'auto_allow_non_destructive' &&
      policy.riskLevel !== 'destructive' &&
      !params.forceConfirmation
    ) {
      needsConfirmation = false;
    }

    if (!needsConfirmation) {
      const allowedRes = this.evaluateAction({
        ...params,
        userPolicyOverride: userPolicy?.mode,
      });
      await this.recordSecurityAuditDurable(
        reqCtx,
        {
          action: params.toolName,
          category: this.mapToolToAuditCategory(params.toolName),
          resourceId: params.target || params.toolName,
          status: 'allowed',
          details: { riskLevel: policy.riskLevel, userPolicy: userPolicy?.mode || 'default' },
        },
        store,
      );
      return allowedRes;
    }

    // Check durable store first if an approvalToken was provided (survives serverless restarts)
    if (params.approvalToken) {
      const verified = await this.verifyApprovalTokenDurable(
        {
          approvalToken: params.approvalToken,
          toolName: params.toolName,
          args: params.args,
          userId: params.userId,
        },
        reqCtx,
        store,
      );
      if (verified.valid) {
        return {
          allowed: true,
          riskLevel: policy.riskLevel,
          requiresApproval: false,
          reason: 'Explicit user confirmation token verified.',
        };
      }
    }

    const result = this.evaluateAction({
      ...params,
      approvalToken: undefined, // Already checked durably above
      forceConfirmation: true,
      userPolicyOverride: userPolicy?.mode,
    });

    if (result.challenge) {
      await store.saveApproval(reqCtx, result.challenge);
      await this.collectionStore.put(reqCtx, 'approvals', result.challenge.challengeId, result.challenge, 86400);
      await this.recordSecurityAuditDurable(
        reqCtx,
        {
          action: params.toolName,
          category: this.mapToolToAuditCategory(params.toolName),
          resourceId: result.challenge.challengeId,
          status: 'challenged',
          details: {
            riskLevel: policy.riskLevel,
            target: result.challenge.target,
            reason: result.reason,
          },
        },
        store,
      );

      await this.syncHub.publish(reqCtx, {
        type: 'approval:required',
        title: `Approval Required: ${result.challenge.displayName}`,
        message: result.reason,
        resourceId: result.challenge.challengeId,
        challengeId: result.challenge.challengeId,
        severity: 'warning',
        notifyUser: true,
        data: {
          toolName: result.challenge.toolName,
          riskLevel: result.challenge.riskLevel,
          target: result.challenge.target || null,
          expiresAt: result.challenge.expiresAt,
        },
      });

      void import('./webhooks/webhookEngine')
        .then((m) =>
          m.defaultWebhookEngine.dispatchOutboundEvent(reqCtx, 'approval.required', {
            challengeId: result.challenge!.challengeId,
            toolName: result.challenge!.toolName,
            displayName: result.challenge!.displayName,
            riskLevel: result.challenge!.riskLevel,
            reason: result.reason,
          }),
        )
        .catch(() => {});
    }

    return result;
  }

  public async resolveChallengeDurable(
    params: {
      challengeId: string;
      confirmed: boolean;
      userId?: string;
      reason?: string;
    },
    ctx?: DurableRequestContext,
    store: DurableExecutionStore = defaultDurableStore,
  ): Promise<{
    success: boolean;
    status: 'approved' | 'rejected' | 'expired' | 'invalid';
    approvalToken?: string;
    expiresAt?: number;
    error?: string;
  }> {
    if (!params.userId) {
      return { success: false, status: 'invalid', error: 'Challenge not found.' };
    }
    this.resolveSigningSecret();
    const reqCtx: DurableRequestContext = ctx || { userId: params.userId };

    // Acquire per-challenge atomic lock to prevent concurrent double-resolution
    const lockOwner = `resolve_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const lock = await this.collectionStore.tryAcquireLease(`appr_lock:${params.challengeId}`, lockOwner, 5000);
    if (!lock.acquired) {
      return { success: false, status: 'invalid', error: 'Challenge is currently being processed.' };
    }

    try {
      // Hydrate from durable store if cold-started serverless instance doesn't have it in memory
      const persisted =
        (await store.getApproval(reqCtx, params.challengeId)) ||
        (await this.collectionStore.get<PermissionChallenge>(reqCtx, 'approvals', params.challengeId));
      if (persisted) {
        this.challenges.set(persisted.challengeId, persisted);
      }

      const resolution = this.resolveChallenge(params);
      const updated = this.challenges.get(params.challengeId);
      if (updated) {
        await store.saveApproval(reqCtx, updated);
        await this.collectionStore.put(reqCtx, 'approvals', updated.challengeId, updated, 86400);
        await this.recordSecurityAuditDurable(
          reqCtx,
          {
            action: updated.toolName,
            category: resolution.status === 'approved' ? 'permission_approval' : 'permission_rejection',
            resourceId: updated.challengeId,
            status: resolution.status === 'approved' ? 'allowed' : 'denied',
            details: {
              resolutionStatus: resolution.status,
              approvedBy: params.userId,
              resolvedAt: updated.resolvedAt,
              reason: params.reason || resolution.error || '',
            },
          },
          store,
        );
        await this.syncHub.publish(reqCtx, {
          type: 'approval:resolved',
          title: `Approval ${resolution.status}: ${updated.displayName}`,
          message:
            resolution.status === 'approved'
              ? `Approved action '${updated.toolName}'.`
              : `Permission challenge '${updated.toolName}' was ${resolution.status}.`,
          resourceId: updated.challengeId,
          challengeId: updated.challengeId,
          severity: resolution.status === 'approved' ? 'success' : 'info',
          notifyUser: false,
          data: { status: resolution.status, toolName: updated.toolName },
        });
      }
      return resolution;
    } finally {
      await this.collectionStore.releaseLease(`appr_lock:${params.challengeId}`, lockOwner);
    }
  }

  /**
   * Revoke an approved (not yet consumed) permission challenge immediately so its token cannot be used.
   */
  public async revokeChallengeDurable(
    params: {
      challengeId: string;
      userId: string;
      reason?: string;
    },
    ctx?: DurableRequestContext,
    store: DurableExecutionStore = defaultDurableStore,
  ): Promise<{ success: boolean; status: string; error?: string }> {
    const reqCtx: DurableRequestContext = ctx || { userId: params.userId };
    const persisted =
      this.challenges.get(params.challengeId) ||
      (await store.getApproval(reqCtx, params.challengeId)) ||
      (await this.collectionStore.get<PermissionChallenge>(reqCtx, 'approvals', params.challengeId));

    if (!persisted || persisted.userId !== params.userId) {
      return { success: false, status: 'not_found', error: 'Approval challenge not found.' };
    }
    if (persisted.status === 'consumed' || persisted.status === 'rejected' || persisted.status === 'expired') {
      return { success: false, status: persisted.status, error: `Cannot revoke challenge in terminal status '${persisted.status}'.` };
    }

    persisted.status = 'revoked';
    persisted.revokedAt = Date.now();
    persisted.revocationReason = params.reason || 'Revoked by user';
    this.challenges.set(persisted.challengeId, persisted);
    await store.saveApproval(reqCtx, persisted);
    await this.collectionStore.put(reqCtx, 'approvals', persisted.challengeId, persisted, 86400);

    await this.recordSecurityAuditDurable(
      reqCtx,
      {
        action: persisted.toolName,
        category: 'permission_revocation',
        resourceId: persisted.challengeId,
        status: 'denied',
        details: { revokedBy: params.userId, reason: persisted.revocationReason },
      },
      store,
    );

    return { success: true, status: 'revoked' };
  }

  public async verifyApprovalTokenDurable(
    params: {
      approvalToken: string;
      toolName: string;
      args: Record<string, any>;
      userId?: string;
    },
    ctx?: DurableRequestContext,
    store: DurableExecutionStore = defaultDurableStore,
  ): Promise<{ valid: boolean; reason: string }> {
    if (!params.userId) {
      return { valid: false, reason: 'An authenticated user identity is required.' };
    }
    this.resolveSigningSecret();
    const reqCtx: DurableRequestContext = ctx || { userId: params.userId };

    // Acquire atomic token-consumption lease so concurrent requests cannot double-spend a single-use token
    const lockOwner = `consume_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const lock = await this.collectionStore.tryAcquireLease(`tok_lock:${params.approvalToken}`, lockOwner, 5000);
    if (!lock.acquired) {
      return { valid: false, reason: 'Approval token is already being verified by another request.' };
    }

    try {
      // Always refresh from durable store to detect revocation or consumption from another serverless instance
      const persisted = await store.findApprovalByToken(reqCtx, params.approvalToken);
      if (persisted) {
        this.challenges.set(persisted.challengeId, persisted);
      }

      const verification = this.verifyApprovalToken(params);
      for (const c of this.challenges.values()) {
        if (c.approvalToken === params.approvalToken) {
          await store.saveApproval(reqCtx, c);
          await this.collectionStore.put(reqCtx, 'approvals', c.challengeId, c, 86400);
          break;
        }
      }

      if (!verification.valid) {
        await this.recordSecurityAuditDurable(
          reqCtx,
          {
            action: params.toolName,
            category: 'auth_failure',
            resourceId: params.toolName,
            status: 'denied',
            details: { reason: verification.reason },
          },
          store,
        );
      }

      return verification;
    } finally {
      await this.collectionStore.releaseLease(`tok_lock:${params.approvalToken}`, lockOwner);
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

  private recordAudit(record: Omit<AuditRecord, 'id' | 'timestamp'>) {
    this.auditLog.push({
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...record,
    });

    if (this.auditLog.length > 500) {
      this.auditLog = this.auditLog.slice(-400);
    }
  }

  private registerDefaultPolicies() {
    // 1. Read-Only Operations (Allowed automatically)
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
        consequences: ['Reads local repository state.'],
      },
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
    ];

    for (const r of readOnlyTools) {
      this.registerPolicy({
        ...r,
        riskLevel: 'read-only',
        requiresConfirmation: false,
      });
    }

    // 2. Destructive Operations (Requires explicit confirmation)
    const destructiveTools: Array<Omit<PolicyActionDefinition, 'riskLevel' | 'requiresConfirmation'>> = [
      {
        toolName: 'delete_file',
        displayName: 'Delete File',
        category: 'filesystem',
        description: 'Permanently deletes a file from the repository or disk.',
        consequences: [
          'The specified file will be permanently removed.',
          'Uncommitted changes in this file cannot be recovered.',
        ],
      },
      {
        toolName: 'drop_database',
        displayName: 'Drop or Truncate Database',
        category: 'system',
        description: 'Purges or resets database records and collections.',
        consequences: [
          'All matching records will be permanently deleted.',
          'Database state cannot be restored without a prior backup.',
        ],
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
    ];

    for (const d of destructiveTools) {
      this.registerPolicy({
        ...d,
        riskLevel: 'destructive',
        requiresConfirmation: true,
      });
    }

    // 3. Privileged Operations (Requires explicit confirmation)
    const privilegedTools: Array<Omit<PolicyActionDefinition, 'riskLevel' | 'requiresConfirmation'>> = [
      {
        toolName: 'git_push',
        displayName: 'Push to Remote Repository',
        category: 'coding',
        description: 'Pushes local commits to the remote GitHub repository branch.',
        consequences: [
          'Commits will be sent to the remote origin.',
          'May trigger CI/CD pipelines and production deployments.',
        ],
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
        consequences: ['Executes arbitrary system commands with sandbox environment permissions.'],
      },
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
      {
        toolName: 'skill_install_untrusted',
        displayName: 'Install Third-Party Skill',
        category: 'system',
        description: 'Installs a user-supplied or third-party skill manifest into the workspace.',
        consequences: ['Adds a new untrusted skill that may request tools or sandbox execution.'],
      },
      {
        toolName: 'skill_execute_sandbox',
        displayName: 'Execute Code-Bearing Skill in Sandbox',
        category: 'coding',
        description: 'Runs a code-bearing skill inside an isolated sandbox workspace.',
        consequences: ['Executes untrusted skill code strictly inside an isolated sandbox container.'],
      },
    ];

    for (const p of privilegedTools) {
      this.registerPolicy({
        ...p,
        riskLevel: 'privileged',
        requiresConfirmation: true,
      });
    }

    // 4. Feature 06 — Sandboxed Coding & Real Browser Execution Tools (20 tools)
    const sandboxAndBrowserPolicies: PolicyActionDefinition[] = [
      {
        toolName: 'sandbox_status',
        displayName: 'Inspect Sandbox Status',
        category: 'coding',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Inspects status, limits, and expiration of an owned isolated sandbox.',
        consequences: ['Reads isolated sandbox metadata.'],
      },
      {
        toolName: 'filesystem_list',
        displayName: 'List Sandbox Files',
        category: 'filesystem',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Lists files and directories within the authorized sandbox workspace root.',
        consequences: ['Inspects workspace directory entries.'],
      },
      {
        toolName: 'filesystem_read',
        displayName: 'Read Sandbox File',
        category: 'filesystem',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Reads a file inside the authorized sandbox workspace.',
        consequences: ['Reads sandbox file contents.'],
      },
      {
        toolName: 'filesystem_search',
        displayName: 'Search Sandbox Files',
        category: 'filesystem',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Searches file contents within the authorized sandbox workspace.',
        consequences: ['Searches workspace text files.'],
      },
      {
        toolName: 'preview_status',
        displayName: 'Check Preview Server Status',
        category: 'coding',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Checks live readiness status and preview URL of a sandbox dev server.',
        consequences: ['Probes the sandbox preview endpoint.'],
      },
      {
        toolName: 'browser_session_create',
        displayName: 'Create Isolated Browser Session',
        category: 'web',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Launches an isolated remote browser session with clean cookies and storage.',
        consequences: ['Allocates a temporary isolated browser session.'],
      },
      {
        toolName: 'browser_navigate',
        displayName: 'Navigate Browser Session',
        category: 'web',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Navigates the isolated browser session to an authorized public URL.',
        consequences: ['Loads a public webpage inside the isolated browser.'],
      },
      {
        toolName: 'browser_inspect',
        displayName: 'Inspect Webpage DOM',
        category: 'web',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Reads page title, visible text, DOM elements, and console errors.',
        consequences: ['Inspects currently loaded page state.'],
      },
      {
        toolName: 'browser_screenshot',
        displayName: 'Capture Browser Screenshot',
        category: 'web',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Captures a real visual screenshot of the isolated browser viewport.',
        consequences: ['Produces a PNG/JPEG image of the current page.'],
      },
      {
        toolName: 'browser_session_close',
        displayName: 'Close Browser Session',
        category: 'web',
        riskLevel: 'read-only',
        requiresConfirmation: false,
        description: 'Closes an isolated browser session and discards its temporary state.',
        consequences: ['Releases browser compute and session resources.'],
      },
      {
        toolName: 'sandbox_create',
        displayName: 'Create Isolated Sandbox',
        category: 'coding',
        riskLevel: 'privileged',
        requiresConfirmation: false,
        description: 'Provisions an isolated container/microVM workspace for the authenticated project.',
        consequences: ['Allocates an isolated sandbox subject to CPU, memory, disk, and timeout limits.'],
      },
      {
        toolName: 'filesystem_write',
        displayName: 'Write Sandbox File',
        category: 'filesystem',
        riskLevel: 'privileged',
        requiresConfirmation: false,
        description: 'Creates or updates a file strictly within the authorized sandbox workspace root.',
        consequences: ['Modifies files inside the isolated sandbox workspace.'],
      },
      {
        toolName: 'terminal_cancel',
        displayName: 'Cancel Terminal Command',
        category: 'coding',
        riskLevel: 'privileged',
        requiresConfirmation: false,
        description: 'Sends termination signal to a running terminal execution inside the sandbox.',
        consequences: ['Terminates an active sandbox command process.'],
      },
      {
        toolName: 'preview_start',
        displayName: 'Start Sandbox Dev Preview',
        category: 'coding',
        riskLevel: 'privileged',
        requiresConfirmation: false,
        description: 'Starts a development server inside the isolated sandbox and verifies preview readiness.',
        consequences: ['Starts a dev server process inside the sandbox and exposes a preview URL.'],
      },
      {
        toolName: 'sandbox_cleanup',
        displayName: 'Clean Up Sandbox',
        category: 'coding',
        riskLevel: 'privileged',
        requiresConfirmation: false,
        description: 'Stops running processes and destroys the isolated sandbox environment.',
        consequences: ['Releases sandbox resources and ends active processes.'],
      },
      {
        toolName: 'browser_click',
        displayName: 'Click Browser Element',
        category: 'web',
        riskLevel: 'privileged',
        requiresConfirmation: false,
        description: 'Clicks an element inside the isolated browser session (sensitive clicks require approval).',
        consequences: ['Triggers interactive UI behavior on the loaded webpage.'],
      },
      {
        toolName: 'filesystem_delete',
        displayName: 'Delete Sandbox File',
        category: 'filesystem',
        riskLevel: 'destructive',
        requiresConfirmation: true,
        description: 'Deletes a file or directory inside the authorized sandbox workspace.',
        consequences: ['Removes the targeted file or directory from the sandbox workspace.'],
      },
      {
        toolName: 'terminal_execute',
        displayName: 'Execute Sandbox Terminal Command',
        category: 'coding',
        riskLevel: 'privileged',
        requiresConfirmation: true,
        description: 'Executes a shell command inside the isolated sandbox environment.',
        consequences: ['Runs a process inside the isolated workspace; installs and destructive commands require approval.'],
      },
      {
        toolName: 'terminal_stream',
        displayName: 'Stream Sandbox Terminal Command',
        category: 'coding',
        riskLevel: 'privileged',
        requiresConfirmation: true,
        description: 'Executes and streams live stdout/stderr output from an isolated sandbox command.',
        consequences: ['Runs a streaming process inside the isolated workspace.'],
      },
      {
        toolName: 'browser_fill',
        displayName: 'Fill Browser Form Input',
        category: 'web',
        riskLevel: 'privileged',
        requiresConfirmation: true,
        description: 'Types input into a webpage form field inside an isolated browser session.',
        consequences: ['Modifies external webpage form state and requires explicit confirmation.'],
      },
    ];

    for (const def of sandboxAndBrowserPolicies) {
      this.registerPolicy(def);
    }
  }
}

export const permissionsGateway = new PermissionsGatewayService();
