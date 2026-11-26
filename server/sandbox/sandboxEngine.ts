/**
 * Core Sandboxed Coding Execution Engine.
 *
 * Orchestrates isolated sandbox lifecycle, real terminal execution (buffered & streaming),
 * workspace-confined filesystem operations, live development preview startup + HTTP readiness
 * verification, durable persistence across serverless cold starts, idempotency, retries,
 * permissions gateway enforcement, audit logging, and signed provider webhook handling.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { permissionsGateway, type PermissionChallenge, type PermissionsGatewayService } from '../permissionsGateway';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
  type PersistenceMode,
} from './durableStore';
import {
  getSandboxProviderCapabilities,
  resolveSandboxProvider,
  SandboxProviderError,
  type SandboxProviderAdapter,
} from './providers';
import {
  AUTHORIZED_WORKSPACE_ROOT,
  isValidResourceId,
  redactSensitiveExecutionText,
  resolveWorkspacePath,
  sanitizeSandboxEnv,
  validateBrowserNavigationUrl,
  validateFileWritePayload,
  validateSandboxCommand,
  verifyWebhookSignature,
} from './security';
import {
  DEFAULT_SANDBOX_LIMITS,
  type EngineActionAuditEntry,
  type PreviewServerState,
  type ProviderCapabilityReport,
  type SandboxResourceLimits,
  type SandboxRuntime,
  type SandboxWorkspaceRecord,
  type TerminalExecutionRecord,
  type TerminalStreamEvent,
  type WorkspaceArtifact,
  type WorkspaceFileEntry,
  type WorkspaceSearchMatch,
} from './types';

export class SandboxEngineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly challenge?: PermissionChallenge;

  constructor(params: { message: string; code: string; statusCode?: number; challenge?: PermissionChallenge }) {
    super(params.message);
    this.name = 'SandboxEngineError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 400;
    this.challenge = params.challenge;
  }
}

export type PreviewProbeFn = (url: string, timeoutMs: number) => Promise<{ ok: boolean; status?: number; error?: string }>;

const defaultPreviewProbe: PreviewProbeFn = async (url, timeoutMs) => {
  const urlCheck = validateBrowserNavigationUrl(url);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    return { ok: false, error: urlCheck.error || 'Preview URL failed security validation.' };
  }
  try {
    const res = await fetch(urlCheck.normalizedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: res.status >= 200 && res.status < 500,
      status: res.status,
      error: res.status >= 500 ? `Preview server returned HTTP ${res.status}` : undefined,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Preview server is unreachable.' };
  }
};

export interface SandboxEngineOptions {
  store?: DurableExecutionStore;
  providerResolver?: (preferred?: string) => SandboxProviderAdapter;
  gateway?: PermissionsGatewayService;
  previewProbe?: PreviewProbeFn;
}

const VALID_RUNTIMES = new Set<SandboxRuntime>([
  'node',
  'typescript',
  'javascript',
  'python',
  'html',
  'react',
  'vite',
  'nextjs',
  'custom',
]);

export class SandboxExecutionEngine {
  private readonly store: DurableExecutionStore;
  private readonly providerResolver: (preferred?: string) => SandboxProviderAdapter;
  private readonly gateway: PermissionsGatewayService;
  private readonly previewProbe: PreviewProbeFn;

  constructor(options?: SandboxEngineOptions) {
    this.store = options?.store ?? defaultDurableStore;
    this.providerResolver = options?.providerResolver ?? resolveSandboxProvider;
    this.gateway = options?.gateway ?? permissionsGateway;
    this.previewProbe = options?.previewProbe ?? defaultPreviewProbe;
  }

  public getPersistenceMode(ctx?: DurableRequestContext): PersistenceMode {
    return this.store.getMode(ctx);
  }

  public async getHealth(liveCheck = false): Promise<{
    provider: ProviderCapabilityReport;
    persistenceMode: PersistenceMode;
  }> {
    const provider = await getSandboxProviderCapabilities(liveCheck);
    return {
      provider,
      persistenceMode: this.store.getMode(),
    };
  }

  private async audit(
    ctx: DurableRequestContext,
    action: string,
    resourceType: EngineActionAuditEntry['resourceType'],
    resourceId: string,
    status: EngineActionAuditEntry['status'],
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.store.appendAudit(ctx, {
      auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      userId: ctx.userId,
      action,
      resourceType,
      resourceId,
      status,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<{ value: T; retryCount: number }> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= maxRetries) {
      try {
        const value = await fn();
        return { value, retryCount: attempt };
      } catch (err) {
        lastError = err;
        const retryable = err instanceof SandboxProviderError && err.retryable;
        if (!retryable || attempt >= maxRetries) {
          throw err;
        }
        attempt++;
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
    throw lastError;
  }

  private clampLimits(input?: Partial<SandboxResourceLimits>): SandboxResourceLimits {
    return {
      cpuCores: Math.min(8, Math.max(1, Number(input?.cpuCores) || DEFAULT_SANDBOX_LIMITS.cpuCores)),
      memoryMb: Math.min(8192, Math.max(256, Number(input?.memoryMb) || DEFAULT_SANDBOX_LIMITS.memoryMb)),
      diskMb: Math.min(20480, Math.max(512, Number(input?.diskMb) || DEFAULT_SANDBOX_LIMITS.diskMb)),
      timeoutSec: Math.min(3600, Math.max(60, Number(input?.timeoutSec) || DEFAULT_SANDBOX_LIMITS.timeoutSec)),
      idleTimeoutSec: Math.min(1800, Math.max(60, Number(input?.idleTimeoutSec) || DEFAULT_SANDBOX_LIMITS.idleTimeoutSec)),
      maxCommandTimeoutMs: Math.min(
        300_000,
        Math.max(5_000, Number(input?.maxCommandTimeoutMs) || DEFAULT_SANDBOX_LIMITS.maxCommandTimeoutMs),
      ),
      maxFileSizeBytes: Math.min(
        5 * 1024 * 1024,
        Math.max(1024, Number(input?.maxFileSizeBytes) || DEFAULT_SANDBOX_LIMITS.maxFileSizeBytes),
      ),
    };
  }

  private async requireOwnedSandbox(
    ctx: DurableRequestContext,
    sandboxId: string,
    allowStopped = false,
  ): Promise<SandboxWorkspaceRecord> {
    if (!isValidResourceId(sandboxId)) {
      throw new SandboxEngineError({ code: 'INVALID_SANDBOX_ID', message: 'Invalid sandboxId format.', statusCode: 400 });
    }
    const sandbox = await this.store.getSandbox(ctx, sandboxId);
    if (!sandbox) {
      throw new SandboxEngineError({ code: 'SANDBOX_NOT_FOUND', message: 'Sandbox not found.', statusCode: 404 });
    }
    if (sandbox.userId !== ctx.userId) {
      await this.audit(ctx, 'sandbox_access_denied', 'sandbox', sandboxId, 'denied', {
        reason: 'Cross-user workspace access attempt blocked.',
      });
      throw new SandboxEngineError({
        code: 'FORBIDDEN',
        message: 'Access denied: you do not own this sandbox workspace.',
        statusCode: 403,
      });
    }

    // Automatic idle/TTL expiration check
    if (!allowStopped && sandbox.status !== 'stopped' && sandbox.status !== 'expired') {
      const nowMs = Date.now();
      const expiresAtMs = Date.parse(sandbox.expiresAt);
      const lastActiveMs = Date.parse(sandbox.lastActiveAt);
      const idleExpired = Number.isFinite(lastActiveMs) && nowMs - lastActiveMs > sandbox.limits.idleTimeoutSec * 1000;
      const ttlExpired = Number.isFinite(expiresAtMs) && nowMs > expiresAtMs;

      if (idleExpired || ttlExpired) {
        try {
          const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
          await provider.destroySandbox(sandbox.providerSandboxId);
        } catch {
          // Best-effort provider cleanup
        }
        sandbox.status = 'expired';
        sandbox.cleanedUpAt = new Date(nowMs).toISOString();
        sandbox.updatedAt = sandbox.cleanedUpAt;
        await this.store.saveSandbox(ctx, sandbox);
        throw new SandboxEngineError({
          code: 'SANDBOX_EXPIRED',
          message: 'Sandbox workspace has expired due to idle or lifetime timeout and was cleaned up.',
          statusCode: 410,
        });
      }
    }

    if (!allowStopped && (sandbox.status === 'stopped' || sandbox.status === 'expired')) {
      throw new SandboxEngineError({
        code: 'SANDBOX_INACTIVE',
        message: `Sandbox is "${sandbox.status}" and cannot accept execution requests.`,
        statusCode: 409,
      });
    }

    return sandbox;
  }

  private async touchSandbox(ctx: DurableRequestContext, sandbox: SandboxWorkspaceRecord): Promise<void> {
    const now = new Date().toISOString();
    sandbox.lastActiveAt = now;
    sandbox.updatedAt = now;
    await this.store.saveSandbox(ctx, sandbox);
  }

  // -------------------------------------------------------------------------
  // 1. Sandbox Lifecycle
  // -------------------------------------------------------------------------

  public async createSandbox(
    ctx: DurableRequestContext,
    input: {
      projectId: string;
      taskId?: string;
      runtime?: SandboxRuntime;
      image?: string;
      limits?: Partial<SandboxResourceLimits>;
      env?: Record<string, unknown>;
      persistent?: boolean;
      provider?: string;
      idempotencyKey?: string;
    },
  ): Promise<SandboxWorkspaceRecord> {
    if (!ctx.userId) {
      throw new SandboxEngineError({ code: 'UNAUTHENTICATED', message: 'Authentication required.', statusCode: 401 });
    }
    const projectId = (input.projectId || 'default-project').trim();
    if (!isValidResourceId(projectId)) {
      throw new SandboxEngineError({ code: 'INVALID_PROJECT_ID', message: 'Invalid projectId format.', statusCode: 400 });
    }

    if (input.idempotencyKey) {
      const cached = await this.store.getIdempotency<SandboxWorkspaceRecord>(ctx, `sb_create_${input.idempotencyKey}`);
      if (cached?.result) return cached.result;
    }

    const runtime: SandboxRuntime = input.runtime && VALID_RUNTIMES.has(input.runtime) ? input.runtime : 'node';
    const limits = this.clampLimits(input.limits);
    const safeEnv = sanitizeSandboxEnv(input.env);
    const provider = this.providerResolver(input.provider);

    const sandboxId = `sb_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const workspaceId = `ws_${projectId.slice(0, 24)}_${crypto.randomBytes(5).toString('hex')}`;

    const { value: created } = await this.withRetry(() =>
      provider.createSandbox({
        workspaceId,
        userId: ctx.userId,
        projectId,
        taskId: input.taskId,
        runtime,
        image: input.image,
        limits,
        env: safeEnv,
        persistent: Boolean(input.persistent),
      }),
    );

    const now = Date.now();
    const record: SandboxWorkspaceRecord = {
      sandboxId,
      workspaceId,
      provider: provider.id,
      providerSandboxId: created.providerSandboxId,
      userId: ctx.userId,
      projectId,
      taskId: input.taskId,
      runtime,
      image: created.image || input.image,
      workspaceRoot: created.workspaceRoot || AUTHORIZED_WORKSPACE_ROOT,
      status: created.status || 'running',
      limits,
      persistent: Boolean(input.persistent),
      previewStatus: 'stopped',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      lastActiveAt: new Date(now).toISOString(),
      expiresAt: new Date(now + limits.timeoutSec * 1000).toISOString(),
    };

    await this.store.saveSandbox(ctx, record);
    if (input.idempotencyKey) {
      await this.store.saveIdempotency(ctx, `sb_create_${input.idempotencyKey}`, record, limits.timeoutSec);
    }
    await this.audit(ctx, 'sandbox_create', 'sandbox', sandboxId, 'succeeded', {
      workspaceId,
      projectId,
      runtime,
      provider: provider.id,
    });

    return record;
  }

  public async getSandboxStatus(
    ctx: DurableRequestContext,
    sandboxId: string,
    refreshFromProvider = true,
  ): Promise<SandboxWorkspaceRecord> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId, true);
    if (refreshFromProvider && sandbox.status !== 'stopped' && sandbox.status !== 'expired') {
      try {
        const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
        const live = await provider.getSandboxStatus(sandbox.providerSandboxId);
        sandbox.status = live.status;
        if (live.error) sandbox.error = redactSensitiveExecutionText(live.error);
        sandbox.updatedAt = new Date().toISOString();
        await this.store.saveSandbox(ctx, sandbox);
      } catch (err: any) {
        sandbox.error = redactSensitiveExecutionText(err?.message || 'Provider status check failed.');
      }
    }
    return sandbox;
  }

  public async cleanupSandbox(
    ctx: DurableRequestContext,
    sandboxId: string,
  ): Promise<{ sandboxId: string; status: 'stopped'; cleanedUpAt: string }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId, true);
    if (sandbox.status !== 'stopped' && sandbox.status !== 'expired') {
      const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
      await provider.destroySandbox(sandbox.providerSandboxId);
    }

    const now = new Date().toISOString();
    sandbox.status = 'stopped';
    sandbox.previewStatus = 'stopped';
    sandbox.previewUrl = undefined;
    sandbox.cleanedUpAt = now;
    sandbox.updatedAt = now;
    await this.store.saveSandbox(ctx, sandbox);
    await this.audit(ctx, 'sandbox_cleanup', 'sandbox', sandboxId, 'succeeded', {
      workspaceId: sandbox.workspaceId,
    });

    return { sandboxId, status: 'stopped', cleanedUpAt: now };
  }

  // -------------------------------------------------------------------------
  // 2. Real Terminal Execution (Buffered, Streaming, Cancellation)
  // -------------------------------------------------------------------------

  public async executeTerminal(
    ctx: DurableRequestContext,
    input: {
      sandboxId: string;
      command: string;
      cwd?: string;
      env?: Record<string, unknown>;
      timeoutMs?: number;
      approvalToken?: string;
      idempotencyKey?: string;
      background?: boolean;
      toolName?: 'terminal_execute' | 'terminal_stream';
      onEvent?: (event: TerminalStreamEvent) => void;
    },
  ): Promise<TerminalExecutionRecord> {
    const sandbox = await this.requireOwnedSandbox(ctx, input.sandboxId);

    if (input.idempotencyKey) {
      const cached = await this.store.getIdempotency<TerminalExecutionRecord>(ctx, `exec_${input.idempotencyKey}`);
      if (cached?.result) return cached.result;
    }

    const timeoutMs = Math.min(
      sandbox.limits.maxCommandTimeoutMs,
      Math.max(1_000, Number(input.timeoutMs) || 30_000),
    );

    const cmdCheck = validateSandboxCommand(input.command, timeoutMs);
    if (!cmdCheck.valid || !cmdCheck.normalizedCommand) {
      await this.audit(ctx, 'terminal_execute', 'terminal', sandbox.sandboxId, 'denied', {
        reason: cmdCheck.error,
        command: redactSensitiveExecutionText(String(input.command || '').slice(0, 200)),
      });
      throw new SandboxEngineError({
        code: 'FORBIDDEN_COMMAND',
        message: cmdCheck.error || 'Command rejected by sandbox security policy.',
        statusCode: 403,
      });
    }

    const cwdResolution = resolveWorkspacePath(input.cwd || '.', sandbox.workspaceRoot);
    if (!cwdResolution.valid || !cwdResolution.absolutePath) {
      throw new SandboxEngineError({
        code: 'INVALID_WORKSPACE_PATH',
        message: cwdResolution.error || 'Working directory escapes workspace root.',
        statusCode: 403,
      });
    }

    // Enforce explicit user approval for risky commands (package installs, network transfer, destructive ops, >60s)
    if (cmdCheck.requiresApproval) {
      const evalArgs = {
        sandboxId: sandbox.sandboxId,
        command: cmdCheck.normalizedCommand,
        cwd: cwdResolution.normalizedRelative || '.',
      };
      const evaluation = await this.gateway.evaluateActionDurable(
        {
          toolName: input.toolName || 'terminal_execute',
          args: evalArgs,
          userId: ctx.userId,
          target: cmdCheck.normalizedCommand.slice(0, 120),
          approvalToken: input.approvalToken,
          forceConfirmation: true,
          reasonOverride: cmdCheck.approvalReason,
        },
        ctx,
        this.store,
      );

      if (!evaluation.allowed) {
        throw new SandboxEngineError({
          code: 'APPROVAL_REQUIRED',
          message: evaluation.reason,
          statusCode: 403,
          challenge: evaluation.challenge,
        });
      }
    }

    const executionId = `exec_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    const startedAt = new Date().toISOString();
    const record: TerminalExecutionRecord = {
      executionId,
      sandboxId: sandbox.sandboxId,
      workspaceId: sandbox.workspaceId,
      userId: ctx.userId,
      provider: sandbox.provider,
      command: cmdCheck.normalizedCommand,
      cwd: cwdResolution.normalizedRelative || '.',
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: null,
      startedAt,
      timeoutMs,
      idempotencyKey: input.idempotencyKey,
      retryCount: 0,
      untrustedData: true,
    };

    await this.store.saveExecution(ctx, record);
    input.onEvent?.({
      type: 'status',
      executionId,
      status: 'running',
      timestamp: startedAt,
    });

    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const safeEnv = sanitizeSandboxEnv(input.env);

    try {
      const { value: result, retryCount } = await this.withRetry(() =>
        provider.executeCommand({
          providerSandboxId: sandbox.providerSandboxId,
          command: cmdCheck.normalizedCommand!,
          cwd: cwdResolution.absolutePath!,
          env: safeEnv,
          timeoutMs,
          background: input.background,
          onEvent: input.onEvent
            ? (ev) =>
                input.onEvent!({
                  ...ev,
                  executionId,
                  data: ev.data ? redactSensitiveExecutionText(ev.data) : ev.data,
                })
            : undefined,
        }),
      );

      record.providerExecutionId = result.providerExecutionId;
      record.stdout = redactSensitiveExecutionText(result.stdout);
      record.stderr = redactSensitiveExecutionText(result.stderr);
      record.exitCode = result.exitCode;
      record.durationMs = result.durationMs;
      record.retryCount = retryCount;
      record.cancelled = Boolean(result.cancelled);
      record.completedAt = new Date().toISOString();
      record.status = result.cancelled
        ? 'cancelled'
        : result.timedOut
          ? 'timed_out'
          : input.background
            ? 'running'
            : result.exitCode === 0
              ? 'completed'
              : 'failed';

      await this.store.saveExecution(ctx, record);
      await this.touchSandbox(ctx, sandbox);
      if (input.idempotencyKey) {
        await this.store.saveIdempotency(ctx, `exec_${input.idempotencyKey}`, record, 3600);
      }

      await this.audit(ctx, input.toolName || 'terminal_execute', 'terminal', executionId, 'succeeded', {
        sandboxId: sandbox.sandboxId,
        cwd: record.cwd,
        exitCode: record.exitCode,
        status: record.status,
        durationMs: record.durationMs,
      });

      return record;
    } catch (err: any) {
      record.status = err instanceof SandboxProviderError && err.code === 'PROVIDER_TIMEOUT' ? 'timed_out' : 'failed';
      record.error = redactSensitiveExecutionText(err?.message || 'Terminal execution failed.');
      record.completedAt = new Date().toISOString();
      await this.store.saveExecution(ctx, record);
      await this.audit(ctx, input.toolName || 'terminal_execute', 'terminal', executionId, 'failed', {
        sandboxId: sandbox.sandboxId,
        error: record.error,
      });
      throw err;
    }
  }

  public async cancelTerminal(
    ctx: DurableRequestContext,
    sandboxId: string,
    executionId: string,
  ): Promise<{ executionId: string; cancelled: boolean; status: TerminalExecutionRecord['status'] }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const execution = await this.store.getExecution(ctx, executionId);
    if (!execution || execution.sandboxId !== sandbox.sandboxId) {
      throw new SandboxEngineError({ code: 'EXECUTION_NOT_FOUND', message: 'Terminal execution not found.', statusCode: 404 });
    }
    if (execution.userId !== ctx.userId) {
      throw new SandboxEngineError({ code: 'FORBIDDEN', message: 'Access denied.', statusCode: 403 });
    }

    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const cancelled = await provider.cancelCommand(
      sandbox.providerSandboxId,
      execution.providerExecutionId || execution.executionId,
    );

    if (cancelled) {
      execution.status = 'cancelled';
      execution.cancelled = true;
      execution.completedAt = new Date().toISOString();
      await this.store.saveExecution(ctx, execution);
    }

    await this.audit(ctx, 'terminal_cancel', 'terminal', executionId, cancelled ? 'succeeded' : 'failed', {
      sandboxId,
    });
    return { executionId, cancelled, status: execution.status };
  }

  // -------------------------------------------------------------------------
  // 3. Controlled Workspace Filesystem API
  // -------------------------------------------------------------------------

  private sanitizeFileEntries(entries: WorkspaceFileEntry[], workspaceRoot: string): WorkspaceFileEntry[] {
    const rootPosix = path.posix.resolve('/', workspaceRoot);
    return entries.map((entry) => {
      const rel = entry.path.startsWith(rootPosix)
        ? path.posix.relative(rootPosix, entry.path) || '.'
        : entry.path.replace(/^\/+/, '');
      return {
        ...entry,
        path: rel,
      };
    });
  }

  public async listFiles(
    ctx: DurableRequestContext,
    sandboxId: string,
    dirPath = '.',
  ): Promise<{ path: string; entries: WorkspaceFileEntry[] }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const resolved = resolveWorkspacePath(dirPath, sandbox.workspaceRoot);
    if (!resolved.valid || !resolved.absolutePath) {
      throw new SandboxEngineError({ code: 'INVALID_WORKSPACE_PATH', message: resolved.error!, statusCode: 403 });
    }
    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const rawEntries = await provider.listFiles(sandbox.providerSandboxId, resolved.absolutePath);
    await this.touchSandbox(ctx, sandbox);
    return {
      path: resolved.normalizedRelative || '.',
      entries: this.sanitizeFileEntries(rawEntries, sandbox.workspaceRoot),
    };
  }

  public async readFile(
    ctx: DurableRequestContext,
    sandboxId: string,
    filePath: string,
  ): Promise<{ path: string; content: string; byteLength: number; untrustedData: true }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const resolved = resolveWorkspacePath(filePath, sandbox.workspaceRoot);
    if (!resolved.valid || !resolved.absolutePath || resolved.normalizedRelative === '.') {
      throw new SandboxEngineError({
        code: 'INVALID_WORKSPACE_PATH',
        message: resolved.error || 'A valid file path inside the workspace is required.',
        statusCode: 403,
      });
    }
    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const content = await provider.readFile(sandbox.providerSandboxId, resolved.absolutePath);
    await this.touchSandbox(ctx, sandbox);
    return {
      path: resolved.normalizedRelative!,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      untrustedData: true,
    };
  }

  public async writeFile(
    ctx: DurableRequestContext,
    sandboxId: string,
    filePath: string,
    content: string,
  ): Promise<{ path: string; byteLength: number; updatedAt: string }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const resolved = resolveWorkspacePath(filePath, sandbox.workspaceRoot);
    if (!resolved.valid || !resolved.absolutePath || resolved.normalizedRelative === '.') {
      throw new SandboxEngineError({
        code: 'INVALID_WORKSPACE_PATH',
        message: resolved.error || 'A valid file path inside the workspace is required.',
        statusCode: 403,
      });
    }

    const payloadCheck = validateFileWritePayload(content, sandbox.limits.maxFileSizeBytes);
    if (!payloadCheck.valid) {
      throw new SandboxEngineError({
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
        message: payloadCheck.error || 'Invalid file payload.',
        statusCode: 413,
      });
    }

    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const parentDir = path.posix.dirname(resolved.absolutePath);
    if (parentDir && parentDir !== sandbox.workspaceRoot) {
      await provider.makeDirectory(sandbox.providerSandboxId, parentDir).catch(() => {});
    }
    await provider.writeFile(sandbox.providerSandboxId, resolved.absolutePath, content);
    await this.touchSandbox(ctx, sandbox);

    const updatedAt = new Date().toISOString();
    await this.audit(ctx, 'filesystem_write', 'filesystem', sandboxId, 'succeeded', {
      path: resolved.normalizedRelative,
      byteLength: payloadCheck.byteLength,
    });

    return {
      path: resolved.normalizedRelative!,
      byteLength: payloadCheck.byteLength,
      updatedAt,
    };
  }

  public async deleteFile(
    ctx: DurableRequestContext,
    sandboxId: string,
    filePath: string,
    approvalToken?: string,
  ): Promise<{ path: string; deleted: true }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const resolved = resolveWorkspacePath(filePath, sandbox.workspaceRoot);
    if (!resolved.valid || !resolved.absolutePath || resolved.normalizedRelative === '.') {
      throw new SandboxEngineError({
        code: 'INVALID_WORKSPACE_PATH',
        message: resolved.error || 'Cannot delete workspace root or escape workspace boundary.',
        statusCode: 403,
      });
    }

    const evaluation = await this.gateway.evaluateActionDurable(
      {
        toolName: 'filesystem_delete',
        args: { sandboxId, path: resolved.normalizedRelative },
        userId: ctx.userId,
        target: resolved.normalizedRelative,
        approvalToken,
      },
      ctx,
      this.store,
    );

    if (!evaluation.allowed) {
      throw new SandboxEngineError({
        code: 'APPROVAL_REQUIRED',
        message: evaluation.reason,
        statusCode: 403,
        challenge: evaluation.challenge,
      });
    }

    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    await provider.deletePath(sandbox.providerSandboxId, resolved.absolutePath);
    await this.touchSandbox(ctx, sandbox);

    await this.audit(ctx, 'filesystem_delete', 'filesystem', sandboxId, 'succeeded', {
      path: resolved.normalizedRelative,
    });

    return { path: resolved.normalizedRelative!, deleted: true };
  }

  public async makeDirectory(
    ctx: DurableRequestContext,
    sandboxId: string,
    dirPath: string,
  ): Promise<{ path: string; created: true }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const resolved = resolveWorkspacePath(dirPath, sandbox.workspaceRoot);
    if (!resolved.valid || !resolved.absolutePath) {
      throw new SandboxEngineError({ code: 'INVALID_WORKSPACE_PATH', message: resolved.error!, statusCode: 403 });
    }
    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    await provider.makeDirectory(sandbox.providerSandboxId, resolved.absolutePath);
    await this.touchSandbox(ctx, sandbox);
    await this.audit(ctx, 'filesystem_mkdir', 'filesystem', sandboxId, 'succeeded', {
      path: resolved.normalizedRelative,
    });
    return { path: resolved.normalizedRelative!, created: true };
  }

  public async renamePath(
    ctx: DurableRequestContext,
    sandboxId: string,
    fromPath: string,
    toPath: string,
  ): Promise<{ fromPath: string; toPath: string; moved: true }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const fromResolved = resolveWorkspacePath(fromPath, sandbox.workspaceRoot);
    const toResolved = resolveWorkspacePath(toPath, sandbox.workspaceRoot);
    if (
      !fromResolved.valid ||
      !fromResolved.absolutePath ||
      fromResolved.normalizedRelative === '.' ||
      !toResolved.valid ||
      !toResolved.absolutePath ||
      toResolved.normalizedRelative === '.'
    ) {
      throw new SandboxEngineError({
        code: 'INVALID_WORKSPACE_PATH',
        message: fromResolved.error || toResolved.error || 'Both source and destination paths must stay inside the workspace.',
        statusCode: 403,
      });
    }
    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    await provider.renamePath(sandbox.providerSandboxId, fromResolved.absolutePath, toResolved.absolutePath);
    await this.touchSandbox(ctx, sandbox);
    await this.audit(ctx, 'filesystem_rename', 'filesystem', sandboxId, 'succeeded', {
      fromPath: fromResolved.normalizedRelative,
      toPath: toResolved.normalizedRelative,
    });
    return {
      fromPath: fromResolved.normalizedRelative!,
      toPath: toResolved.normalizedRelative!,
      moved: true,
    };
  }

  public async searchFiles(
    ctx: DurableRequestContext,
    sandboxId: string,
    query: string,
    dirPath = '.',
  ): Promise<{ query: string; path: string; matches: WorkspaceSearchMatch[]; untrustedData: true }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed || trimmed.length > 200) {
      throw new SandboxEngineError({ code: 'INVALID_SEARCH_QUERY', message: 'Search query must be 1–200 characters.', statusCode: 400 });
    }
    const resolved = resolveWorkspacePath(dirPath, sandbox.workspaceRoot);
    if (!resolved.valid || !resolved.absolutePath) {
      throw new SandboxEngineError({ code: 'INVALID_WORKSPACE_PATH', message: resolved.error!, statusCode: 403 });
    }
    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const rawMatches = await provider.searchFiles(sandbox.providerSandboxId, resolved.absolutePath, trimmed);
    const rootPosix = path.posix.resolve('/', sandbox.workspaceRoot);
    const sanitized = rawMatches.map((m) => ({
      path: m.path.startsWith(rootPosix) ? path.posix.relative(rootPosix, m.path) : m.path.replace(/^\/+/, ''),
      line: m.line,
      preview: redactSensitiveExecutionText(m.preview),
    }));
    await this.touchSandbox(ctx, sandbox);
    return {
      query: trimmed,
      path: resolved.normalizedRelative || '.',
      matches: sanitized,
      untrustedData: true,
    };
  }

  public async inspectProjectStructure(
    ctx: DurableRequestContext,
    sandboxId: string,
    maxDepth = 3,
  ): Promise<{ root: string; tree: WorkspaceFileEntry[] }> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const collected: WorkspaceFileEntry[] = [];

    const walk = async (relDir: string, depth: number) => {
      if (depth > maxDepth || collected.length >= 250) return;
      const resolved = resolveWorkspacePath(relDir, sandbox.workspaceRoot);
      if (!resolved.valid || !resolved.absolutePath) return;
      const entries = this.sanitizeFileEntries(
        await provider.listFiles(sandbox.providerSandboxId, resolved.absolutePath),
        sandbox.workspaceRoot,
      );
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        collected.push(entry);
        if (entry.type === 'directory' && depth < maxDepth) {
          await walk(entry.path, depth + 1);
        }
        if (collected.length >= 250) break;
      }
    };

    await walk('.', 0);
    await this.touchSandbox(ctx, sandbox);
    return { root: '.', tree: collected };
  }

  public async createWorkspaceArtifact(
    ctx: DurableRequestContext,
    sandboxId: string,
    dirPath = '.',
  ): Promise<WorkspaceArtifact> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId);
    const resolved = resolveWorkspacePath(dirPath, sandbox.workspaceRoot);
    if (!resolved.valid || !resolved.absolutePath) {
      throw new SandboxEngineError({ code: 'INVALID_WORKSPACE_PATH', message: resolved.error!, statusCode: 403 });
    }
    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    if (provider.createArtifact) {
      const artifact = await provider.createArtifact(sandbox.providerSandboxId, resolved.absolutePath);
      await this.audit(ctx, 'filesystem_artifact', 'filesystem', sandboxId, 'succeeded', {
        filename: artifact.filename,
        sizeBytes: artifact.sizeBytes,
      });
      return artifact;
    }

    // Fallback: assemble a JSON bundle of workspace text files via provider.readFile
    const structure = await this.inspectProjectStructure(ctx, sandboxId, 3);
    const files: Record<string, string> = {};
    let totalBytes = 0;
    for (const item of structure.tree) {
      if (item.type !== 'file') continue;
      if (totalBytes > 4 * 1024 * 1024) break;
      try {
        const res = await this.readFile(ctx, sandboxId, item.path);
        files[item.path] = res.content;
        totalBytes += res.byteLength;
      } catch {
        // Skip unreadable/binary files
      }
    }
    const bundleJson = JSON.stringify({ workspaceId: sandbox.workspaceId, files }, null, 2);
    const contentBase64 = Buffer.from(bundleJson, 'utf8').toString('base64');
    return {
      filename: `${sandbox.workspaceId}.json`,
      mimeType: 'application/json',
      encoding: 'base64',
      sizeBytes: Buffer.byteLength(bundleJson, 'utf8'),
      contentBase64,
      fileCount: Object.keys(files).length,
      createdAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // 4. Live Development Preview (Real Server Startup & HTTP Readiness Check)
  // -------------------------------------------------------------------------

  public async startPreview(
    ctx: DurableRequestContext,
    input: {
      sandboxId: string;
      command: string;
      port: number;
      cwd?: string;
      readinessTimeoutMs?: number;
      pollIntervalMs?: number;
      approvalToken?: string;
    },
  ): Promise<PreviewServerState> {
    const sandbox = await this.requireOwnedSandbox(ctx, input.sandboxId);
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 80 || port > 65535) {
      throw new SandboxEngineError({ code: 'INVALID_PREVIEW_PORT', message: 'Preview port must be an integer between 80 and 65535.', statusCode: 400 });
    }

    const execution = await this.executeTerminal(ctx, {
      sandboxId: sandbox.sandboxId,
      command: input.command,
      cwd: input.cwd || '.',
      background: true,
      approvalToken: input.approvalToken,
    });

    if (execution.status === 'failed' || (execution.exitCode !== null && execution.exitCode !== 0)) {
      const failedState: PreviewServerState = {
        sandboxId: sandbox.sandboxId,
        workspaceId: sandbox.workspaceId,
        command: execution.command,
        port,
        status: 'failed',
        executionId: execution.executionId,
        checkedAt: new Date().toISOString(),
        error: execution.stderr || execution.error || `Development server exited immediately with code ${execution.exitCode}.`,
      };
      sandbox.previewStatus = 'failed';
      sandbox.previewPort = port;
      sandbox.previewUrl = undefined;
      await this.store.saveSandbox(ctx, sandbox);
      return failedState;
    }

    const provider = this.providerResolver(sandbox.provider === 'unconfigured' ? undefined : sandbox.provider);
    const previewUrl = await provider.getPreviewUrl(sandbox.providerSandboxId, port);

    const readinessTimeoutMs = Math.min(45_000, Math.max(1_000, Number(input.readinessTimeoutMs) || 15_000));
    const pollIntervalMs = Math.min(2_000, Math.max(100, Number(input.pollIntervalMs) || 500));
    const deadline = Date.now() + readinessTimeoutMs;

    let probeResult: { ok: boolean; status?: number; error?: string } = {
      ok: false,
      error: 'Preview server did not become ready before timeout.',
    };

    while (Date.now() <= deadline) {
      probeResult = await this.previewProbe(previewUrl, Math.min(4000, Math.max(500, deadline - Date.now())));
      if (probeResult.ok) break;
      if (Date.now() + pollIntervalMs > deadline) break;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    const checkedAt = new Date().toISOString();
    if (!probeResult.ok) {
      sandbox.previewStatus = 'failed';
      sandbox.previewPort = port;
      sandbox.previewUrl = undefined;
      sandbox.previewCommandExecutionId = execution.executionId;
      await this.store.saveSandbox(ctx, sandbox);
      await this.audit(ctx, 'preview_start', 'preview', sandbox.sandboxId, 'failed', {
        port,
        error: probeResult.error,
      });
      return {
        sandboxId: sandbox.sandboxId,
        workspaceId: sandbox.workspaceId,
        command: execution.command,
        port,
        status: 'failed',
        httpStatus: probeResult.status,
        executionId: execution.executionId,
        checkedAt,
        error: probeResult.error || 'Development server failed readiness verification.',
      };
    }

    sandbox.previewStatus = 'ready';
    sandbox.previewPort = port;
    sandbox.previewUrl = previewUrl;
    sandbox.previewCommandExecutionId = execution.executionId;
    sandbox.updatedAt = checkedAt;
    await this.store.saveSandbox(ctx, sandbox);
    await this.audit(ctx, 'preview_start', 'preview', sandbox.sandboxId, 'succeeded', {
      port,
      previewUrl,
      httpStatus: probeResult.status,
    });

    return {
      sandboxId: sandbox.sandboxId,
      workspaceId: sandbox.workspaceId,
      command: execution.command,
      port,
      status: 'ready',
      previewUrl,
      httpStatus: probeResult.status,
      executionId: execution.executionId,
      checkedAt,
    };
  }

  public async getPreviewStatus(ctx: DurableRequestContext, sandboxId: string): Promise<PreviewServerState> {
    const sandbox = await this.requireOwnedSandbox(ctx, sandboxId, true);
    const checkedAt = new Date().toISOString();

    if (!sandbox.previewUrl || !sandbox.previewPort || sandbox.status === 'stopped' || sandbox.status === 'expired') {
      return {
        sandboxId: sandbox.sandboxId,
        workspaceId: sandbox.workspaceId,
        command: '',
        port: sandbox.previewPort || 0,
        status: 'stopped',
        checkedAt,
      };
    }

    const probe = await this.previewProbe(sandbox.previewUrl, 5000);
    sandbox.previewStatus = probe.ok ? 'ready' : 'failed';
    sandbox.updatedAt = checkedAt;
    await this.store.saveSandbox(ctx, sandbox);

    return {
      sandboxId: sandbox.sandboxId,
      workspaceId: sandbox.workspaceId,
      command: '',
      port: sandbox.previewPort,
      status: probe.ok ? 'ready' : 'failed',
      previewUrl: probe.ok ? sandbox.previewUrl : undefined,
      httpStatus: probe.status,
      executionId: sandbox.previewCommandExecutionId,
      checkedAt,
      error: probe.ok ? undefined : probe.error,
    };
  }

  // -------------------------------------------------------------------------
  // 5. Verified Provider Webhook Handler
  // -------------------------------------------------------------------------

  public async handleProviderWebhook(params: {
    rawBody: string;
    signatureHeader?: string | null;
    secret?: string | null;
  }): Promise<{ accepted: boolean; eventType?: string; sandboxId?: string }> {
    const sig = verifyWebhookSignature(params);
    if (!sig.valid) {
      throw new SandboxEngineError({ code: 'INVALID_WEBHOOK_SIGNATURE', message: sig.reason, statusCode: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(params.rawBody);
    } catch {
      throw new SandboxEngineError({ code: 'INVALID_WEBHOOK_PAYLOAD', message: 'Malformed webhook JSON.', statusCode: 400 });
    }

    const eventType = String(payload?.event || payload?.type || 'unknown');
    const providerSandboxId = String(payload?.sandboxId || payload?.providerSandboxId || '');
    if (!providerSandboxId) {
      return { accepted: true, eventType };
    }

    const sandbox = await this.store.findSandboxByProviderId(providerSandboxId);
    if (!sandbox) {
      return { accepted: true, eventType };
    }

    const sysCtx: DurableRequestContext = { userId: sandbox.userId };
    if (eventType.includes('stop') || eventType.includes('kill') || eventType.includes('terminate')) {
      sandbox.status = 'stopped';
      sandbox.previewStatus = 'stopped';
      sandbox.cleanedUpAt = new Date().toISOString();
    } else if (eventType.includes('expire')) {
      sandbox.status = 'expired';
      sandbox.previewStatus = 'stopped';
      sandbox.cleanedUpAt = new Date().toISOString();
    } else if (eventType.includes('error')) {
      sandbox.status = 'error';
      sandbox.error = redactSensitiveExecutionText(String(payload?.error || 'Provider reported sandbox error.'));
    }

    sandbox.updatedAt = new Date().toISOString();
    await this.store.saveSandbox(sysCtx, sandbox);
    await this.audit(sysCtx, 'provider_webhook', 'webhook', sandbox.sandboxId, 'succeeded', { eventType });

    return { accepted: true, eventType, sandboxId: sandbox.sandboxId };
  }
}

export const defaultSandboxEngine = new SandboxExecutionEngine();
