import crypto from 'crypto';

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
  riskLevel: PolicyRiskLevel;
  status: 'allowed' | 'challenged' | 'approved' | 'rejected' | 'consumed' | 'denied';
  reason: string;
  target?: string;
  challengeId?: string;
}

export class PermissionsGatewayService {
  private policies = new Map<string, PolicyActionDefinition>();
  private challenges = new Map<string, PermissionChallenge>();
  private auditLog: AuditRecord[] = [];
  private readonly DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SECRET = process.env.POLICY_GATEWAY_SECRET || 'manus_gateway_policy_secret_2026';

  constructor() {
    this.registerDefaultPolicies();
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
   * Compute deterministic canonical hash of parameters to prevent tampering
   */
  public hashParameters(args: Record<string, any>): string {
    const sortedKeys = Object.keys(args || {}).sort();
    const normalized: Record<string, any> = {};
    for (const key of sortedKeys) {
      normalized[key] = args[key];
    }
    return crypto
      .createHmac('sha256', this.SECRET)
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  /**
   * Evaluate a requested tool invocation against policy rules
   */
  public evaluateAction(params: {
    toolName: string;
    args: Record<string, any>;
    userId?: string;
    target?: string;
    approvalToken?: string;
  }): {
    allowed: boolean;
    riskLevel: PolicyRiskLevel;
    requiresApproval: boolean;
    reason: string;
    challenge?: PermissionChallenge;
  } {
    const policy = this.getPolicy(params.toolName);
    const userId = params.userId || 'usr_manus_default';
    const paramsHash = this.hashParameters(params.args);

    // 1. Read-Only tools are automatically allowed
    if (policy.riskLevel === 'read-only' && !policy.requiresConfirmation) {
      this.recordAudit({
        userId,
        toolName: params.toolName,
        riskLevel: 'read-only',
        status: 'allowed',
        reason: 'Read-only operation allowed automatically by policy gateway',
        target: params.target,
      });

      return {
        allowed: true,
        riskLevel: 'read-only',
        requiresApproval: false,
        reason: 'Read-only operation verified and allowed.',
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

    this.recordAudit({
      userId,
      toolName: params.toolName,
      riskLevel: policy.riskLevel,
      status: 'challenged',
      reason: `Explicit confirmation required for ${policy.riskLevel} operation: ${policy.displayName}`,
      target: challenge.target,
      challengeId,
    });

    return {
      allowed: false,
      riskLevel: policy.riskLevel,
      requiresApproval: true,
      reason: `Explicit user approval required for ${policy.riskLevel} action.`,
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

    if (Date.now() > challenge.expiresAt) {
      challenge.status = 'expired';
      this.recordAudit({
        userId: params.userId || challenge.userId,
        toolName: challenge.toolName,
        riskLevel: challenge.riskLevel,
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
        userId: params.userId || challenge.userId,
        toolName: challenge.toolName,
        riskLevel: challenge.riskLevel,
        status: 'rejected',
        reason: params.reason || 'User explicitly denied authorization',
        challengeId: challenge.challengeId,
      });
      return { success: true, status: 'rejected' };
    }

    // Approved: Mint single-use, cryptographic approval token
    const tokenPayload = `${challenge.challengeId}:${challenge.parametersHash}:${challenge.userId}:${Date.now()}`;
    const approvalToken = `appr_${crypto.createHmac('sha256', this.SECRET).update(tokenPayload).digest('hex').substring(0, 32)}`;

    challenge.status = 'approved';
    challenge.approvalToken = approvalToken;
    challenge.resolvedAt = Date.now();

    this.recordAudit({
      userId: params.userId || challenge.userId,
      toolName: challenge.toolName,
      riskLevel: challenge.riskLevel,
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
    let matchedChallenge: PermissionChallenge | null = null;

    for (const [_, c] of this.challenges) {
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

    if (params.userId && matchedChallenge.userId !== params.userId) {
      return { valid: false, reason: 'Approval token is bound to a different user identity.' };
    }

    // Burn token: single-use enforcement
    matchedChallenge.status = 'consumed';

    this.recordAudit({
      userId: matchedChallenge.userId,
      toolName: matchedChallenge.toolName,
      riskLevel: matchedChallenge.riskLevel,
      status: 'consumed',
      reason: 'Approval token successfully verified and consumed for execution',
      challengeId: matchedChallenge.challengeId,
    });

    return { valid: true, reason: 'Approval token valid and consumed.' };
  }

  /**
   * Retrieve audit logs with optional limit
   */
  public getAuditLog(limit = 100): AuditRecord[] {
    return this.auditLog.slice(-limit).reverse();
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

    // Keep log bounded
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
        consequences: [
          'All modified, uncommitted work in the repository will be lost.',
        ],
      },
      {
        toolName: 'purge_memories',
        displayName: 'Purge Memory Vault',
        category: 'memory',
        description: 'Erases all saved user memory records and preferences.',
        consequences: [
          'All stored memories and context will be permanently wiped.',
        ],
      },
      {
        toolName: 'delete_project',
        displayName: 'Delete Workspace Project',
        category: 'filesystem',
        description: 'Deletes a project workspace and all associated conversation history.',
        consequences: [
          'Project files and chat sessions will be permanently removed.',
        ],
      },
      {
        toolName: 'cancel_all_tasks',
        displayName: 'Cancel All Active Tasks',
        category: 'system',
        description: 'Force terminates all running and queued background tasks.',
        consequences: [
          'All in-flight autonomous agent executions will be stopped immediately.',
        ],
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
        consequences: [
          'Stages and commits code changes to git history.',
        ],
      },
      {
        toolName: 'run_command',
        displayName: 'Execute System Command',
        category: 'system',
        description: 'Runs a shell command or script in the execution environment.',
        consequences: [
          'Executes arbitrary system commands with host environment permissions.',
        ],
      },
      {
        toolName: 'send_webhook',
        displayName: 'Send External Webhook',
        category: 'workspace',
        description: 'Transmits a payload to an external HTTP webhook endpoint.',
        consequences: [
          'Sends data payload to an external third-party server.',
        ],
      },
      {
        toolName: 'modify_credentials',
        displayName: 'Modify System Credentials',
        category: 'system',
        description: 'Updates API keys, connector tokens, or authentication secrets.',
        consequences: [
          'Alters sensitive security credentials for the user account.',
        ],
      },
      {
        toolName: 'trigger_scheduled_workflow',
        displayName: 'Deploy Scheduled Agent',
        category: 'system',
        description: 'Enables an autonomous agent to execute on a recurring timer in the background.',
        consequences: [
          'Agent will run automatically at scheduled intervals without active prompt.',
        ],
      },
      {
        toolName: 'device_action',
        displayName: 'Execute Device Action',
        category: 'device',
        description: 'Triggers Android device native intent (camera, storage, haptics).',
        consequences: [
          'Interacts with native mobile device hardware.',
        ],
      },
    ];

    for (const p of privilegedTools) {
      this.registerPolicy({
        ...p,
        riskLevel: 'privileged',
        requiresConfirmation: true,
      });
    }
  }
}

export const permissionsGateway = new PermissionsGatewayService();
