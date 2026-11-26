/**
 * Permissions gateway (Feature 02 upgrade).
 *
 * Same public API as the original in-memory gateway, now backed by the durable
 * permission store: challenges, single-use approval tokens and audit records
 * persist in Firestore and survive serverless restarts. Token consumption is
 * transactional (replay of an approval token is rejected). In production a
 * missing POLICY_GATEWAY_SECRET fails closed: sensitive actions are denied
 * with PERMISSIONS_UNSIGNABLE and NO random secret is generated.
 */

import crypto from 'crypto';
import {
  resolvePermissionStore, hashApprovalToken,
  type PermissionStore, type StoredChallenge, type StoredAuditRecord, type UserPolicyOverride,
} from './security/permissionsStore';

export type PolicyRiskLevel = 'read-only' | 'sensitive' | 'moderate' | 'unsafe' | 'destructive' | 'privileged';

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
  parametersSummary: Record<string, unknown>;
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
  riskLevel: string;
  status: 'allowed' | 'challenged' | 'approved' | 'rejected' | 'consumed' | 'denied';
  reason: string;
  target?: string;
  challengeId?: string;
  category?: StoredAuditRecord['category'];
  requestId?: string;
}

const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;
const LOCAL_DEV_SECRET = process.env.NODE_ENV === 'production'
  ? null
  : crypto.randomBytes(32).toString('hex');

function resolveSigningSecret(): string | null {
  const configured = process.env.POLICY_GATEWAY_SECRET || '';
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === 'production') return null; // fail closed, never replace silently
  return LOCAL_DEV_SECRET; // dev/test only; per-process, never used to sign prod approvals
}

export class PermissionsGatewayService {
  private policies = new Map<string, PolicyActionDefinition>();
  private storePromise: Promise<PermissionStore> | null = null;

  private store(): Promise<PermissionStore> {
    if (!this.storePromise) this.storePromise = resolvePermissionStore();
    return this.storePromise;
  }

  /** 'firestore' when durable storage is active, 'memory' otherwise. */
  public async storageMode(): Promise<'firestore' | 'memory'> {
    const store = await this.store();
    return store.durable ? 'firestore' : 'memory';
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

  public hashParameters(args: Record<string, unknown>): string {
    const sortedKeys = Object.keys(args || {}).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of sortedKeys) normalized[key] = (args as Record<string, unknown>)[key];
    return crypto.createHmac('sha256', resolveSigningSecret() || 'unsignable').update(JSON.stringify(normalized)).digest('hex');
  }

  /* ---------------- evaluateAction ---------------- */

  public async evaluateAction(params: {
    toolName: string;
    args: Record<string, unknown>;
    userId?: string;
    target?: string;
    approvalToken?: string;
    workspaceId?: string;
    requestId?: string;
  }): Promise<{
    allowed: boolean;
    riskLevel: PolicyRiskLevel;
    requiresApproval: boolean;
    reason: string;
    challenge?: PermissionChallenge;
  }> {
    const policy = this.getPolicy(params.toolName);
    const userId = params.userId;
    if (!userId) {
      return { allowed: false, riskLevel: policy.riskLevel, requiresApproval: true, reason: 'An authenticated user identity is required for permission checks.' };
    }

    // User-specific policy override (deny wins over allow).
    const overrides = await (await this.store()).getUserPolicies(userId);
    const override = overrides.find((o) => o.toolName === params.toolName);
    if (override && override.effect === 'deny') {
      await this.audit({ userId, toolName: params.toolName, riskLevel: policy.riskLevel, status: 'denied', reason: 'Deny policy override set by user', target: params.target });
      return { allowed: false, riskLevel: policy.riskLevel, requiresApproval: false, reason: 'This tool is disabled by your permission settings.' };
    }

    const userAllow = override && override.effect === 'allow' && policy.riskLevel === 'sensitive';

    if (policy.riskLevel === 'read-only' && !policy.requiresConfirmation) {
      await this.audit({ userId, toolName: params.toolName, riskLevel: 'read-only', status: 'allowed', reason: 'Read-only operation allowed automatically by policy gateway', target: params.target, category: 'tool_execution' });
      return { allowed: true, riskLevel: 'read-only', requiresApproval: false, reason: 'Read-only operation verified and allowed.' };
    }

    // Production fail-closed: sensitive/privileged/destructive actions cannot be
    // authorized without the stable signing secret.
    if (resolveSigningSecret() === null) {
      await this.audit({ userId, toolName: params.toolName, riskLevel: policy.riskLevel, status: 'denied', reason: 'POLICY_GATEWAY_SECRET missing in production; gateway fails closed', target: params.target, category: 'auth_failure' });
      return { allowed: false, riskLevel: policy.riskLevel, requiresApproval: true, reason: 'Authorization is unavailable: the deployment policy signing secret is not configured. Sensitive actions are denied.' };
    }

    if (params.approvalToken) {
      const verification = await this.verifyApprovalToken({
        approvalToken: params.approvalToken,
        toolName: params.toolName,
        args: params.args,
        userId,
      });
      if (verification.valid) {
        return { allowed: true, riskLevel: policy.riskLevel, requiresApproval: false, reason: 'Explicit user confirmation token verified.' };
      }
      return {
        allowed: false,
        riskLevel: policy.riskLevel,
        requiresApproval: true,
        reason: verification.reason,
      };
    }

    if (userAllow) {
      await this.audit({ userId, toolName: params.toolName, riskLevel: policy.riskLevel, status: 'allowed', reason: 'Allowed by user policy override', target: params.target, category: 'permission_approved' });
      return { allowed: true, riskLevel: policy.riskLevel, requiresApproval: false, reason: 'Allowed by your saved permission policy for this tool.' };
    }

    const store = await this.store();
    const challengeId = 'chg_' + crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const stored: StoredChallenge = {
      challengeId,
      toolName: params.toolName,
      displayName: policy.displayName,
      riskLevel: policy.riskLevel,
      target: params.target || String(params.args.path || params.args.url || params.args.command || params.args.target || ''),
      parametersHash: this.hashParameters(params.args),
      parametersSummary: this.sanitizeArgsForSummary(params.args),
      consequences: policy.consequences,
      userId,
      createdAt: now,
      expiresAt: now + DEFAULT_EXPIRY_MS,
      status: 'pending',
      workspaceId: params.workspaceId,
    };
    await store.putChallenge(stored);
    await this.audit({ userId, toolName: params.toolName, riskLevel: policy.riskLevel, status: 'challenged', reason: `Explicit confirmation required for ${policy.riskLevel} operation: ${policy.displayName}`, target: stored.target, challengeId, category: 'tool_execution', requestId: params.requestId });

    return {
      allowed: false,
      riskLevel: policy.riskLevel,
      requiresApproval: true,
      reason: `Explicit user approval required for ${policy.riskLevel} action.`,
      challenge: this.toPublicChallenge(stored),
    };
  }

  /* ---------------- challenge resolution ---------------- */

  public async resolveChallenge(params: {
    challengeId: string;
    confirmed: boolean;
    userId?: string;
    reason?: string;
  }): Promise<{ success: boolean; status: 'approved' | 'rejected' | 'expired' | 'invalid'; approvalToken?: string; expiresAt?: number; error?: string }> {
    if (!params.userId) return { success: false, status: 'invalid', error: 'An authenticated user is required.' };
    if (resolveSigningSecret() === null) return { success: false, status: 'invalid', error: 'Authorization is unavailable: signing secret is not configured.' };
    const store = await this.store();
    const challenge = await store.getChallenge(params.challengeId, params.userId);
    if (!challenge || challenge.userId !== params.userId || challenge.status !== 'pending') {
      return { success: false, status: 'invalid', error: 'Challenge not found or no longer pending.' };
    }
    if (Date.now() > challenge.expiresAt) {
      await store.transitionChallenge(params.challengeId, ['pending'], (c) => ({ ...c, status: 'expired' }));
      await this.audit({ userId: params.userId, toolName: challenge.toolName, riskLevel: challenge.riskLevel, status: 'denied', reason: 'Challenge confirmation expired before decision', challengeId: params.challengeId, category: 'permission_rejected' });
      return { success: false, status: 'expired', error: 'Confirmation challenge has expired.' };
    }

    if (!params.confirmed) {
      await store.transitionChallenge(params.challengeId, ['pending'], (c) => ({ ...c, status: 'rejected', resolvedAt: Date.now() }));
      await this.audit({ userId: params.userId, toolName: challenge.toolName, riskLevel: challenge.riskLevel, status: 'rejected', reason: params.reason || 'User explicitly denied authorization', challengeId: params.challengeId, category: 'permission_rejected' });
      return { success: true, status: 'rejected' };
    }

    // Mint single-use token bound to challenge + params + user + expiry.
    const payload = [challenge.challengeId, challenge.parametersHash, challenge.userId, String(challenge.expiresAt)].join('.');
    const secret = resolveSigningSecret() as string;
    const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const approvalToken = 'appr1.' + Buffer.from(payload).toString('base64url') + '.' + mac;

    const updated = await store.transitionChallenge(params.challengeId, ['pending'], (c) => ({
      ...c,
      status: 'approved',
      approvalToken,
      approvalTokenHash: hashApprovalToken(approvalToken),
      resolvedAt: Date.now(),
    }));
    if (!updated) return { success: false, status: 'invalid', error: 'Challenge is no longer pending.' };

    await this.audit({ userId: params.userId, toolName: challenge.toolName, riskLevel: challenge.riskLevel, status: 'approved', reason: 'User explicitly confirmed authorization', challengeId: params.challengeId, category: 'permission_approved' });
    return { success: true, status: 'approved', approvalToken, expiresAt: challenge.expiresAt };
  }

  /* ---------------- token verification (single-use, transactional) ---------------- */

  public async verifyApprovalToken(params: {
    approvalToken: string;
    toolName: string;
    args: Record<string, unknown>;
    userId?: string;
  }): Promise<{ valid: boolean; reason: string }> {
    const fail = (reason: string) => ({ valid: false, reason });
    if (!params.userId) return fail('An authenticated user identity is required.');
    const secret = resolveSigningSecret();
    if (secret === null) return fail('Authorization is unavailable: signing secret is not configured.');

    const token = String(params.approvalToken || '');
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'appr1') return fail('Invalid or unknown approval token.');
    let payload: string;
    try {
      payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    } catch {
      return fail('Invalid or unknown approval token.');
    }
    const expectedMac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(parts[2]);
    const b = Buffer.from(expectedMac);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('Approval token signature verification failed.');

    const [challengeId, parametersHash, tokenUserId, expiresAtRaw] = payload.split('.');
    if (tokenUserId !== params.userId) return fail('Approval token is bound to a different user identity.');
    if (Number(expiresAtRaw) < Date.now()) return fail('Approval token has expired.');

    const store = await this.store();
    const challenge = await store.getChallenge(challengeId, params.userId);
    if (!challenge) return fail('Invalid or unknown approval token.');
    if (challenge.approvalToken !== token) return fail('Approval token does not match its challenge record.');
    if (challenge.status === 'consumed') return fail('Approval token has already been consumed (replay attack rejected).');
    if (challenge.status !== 'approved') return fail(`Challenge status is '${challenge.status}', not approved.`);
    if (challenge.toolName !== params.toolName) return fail('Approval token does not match requested tool.');

    const currentHash = this.hashParameters(params.args);
    if (parametersHash !== currentHash || parametersHash !== challenge.parametersHash) {
      return fail('Parameter hash mismatch. Arguments were altered after approval.');
    }

    // Atomic single-use consumption.
    const consumed = await store.transitionChallenge(challengeId, ['approved'], (c) => ({
      ...c,
      status: 'consumed',
      consumedAt: Date.now(),
    }));
    if (!consumed) return fail('Approval token has already been consumed (replay attack rejected).');

    await this.audit({ userId: params.userId, toolName: params.toolName, riskLevel: challenge.riskLevel, status: 'consumed', reason: 'Approval token verified and consumed for execution', challengeId, category: 'tool_execution' });
    return { valid: true, reason: 'Approval token valid and consumed.' };
  }

  /* ---------------- audit ---------------- */

  public async getAuditLog(limit = 100, userId?: string): Promise<AuditRecord[]> {
    if (!userId) return [];
    const records = await (await this.store()).listAudit(userId, limit);
    return records.map((r) => ({
      id: r.id, timestamp: r.timestamp, userId: r.userId, toolName: r.toolName,
      riskLevel: r.riskLevel, status: r.status, reason: r.reason, target: r.target,
      challengeId: r.challengeId, category: r.category, requestId: r.requestId,
    }));
  }

  /** Generalized audit event API for the other features (tools, fs, terminal, browser, APIs, admin). */
  public async recordAuditEvent(event: {
    userId: string;
    category: StoredAuditRecord['category'];
    toolName?: string;
    status?: StoredAuditRecord['status'];
    reason: string;
    target?: string
    ; challengeId?: string;
    riskLevel?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.audit({
      userId: event.userId,
      toolName: event.toolName || event.category,
      riskLevel: event.riskLevel || 'n/a',
      status: event.status || 'allowed',
      reason: event.reason,
      target: event.target,
      challengeId: event.challengeId,
      category: event.category,
      requestId: event.requestId,
      metadata: event.metadata,
    });
  }

  public async setUserPolicy(override: { userId: string; toolName: string; effect: 'allow' | 'deny' }): Promise<void> {
    const o: UserPolicyOverride = { ...override, updatedAt: new Date().toISOString() };
    await (await this.store()).setUserPolicy(o);
    await this.audit({ userId: override.userId, toolName: override.toolName, riskLevel: 'n/a', status: 'allowed', reason: `User policy override set to ${override.effect}`, category: 'admin_action' });
  }

  /* ---------------- legacy synchronous surface (dev/test compat) ---------------- */

  /** @deprecated synchronous monitoring view of recent audit entries (memory store only). */
  public getRecentAudit(limit = 100): AuditRecord[] {
    return []; // durable audit is async-only; no process-local log is authoritative.
  }

  private sanitizeArgsForSummary(args: Record<string, unknown>): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args || {})) {
      if (/key|secret|token|password|auth/i.test(k)) summary[k] = '[REDACTED]';
      else if (typeof v === 'string') summary[k] = v.length > 200 ? v.slice(0, 197) + '...' : v;
      else if (typeof v === 'number' || typeof v === 'boolean') summary[k] = v;
      else if (v && typeof v === 'object') summary[k] = Array.isArray(v) ? '[Array (' + (v as unknown[]).length + ')]' : '[Object]';
    }
    return summary;
  }

  private toPublicChallenge(c: StoredChallenge): PermissionChallenge {
    return {
      challengeId: c.challengeId, toolName: c.toolName, displayName: c.displayName,
      riskLevel: c.riskLevel as PolicyRiskLevel, target: c.target, parametersHash: c.parametersHash,
      parametersSummary: c.parametersSummary, consequences: c.consequences, userId: c.userId,
      createdAt: c.createdAt, expiresAt: c.expiresAt, status: c.status,
    };
  }

  private async audit(rec: Omit<StoredAuditRecord, 'id' | 'timestamp'>): Promise<void> {
    try {
      const store = await this.store();
      await store.appendAudit({
        id: 'aud_' + crypto.randomBytes(10).toString('hex'),
        timestamp: new Date().toISOString(),
        ...rec,
      });
    } catch { /* audit must never break the request path */ }
  }

  /* ---------------- default policies (unchanged catalog) ---------------- */

  private registerDefaultPolicies() {
    const readOnlyTools: Array<{ toolName: string; displayName: string; category: PolicyActionDefinition['category']; description: string; consequences: string[] }> = [
      { toolName: 'web_search', displayName: 'Web Search', category: 'web', description: 'Queries public search engines and encyclopedic sources for current facts.', consequences: ['Reads public internet data without side effects.'] },
      { toolName: 'fetch_webpage', displayName: 'Read Webpage', category: 'web', description: 'Fetches and parses public web page content.', consequences: ['Retrieves external public HTML content.'] },
      { toolName: 'calculate', displayName: 'Mathematical Calculator', category: 'system', description: 'Evaluates arithmetic and algebraic calculations.', consequences: ['Pure computation without side effects.'] },
      { toolName: 'get_file', displayName: 'Read File', category: 'filesystem', description: 'Reads contents of an existing workspace file.', consequences: ['Reads local repository state.'] },
      { toolName: 'list_files', displayName: 'List Files', category: 'filesystem', description: 'Lists files and folders within the project workspace.', consequences: ['Inspects file tree hierarchy.'] },
      { toolName: 'get_git_status', displayName: 'Inspect Git Status', category: 'coding', description: 'Checks current git branch and uncommitted modifications.', consequences: ['Read-only git repository query.'] },
      { toolName: 'read_memory', displayName: 'Read Memory Records', category: 'memory', description: 'Retrieves long-term preferences and facts from user memory vault.', consequences: ['Reads stored user memories.'] },
      { toolName: 'check_weather', displayName: 'Weather Forecast', category: 'web', description: 'Fetches open meteorological forecasts.', consequences: ['Reads public weather information.'] },
      { toolName: 'read_checkpoint', displayName: 'Read Task Checkpoint', category: 'system', description: 'Reads stored task checkpoint state.', consequences: ['Inspects persisted execution status.'] },
    ];
    for (const r of readOnlyTools) this.registerPolicy({ ...r, riskLevel: 'read-only', requiresConfirmation: false });

    const destructiveTools: Array<{ toolName: string; displayName: string; category: PolicyActionDefinition['category']; description: string; consequences: string[] }> = [
      { toolName: 'delete_file', displayName: 'Delete File', category: 'filesystem', description: 'Permanently deletes a file from the repository or disk.', consequences: ['The specified file will be permanently removed.', 'Uncommitted changes in this file cannot be recovered.'] },
      { toolName: 'drop_database', displayName: 'Drop or Truncate Database', category: 'system', description: 'Purges or resets database records and collections.', consequences: ['All matching records will be permanently deleted.', 'Database state cannot be restored without a prior backup.'] },
      { toolName: 'git_reset_hard', displayName: 'Hard Git Reset', category: 'coding', description: 'Discards uncommitted changes across the entire working tree.', consequences: ['All modified, uncommitted work in the repository will be lost.'] },
      { toolName: 'purge_memories', displayName: 'Purge Memory Vault', category: 'memory', description: 'Erases all saved user memory records and preferences.', consequences: ['All stored memories and context will be permanently wiped.'] },
      { toolName: 'delete_project', displayName: 'Delete Workspace Project', category: 'filesystem', description: 'Deletes a project workspace and all associated conversation history.', consequences: ['Project files and chat sessions will be permanently removed.'] },
      { toolName: 'cancel_all_tasks', displayName: 'Cancel All Active Tasks', category: 'system', description: 'Force terminates all running and queued background tasks.', consequences: ['All in-flight autonomous agent executions will be stopped immediately.'] },
      { toolName: 'filesystem_delete', displayName: 'Delete Workspace Path', category: 'filesystem', description: 'Deletes a sandboxed workspace path.', consequences: ['Sandbox workspace data is permanently removed.'] },
      { toolName: 'sandbox_cleanup', displayName: 'Terminate Sandbox', category: 'coding', description: 'Terminates a sandbox session.', consequences: ['Sandbox state is lost.'] },
    ];
    for (const d of destructiveTools) this.registerPolicy({ ...d, riskLevel: 'destructive', requiresConfirmation: true });

    const privilegedTools: Array<{ toolName: string; displayName: string; category: PolicyActionDefinition['category']; description: string; consequences: string[] }> = [
      { toolName: 'git_push', displayName: 'Push to Remote Repository', category: 'coding', description: 'Pushes local commits to the remote GitHub repository branch.', consequences: ['Commits will be sent to the remote origin.', 'May trigger CI/CD pipelines and production deployments.'] },
      { toolName: 'commit_changes', displayName: 'Create Git Commit', category: 'coding', description: 'Creates a signed git commit with modified workspace files.', consequences: ['Stages and commits code changes to git history.'] },
      { toolName: 'run_command', displayName: 'Execute System Command', category: 'system', description: 'Runs a shell command or script in the execution environment.', consequences: ['Executes arbitrary system commands with host environment permissions.'] },
      { toolName: 'send_webhook', displayName: 'Send External Webhook', category: 'workspace', description: 'Transmits a payload to an external HTTP webhook endpoint.', consequences: ['Sends data payload to an external third-party server.'] },
      { toolName: 'modify_credentials', displayName: 'Modify System Credentials', category: 'system', description: 'Updates API keys, connector tokens, or authentication secrets.', consequences: ['Alters sensitive security credentials for the user account.'] },
      { toolName: 'trigger_scheduled_workflow', displayName: 'Deploy Scheduled Agent', category: 'system', description: 'Enables an autonomous agent to execute on a recurring timer in the background.', consequences: ['Agent will run automatically at scheduled intervals without active prompt.'] },
      { toolName: 'device_action', displayName: 'Execute Device Action', category: 'device', description: 'Triggers Android device native intent (camera, storage, haptics).', consequences: ['Interacts with native mobile device hardware.'] },
      { toolName: 'sandbox_create', displayName: 'Create Isolated Sandbox', category: 'coding', description: 'Creates a new isolated cloud sandbox.', consequences: ['Provisions billable compute resources.'] },
    ];
    for (const p of privilegedTools) this.registerPolicy({ ...p, riskLevel: 'privileged', requiresConfirmation: true });

    const sensitiveTools: Array<{ toolName: string; displayName: string; category: PolicyActionDefinition['category']; description: string; consequences: string[] }> = [
      { toolName: 'terminal_execute', displayName: 'Execute Terminal Command', category: 'coding', description: 'Runs a command inside the isolated sandbox.', consequences: ['Executes code inside the sandbox.'] },
      { toolName: 'filesystem_write', displayName: 'Write Workspace File', category: 'filesystem', description: 'Writes a file inside the sandbox workspace.', consequences: ['Modifies sandbox files.'] },
      { toolName: 'browser_navigate', displayName: 'Navigate Browser Session', category: 'web', description: 'Navigates the isolated browser.', consequences: ['Sends requests to an external website.'] },
      { toolName: 'browser_click', displayName: 'Click Page Element', category: 'web', description: 'Clicks an element in the isolated browser.', consequences: ['May trigger site state changes.'] },
      { toolName: 'browser_fill', displayName: 'Fill Form Fields', category: 'web', description: 'Fills form fields in the isolated browser.', consequences: ['Enters data into an external site.'] },
      { toolName: 'preview_start', displayName: 'Start Development Preview', category: 'coding', description: 'Installs dependencies and starts a dev server in the sandbox.', consequences: ['Installs packages; runs a server.'] },
    ];
    for (const s of sensitiveTools) this.registerPolicy({ ...s, riskLevel: 'sensitive', requiresConfirmation: true });
  }

  constructor() {
    this.registerDefaultPolicies();
  }
}

import { config } from 'dotenv';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!getApps().length) {
  if (serviceAccountBase64) {
    initializeApp({ credential: cert(JSON.parse(Buffer.from(serviceAccountBase64, 'base64').toString())) });
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT missing; Firestore features are unavailable.');
  }
}

export interface ApprovalChallenge {
  id: string;
  conversationId: string;
  stepId: string;
  type: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  detail: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export interface StoredApproval {
  challengeId: string;
  conversationId: string;
  stepId: string;
  userId: string;
  decision: 'approved' | 'rejected';
  createdAt: string;
  expiresAt: string;
  token: string;
  usedAt?: string | null;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export class CheckpointsService {
  private cache = new Map<string, any>();

  private get db() {
    if (!this._db) throw new Error('Firestore unavailable');
    return this._db;
  }
  private _db: any = null;

  ensureDb(): any {
    if (this._db) return this.db;
    if (!getApps().length) throw new Error('Firestore unavailable');
    this._db = getFirestore();
    return this.db;
  }

  cacheCheckpoint(cacheKey: string, delta: unknown): void {
    const prev = this.cache.get(cacheKey) ?? [];
    this.cache.set(cacheKey, [...prev, delta].slice(-40));
  }

  getCheckpoint(cacheKey: string): unknown[] {
    return this.cache.get(cacheKey) ?? [];
  }

  async saveCheckpoint(...args: unknown[]) {
    return null;
  }

  async listCheckpoints(...args: unknown[]) {
    return [];
  }

  async saveCheckpoint(
    userId: string,
    conversationId: string,
    step: { stepIndex: number; stepLabel: string; completedToolCalls?: string[]; accumulatedResult?: string; totalSteps?: number },
  ): Promise<string> {
    const db = this.ensureDb();
    const steps = 'x';
    const id = crypto
      .createHash('sha256')
      .update([userId, conversationId, step.stepIndex, step.stepLabel].join('|'))
      .digest('hex')
      .slice(0, 40);
    void steps;
    await db.collection('users').doc(userId).collection('checkpoints').doc(id).set({
      id,
      taskId: id,
      conversationId,
      userId,
      stepIndex: step.stepIndex,
      totalSteps: step.totalSteps ?? null,
      stepLabel: step.stepLabel,
      status: 'in_progress',
      completedToolCalls: step.completedToolCalls ?? [],
      accumulatedResult: step.accumulatedResult ?? '',
      stateSnapshot: null,
      checksum: crypto.createHash('sha256').update([conversationId, step.stepIndex, step.completedToolCalls?.join(',') ?? ''].join('|')).digest('hex'),
      timestamp: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return id;
  }

  async listCheckpoints(userId: string, conversationId: string, limit = 50) {
    const db = this.ensureDb();
    const snap = await db
      .collection('users')
      .doc(userId)
      .collection('checkpoints')
      .where('conversationId', '==', conversationId)
      .limit(limit)
      .get();
    return snap.docs.map((d: any) => d.data());
  }

  async saveCheckpointV2(userId: string, conversationId: string, step) {
    return this.saveCheckpoint(userId, conversationId, step);
  }
}
