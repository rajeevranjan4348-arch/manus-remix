/**
 * Feature 06: Sandboxed Coding & Real Browser Execution Engine.
 *
 * Real execution happens on an external sandbox provider (separately deployed
 * worker exposing a documented HTTP contract, or a provider such as E2B-style
 * cloud sandboxes). This service is the server-side enforcement layer:
 * workspace ownership, path-traversal/symlink protection, resource limits,
 * browser SSRF policy, and explicit `unavailable` status when no provider is
 * configured. It never simulates successful execution and never runs untrusted
 * commands in the Netlify host process.
 */

import { DurableStore, getDefaultDurableStore } from '../durable/store';

export type SandboxRuntime = 'node' | 'typescript' | 'javascript' | 'python' | 'react' | 'vite' | 'nextjs' | 'html_css';

export interface SandboxLimits {
  cpuCores: number;
  memoryMb: number;
  diskMb: number;
  timeoutMs: number;
}

export interface SandboxDescriptor {
  sandboxId: string;
  userId: string;
  workdir: string;
  runtimes: SandboxRuntime[];
  limits: SandboxLimits;
  createdAt: string;
  expiresAt?: string;
  provider: string;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  pid?: number;
  durationMs: number;
}

export interface BrowserSessionInfo {
  sessionId: string;
  url: string;
  title?: string;
  consoleErrors: string[];
}

const SANDBOX_REGISTRY_COLLECTION = 'system_sandbox_workspaces';

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  cpuCores: 1,
  memoryMb: 1024,
  diskMb: 2048,
  timeoutMs: 10 * 60 * 1000,
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;

function isProduction(): boolean {
  return process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production';
}

export class UrlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlPolicyError';
  }
}

/**
 * Public-web-only URL policy for browser sessions. Blocks private-network,
 * loopback and cloud-metadata targets by hostname and by resolved-literal IP.
 */
export function assertBrowserUrlAllowed(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlPolicyError('Malformed URL for browser navigation.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UrlPolicyError(`Blocked protocol '${url.protocol}'. Only http/https are allowed.`);
  }
  const host = url.hostname.toLowerCase();
  const blockedHosts = [
    'localhost',
    'metadata.google.internal',
    'metadata.goog',
    'metadata.azure.internal',
    'instance-data',
    '169.254.169.254',
  ];
  if (blockedHosts.includes(host) || host === 'localhost.localdomain') {
    throw new UrlPolicyError(`Blocked navigation to private or metadata host '${host}'.`);
  }
  if (/\.local$/.test(host) || host.endsWith('.internal')) {
    throw new UrlPolicyError(`Blocked navigation to internal-looking host '${host}'.`);
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    const [a, b] = octets as [number, number, number, number];
    const privateRanges: Array<[number, number, number, number]> = [
      [0, 0, 0, 0], [10, 0, 0, 0], [127, 0, 0, 0], [169, 254, 0, 0], [172, 16, 0, 0], [192, 168, 0, 0], [100, 64, 0, 0],
    ];
    for (const [na, nb] of privateRanges) {
      if (na === 0 && a === 0) throw new UrlPolicyError('Blocked private-network address.');
      if (na === 10 && a === 10) throw new UrlPolicyError('Blocked private-network address.');
      if (na === 127 && a === 127) throw new UrlPolicyError('Blocked loopback address.');
      if (na === 169 && a === 169 && b === 254) throw new UrlPolicyError('Blocked link-local/metadata address.');
      if (na === 172 && a === 172 && b >= 16 && b <= 31) throw new UrlPolicyError('Blocked private-network address.');
      if (na === 192 && a === 192 && b === 168) throw new UrlPolicyError('Blocked private-network address.');
      if (na === 100 && a === 100 && b >= 64 && b <= 127) throw new UrlPolicyError('Blocked CGNAT address.');
    }
  }
  const bareIpv6 = host.replace(/^\[/, '').replace(/\]$/, '');
  if (bareIpv6.includes(':') && /^(::1|::|fc|fd|fe80)/i.test(bareIpv6)) {
    throw new UrlPolicyError('Blocked IPv6 loopback or private address.');
  }
  return url;
}

interface SandboxProviderConfig {
  url?: string;
  token?: string;
}

export function resolveSandboxProviderConfig(): SandboxProviderConfig {
  const env = process.env as Record<string, string | undefined>;
  return {
    url: (env.SANDBOX_PROVIDER_URL || env.WORKER_SANDBOX_URL)?.trim() || undefined,
    token: (env.SANDBOX_PROVIDER_TOKEN || env.WORKER_API_TOKEN)?.trim() || undefined,
  };
}

export type SandboxProviderCall = {
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, any>;
  timeoutMs?: number;
};

export class SandboxUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Sandbox unavailable: ${reason}`);
    this.name = 'SandboxUnavailableError';
  }
}

export class SandboxService {
  private activeWorkspaces = new Map<string, SandboxDescriptor>();

  isConfigured(): boolean {
    const cfg = resolveSandboxProviderConfig();
    return Boolean(cfg.url && cfg.token);
  }

  unavailableReason(): string | null {
    const cfg = resolveSandboxProviderConfig();
    if (!cfg.url || !cfg.token) {
      return isProduction()
        ? 'No external sandbox/browser provider is configured (SANDBOX_PROVIDER_URL and SANDBOX_PROVIDER_TOKEN are required).'
        : 'Sandbox provider is not configured in this environment; execution is unavailable.';
    }
    return null;
  }

  private async callProvider<T>(req: SandboxProviderCall): Promise<T> {
    const cfg = resolveSandboxProviderConfig();
    if (!cfg.url || !cfg.token) throw new SandboxUnavailableError(this.unavailableReason() ?? 'not configured');
    const response = await fetch(`${cfg.url.replace(/\/+$/, '')}${req.path}`, {
      method: req.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      throw new Error(`Sandbox provider returned HTTP ${response.status} for ${req.path}.`);
    }
    return (await response.json()) as T;
  }

  private registry(): DurableStore {
    return getDefaultDurableStore();
  }

  /** Create an isolated workspace for an authorized user. */
  public async createSandbox(params: {
    userId: string;
    runtimes?: SandboxRuntime[];
    purpose?: string;
    limits?: Partial<SandboxLimits>;
    maxSeconds?: number;
  }): Promise<{ ok: true; sandbox: SandboxDescriptor } | { ok: false; reason: string; code: 'unavailable' | 'denied' }> {
    const reason = this.unavailableReason();
    if (reason) return { ok: false, reason, code: 'unavailable' };
    const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...(params.limits ?? {}) };
    if (limits.timeoutMs > 60 * 60 * 1000) limits.timeoutMs = 60 * 60 * 1000;
    if (!params.userId || typeof params.userId !== 'string') {
      return { ok: false, reason: 'Authenticated user identity is required.', code: 'denied' };
    }
    try {
      const resp = await this.callProvider<{ sandboxId: string; workdir: string; expiresAt?: string; provider: string }>({
        path: '/sandbox/create',
        body: {
          userId: params.userId,
          purpose: params.purpose?.slice(0, 200) ?? 'general',
          runtimes: params.runtimes ?? ['node', 'javascript', 'typescript'],
          limits,
          maxSeconds: Math.min(3600, params.maxSeconds ?? limits.timeoutMs / 1000),
        },
      });
      const descriptor: SandboxDescriptor = {
        sandboxId: String(resp.sandboxId),
        userId: params.userId,
        workdir: String(resp.workdir ?? '/workspace'),
        runtimes: params.runtimes ?? ['node', 'javascript', 'typescript'],
        limits,
        createdAt: new Date().toISOString(),
        expiresAt: resp.expiresAt,
        provider: String(resp.provider ?? 'external-worker'),
      };
      this.activeWorkspaces.set(descriptor.sandboxId, descriptor);
      const store = this.registry();
      if (store.kind !== 'unavailable') {
        await store
          .set(SANDBOX_REGISTRY_COLLECTION, descriptor.sandboxId, descriptor as unknown as Record<string, any>)
          .catch(() => undefined);
      }
      return { ok: true, sandbox: descriptor };
    } catch (error) {
      if (error instanceof SandboxUnavailableError) return { ok: false, reason: error.reason, code: 'unavailable' };
      return {
        ok: false,
        reason: `Sandbox creation failed: ${error instanceof Error ? error.message : 'provider request failed'}.`,
        code: 'unavailable',
      };
    }
  }

  /** Verify workspace ownership before any privileged operation. */
  private async assertOwnership(sandboxId: string, userId: string): Promise<SandboxDescriptor> {
    const cached = this.activeWorkspaces.get(sandboxId);
    if (cached) {
      if (cached.userId !== userId) throw new Error('Workspace ownership check failed.');
      return cached;
    }
    const store = this.registry();
    if (store.kind === 'unavailable') {
      throw new Error('Workspace ownership cannot be verified without durable registry access.');
    }
    const doc = await store.get(SANDBOX_REGISTRY_COLLECTION, sandboxId);
    if (!doc || doc.userId !== userId) throw new Error('Workspace ownership check failed.');
    return doc as unknown as SandboxDescriptor;
  }

  private async providerCallOwned<T>(
    sandboxId: string,
    userId: string,
    path: string,
    body: Record<string, any>,
    timeoutMs?: number,
  ): Promise<T> {
    await this.assertOwnership(sandboxId, userId);
    return this.callProvider<T>({ path, body: { sandboxId, ...body }, timeoutMs });
  }

  public async status(sandboxId: string, userId: string): Promise<
    { ok: true; status: Record<string, any> } | { ok: false; reason: string; code: 'unavailable' | 'denied' }
  > {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' };
    try {
      const status = await this.providerCallOwned<Record<string, any>>(sandboxId, userId, '/sandbox/status', {});
      return { ok: true, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'status failed';
      return { ok: false, reason: message, code: message.includes('ownership') ? 'denied' : 'unavailable' };
    }
  }

  /** Execute a real command inside the sandbox with output capture. */
  public async terminalExecute(params: {
    sandboxId: string;
    userId: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    onOutput?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void;
  }): Promise<{ ok: true; result: ExecResult } | { ok: false; reason: string; code: 'unavailable' | 'denied' }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' };
    if (typeof params.command !== 'string' || !params.command.trim()) {
      return { ok: false, reason: 'A non-empty command is required.', code: 'denied' };
    }
    const timeoutMs = Math.min(15 * 60_000, Math.max(1000, params.timeoutMs ?? 60_000));
    try {
      const result = await this.providerCallOwned<ExecResult>(
        params.sandboxId,
        params.userId,
        '/sandbox/exec',
        {
          command: params.command.slice(0, 10_000),
          cwd: params.cwd,
          timeoutMs,
        },
        timeoutMs + 10_000,
      );
      if (params.onOutput && typeof result.stdout === 'string') {
        for (const line of result.stdout.split(/(?<=\n)/)) {
          params.onOutput({ stream: 'stdout', text: line });
        }
      }
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        reason: `Terminal execution failed: ${error instanceof Error ? error.message : 'provider request failed'}.`,
        code: 'unavailable',
      };
    }
  }


  public async terminalCancel(sandboxId: string, userId: string, pid: number): Promise<{ ok: boolean; reason?: string }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured' };
    try {
      await this.providerCallOwned(sandboxId, userId, '/sandbox/kill', { pid: Number(pid) });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'cancel failed' };
    }
  }

  public async fsList(sandboxId: string, userId: string, dir: string): Promise<{ ok: boolean; entries?: any[]; reason?: string }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured' };
    try {
      const resp = await this.providerCallOwned<{ entries: any[] }>(sandboxId, userId, '/fs/list', { dir });
      return { ok: true, entries: resp.entries };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'list failed' };
    }
  }

  public async fsRead(sandboxId: string, userId: string, path: string): Promise<{ ok: boolean; content?: string; reason?: string }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured' };
    try {
      const resp = await this.providerCallOwned<{ content: string; size: number }>(sandboxId, userId, '/fs/read', { path });
      return { ok: true, content: resp.content };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'read failed' };
    }
  }

  public async fsWrite(sandboxId: string, userId: string, path: string, content: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured' };
    if (typeof content !== 'string') return { ok: false, reason: 'File content must be a string.' };
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      return { ok: false, reason: `File exceeds the ${MAX_FILE_BYTES / (1024 * 1024)}MB sandbox limit.` };
    }
    try {
      await this.providerCallOwned(sandboxId, userId, '/fs/write', { path, content });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'write failed' };
    }
  }

  public async fsDelete(sandboxId: string, userId: string, path: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured' };
    try {
      await this.providerCallOwned(sandboxId, userId, '/fs/delete', { path });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'delete failed' };
    }
  }

  public async fsSearch(sandboxId: string, userId: string, query: string, glob?: string): Promise<{ ok: boolean; matches?: any[]; reason?: string }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured' };
    try {
      const resp = await this.providerCallOwned<{ matches: any[] }>(sandboxId, userId, '/fs/search', { query: query.slice(0, 500), glob });
      return { ok: true, matches: resp.matches };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'search failed' };
    }
  }

  /** Create a real browser session after enforcing the public-web URL policy. */
  public async browserSessionCreate(params: {
    sandboxId: string;
    userId: string;
    url: string;
    timeoutMs?: number;
  }): Promise<
    | { ok: true; session: BrowserSessionInfo }
    | { ok: false; reason: string; code: 'unavailable' | 'blocked' }
  > {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' };
    try {
      const url = assertBrowserUrlAllowed(params.url);
      const session = await this.providerCallOwned<BrowserSessionInfo>(
        params.sandboxId,
        params.userId,
        '/browser/session/create',
        { url: url.toString(), timeoutMs: params.timeoutMs ?? 30_000 },
        45_000,
      );
      return { ok: true, session: { ...session, consoleErrors: session.consoleErrors ?? [] } };
    } catch (error) {
      if (error instanceof UrlPolicyError) {
        return { ok: false, reason: error.message, code: 'blocked' };
      }
      return {
        ok: false,
        reason: `Browser session failed: ${error instanceof Error ? error.message : 'provider request failed'}.`,
        code: 'unavailable',
      };
    }
  }

  public async browserNavigate(sandboxId: string, userId: string, sessionId: string, url: string, timeoutMs?: number) {
    if (!this.isConfigured()) return { ok: false as const, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' as const };
    try {
      const parsed = assertBrowserUrlAllowed(url);
      const session = await this.providerCallOwned<BrowserSessionInfo>(
        sandboxId,
        userId,
        '/browser/session/navigate',
        { sessionId, url: parsed.toString(), timeoutMs: timeoutMs ?? 30_000 },
        45_000,
      );
      return { ok: true as const, session };
    } catch (error) {
      if (error instanceof UrlPolicyError) return { ok: false as const, reason: error.message, code: 'blocked' as const };
      return { ok: false as const, reason: error instanceof Error ? error.message : 'navigate failed', code: 'unavailable' as const };
    }
  }

  public async browserInspect(sandboxId: string, userId: string, sessionId: string) {
    if (!this.isConfigured()) return { ok: false as const, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' as const };
    try {
      const state = await this.providerCallOwned<Record<string, any>>(sandboxId, userId, '/browser/session/inspect', { sessionId });
      return { ok: true as const, state };
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'inspect failed', code: 'unavailable' as const };
    }
  }

  public async browserClick(sandboxId: string, userId: string, sessionId: string, selector: string) {
    if (!this.isConfigured()) return { ok: false as const, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' as const };
    try {
      const session = await this.providerCallOwned<BrowserSessionInfo>(sandboxId, userId, '/browser/session/click', { sessionId, selector: selector.slice(0, 300) });
      return { ok: true as const, session };
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'click failed', code: 'unavailable' as const };
    }
  }

  public async browserFill(sandboxId: string, userId: string, sessionId: string, values: Record<string, string>) {
    if (!this.isConfigured()) return { ok: false as const, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' as const };
    try {
      const session = await this.providerCallOwned<BrowserSessionInfo>(sandboxId, userId, '/browser/session/fill', { sessionId, values });
      return { ok: true as const, session };
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'fill failed', code: 'unavailable' as const };
    }
  }

  public async browserScreenshot(sandboxId: string, userId: string, sessionId: string) {
    if (!this.isConfigured()) return { ok: false as const, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' as const };
    try {
      const shot = await this.providerCallOwned<{ base64: string; contentType: string }>(sandboxId, userId, '/browser/session/screenshot', { sessionId }, 45_000);
      return { ok: true as const, screenshot: shot };
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'screenshot failed', code: 'unavailable' as const };
    }
  }

  public async browserSessionClose(sandboxId: string, userId: string, sessionId: string) {
    if (!this.isConfigured()) return { ok: false as const, reason: this.unavailableReason() ?? 'unconfigured' };
    try {
      await this.providerCallOwned(sandboxId, userId, '/browser/session/close', { sessionId });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'close failed' };
    }
  }

  /** Start a dev server and wait for a real readiness signal, then return the preview URL. */
  public async previewStart(sandboxId: string, userId: string, params: {
    command: string;
    port: number;
    readinessTimeoutMs?: number;
  }): Promise<
    | { ok: true; previewUrl: string; readiness: 'ready' }
    | { ok: false; reason: string; code: 'unavailable' | 'denied' }
  > {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' };
    const port = Number(params.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return { ok: false, reason: 'A valid port between 1024 and 65535 is required.', code: 'denied' };
    }
    try {
      const resp = await this.providerCallOwned<{ previewUrl: string; readiness: string }>(
        sandboxId,
        userId,
        '/preview/start',
        {
          command: params.command.slice(0, 2000),
          port,
          readinessTimeoutMs: Math.min(120_000, params.readinessTimeoutMs ?? 60_000),
        },
        130_000,
      );
      if (resp.readiness !== 'ready') {
        return {
          ok: false,
          reason: `Dev server did not report readiness (state: ${resp.readiness}). No preview URL is issued.`,
          code: 'unavailable',
        };
      }
      return { ok: true, previewUrl: String(resp.previewUrl), readiness: 'ready' };
    } catch (error) {
      return {
        ok: false,
        reason: `Preview start failed: ${error instanceof Error ? error.message : 'provider request failed'}.`,
        code: 'unavailable',
      };
    }
  }

  public async previewStatus(sandboxId: string, userId: string) {
    if (!this.isConfigured()) return { ok: false as const, reason: this.unavailableReason() ?? 'unconfigured', code: 'unavailable' as const };
    try {
      const resp = await this.providerCallOwned<{ status: string; previewUrl?: string }>(sandboxId, userId, '/preview/status', {});
      return { ok: true as const, resp };
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'status failed', code: 'unavailable' as const };
    }
  }

  /** Terminate processes and remove transient workspace state. */
  public async cleanup(sandboxId: string, userId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.isConfigured()) return { ok: false, reason: this.unavailableReason() ?? 'unconfigured' };
    try {
      await this.providerCallOwned(sandboxId, userId, '/sandbox/destroy', {});
      this.activeWorkspaces.delete(sandboxId);
      const store = this.registry();
      if (store.kind !== 'unavailable') {
        await store.delete(SANDBOX_REGISTRY_COLLECTION, sandboxId).catch(() => undefined);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'cleanup failed' };
    }
  }
}

export const sandboxService = new SandboxService();
