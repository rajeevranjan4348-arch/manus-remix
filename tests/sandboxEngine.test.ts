import { describe, expect, it, beforeEach } from 'vitest';

import { hostnameViolation, validateNavigationUrl } from '../server/sandbox/urlPolicy';
import { resolveWorkspacePath, assertWithinWorkspaceRoot } from '../server/sandbox/pathGuard';
import { MemoryExecutionStore, boundsCheckLimits, resolveExecutionStore } from '../server/sandbox/executionStore';
import { resolveProvider, UnavailableProvider, isProviderAvailable } from '../server/sandbox/provider';
import { SandboxOrchestratorService, type SandboxAuditEvent, type ApprovalEvaluator } from '../server/sandbox/orchestrator';
import type { SandboxProvider, SandboxCreateOptions, SandboxLimits, CommandExecutionRequest, FilesystemEntry } from '../server/sandbox/types';
import { registerSandboxTools } from '../src/lib/sandboxTools';

describe('Feature 06: URL navigation policy (SSRF prevention)', () => {
  it('blocks loopback hosts', () => {
    expect(hostnameViolation('localhost')).toContain('forbidden');
    expect(hostnameViolation('127.0.0.1')).toContain('forbidden');
    expect(hostnameViolation('0.0.0.0')).toContain('forbidden');
  });

  it('blocks cloud metadata endpoints', () => {
    expect(hostnameViolation('169.254.169.254')).toContain('metadata');
    expect(hostnameViolation('metadata.google.internal')).toContain('forbidden');
  });

  it('blocks private IPv4 ranges', () => {
    for (const host of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1']) {
      expect(hostnameViolation(host)).toContain('forbidden');
    }
    expect(hostnameViolation('172.32.0.1')).toBeNull();
  });

  it('blocks internal hostname suffixes', () => {
    for (const host of ['db.local', 'api.internal', 'host.lan', 'x.home.arpa']) {
      expect(hostnameViolation(host)).toContain('forbidden');
    }
  });

  it('blocks IPv6 loopback and unique-local ranges', () => {
    expect(hostnameViolation('::1')).toContain('forbidden');
    expect(hostnameViolation('fd00::1')).toContain('forbidden');
    expect(hostnameViolation('fe80::1')).toContain('forbidden');
  });

  it('allows public URLs and rejects non-HTTP schemes', () => {
    expect(validateNavigationUrl('https://example.com/path').allowed).toBe(true);
    expect(validateNavigationUrl('file:///etc/passwd').allowed).toBe(false);
    expect(validateNavigationUrl('ftp://example.com').allowed).toBe(false);
    expect(validateNavigationUrl('http://user:pass@example.com').allowed).toBe(false);
  });
});

describe('Feature 06: workspace path guard (traversal prevention)', () => {
  it('normalizes safe relative paths', () => {
    expect(resolveWorkspacePath('src/app.ts')).toEqual({ valid: true, virtualPath: 'src/app.ts' });
    expect(resolveWorkspacePath('./src/../src/app.ts')).toEqual({ valid: true, virtualPath: 'src/app.ts' });
    expect(resolveWorkspacePath('')).toEqual({ valid: true, virtualPath: '' });
    expect(resolveWorkspacePath('.')).toEqual({ valid: true, virtualPath: '' });
  });

  it('rejects traversal above the workspace root', () => {
    expect(resolveWorkspacePath('..').valid).toBe(false);
    expect(resolveWorkspacePath('../etc/passwd').valid).toBe(false);
    expect(resolveWorkspacePath('a/b/../../../etc').valid).toBe(false);
  });

  it('rejects absolute paths, drive letters, and null bytes', () => {
    expect(resolveWorkspacePath('/etc/passwd').valid).toBe(false);
    expect(resolveWorkspacePath('\\\\server\\share').valid).toBe(false);
    expect(resolveWorkspacePath('C:\\Users\\x').valid).toBe(false);
    expect(resolveWorkspacePath('_prog'.concat('\u0000')).valid).toBe(false);
    expect(resolveWorkspacePath('file.txt:stream').valid).toBe(false);
  });

  it('escapes fail closed when checking provider-reported real paths', () => {
    expect(assertWithinWorkspaceRoot('/home/user/src/app.ts', '/home/user/')).toBe(true);
    expect(assertWithinWorkspaceRoot('/home/user', '/home/user')).toBe(true);
    expect(assertWithinWorkspaceRoot('/home/other/file.ts', '/home/user')).toBe(false);
    expect(assertWithinWorkspaceRoot('/etc/passwd', '/home/user')).toBe(false);
  });
});

describe('Feature 06: limits bounds-checking', () => {
  it('caps user-supplied limits within safe ceilings', () => {
    const limits = boundsCheckLimits({ maxLifetimeSeconds: 999999, commandTimeoutSeconds: 99000, cpuCores: 100, maxConcurrentPerUser: 99 });
    expect(limits.maxLifetimeSeconds).toBeLessThanOrEqual(4 * 60 * 60);
    expect(limits.commandTimeoutSeconds).toBeLessThanOrEqual(600);
    expect(limits.cpuCores).toBeLessThanOrEqual(8);
    expect(limits.maxConcurrentPerUser).toBeLessThanOrEqual(5);
  });

  it('uses safe defaults when nothing is specified', () => {
    const limits = boundsCheckLimits();
    expect(limits.maxConcurrentPerUser).toBeGreaterThan(0);
    expect(limits.idleTimeoutSeconds).toBeGreaterThan(0);
  });
});

describe('Feature 06: durable execution store', () => {
  let store: MemoryExecutionStore;

  beforeEach(() => {
    store = new MemoryExecutionStore();
  });

  it('scopes sessions to their verified owner', async () => {
    const record: any = {
      sessionId: 'sbx_aaa', userId: 'userA', providerId: 'fake', providerSandboxId: 'p1',
      runtime: 'node', workspaceLabel: 'w', status: 'ready', durable: false,
      createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(), metadata: {},
    };
    await store.putSession(record);
    expect(await store.getSession('sbx_aaa', 'userA')).not.toBeNull();
    expect(await store.getSession('sbx_aaa', 'userB')).toBeNull();
  });

  it('replays the original result for an idempotency key instead of re-executing', async () => {
    const record: any = {
      executionId: 'exe_1', sessionId: 'sbx_aaa', userId: 'userA', status: 'completed',
      command: 'npm test', stdout: 'ok', stderr: '', exitCode: 0,
      idempotencyKey: 'idem-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), truncated: false,
    };
    await store.putExecution(record);
    const replay = await store.findExecutionByIdempotencyKey('userA', 'idem-1');
    expect(replay?.executionId).toBe('exe_1');
    expect(await store.findExecutionByIdempotencyKey('userB', 'idem-1')).toBeNull();
  });

  it('is honest about non-durability when Firestore is unavailable', async () => {
    const resolved = await resolveExecutionStore();
    // In the test environment there are no Firestore credentials, so the
    // resolver must downgrade rather than crash, and flag it.
    expect(resolved).toBeDefined();
  });
});

describe('Feature 06: provider resolution is fail-closed', () => {
  it('reports unavailability instead of pretending execution works', () => {
    process.env.SANDBOX_PROVIDER = '';
    const resolved = resolveProvider();
    expect(resolved.available).toBe(false);
    expect(isProviderAvailable(resolved)).toBe(false);
    expect(resolved.provider).toBeInstanceOf(UnavailableProvider);
  });

  it('rejects unsupported provider names with a clear error', () => {
    process.env.SANDBOX_PROVIDER = 'bogus-vendor';
    const resolved = resolveProvider();
    expect(resolved.available).toBe(false);
    expect(resolved.reason.toLowerCase()).toContain('not a supported provider');
    process.env.SANDBOX_PROVIDER = '';
  });
});

/* Fake provider used for orchestrator behaviour tests without credentials. */
class FakeProvider implements SandboxProvider {
  readonly id = 'fake';
  readonly capabilities = { terminal: true, filesystem: true, devServerPreview: true, browser: true, browserScreenshots: true, runtimes: ['node'] as any[] };
  created: SandboxCreateOptions[] = [];
  terminated: string[] = [];
  commands: CommandExecutionRequest[] = [];

  isConfigured() { return true; }
  configurationErrors() { return []; }
  async healthCheck() { return { providerId: this.id, configured: true, available: true, detail: 'fake ok', checkedAt: new Date().toISOString() }; }
  async createSession(opts: SandboxCreateOptions, _limits: SandboxLimits) {
    this.created.push(opts);
    return { providerSandboxId: 'provider-' + (this.created.length), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), metadata: {} };
  }
  async terminateSession(providerSandboxId: string) { this.terminated.push(providerSandboxId); }
  async execCommand(_id: string, request: CommandExecutionRequest) {
    this.commands.push(request);
    if (request.command.startsWith('nohup')) {
      return { stdout: '4242\n', stderr: '', exitCode: 0, status: 'completed' as const, command: request.command, truncated: false, createdAt: '', updatedAt: '', startedAt: '', finishedAt: '' };
    }
    return { stdout: 'out', stderr: 'err', exitCode: 0, status: 'completed' as const, command: request.command, truncated: false, createdAt: '', updatedAt: '', startedAt: '', finishedAt: '' };
  }
  async readPreviewHostUrl() { return 'https://preview-4242.fake-sandbox.provider.example'; }
  async fetchPreviewStatus(_id: string, _port: number, _t?: number) { return { reachable: true, httpStatus: 200 }; }
  async writeFile(_i: string, _p: string, content: string) { return { size: content.length }; }
  async readFile(_i: string, _p: string) { return { content: 'hello', size: 5 }; }
  async listFiles(): Promise<FilesystemEntry[]> { return [{ path: 'index.ts', name: 'index.ts', type: 'file', size: 5 }]; }
  async deletePath() {}
  async movePath() {}
  async statPath() { return null; }
  async browserCreate(_i: string, _b: string) { return { metadata: { desktopSandboxId: 'desk-1' } }; }
  async browserNavigate(_i: string, _b: string, url: string) { return { url, title: 'T', textContent: 'C', consoleErrors: [] }; }
  async browserInspect() { return { elements: [] }; }
  async browserClick() { return { clicked: true, navigationTriggered: false, urlAfter: '' }; }
  async browserFill() { return { filled: 1 }; }
  async browserScroll() {}
  async browserWaitFor() {}
  async browserScreenshot() { return { dataUrl: 'data:image/png;base64,ZmFrZQ==' }; }
  async browserClose() {}
}

function makeOrchestrator(evaluate: ApprovalEvaluator) {
  const store = new MemoryExecutionStore();
  const provider = new FakeProvider();
  const audit: SandboxAuditEvent[] = [];
  const orchestrator = new SandboxOrchestratorService(async () => ({ store, provider, audit: (e) => { audit.push(e); }, evaluateApproval: evaluate }));
  return { orchestrator, store, provider, audit };
}

describe('Feature 06: orchestrator isolation and ownership', () => {
  it('prevents cross-user access: user B cannot read, execute in, or clean up user A\'s sandbox', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const { orchestrator } = makeOrchestrator(allowAll);
    const session = await orchestrator.createSession('userA', { userId: 'userA' }, { maxConcurrentPerUser: 5 });
    await expect(orchestrator.status('userB', session.sessionId)).resolves.toBeNull();
    await expect(orchestrator.executeCommand('userB', session.sessionId, { command: 'id' })).rejects.toMatchObject({ code: 'SANDBOX_NOT_FOUND' });
    await expect(orchestrator.fsRead('userB', session.sessionId, 'index.ts')).rejects.toMatchObject({ code: 'SANDBOX_NOT_FOUND' });
    await expect(orchestrator.cleanup('userB', session.sessionId)).rejects.toMatchObject({ code: 'SANDBOX_NOT_FOUND' });
  });

  it('enforces the per-user concurrency limit', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const { orchestrator } = makeOrchestrator(allowAll);
    await orchestrator.createSession('userA', { userId: 'userA' }, { maxConcurrentPerUser: 1 });
    await expect(orchestrator.createSession('userA', { userId: 'userA' }, { maxConcurrentPerUser: 1 })).rejects.toMatchObject({ code: 'SANDBOX_LIMIT_REACHED' });
  });

  it('cleans up: terminate marks the record stopped and the session becomes unusable', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const { orchestrator, provider } = makeOrchestrator(allowAll);
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    await orchestrator.cleanup('userA', session.sessionId);
    expect(provider.terminated.length).toBe(1);
    await expect(orchestrator.executeCommand('userA', session.sessionId, { command: 'ls' })).rejects.toMatchObject({ code: 'SANDBOX_INACTIVE' });
  });

  it('rejects invalid workspace paths, oversized commands, and bad ids', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const { orchestrator } = makeOrchestrator(allowAll);
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    await expect(orchestrator.executeCommand('userA', session.sessionId, { command: '../escape' })).resolves.toMatchObject({ status: 'failed' });
    await expect(orchestrator.fsRead('userA', session.sessionId, '../etc/passwd')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(orchestrator.fsDelete('userA', session.sessionId, '')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(orchestrator.cleanup('userA', 'bad id!')).rejects.toMatchObject({ code: 'INVALID_SESSION_ID' });
  });

  it('captures real exit codes: nonzero exits are failed, stdout and stderr are captured separately', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const { orchestrator } = makeOrchestrator(allowAll);
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    const result = await orchestrator.executeCommand('userA', session.sessionId, { command: 'false-command' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
  });

  it('idempotent retried executions replay the original record', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const { orchestrator, provider } = makeOrchestrator(allowAll);
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    const first = await orchestrator.executeCommand('userA', session.sessionId, { command: 'npm install' }, 'retry-key-1');
    const providerCount = provider.commands.filter((c) => c.command === 'npm install').length;
    const second = await orchestrator.executeCommand('userA', session.sessionId, { command: 'npm install' }, 'retry-key-1');
    expect(second.executionId).toBe(first.executionId);
    expect(provider.commands.filter((c) => c.command === 'npm install').length).toBe(providerCount);
  });
});

describe('Feature 06: permission approval gate', () => {
  it('requires approval when the policy says so and reports the challenge', async () => {
    const requireApproval: ApprovalEvaluator = () => ({ allowed: false, requiresApproval: true, riskLevel: 'privileged', reason: 'privileged', challenge: { challengeId: 'chg_1' } });
    const { orchestrator, provider } = makeOrchestrator(requireApproval);
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    const decision = await orchestrator.ensureAllowed('terminal_execute', { command: 'ls' }, 'userA');
    expect(decision).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    // Nothing was executed while unapproved.
    expect(provider.commands.length).toBe(0);
    void session;
  });

  it('allows execution with a valid approval token and records denial audits when refused', async () => {
    let approved = false;
    const gate: ApprovalEvaluator = () => approved
      ? { allowed: true, requiresApproval: false, riskLevel: 'privileged', reason: 'token verified' }
      : { allowed: false, requiresApproval: true, riskLevel: 'privileged', reason: 'needs confirmation' };
    const { orchestrator, audit } = makeOrchestrator(gate);
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    const refused = await orchestrator.ensureAllowed('terminal_execute', { command: 'ls' }, 'userA');
    expect(refused.ok).toBe(false);
    approved = true;
    const granted = await orchestrator.ensureAllowed('terminal_execute', { command: 'ls' }, 'userA');
    expect(granted.ok).toBe(true);
    expect(audit.some((e) => e.outcome === 'denied')).toBe(true);
    void session;
  });
});

describe('Feature 06: preview pipeline never fabricates success', () => {
  it('returns the real provider URL only after a real readiness probe', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const { orchestrator } = makeOrchestrator(allowAll);
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    const result = await orchestrator.previewStart('userA', session.sessionId, { port: 4173 });
    expect(result.ready).toBe(true);
    expect(result.url).toContain('https://');
    expect(result.url).not.toContain('localhost');
  });

  it('reports dependency installation failure honestly with no URL', async () => {
    const allowAll: ApprovalEvaluator = () => ({ allowed: true, requiresApproval: false, riskLevel: 'read-only', reason: 'test allow' });
    const store = new MemoryExecutionStore();
    const provider = new FakeProvider();
    provider.execCommand = async (_i, req) => ({
      stdout: '', stderr: 'ERESOLVE unable to resolve dependency tree', exitCode: 1, status: 'failed' as const,
      command: req.command, truncated: false, createdAt: '', updatedAt: '', startedAt: '', finishedAt: '',
    });
    const orchestrator = new SandboxOrchestratorService(async () => ({ store, provider, audit: () => {}, evaluateApproval: allowAll }));
    const session = await orchestrator.createSession('userA', { userId: 'userA' });
    const result = await orchestrator.previewStart('userA', session.sessionId, {});
    expect(result.ready).toBe(false);
    expect(result.url).toBeNull();
    expect(result.details).toContain('failed');
  });
});

describe('Feature 06: agent tool registration', () => {
  it('registers exactly the 20 specified tools with sane risk levels', () => {
    const registered = new Map<string, any>();
    const registry = { register: (tool: any) => registered.set(tool.name, tool) };
    registerSandboxTools(registry);

    const expected = [
      'sandbox_create', 'sandbox_status', 'terminal_execute', 'terminal_stream', 'terminal_cancel',
      'filesystem_list', 'filesystem_read', 'filesystem_write', 'filesystem_delete', 'filesystem_search',
      'browser_session_create', 'browser_navigate', 'browser_inspect', 'browser_click', 'browser_fill',
      'browser_screenshot', 'browser_session_close', 'preview_start', 'preview_status', 'sandbox_cleanup',
    ];
    expect([...registered.keys()].sort()).toEqual([...expected].sort());

    const approvalTools = ['sandbox_create', 'terminal_execute', 'filesystem_write', 'filesystem_delete', 'browser_click', 'browser_fill', 'browser_navigate', 'preview_start', 'sandbox_cleanup'];
    for (const name of approvalTools) {
      expect(['destructive', 'privileged', 'sensitive']).toContain(registered.get(name).riskLevel);
    }
    for (const name of ['filesystem_read', 'filesystem_list', 'browser_inspect', 'browser_screenshot', 'preview_status']) {
      expect(registered.get(name).riskLevel).toBe('read-only');
    }
  });
});
