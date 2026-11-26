/**
 * E2B provider adapter (Feature 06).
 *
 * Real isolated cloud sandboxes for terminal and filesystem execution plus
 * real isolated Chromium browser sessions with genuine screenshots via the
 * E2B desktop product. The vendor SDK is loaded dynamically so the base
 * Netlify build stays green even before the optional packages are installed;
 * when they are missing, configuration is reported honestly (unavailable).
 *
 * Host isolation invariants:
 * - No user command ever runs on the Netlify host.
 * - Sandbox API keys live only in server-side env vars.
 * - Filesystem paths reaching the SDK are always workspace-relative results
 *   from the path guard, joined onto the sandbox workspace root.
 */

import type { CommandExecutionRecord, CommandExecutionRequest, FilesystemEntry, ProviderHealth,
  SandboxCreateOptions, SandboxLimits, RuntimeId, SandboxProvider } from './types';
import { resolveWorkspacePath } from './pathGuard';
import { validateNavigationUrl } from './urlPolicy';

/* E2B runtime dts: kept loose (any) because the SDK is an optional runtime dep. */
type AnyObj = Record<string, any>;
type E2BSdk = { Sandbox: any };
type DesktopSdk = { Desktop: any };

let e2bSdkPromise: Promise<E2BSdk | null> | null = null;
let desktopSdkPromise: Promise<DesktopSdk | null> | null = null;

/** Dynamic, non-statically-resolvable imports so builds never hard-fail. */
async function loadE2bSdk(): Promise<E2BSdk | null> {
  if (!e2bSdkPromise) {
    const specifier = ['e', '2', 'b'].join('');
    e2bSdkPromise = import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)
      .then((m: any) => (m && (m.Sandbox || m.default?.Sandbox) ? m : null))
      .catch(() => null);
  }
  return e2bSdkPromise;
}

async function loadDesktopSdk(): Promise<DesktopSdk | null> {
  if (!desktopSdkPromise) {
    const specifier = ['@e', '2', 'b', 'desktop'].join('/');
    desktopSdkPromise = import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)
      .then((m: any) => (m && (m.Desktop || m.default?.Desktop) ? m : null))
      .catch(() => null);
  }
  return desktopSdkPromise;
}

const RUNTIME_TO_TEMPLATE: Record<RuntimeId, string | null> = {
  node: null,            // e2b default image ships Node.js
  typescript: null,
  javascript: null,
  html-css: null,
  python: null,          // e2b default image ships Python
  'react-vite': process.env.E2B_TEMPLATE_REACT_VITE || null,
  next: process.env.E2B_TEMPLATE_NEXT || null,
  custom: process.env.E2B_TEMPLATE || null,
};

export function runtimeExplicitlySupported(runtime: RuntimeId): boolean {
  return RUNTIME_TO_TEMPLATE[runtime] !== undefined;
}

const WORKSPACE_ROOT = '/home/user';

const COMMAND_TIMEOUT_SECONDS_CAP = 600;
const OUTPUT_CHAR_CAP = 200_000;

function joinWorkspace(virtualPath: string): string {
  return virtualPath === '' ? WORKSPACE_ROOT : WORKSPACE_ROOT + '/' + virtualPath;
}

export class E2BProviderAdapter implements SandboxProvider {
  readonly id = 'e2b';
  readonly capabilities = {
    terminal: true,
    filesystem: true,
    devServerPreview: true,
    browser: true,
    browserScreenshots: true,
    runtimes: ['node', 'typescript', 'javascript', 'python', 'html-css', 'react-vite', 'next', 'custom'] as RuntimeId[],
  };

  private e2bSandboxIds = new Map<string, any>(); // providerSandboxId -> live SDK instance (ephemeral cache only)

  isConfigured(): boolean {
    return this.configurationErrors().length === 0;
  }

  configurationErrors(): string[] {
    const errors: string[] = [];
    if (!process.env.E2B_API_KEY) {
      errors.push('E2B_API_KEY is not set on the server.');
    }
    if (typeof process === 'undefined' || typeof process.env === 'undefined') {
      errors.push('Server environment is unavailable.');
    }
    return errors;
  }

  private async sdk(): Promise<E2BSdk> {
    const loaded = await loadE2bSdk();
    if (!loaded) {
      throw new Error('E2B SDK is not installed. Run: npm install e2b  (then redeploy).');
    }
    return loaded;
  }

  private async liveSandbox(providerSandboxId: string): Promise<any> {
    const cached = this.e2bSandboxIds.get(providerSandboxId);
    if (cached) return cached;
    const { Sandbox } = await this.sdk();
    const sandbox = await Sandbox.connect(providerSandboxId);
    this.e2bSandboxIds.set(providerSandboxId, sandbox);
    return sandbox;
  }

  async healthCheck(timeoutMs = 5000): Promise<ProviderHealth> {
    const errors = this.configurationErrors();
    if (errors.length > 0) {
      return { providerId: this.id, configured: false, available: false, detail: errors.join(' '), checkedAt: new Date().toISOString() };
    }
    try {
      const sdk = await this.sdk();
      // Verify credentials with a cheap, provider-side call only.
      const sandboxList = sdk.Sandbox.list ? await sdk.Sandbox.list() : null;
      return {
        providerId: this.id,
        configured: true,
        available: true,
        detail: sandboxList ? 'E2B credentials verified via SDK list call.' : 'E2B SDK module loaded; credentials assumed present.',
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        providerId: this.id,
        configured: true,
        available: false,
        detail: 'E2B health check failed: ' + (err?.message || 'unknown error'),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  validateRuntime(runtime: RuntimeId): void {
    if (!runtimeExplicitlySupported(runtime)) {
      throw new Error(`Runtime '${runtime}' has no configured template. Configure the required E2B template env var first.`);
    }
  }

  async createSession(opts: SandboxCreateOptions, limits: SandboxLimits): Promise<{ providerSandboxId: string; expiresAt: string; metadata: Record<string, unknown> }> {
    this.validateRuntime(opts.runtime || 'node');
    const { Sandbox } = await this.sdk();
    const timeoutMs = Math.max(60, limits.maxLifetimeSeconds) * 1000;
    const template = RUNTIME_TO_TEMPLATE[opts.runtime || 'node'] || undefined;
    const sandbox = await Sandbox.create(template || undefined, {
      timeoutMs,
      envs: { ...(opts.env || {}) },
      metadata: {
        userId: opts.userId,
        workspaceLabel: (opts.workspaceLabel || 'workspace').slice(0, 100),
        managedBy: 'manus-remix-sandbox-engine',
      },
      secure: true,
    });
    this.e2bSandboxIds.set(sandbox.sandboxId, sandbox);
    return {
      providerSandboxId: sandbox.sandboxId,
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      metadata: { hostDomain: process.env.E2B_DOMAIN || undefined },
    };
  }

  async terminateSession(providerSandboxId: string): Promise<void> {
    try {
      const cached = this.e2bSandboxIds.get(providerSandboxId);
      if (cached) {
        await cached.kill();
        this.e2bSandboxIds.delete(providerSandboxId);
        return;
      }
      const { Sandbox } = await this.sdk();
      const sandbox = await Sandbox.connect(providerSandboxId);
      await sandbox.kill();
    } catch (err: any) {
      // Termination of an already-dead sandbox is not an error.
      if (!/not.found|404/i.test(String(err?.message || ''))) throw err;
    }
  }

  async execCommand(providerSandboxId: string, request: CommandExecutionRequest): Promise<{
    stdout: string; stderr: string; exitCode: number | null; error?: string;
    status: 'completed' | 'failed' | 'timed_out'; command: string; cwd?: string; truncated: boolean;
    createdAt: string; updatedAt: string; startedAt: string; finishedAt: string;
  }> {
    const sandbox = await this.liveSandbox(providerSandboxId);
    const timeoutSeconds = Math.min(Math.max(1, request.timeoutSeconds || 120), COMMAND_TIMEOUT_SECONDS_CAP);
    const startedAt = new Date().toISOString();
    try {
      const result = await sandbox.commands.run(request.command, {
        timeoutMs: timeoutSeconds * 1000,
        cwd: request.cwd ? joinWorkspace(resolveWorkspacePath(request.cwd).virtualPath || '') : undefined,
        envs: { ...(request.env || {}) },
      });
      const finishedAt = new Date().toISOString();
      let stdout = String(result?.stdout ?? '');
      let stderr = String(result?.stderr ?? '');
      const truncated = stdout.length > OUTPUT_CHAR_CAP || stderr.length > OUTPUT_CHAR_CAP;
      if (stdout.length > OUTPUT_CHAR_CAP) stdout = stdout.slice(0, OUTPUT_CHAR_CAP) + '\n...[truncated]';
      if (stderr.length > OUTPUT_CHAR_CAP) stderr = stderr.slice(0, OUTPUT_CHAR_CAP) + '\n...[truncated]';
      return {
        command: request.command,
        cwd: request.cwd,
        stdout,
        stderr,
        exitCode: typeof result?.exitCode === 'number' ? result.exitCode : null,
        status: typeof result?.exitCode === 'number' && result.exitCode !== 0 ? 'failed' : 'completed',
        error: typeof result?.exitCode === 'number' && result.exitCode !== 0 ? `Command exited with code ${result.exitCode}` : undefined,
        createdAt: startedAt, updatedAt: finishedAt, startedAt, finishedAt,
        truncated,
      };
    } catch (err: any) {
      const finishedAt = new Date().toISOString();
      const message = String(err?.message || 'Command execution failed');
      const timedOut = /timeout|timed out/i.test(message);
      return {
        command: request.command,
        cwd: request.cwd,
        stdout: '',
        stderr: timedOut ? '' : message,
        exitCode: null,
        status: timedOut ? 'timed_out' : 'failed',
        error: timedOut ? `Command exceeded the ${timeoutSeconds}s time limit and was terminated.` : message,
        createdAt: startedAt, updatedAt: finishedAt, startedAt, finishedAt,
        truncated: false,
      };
    }
  }

  async readPreviewHostUrl(providerSandboxId: string, port: number): Promise<string | null> {
    const sandbox = await this.liveSandbox(providerSandboxId);
    const host = typeof sandbox.getHost === 'function' ? sandbox.getHost(port)
      : typeof sandbox.getHostPort === 'function' ? sandbox.getHostPort(port) : null;
    if (!host) return null;
    return host.startsWith('http') ? host : `https://${host}`;
  }

  /** Real readiness probe: the server fetches the live preview URL. */
  async fetchPreviewStatus(providerSandboxId: string, port: number, timeoutMs = 4000): Promise<{ reachable: boolean; httpStatus: number | null; error?: string }> {
    const url = await this.readPreviewHostUrl(providerSandboxId, port);
    if (!url) return { reachable: false, httpStatus: null, error: 'No host URL available for this sandbox/port.' };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'ManusRemixPreviewProbe/1.0' } });
      return { reachable: res.status > 0, httpStatus: res.status };
    } catch (err: any) {
      return { reachable: false, httpStatus: null, error: String(err?.message || 'preview probe failed') };
    }
  }

  async writeFile(providerSandboxId: string, virtualPath: string, content: string, createDirectories: boolean): Promise<{ size: number }> {
    const resolved = resolveWorkspacePath(virtualPath);
    if (!resolved.valid || resolved.virtualPath === undefined || resolved.virtualPath === '') {
      throw new Error('A concrete file path inside the workspace is required.');
    }
    const sandbox = await this.liveSandbox(providerSandboxId);
    const target = joinWorkspace(resolved.virtualPath);
    if (createDirectories) {
      const parent = target.split('/').slice(0, -1).join('/');
      if (parent && parent !== WORKSPACE_ROOT) {
        await sandbox.commands.run(`mkdir -p ${JSON.stringify(parent)}`, { timeoutMs: 30_000 });
      }
    }
    await sandbox.files.write(target, content);
    return { size: content.length };
  }

  async readFile(providerSandboxId: string, virtualPath: string): Promise<{ content: string; size: number }> {
    const resolved = resolveWorkspacePath(virtualPath);
    if (!resolved.valid || !resolved.virtualPath) {
      throw new Error('A concrete file path inside the workspace is required.');
    }
    const sandbox = await this.liveSandbox(providerSandboxId);
    const content = await sandbox.files.read(joinWorkspace(resolved.virtualPath));
    const text = typeof content === 'string' ? content : content.toString();
    return { content: text, size: text.length };
  }

  async listFiles(providerSandboxId: string, virtualDir: string): Promise<FilesystemEntry[]> {
    const resolved = resolveWorkspacePath(virtualDir);
    if (!resolved.valid) throw new Error(resolved.error || 'Invalid path');
    const sandbox = await this.liveSandbox(providerSandboxId);
    const entries = await sandbox.files.list(joinWorkspace(resolved.virtualPath || ''));
    if (!Array.isArray(entries)) return [];
    return entries.map((e: AnyObj) => ({
      path: String(e.path || '').replace(WORKSPACE_ROOT + '/', ''),
      name: String(e.name || ''),
      type: e.type === 'dir' ? 'dir' : 'file',
      size: Number(e.size || 0),
    })).slice(0, 1000);
  }

  async deletePath(providerSandboxId: string, virtualPath: string): Promise<void> {
    const resolved = resolveWorkspacePath(virtualPath);
    if (!resolved.valid || !resolved.virtualPath) throw new Error('A concrete path inside the workspace is required.');
    const sandbox = await this.liveSandbox(providerSandboxId);
    await sandbox.files.remove(joinWorkspace(resolved.virtualPath));
  }

  async movePath(providerSandboxId: string, from: string, to: string): Promise<void> {
    const fromResolved = resolveWorkspacePath(from);
    const toResolved = resolveWorkspacePath(to);
    if (!fromResolved.valid || !fromResolved.virtualPath || !toResolved.valid || !toResolved.virtualPath) {
      throw new Error('Concrete source and destination paths inside the workspace are required.');
    }
    const sandbox = await this.liveSandbox(providerSandboxId);
    await sandbox.commands.run(`mv ${JSON.stringify(joinWorkspace(fromResolved.virtualPath))} ${JSON.stringify(joinWorkspace(toResolved.virtualPath))}`, { timeoutMs: 30_000 });
  }

  async statPath(providerSandboxId: string, virtualPath: string): Promise<FilesystemEntry | null> {
    try {
      const listing = await this.listFiles(providerSandboxId, virtualPath);
      // list on a file path may throw or return empty; fall back to file read.
      if (listing.length === 0) {
        const file = await this.readFile(providerSandboxId, virtualPath);
        const parts = virtualPath.split('/');
        return { path: virtualPath, name: parts[parts.length - 1] || virtualPath, type: 'file', size: file.size };
      }
      const parts = virtualPath.split('/');
      return { path: virtualPath, name: parts[parts.length - 1] || virtualPath, type: 'dir', size: 0 };
    } catch {
      return null;
    }
  }

  /* ---------------- Browser: real Chromium via E2B desktop + CDP ---------------- */

  private desktopSandboxIds = new Map<string, any>(); // browserSessionId -> live desktop instance

  private async desktop(browserSessionId: string, restoreDesktopId?: string): Promise<any> {
    const cached = this.desktopSandboxIds.get(browserSessionId);
    if (cached) return cached;
    const Desktop = (await loadDesktopSdk())?.Desktop;
    if (!Desktop) {
      throw new Error('E2B desktop SDK is not installed. Run: npm install @e2b/desktop  (then redeploy).');
    }
    const desktop = restoreDesktopId ? await Desktop.connect(restoreDesktopId) : await Desktop.create({
      timeoutMs: 30 * 60 * 1000,
      envs: { DISPLAY: ':0' },
    });
    this.desktopSandboxIds.set(browserSessionId, desktop);
    return desktop;
  }

  cdpSupported(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  async browserCreate(providerSandboxId: string, browserSessionId: string, restore?: Record<string, unknown>): Promise<{ metadata: Record<string, unknown> }> {
    const desktop = await this.desktop(browserSessionId, (restore && (restore as AnyObj).desktopSandboxId as string) || undefined);
    if (!this.cdpSupported()) {
      throw new Error('Browser automation requires a runtime with WebSocket support.');
    }
    return { metadata: { desktopSandboxId: desktop.sandboxId } };
  }

  private async cdp(browserSessionId: string): Promise<{ wsUrlFor(targetId?: string): Promise<string>; listTargets(): Promise<AnyObj[]> }> {
    const desktop = await this.desktop(browserSessionId);
    const hostBase = typeof desktop.getHost === 'function' ? desktop.getHost(9222) : desktop.getHostPort(9222);
    const base = hostBase.startsWith('http') ? hostBase : `https://${hostBase}`;
    const res = await fetch(base + '/json/list', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('Browser debug endpoint unreachable (HTTP ' + res.status + ').');
    const targets: AnyObj[] = await res.json();
    return {
      async wsUrlFor(targetId?: string) {
        const list = targetId ? targets.filter((t) => t.id === targetId) : targets;
        const chosen = targetId ? list[0] : targets.find((t) => t.type === 'page') || targets[0];
        if (!chosen || !chosen.webSocketDebuggerUrl) throw new Error('No debuggable browser target found.');
        return String(chosen.webSocketDebuggerUrl).replace('ws://', 'wss://').replace(base.replace('https://', 'wss://'), base.replace('https://', 'wss://'));
      },
      async listTargets() { return targets; },
    };
  }

  /** Minimal CDP-over-WebSocket client used for real page interaction. */
  private async cdpCall(sessionId: string, method: string, params?: AnyObj, timeoutMs = 10000): Promise<AnyObj> {
    const info = await this.cdp(sessionId);
    let targetId: string | undefined;
    const list = await info.listTargets();
    const page = list.find((t) => t.type === 'page');
    targetId = page?.id;
    const wsUrl = await info.wsUrlFor(targetId);
    return new Promise<AnyObj>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP call timed out: ' + method)); }, timeoutMs);
      let currentId = 1;
      ws.onopen = () => {
        const payload: AnyObj = { id: currentId, method, params: params || {} };
        ws.send(JSON.stringify(payload));
      };
      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id === currentId) {
            clearTimeout(timer);
            ws.close();
            if (msg.error) reject(new Error('CDP error: ' + JSON.stringify(msg.error)));
            else resolve(msg.result || {});
          }
        } catch (e) { /* ignore non-matching frames */ }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('CDP websocket connection failed.'));
      };
    });
  }

  private async activeTargetId(browserSessionId: string): Promise<string | undefined> {
    const info = await this.cdp(browserSessionId);
    const list = await info.listTargets();
    return (list.find((t) => t.type === 'page') || list[0])?.id;
  }

  async browserNavigate(providerSandboxId: string, browserSessionId: string, url: string, timeoutMs: number): Promise<{ url: string; title: string; textContent: string; consoleErrors: string[] }> {
    const decision = validateNavigationUrl(url);
    if (!decision.allowed) throw new Error(decision.reason || 'Navigation blocked by policy');
    const targetId = await this.activeTargetId(browserSessionId);
    if (!targetId) throw new Error('No active browser page target.');
    try {
      await this.cdpCall(browserSessionId, 'Page.navigate', { url: decision.normalizedUrl }, timeoutMs);
    } catch (err: any) {
      throw new Error('Navigation failed: ' + (err?.message || 'unknown'));
    }
    await new Promise((r) => setTimeout(r, 1200));
    const titleResult = await this.cdpCall(browserSessionId, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    const textResult = await this.cdpCall(browserSessionId, 'Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText.slice(0, 20000) : ""',
      returnByValue: true,
    });
    const consoleErrors = await this.cdpCall(browserSessionId, 'Runtime.evaluate', {
      expression: 'window.__manusConsoleErrors ? window.__manusConsoleErrors : []',
      returnByValue: true,
    }).catch(() => ({ result: { value: [] } }));
    return {
      url: decision.normalizedUrl || url,
      title: String(titleResult?.result?.value || ''),
      textContent: String(textResult?.result?.value || ''),
      consoleErrors: Array.isArray(consoleErrors?.result?.value) ? consoleErrors.result.value.map(String).slice(0, 50) : [],
    };
  }

  async browserInspect(providerSandboxId: string, browserSessionId: string, selector?: string, limit = 60): Promise<{ elements: Array<{ tag: string; id?: string; classes?: string; text?: string; href?: string; inputType?: string; name?: string }> }> {
    const scope = selector ? JSON.stringify(selector) : 'document';
    const expression = `(function(){ const root = ${scope}; const nodes = root && root.querySelectorAll ? root.querySelectorAll('a,button,input,select,textarea,[role=button]') : []; return Array.from(nodes).slice(0, ${Math.min(Math.max(1, limit), 200)}).map(function(n){ return { tag: n.tagName.toLowerCase(), id: n.id || undefined, classes: (typeof n.className === 'string' ? n.className : '').slice(0,120) || undefined, text: (n.innerText || n.value || '').slice(0, 200) || undefined, href: n.href || undefined, inputType: n.type || undefined, name: n.name || undefined }; }); })()`;
    const result = await this.cdpCall(browserSessionId, 'Runtime.evaluate', { expression, returnByValue: true });
    const value = result?.result?.value;
    if (!Array.isArray(value)) throw new Error(selector ? `No elements matched selector ${selector}` : 'No inspectable elements found.');
    return { elements: value };
  }

  async browserClick(providerSandboxId: string, browserSessionId: string, selector: string): Promise<{ clicked: boolean; navigationTriggered: boolean; urlAfter: string }> {
    if (!selector) throw new Error('A CSS selector is required.');
    const expression = `(function(){ const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; el.scrollIntoView({block:'center'}); el.click(); return { found: true }; })()`;
    const result = await this.cdpCall(browserSessionId, 'Runtime.evaluate', { expression, returnByValue: true });
    await new Promise((r) => setTimeout(r, 800));
    const urlAfter = await this.cdpCall(browserSessionId, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const urlAfterValue = String(urlAfter?.result?.value ?? '');
    if (!result?.result?.value || result.result.value.found !== true) throw new Error(`No element matched selector ${selector}`);
    return { clicked: true, navigationTriggered: true, urlAfter: urlAfterValue };
  }

  async browserFill(providerSandboxId: string, browserSessionId: string, fields: Array<{ selector: string; value: string; type?: string }>): Promise<{ filled: number }> {
    if (!Array.isArray(fields) || fields.length === 0 || fields.length > 25) {
      throw new Error('Provide between 1 and 25 fields to fill.');
    }
    let filled = 0;
    for (const field of fields) {
      const expression = `(function(){ const el = document.querySelector(${JSON.stringify(field.selector)}); if (!el) return false; el.focus(); el.value = ${JSON.stringify(String(field.value ?? ''))}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
      const result = await this.cdpCall(browserSessionId, 'Runtime.evaluate', { expression, returnByValue: true });
      if (result?.result?.value === true) filled += 1;
    }
    return { filled };
  }

  async browserScroll(providerSandboxId: string, browserSessionId: string, direction: 'up' | 'down', pixels: number): Promise<void> {
    const amount = Math.min(Math.max(1, Math.round(pixels || 600)), 20000) * (direction === 'up' ? -1 : 1);
    await this.cdpCall(browserSessionId, 'Runtime.evaluate', { expression: `window.scrollBy(0, ${amount})`, returnByValue: true });
  }

  async browserWaitFor(providerSandboxId: string, browserSessionId: string, condition: 'navigation' | 'selector', value: string, timeoutMs: number): Promise<void> {
    if (!['navigation', 'selector'].includes(condition)) throw new Error('Unsupported wait condition.');
    const deadline = Date.now() + Math.min(Math.max(500, timeoutMs), 30_000);
    while (Date.now() < deadline) {
      const expression = condition === 'selector'
        ? `!!document.querySelector(${JSON.stringify(value)})`
        : 'document.readyState === "complete"';
      const result = await this.cdpCall(browserSessionId, 'Runtime.evaluate', { expression, returnByValue: true }, 4000).catch(() => null);
      if (result?.result?.value === true) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`Wait condition '${condition}: ${value}' was not met within the time limit.`);
  }

  async browserScreenshot(providerSandboxId: string, browserSessionId: string): Promise<{ dataUrl: string }> {
    const desktop = await this.desktop(browserSessionId);
    const png = await desktop.screenshot();
    const bytes: Uint8Array = typeof png === 'string' ? Uint8Array.from(Buffer == null ? [] : Buffer.from(png, 'binary')) : new Uint8Array(png);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const base64 = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
    return { dataUrl: `data:image/png;base64,${base64}` };
  }

  async browserClose(providerSandboxId: string, browserSessionId: string): Promise<void> {
    const desktop = this.desktopSandboxIds.get(browserSessionId);
    if (desktop) {
      try { await desktop.kill(); } catch {}
      this.desktopSandboxIds.delete(browserSessionId);
    }
  }
}
