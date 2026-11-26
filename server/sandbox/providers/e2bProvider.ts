/**
 * Real E2B Sandbox REST API Provider Adapter.
 * Uses server-side E2B_API_KEY and E2B_API_BASE_URL (default https://api.e2b.dev).
 * Never executes commands on the Netlify host.
 */

import { AUTHORIZED_WORKSPACE_ROOT } from '../security';
import type {
  ProviderCapabilityReport,
  SandboxRuntime,
  SandboxStatus,
  WorkspaceFileEntry,
  WorkspaceSearchMatch,
} from '../types';
import {
  RUNTIME_IMAGE_CATALOG,
  SandboxProviderError,
  type ProviderCommandInput,
  type ProviderCommandResult,
  type ProviderCreateSandboxInput,
  type ProviderCreateSandboxResult,
  type SandboxProviderAdapter,
} from './types';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class E2BSandboxProvider implements SandboxProviderAdapter {
  public readonly id = 'e2b' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly envdDomain: string;
  private readonly defaultTemplate: string;

  constructor(config?: { apiKey?: string; baseUrl?: string; envdDomain?: string; defaultTemplate?: string }) {
    this.apiKey = (config?.apiKey ?? process.env.E2B_API_KEY ?? '').trim();
    this.baseUrl = (config?.baseUrl ?? process.env.E2B_API_BASE_URL ?? 'https://api.e2b.dev').replace(/\/$/, '');
    this.envdDomain = (config?.envdDomain ?? process.env.E2B_ENVD_DOMAIN ?? 'e2b.app').trim();
    this.defaultTemplate = (config?.defaultTemplate ?? process.env.E2B_TEMPLATE_ID ?? 'base').trim();
  }

  public isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  public getMissingCredentials(): string[] {
    return this.isConfigured() ? [] : ['E2B_API_KEY'];
  }

  public getSupportedRuntimes(): SandboxRuntime[] {
    return ['node', 'typescript', 'javascript', 'python', 'html', 'react', 'vite', 'nextjs', 'custom'];
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new SandboxProviderError({
        code: 'SANDBOX_PROVIDER_UNAVAILABLE',
        message: 'E2B sandbox provider is not configured. Set E2B_API_KEY in server environment variables.',
        statusCode: 503,
        retryable: false,
        provider: this.id,
      });
    }
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    this.assertConfigured();
    const { timeoutMs = 20_000, ...rest } = init;
    let res: Response;
    try {
      res = await fetch(url, {
        ...rest,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          ...(rest.headers || {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new SandboxProviderError({
        code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
        message: timedOut ? 'E2B provider request timed out.' : `E2B provider network failure: ${err?.message || 'unknown error'}`,
        statusCode: timedOut ? 504 : 502,
        retryable: true,
        provider: this.id,
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new SandboxProviderError({
        code: `E2B_HTTP_${res.status}`,
        message: `E2B API returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ''}`,
        statusCode: res.status >= 500 ? 502 : res.status,
        retryable: res.status === 429 || res.status >= 500,
        provider: this.id,
      });
    }

    if (res.status === 204) return undefined as T;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  private envdBaseUrl(providerSandboxId: string): string {
    if (process.env.E2B_ENVD_BASE_URL) {
      return `${process.env.E2B_ENVD_BASE_URL.replace(/\/$/, '')}/${encodeURIComponent(providerSandboxId)}`;
    }
    return `https://49983-${encodeURIComponent(providerSandboxId)}.${this.envdDomain}`;
  }

  public async healthCheck(): Promise<ProviderCapabilityReport> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.id,
        configured: false,
        operational: false,
        liveCheckPerformed: false,
        supportedRuntimes: this.getSupportedRuntimes(),
        features: ['isolated-vm', 'terminal', 'filesystem', 'preview-urls'],
        missingCredentials: this.getMissingCredentials(),
        checkedAt,
        error: 'E2B_API_KEY is not configured.',
      };
    }

    try {
      await this.requestJson(`${this.baseUrl}/sandboxes`, { method: 'GET', timeoutMs: 8000 });
      return {
        provider: this.id,
        configured: true,
        operational: true,
        liveCheckPerformed: true,
        supportedRuntimes: this.getSupportedRuntimes(),
        features: ['isolated-vm', 'terminal', 'filesystem', 'preview-urls'],
        missingCredentials: [],
        checkedAt,
      };
    } catch (err: any) {
      return {
        provider: this.id,
        configured: true,
        operational: false,
        liveCheckPerformed: true,
        supportedRuntimes: this.getSupportedRuntimes(),
        features: ['isolated-vm', 'terminal', 'filesystem', 'preview-urls'],
        missingCredentials: [],
        checkedAt,
        error: err?.message || 'E2B health check failed.',
      };
    }
  }

  public async createSandbox(input: ProviderCreateSandboxInput): Promise<ProviderCreateSandboxResult> {
    const catalog = RUNTIME_IMAGE_CATALOG[input.runtime] || RUNTIME_IMAGE_CATALOG.node;
    const templateID = input.image || this.defaultTemplate || catalog.defaultTemplate;

    const data = await this.requestJson<{ sandboxID?: string; sandboxId?: string; id?: string }>(
      `${this.baseUrl}/sandboxes`,
      {
        method: 'POST',
        body: JSON.stringify({
          templateID,
          timeout: Math.min(3600, Math.max(60, input.limits.timeoutSec)),
          envVars: input.env,
          metadata: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            userId: input.userId,
            runtime: input.runtime,
          },
        }),
      },
    );

    const providerSandboxId = data.sandboxID || data.sandboxId || data.id;
    if (!providerSandboxId) {
      throw new SandboxProviderError({
        code: 'E2B_INVALID_CREATE_RESPONSE',
        message: 'E2B API did not return a sandbox identifier.',
        statusCode: 502,
        provider: this.id,
      });
    }

    // Ensure workspace root exists inside the isolated sandbox
    await this.makeDirectory(providerSandboxId, AUTHORIZED_WORKSPACE_ROOT).catch(() => {});

    return {
      providerSandboxId,
      workspaceRoot: AUTHORIZED_WORKSPACE_ROOT,
      status: 'running',
      image: templateID,
    };
  }

  public async getSandboxStatus(providerSandboxId: string): Promise<{ status: SandboxStatus; error?: string }> {
    try {
      const data = await this.requestJson<{ state?: string; status?: string }>(
        `${this.baseUrl}/sandboxes/${encodeURIComponent(providerSandboxId)}`,
        { method: 'GET', timeoutMs: 8000 },
      );
      const raw = (data.state || data.status || 'running').toLowerCase();
      if (raw.includes('run')) return { status: 'running' };
      if (raw.includes('pause') || raw.includes('idle')) return { status: 'idle' };
      if (raw.includes('stop') || raw.includes('kill')) return { status: 'stopped' };
      return { status: 'running' };
    } catch (err: any) {
      if (err instanceof SandboxProviderError && err.statusCode === 404) {
        return { status: 'stopped', error: 'Sandbox no longer exists on provider.' };
      }
      throw err;
    }
  }

  public async destroySandbox(providerSandboxId: string): Promise<void> {
    try {
      await this.requestJson(`${this.baseUrl}/sandboxes/${encodeURIComponent(providerSandboxId)}`, {
        method: 'DELETE',
        timeoutMs: 10_000,
      });
    } catch (err: any) {
      if (err instanceof SandboxProviderError && err.statusCode === 404) return;
      throw err;
    }
  }

  public async executeCommand(input: ProviderCommandInput): Promise<ProviderCommandResult> {
    const started = Date.now();
    const envdUrl = `${this.envdBaseUrl(input.providerSandboxId)}/process/execute`;
    const data = await this.requestJson<{
      pid?: string | number;
      executionId?: string;
      stdout?: string;
      stderr?: string;
      exitCode?: number | null;
      timedOut?: boolean;
    }>(envdUrl, {
      method: 'POST',
      timeoutMs: input.timeoutMs + 5000,
      body: JSON.stringify({
        cmd: input.command,
        cwd: input.cwd,
        envs: input.env || {},
        timeoutMs: input.timeoutMs,
        background: Boolean(input.background),
      }),
    });

    const stdout = typeof data.stdout === 'string' ? data.stdout : '';
    const stderr = typeof data.stderr === 'string' ? data.stderr : '';
    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : input.background ? null : 0;

    if (input.onEvent) {
      const now = new Date().toISOString();
      if (stdout) {
        input.onEvent({ type: 'stdout', executionId: String(data.executionId || data.pid || ''), data: stdout, timestamp: now });
      }
      if (stderr) {
        input.onEvent({ type: 'stderr', executionId: String(data.executionId || data.pid || ''), data: stderr, timestamp: now });
      }
      input.onEvent({
        type: 'exit',
        executionId: String(data.executionId || data.pid || ''),
        exitCode,
        status: data.timedOut ? 'timed_out' : exitCode === 0 || exitCode === null ? 'completed' : 'failed',
        timestamp: now,
      });
    }

    return {
      providerExecutionId: data.executionId || (data.pid !== undefined ? String(data.pid) : undefined),
      stdout,
      stderr,
      exitCode,
      timedOut: Boolean(data.timedOut),
      durationMs: Date.now() - started,
    };
  }

  public async cancelCommand(providerSandboxId: string, providerExecutionId: string): Promise<boolean> {
    try {
      await this.requestJson(`${this.envdBaseUrl(providerSandboxId)}/process/${encodeURIComponent(providerExecutionId)}/kill`, {
        method: 'POST',
        body: JSON.stringify({ signal: 'SIGTERM' }),
        timeoutMs: 8000,
      });
      return true;
    } catch {
      return false;
    }
  }

  public async listFiles(providerSandboxId: string, absolutePath: string): Promise<WorkspaceFileEntry[]> {
    const result = await this.executeCommand({
      providerSandboxId,
      command: `node -e "const fs=require('fs'),p=require('path');const dir=${JSON.stringify(absolutePath)};const items=fs.readdirSync(dir,{withFileTypes:true}).map(d=>{const full=p.posix.join(dir,d.name);let st={size:0,mtime:new Date()};try{st=fs.statSync(full);}catch{}return{name:d.name,path:full,type:d.isDirectory()?'directory':'file',size:st.size||0,modifiedAt:st.mtime.toISOString()};});console.log(JSON.stringify(items));"`,
      cwd: AUTHORIZED_WORKSPACE_ROOT,
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) {
      throw new SandboxProviderError({
        code: 'FILESYSTEM_LIST_FAILED',
        message: result.stderr || 'Failed to list workspace directory.',
        statusCode: 400,
        provider: this.id,
      });
    }
    return JSON.parse(result.stdout || '[]') as WorkspaceFileEntry[];
  }

  public async readFile(providerSandboxId: string, absolutePath: string): Promise<string> {
    const url = `${this.envdBaseUrl(providerSandboxId)}/files?path=${encodeURIComponent(absolutePath)}`;
    return this.requestJson<string>(url, { method: 'GET', timeoutMs: 15_000 });
  }

  public async writeFile(providerSandboxId: string, absolutePath: string, content: string): Promise<void> {
    const url = `${this.envdBaseUrl(providerSandboxId)}/files?path=${encodeURIComponent(absolutePath)}`;
    await this.requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
      timeoutMs: 20_000,
    });
  }

  public async deletePath(providerSandboxId: string, absolutePath: string): Promise<void> {
    await this.executeCommand({
      providerSandboxId,
      command: `rm -rf -- ${shellQuote(absolutePath)}`,
      cwd: AUTHORIZED_WORKSPACE_ROOT,
      timeoutMs: 15_000,
    });
  }

  public async makeDirectory(providerSandboxId: string, absolutePath: string): Promise<void> {
    await this.executeCommand({
      providerSandboxId,
      command: `mkdir -p -- ${shellQuote(absolutePath)}`,
      cwd: AUTHORIZED_WORKSPACE_ROOT,
      timeoutMs: 15_000,
    });
  }

  public async renamePath(providerSandboxId: string, fromAbsolutePath: string, toAbsolutePath: string): Promise<void> {
    const res = await this.executeCommand({
      providerSandboxId,
      command: `mv -- ${shellQuote(fromAbsolutePath)} ${shellQuote(toAbsolutePath)}`,
      cwd: AUTHORIZED_WORKSPACE_ROOT,
      timeoutMs: 15_000,
    });
    if (res.exitCode !== 0) {
      throw new SandboxProviderError({
        code: 'FILESYSTEM_RENAME_FAILED',
        message: res.stderr || 'Failed to rename or move file.',
        statusCode: 400,
        provider: this.id,
      });
    }
  }

  public async searchFiles(
    providerSandboxId: string,
    rootAbsolutePath: string,
    query: string,
  ): Promise<WorkspaceSearchMatch[]> {
    const res = await this.executeCommand({
      providerSandboxId,
      command: `grep -rnI --max-count=50 -- ${shellQuote(query)} ${shellQuote(rootAbsolutePath)} || true`,
      cwd: AUTHORIZED_WORKSPACE_ROOT,
      timeoutMs: 15_000,
    });
    const matches: WorkspaceSearchMatch[] = [];
    for (const line of res.stdout.split('\n')) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (m) {
        matches.push({ path: m[1], line: Number(m[2]), preview: m[3].slice(0, 240) });
      }
      if (matches.length >= 100) break;
    }
    return matches;
  }

  public async getPreviewUrl(providerSandboxId: string, port: number): Promise<string> {
    return `https://${port}-${encodeURIComponent(providerSandboxId)}.${this.envdDomain}`;
  }
}
