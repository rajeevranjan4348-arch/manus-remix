/**
 * Sandbox orchestrator (Feature 06).
 *
 * Owns the durable session lifecycle, cross-tenant isolation (every record is
 * keyed to the verified Firebase user id), workspace ownership enforcement,
 * preview pipelines, and audit logging. It never applies user identity from
 * request payloads: only the verified bearer-token subject may act on a session.
 */

import type { BrowserSessionStatus, CommandExecutionRecord, CommandExecutionRequest,
  FilesystemEntry, RuntimeId, SandboxCreateOptions, SandboxLimits, SandboxSessionRecord } from './types';
import type { ExecutionStore } from './executionStore';
import { MemoryExecutionStore, boundsCheckLimits } from './executionStore';
import type { SandboxProvider } from './types';
import { resolveWorkspacePath } from './pathGuard';
import { validateNavigationUrl } from './urlPolicy';

export type ActionCategory = 'terminal' | 'filesystem' | 'browser' | 'preview' | 'session';

export interface SandboxAuditEvent {
  at: string;
  userId: string;
  action: string;
  category: ActionCategory;
  sessionId?: string;
  outcome: 'allowed' | 'denied' | 'failed' | 'succeeded';
  detail?: string;
}

export interface ApprovalDecisionContext {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  approvalToken?: string;
}

/**
 * Server-side permission hook. The Netlify function injects
 * server/permissionsGateway.evaluateAction here, keeping wiring testable.
 */
export type ApprovalEvaluator = (ctx: ApprovalDecisionContext) => {
  allowed: boolean;
  requiresApproval: boolean;
  riskLevel: string;
  reason: string;
  challenge?: unknown;
};

export interface OrchestrationServices {
  store: ExecutionStore;
  provider: SandboxProvider;
  audit: (event: SandboxAuditEvent) => void;
  evaluateApproval: ApprovalEvaluator;
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;
const BROWSER_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function makeId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export class SandboxOrchestratorService {
  constructor(private readonly services: () => Promise<OrchestrationServices>) {}

  /* ---------- Approval gate ---------- */

  async ensureAllowed(toolName: string, args: Record<string, unknown>, userId: string, approvalToken?: string): Promise<{ ok: true } | { ok: false; status: number; code: string; reason: string; challenge?: unknown }> {
    const svc = await this.services();
    const decision = svc.evaluateApproval({ toolName, args, userId, approvalToken });
    if (decision.allowed) return { ok: true };
    svc.audit({
      at: new Date().toISOString(),
      userId,
      action: toolName,
      category: 'session',
      outcome: 'denied',
      detail: decision.reason,
    });
    return {
      ok: false,
      status: decision.requiresApproval ? 403 : 403,
      code: decision.requiresApproval ? 'APPROVAL_REQUIRED' : 'PERMISSION_DENIED',
      reason: decision.reason,
      challenge: decision.challenge,
    };
  }

  /* ---------- Session lifecycle ---------- */

  async createSession(userId: string, options: SandboxCreateOptions, limits?: Partial<SandboxLimits>): Promise<SandboxSessionRecord> {
    const svc = await this.services();
    const effective: SandboxLimits = boundsCheckLimits(limits);

    const existing = await svc.store.listSessionsForUser(userId);
    const active = existing.filter((s) => ['creating', 'ready', 'busy'].includes(s.status));
    if (active.length >= effective.maxConcurrentPerUser) {
      throw Object.assign(new Error(`Sandbox limit reached: at most ${effective.maxConcurrentPerUser} concurrent sandboxes per user. Clean one up first.`), { code: 'SANDBOX_LIMIT_REACHED' });
    }

    const sessionId = makeId('sbx');
    const workspaceLabel = String(options.workspaceLabel || 'workspace').slice(0, 100).replace(/[^a-zA-Z0-9._ -]/g, '');
    const record: SandboxSessionRecord = {
      sessionId,
      userId,
      providerId: svc.provider.id,
      providerSandboxId: null,
      runtime: (options.runtime || 'node') as RuntimeId,
      workspaceLabel,
      status: 'creating',
      durable: svc.store.durable,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + effective.maxLifetimeSeconds * 1000).toISOString(),
      metadata: {},
    };
    await svc.store.putSession(record);
    svc.audit({ at: new Date().toISOString(), userId, action: 'sandbox_create', category: 'session', sessionId, outcome: 'allowed' });

    try {
      const created = await svc.provider.createSession({ ...options, userId, workspaceLabel }, effective);
      record.providerSandboxId = created.providerSandboxId;
      record.status = 'ready';
      record.expiresAt = created.expiresAt;
      record.metadata = created.metadata;
      await svc.store.putSession(record);
      return { ...record };
    } catch (err: any) {
      record.status = 'failed';
      record.metadata = { failureReason: String(err?.message || 'sandbox creation failed') };
      await svc.store.putSession(record);
      throw err;
    }
  }

  /** Ownership check: only the verified owner (or nobody) may touch a session. */
  async requireOwnedSession(userId: string, sessionId: string): Promise<SandboxSessionRecord> {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw Object.assign(new Error('Invalid session id.'), { code: 'INVALID_SESSION_ID', status: 400 });
    }
    const svc = await this.services();
    const record = await svc.store.getSession(sessionId, userId);
    if (!record) {
      svc.audit({ at: new Date().toISOString(), userId, action: 'sandbox_access', category: 'session', sessionId, outcome: 'denied', detail: 'No owned session.' });
      throw Object.assign(new Error('Sandbox not found for this user.'), { code: 'SANDBOX_NOT_FOUND', status: 404 });
    }
    this.assertNotExpired(record);
    return record;
  }

  private assertNotExpired(record: SandboxSessionRecord): void {
    if (new Date(record.expiresAt).getTime() < Date.now() && record.status !== 'stopped') {
      record.status = 'expired';
    }
    if (['stopped', 'expired', 'failed'].includes(record.status)) {
      throw Object.assign(new Error(`Sandbox session is ${record.status}.`), { code: 'SANDBOX_INACTIVE', status: 409 });
    }
  }

  async status(userId: string, sessionId: string): Promise<SandboxSessionRecord | null> {
    const svc = await this.services();
    if (!SESSION_ID_PATTERN.test(sessionId)) return null;
    return svc.store.getSession(sessionId, userId);
  }

  async listSessions(userId: string): Promise<SandboxSessionRecord[]> {
    const svc = await this.services();
    return svc.store.listSessionsForUser(userId);
  }

  async touch(record: SandboxSessionRecord): Promise<void> {
    const svc = await this.services();
    record.lastActiveAt = new Date().toISOString();
    await svc.store.putSession(record);
  }

  /** Terminate sandbox, close browser sessions, mark records. Idempotent. */
  async cleanup(userId: string, sessionId: string): Promise<{ terminated: boolean }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    let terminated = false;
    if (record.status === 'ready' || record.status === 'busy') {
      try {
        if (record.providerSandboxId) {
          await svc.provider.terminateSession(record.providerSandboxId);
          terminated = true;
        }
      } catch (err: any) {
        svc.audit({ at: new Date().toISOString(), userId, action: 'sandbox_cleanup', category: 'session', sessionId, outcome: 'failed', detail: String(err?.message || '') });
      }
    }
    record.status = 'stopped';
    await svc.store.putSession(record);
    svc.audit({ at: new Date().toISOString(), userId, action: 'sandbox_cleanup', category: 'session', sessionId, outcome: 'succeeded' });
    return { terminated };
  }

  /**
   * Idle expiration sweep. Called opportunistically on each sandbox API hit;
   * sandbox records past their idle timeout are terminated. Never throws.
   */
  async sweepExpired(userId: string): Promise<number> {
    const svc = await this.services();
    let cleaned = 0;
    const sessions = await svc.store.listSessionsForUser(userId);
    const now = Date.now();
    for (const record of sessions) {
      if (['creating', 'ready', 'busy'].includes(record.status)) {
        const lifetimeExpired = new Date(record.expiresAt).getTime() < now;
        const idleExpired = now - new Date(record.lastActiveAt).getTime() > DEFAULT_IDLE_SECONDS * 1000;
        if (lifetimeExpired || idleExpired) {
          try {
            await this.cleanup(userId, record.sessionId);
            cleaned += 1;
          } catch { /* leave for next sweep */ }
        }
      }
    }
    return cleaned;
  }

  /* ---------- Terminal execution ---------- */

  async executeCommand(userId: string, sessionId: string, request: CommandExecutionRequest, idempotencyKey?: string): Promise<CommandExecutionRecord> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const cwdCheck = request.cwd !== undefined ? resolveWorkspacePath(request.cwd) : { valid: true, virtualPath: '' };
    if (!cwdCheck.valid) {
      throw Object.assign(new Error(cwdCheck.error || 'Invalid working directory'), { code: 'INVALID_PATH', status: 400 });
    }
    if (typeof request.command !== 'string' || request.command.trim().length === 0 || request.command.length > 4000) {
      throw Object.assign(new Error('A command between 1 and 4000 characters is required.'), { code: 'INVALID_COMMAND', status: 400 });
    }

    if (idempotencyKey) {
      const prior = await svc.store.findExecutionByIdempotencyKey(userId, idempotencyKey);
      if (prior && !['queued', 'running'].includes(prior.status)) {
        return prior; // replay the original result exactly; never re-execute
      }
    }

    const executionId = makeId('exe');
    const now = new Date().toISOString();
    const execRecord: CommandExecutionRecord = {
      executionId,
      sessionId,
      userId,
      status: 'queued',
      command: request.command,
      cwd: request.cwd,
      stdout: '',
      stderr: '',
      exitCode: null,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
      truncated: false,
    };
    await svc.store.putExecution(execRecord);

    if (!record.providerSandboxId) {
      execRecord.status = 'failed';
      execRecord.error = 'Sandbox has no provider instance. Recreate the session.';
      execRecord.updatedAt = new Date().toISOString();
      await svc.store.putExecution(execRecord);
      return execRecord;
    }

    execRecord.status = 'running';
    execRecord.startedAt = new Date().toISOString();
    execRecord.updatedAt = execRecord.startedAt;
    await svc.store.putExecution(execRecord).catch(() => {});

    try {
      const result = await svc.provider.execCommand(record.providerSandboxId, {
        command: request.command,
        cwd: request.cwd,
        timeoutSeconds: request.timeoutSeconds,
        env: request.env,
      });
      const finished: CommandExecutionRecord = {
        ...execRecord,
        ...result,
        executionId,
        sessionId,
        userId,
        updatedAt: new Date().toISOString(),
      };
      await svc.store.putExecution(finished);
      await svc.audit({ at: finished.updatedAt, userId, action: 'terminal_execute', category: 'terminal', sessionId, outcome: result.status === 'completed' ? 'succeeded' : 'failed', detail: result.status });
      await this.touch(record);
      return finished;
    } catch (err: any) {
      const failedRecord: CommandExecutionRecord = {
        ...execRecord,
        status: 'failed',
        error: String(err?.message || 'execution failed'),
        updatedAt: new Date().toISOString(),
      };
      await svc.store.putExecution(failedRecord).catch(() => {});
      svc.audit({ at: failedRecord.updatedAt, userId, action: 'terminal_execute', category: 'terminal', sessionId, outcome: 'failed', detail: failedRecord.error });
      return failedRecord;
    }
  }

  async getExecution(userId: string, executionId: string): Promise<CommandExecutionRecord | null> {
    const svc = await this.services();
    return svc.store.getExecution(executionId, userId); // records are owner-scoped
  }

  async cancelExecution(userId: string, executionId: string): Promise<CommandExecutionRecord | null> {
    const svc = await this.services();
    const record = await svc.store.getExecution(executionId, userId);
    if (!record) return null;
    if (!['queued', 'running'].includes(record.status)) return record;
    // Best-effort remote kill inside the sandbox; the durable record always
    // flips to cancelled even when the process already finished.
    record.status = 'cancelled';
    record.updatedAt = new Date().toISOString();
    record.error = 'Cancelled by user request.';
    await svc.store.putExecution(record);
    if (record.sessionId) {
      const session = await svc.store.getSession(record.sessionId, userId);
      if (session?.providerSandboxId) {
        await svc.provider.execCommand(session.providerSandboxId, { command: 'pkill -f "manus-cmd" || true', timeoutSeconds: 5 }).catch(() => null);
      }
    }
    return record;
  }

  /* ---------- Filesystem ---------- */

  async fsList(userId: string, sessionId: string, dir: string): Promise<FilesystemEntry[]> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    if (!record.providerSandboxId) throw Object.assign(new Error('Sandbox is not active.'), { code: 'SANDBOX_INACTIVE', status: 409 });
    return svc.provider.listFiles(record.providerSandboxId, dir);
  }

  async fsRead(userId: string, sessionId: string, path: string): Promise<{ content: string; size: number }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const resolved = resolveWorkspacePath(path);
    if (!resolved.valid || !resolved.virtualPath) {
      throw Object.assign(new Error(resolved.error || 'A file path is required.'), { code: 'INVALID_PATH', status: 400 });
    }
    if (!record.providerSandboxId) throw Object.assign(new Error('Sandbox is not active.'), { code: 'SANDBOX_INACTIVE', status: 409 });
    const result = await svc.provider.readFile(record.providerSandboxId, resolved.virtualPath);
    await this.auditFs(svc, userId, 'filesystem_read', sessionId, 'succeeded');
    return result;
  }

  async fsWrite(userId: string, sessionId: string, path: string, content: string, createDirectories: boolean): Promise<{ size: number }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const resolved = resolveWorkspacePath(path);
    if (!resolved.valid || !resolved.virtualPath) {
      throw Object.assign(new Error(resolved.error || 'A file path is required.'), { code: 'INVALID_PATH', status: 400 });
    }
    const byteLength = new TextEncoder ? new TextEncoder().encode(content).length : content.length;
    if (byteLength > MAX_FILE_BYTES_LIMIT) {
      throw Object.assign(new Error('File exceeds the 25MB limit.'), { code: 'FILE_TOO_LARGE', status: 413 });
    }
    if (!record.providerSandboxId) throw Object.assign(new Error('Sandbox is not active.'), { code: 'SANDBOX_INACTIVE', status: 409 });
    const result = await svc.provider.writeFile(record.providerSandboxId, resolved.virtualPath, content, createDirectories !== false);
    await this.auditFs(svc, userId, 'filesystem_write', sessionId, 'succeeded', resolved.virtualPath);
    return result;
  }

  async fsDelete(userId: string, sessionId: string, path: string): Promise<void> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const resolved = resolveWorkspacePath(path);
    if (!resolved.valid || !resolved.virtualPath || resolved.virtualPath === '') {
      throw Object.assign(new Error('The workspace root cannot be deleted.'), { code: 'INVALID_PATH', status: 400 });
    }
    if (!record.providerSandboxId) throw Object.assign(new Error('Sandbox is not active.'), { code: 'SANDBOX_INACTIVE', status: 409 });
    await svc.provider.deletePath(record.providerSandboxId, resolved.virtualPath);
    await this.auditFs(svc, userId, 'filesystem_delete', sessionId, 'succeeded', resolved.virtualPath);
  }

  async fsMove(userId: string, sessionId: string, from: string, to: string): Promise<void> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    if (!record.providerSandboxId) throw Object.assign(new Error('Sandbox is not active.'), { code: 'SANDBOX_INACTIVE', status: 409 });
    await svc.provider.movePath(record.providerSandboxId, from, to);
    await this.auditFs(svc, userId, 'filesystem_move', sessionId, 'succeeded', from + ' -> ' + to);
  }

  async fsSearch(userId: string, sessionId: string, query: string): Promise<{ matches: Array<{ path: string; type: string }> }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    if (!record.providerSandboxId) throw Object.assign(new Error('Sandbox is not active.'), { code: 'SANDBOX_INACTIVE', status: 409 });
    const safeQuery = String(query || '').replace(/["'\\|;&<>(){}[\]$!*?~\n\r]/g, '').trim();
    if (!safeQuery || safeQuery.length > 120) {
      throw Object.assign(new Error('A search term up to 120 characters is required.'), { code: 'INVALID_QUERY', status: 400 });
    }
    const result = await svc.provider.execCommand(record.providerSandboxId, {
      command: `grep -rIl --exclude-dir=node_modules --exclude-dir=.git ${JSON.stringify(safeQuery)} /home/user 2>/dev/null | head -100`,
      timeoutSeconds: 30,
    });
    const matches = result.stdout.split('\n').map((p) => p.replace('/home/user/', '').trim()).filter(Boolean).map((path) => ({ path, type: 'file' }));
    return { matches };
  }

  private async auditFs(svc: OrchestrationServices, userId: string, action: string, sessionId: string, outcome: SandboxAuditEvent['outcome'], detail?: string): Promise<void> {
    svc.audit({ at: new Date().toISOString(), userId, action, category: 'filesystem', sessionId, outcome, detail });
  }

  /* ---------- Browser sessions ---------- */

  async browserCreate(userId: string, sessionId: string): Promise<{ browserSessionId: string }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const browserSessionId = makeId('brw');
    let providerMetadata: Record<string, unknown> = {};
    try {
      const created = await svc.provider.browserCreate(record.providerSandboxId || '', browserSessionId);
      providerMetadata = (created && (created as any).metadata) || {};
    } catch (err: any) {
      throw err;
    }
    const browserRecord = {
      browserSessionId,
      sessionId,
      userId,
      status: 'ready' as BrowserSessionStatus,
      createdAt: new Date().toISOString(),
    };
    await svc.store.putBrowserSession(browserRecord);
    await svc.store.putSession({ ...record, metadata: { ...record.metadata, browserSessions: [...(Object.keys(providerMetadata))] } }).catch(() => {});
    await svc.provider.browserCreate(record.providerSandboxId || '', browserSessionId, providerMetadata).catch(() => {});
    record.metadata = { ...record.metadata, ['browserSession_' + browserSessionId]: providerMetadata };
    await (await this.services()).store.putSession(record);
    svc.audit({ at: new Date().toISOString(), userId, action: 'browser_session_create', category: 'browser', sessionId, outcome: 'succeeded' });
    return { browserSessionId };
  }

  private async requireOwnedBrowserSession(userId: string, sessionId: string, browserSessionId: string) {
    if (!BROWSER_SESSION_ID_PATTERN.test(browserSessionId)) {
      throw Object.assign(new Error('Invalid browser session id.'), { code: 'INVALID_BROWSER_SESSION', status: 400 });
    }
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const record = await svc.store.getBrowserSession(browserSessionId, userId);
    if (!record || record.sessionId !== sessionId) {
      throw Object.assign(new Error('Browser session not found for this user.'), { code: 'BROWSER_SESSION_NOT_FOUND', status: 404 });
    }
    if (record.status === 'closed') {
      throw Object.assign(new Error('Browser session is closed.'), { code: 'BROWSER_SESSION_CLOSED', status: 409 });
    }
    return { svc, browserRecord: record };
  }

  private async withBrowserSessionRecord<T>(userId: string, sessionId: string, browserSessionId: string, action: string, fn: () => Promise<T>, onDone?: (r: SandboxSessionRecord) => Promise<void>): Promise<T> {
    const { svc, browserRecord } = await this.requireOwnedBrowserSession(userId, sessionId, browserSessionId);
    browserRecord.status = 'ready';
    return fn();
  }

  async browserNavigate(userId: string, sessionId: string, browserSessionId: string, url: string, timeoutMs = 20000): Promise<{ url: string; title: string; textContent: string; consoleErrors: string[] }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const { browserRecord } = await this.requireOwnedBrowserSession(userId, sessionId, browserSessionId);
    const decision = validateNavigationUrl(url);
    if (!decision.allowed) {
      svc.audit({ at: new Date().toISOString(), userId, action: 'browser_navigate', category: 'browser', sessionId, outcome: 'denied', detail: decision.reason });
      throw Object.assign(new Error(decision.reason || 'Blocked'), { code: 'NAVIGATION_BLOCKED', status: 403 });
    }
    const restore = record.metadata['browserSession_' + browserSessionId] as Record<string, unknown> | undefined;
    const result = await svc.provider.browserNavigate(record.providerSandboxId || '', browserSessionId, url, timeoutMs);
    void browserRecord;
    svc.audit({ at: new Date().toISOString(), userId, action: 'browser_navigate', category: 'browser', sessionId, outcome: 'succeeded', detail: decision.normalizedUrl });
    return result;
  }

  async browserInspect(userId: string, sessionId: string, browserSessionId: string, selector?: string, limit?: number): Promise<any> {
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const record = await svc.store.getSession(sessionId, userId);
    const restore = record?.metadata['browserSession_' + browserSessionId] as Record<string, unknown> | undefined;
    await svc.provider.browserCreate(record?.providerSandboxId || '', browserSessionId, restore);
    return svc.provider.browserInspect(record?.providerSandboxId || '', browserSessionId, selector, limit);
  }

  async browserClick(userId: string, sessionId: string, browserSessionId: string, selector: string): Promise<any> {
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    if (!selector || selector.length > 500) throw Object.assign(new Error('A CSS selector up to 500 characters is required.'), { code: 'INVALID_SELECTOR', status: 400 });
    const result = await svc.provider.browserClick((await svc.store.getSession(sessionId, userId))?.providerSandboxId || '', browserSessionId, selector);
    svc.audit({ at: new Date().toISOString(), userId, action: 'browser_click', category: 'browser', sessionId, outcome: 'succeeded', detail: selector });
    return result;
  }

  async browserFill(userId: string, sessionId: string, browserSessionId: string, fields: Array<{ selector: string; value: string; type?: string }>): Promise<any> {
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if ((f?.type === 'password') && typeof f.value === 'string') f.value = f.value; // passwords are filled inside the sandbox only; never echoed back
      }
    }
    const result = await svc.provider.browserFill((await svc.store.getSession(sessionId, userId))?.providerSandboxId || '', browserSessionId, fields);
    svc.audit({ at: new Date().toISOString(), userId, action: 'browser_fill', category: 'browser', sessionId, outcome: 'succeeded', detail: `${fields?.length || 0} fields` });
    return result;
  }

  async browserScroll(userId: string, sessionId: string, browserSessionId: string, direction: 'up' | 'down', pixels: number): Promise<void> {
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    return svc.provider.browserScroll((await svc.store.getSession(sessionId, userId))?.providerSandboxId || '', browserSessionId, direction, pixels);
  }

  async browserWaitFor(userId: string, sessionId: string, browserSessionId: string, condition: 'navigation' | 'selector', value: string, timeoutMs: number): Promise<void> {
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    return svc.provider.browserWaitFor((await svc.store.getSession(sessionId, userId))?.providerSandboxId || '', browserSessionId, condition, value, timeoutMs);
  }

  async browserScreenshot(userId: string, sessionId: string, browserSessionId: string): Promise<{ dataUrl: string }> {
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    const result = await svc.provider.browserScreenshot((await svc.store.getSession(sessionId, userId))?.providerSandboxId || '', browserSessionId);
    svc.audit({ at: new Date().toISOString(), userId, action: 'browser_screenshot', category: 'browser', sessionId, outcome: 'succeeded' });
    return result;
  }

  async browserClose(userId: string, sessionId: string, browserSessionId: string): Promise<void> {
    await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    await svc.provider.browserClose((await svc.store.getSession(sessionId, userId))?.providerSandboxId || '', browserSessionId);
    await svc.store.deleteBrowserSession(browserSessionId, userId);
    svc.audit({ at: new Date().toISOString(), userId, action: 'browser_session_close', category: 'browser', sessionId, outcome: 'succeeded' });
  }

  /* ---------- Preview pipeline ---------- */

  /**
   * Install dependencies and start a dev server. Every reported step status
   * comes from a real probe; failures are reported as failures. No preview
   * URL is ever fabricated.
   */
  async previewStart(userId: string, sessionId: string, opts: { installCommand?: string; startCommand?: string; port?: number; cwd?: string; timeoutSeconds?: number }): Promise<{ step: string; url: string | null; ready: boolean; details: string }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    if (!record.providerSandboxId) throw Object.assign(new Error('Sandbox is not active.'), { code: 'SANDBOX_INACTIVE', status: 409 });
    await this.touch(record);

    const port = Math.min(Math.max(1024, Math.round(opts.port || 3000)), 65535);
    const cwd = opts.cwd !== undefined ? resolveWorkspacePath(opts.cwd).virtualPath || '' : '';
    const installCommand = (opts.installCommand || 'npm install').slice(0, 300);
    const startCommand = (opts.startCommand || 'npm run dev -- --host 0.0.0.0').slice(0, 300);

    const installResult = await svc.provider.execCommand(record.providerSandboxId, { command: installCommand, cwd, timeoutSeconds: Math.min(opts.timeoutSeconds || 240, 480) });
    if (installResult.status !== 'completed') {
      svc.audit({ at: new Date().toISOString(), userId, action: 'preview_start', category: 'preview', sessionId, outcome: 'failed', detail: 'Dependency installation failed.' });
      return { step: 'install', url: null, ready: false, details: `Dependency installation failed (exit ${installResult.exitCode}). stderr: ${(installResult.stderr || '').slice(-500)}` };
    }

    // Start the dev server detached inside the sandbox.
    const detached = await svc.provider.execCommand(record.providerSandboxId, {
      command: `nohup sh -c ${JSON.stringify(startCommand)} > /home/user/.manus-preview.log 2>&1 & echo $!`,
      cwd,
      timeoutSeconds: 20,
    });
    if (detached.status !== 'completed') {
      return { step: 'start', url: null, ready: false, details: `Dev server failed to start: ${(detached.stderr || '').slice(-500)}` };
    }

    // Readiness probing with honest failure reporting.
    const deadline = Date.now() + 60_000;
    let lastStatus = '';
    while (Date.now() < deadline) {
      const probe = await svc.provider.fetchPreviewStatus(record.providerSandboxId, port, 3000).catch((err: any) => ({ reachable: false, httpStatus: null, error: String(err?.message || '') }));
      lastStatus = probe.httpStatus ? `HTTP ${probe.httpStatus}` : (probe.error || 'unreachable');
      if (probe.httpStatus && probe.httpStatus > 0) {
        const url = await svc.provider.readPreviewHostUrl(record.providerSandboxId, port);
        if (url) {
          svc.audit({ at: new Date().toISOString(), userId, action: 'preview_start', category: 'preview', sessionId, outcome: 'succeeded', detail: url });
          return { step: 'ready', url, ready: true, details: `Preview server is live (${lastStatus}).` };
        }
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    const logTailResult = await svc.provider.execCommand(record.providerSandboxId, { command: 'tail -c 2000 /home/user/.manus-preview.log 2>/dev/null || true', timeoutSeconds: 10 }).catch(() => null);
    svc.audit({ at: new Date().toISOString(), userId, action: 'preview_start', category: 'preview', sessionId, outcome: 'failed', detail: 'Readiness timeout' });
    return { step: 'ready-probe', url: null, ready: false, details: `Dev server did not become reachable within 60s (${lastStatus}). Log tail: ${(logTailResult?.stdout || '').slice(-500)}` };
  }

  async previewStatus(userId: string, sessionId: string, port = 3000): Promise<{ ready: boolean; url: string | null; httpStatus: number | null; error?: string }> {
    const record = await this.requireOwnedSession(userId, sessionId);
    const svc = await this.services();
    if (!record.providerSandboxId) return { ready: false, url: null, httpStatus: null, error: 'Sandbox is not active.' };
    const probe = await svc.provider.fetchPreviewStatus(record.providerSandboxId, port, 4000).catch((err: any) => ({ reachable: false, httpStatus: null, error: String(err?.message || '') }));
    const url = await svc.provider.readPreviewHostUrl(record.providerSandboxId, port).catch(() => null);
    return { ready: Boolean(probe.httpStatus && probe.httpStatus > 0), url, httpStatus: probe.httpStatus, error: probe.error };
  }
}

const DEFAULT_IDLE_SECONDS = 5 * 60;
const MAX_FILE_BYTES_LIMIT = 25 * 1024 * 1024;

export const SANDBOX_AUDIT_LOG: SandboxAuditEvent[] = [];

/** Bounded audit sink shared by the Netlify function. */
export function recordAuditEvent(event: SandboxAuditEvent): void {
  SANDBOX_AUDIT_LOG.push(event);
  if (SANDBOX_AUDIT_LOG.length > 500) SANDBOX_AUDIT_LOG.splice(0, SANDBOX_AUDIT_LOG.length - 400);
}
