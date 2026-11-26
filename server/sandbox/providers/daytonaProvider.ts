/**
 * Real Daytona Cloud Workspace REST Provider Adapter.
 * Uses server-side DAYTONA_API_KEY and DAYTONA_API_URL.
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

export class DaytonaSandboxProvider implements SandboxProviderAdapter {
  public readonly id = 'daytona' as const;
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(config?: { apiKey?: string; apiUrl?: string }) {
    this.apiKey = (config?.apiKey ?? process.env.DAYTONA_API_KEY ?? '').trim();
    this.apiUrl = (config?.apiUrl ?? process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api').replace(/\/$/, '');
  }

  public isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  public getMissingCredentials(): string[] {
    return this.isConfigured() ? [] : ['DAYTONA_API_KEY'];
  }

  public getSupportedRuntimes(): SandboxRuntime[] {
    return ['node', 'typescript', 'javascript', 'python', 'html', 'react', 'vite', 'nextjs', 'custom'];
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new SandboxProviderError({
        code: 'SANDBOX_PROVIDER_UNAVAILABLE',
        message: 'Daytona sandbox provider is not configured. Set DAYTONA_API_KEY in server environment variables.',
        statusCode: 503,
        retryable: false,
        provider: this.id,
      });
    }
  }

  private async requestJson<T>(endpoint: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    this.assertConfigured();
    const { timeoutMs = 20_000, ...rest } = init;
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}${endpoint}`, {
        ...rest,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(rest.headers || {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new SandboxProviderError({
        code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
        message: timedOut ? 'Daytona API request timed out.' : `Daytona API network error: ${err?.message || 'unknown'}`,
        statusCode: timedOut ? 504 : 502,
        retryable: true,
        provider: this.id,
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new SandboxProviderError({
        code: `DAYTONA_HTTP_${res.status}`,
        message: `Daytona API returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ''}`,
        statusCode: res.status >= 500 ? 502 : res.status,
        retryable: res.status === 429 || res.status >= 500,
        provider: this.id,
      });
    }

    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T);
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
        features: ['isolated-container', 'terminal', 'filesystem', 'preview-urls', 'persistence'],
        missingCredentials: this.getMissingCredentials(),
        checkedAt,
        error: 'DAYTONA_API_KEY is not configured.',
      };
    }

    try {
      await this.requestJson('/sandbox', { method: 'GET', timeoutMs: 8000 });
      return {
        provider: this.id,
        configured: true,
        operational: true,
        liveCheckPerformed: true,
        supportedRuntimes: this.getSupportedRuntimes(),
        features: ['isolated-container', 'terminal', 'filesystem', 'preview-urls', 'persistence'],
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
        features: ['isolated-container', 'terminal', 'filesystem', 'preview-urls', 'persistence'],
        missingCredentials: [],
        checkedAt,
        error: err?.message || 'Daytona health check failed.',
      };
    }
  }

  public async createSandbox(input: ProviderCreateSandboxInput): Promise<ProviderCreateSandboxResult> {
    const catalog = RUNTIME_IMAGE_CATALOG[input.runtime] || RUNTIME_IMAGE_CATALOG.node;
    const image = input.image || catalog.defaultImage;

    const data = await this.requestJson<{ id?: string; sandboxId?: string; state?: string }>('/sandbox', {
      method: 'POST',
      body: JSON.stringify({
        image,
        env: input.env,
        resources: {
          cpu: input.limits.cpuCores,
          memory: Math.max(1, Math.round(input.limits.memoryMb / 1024)),
          disk: Math.max(1, Math.round(input.limits.diskMb / 1024)),
        },
        autoStopInterval: Math.max(5, Math.round(input.limits.idleTimeoutSec / 60)),
        labels: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          userId: input.userId,
          runtime: input.runtime,
        },
      }),
    });

    const providerSandboxId = data.id || data.sandboxId;
    if (!providerSandboxId) {
      throw new SandboxProviderError({
        code: 'DAYTONA_INVALID_CREATE_RESPONSE',
        message: 'Daytona API did not return a sandbox ID.',
        statusCode: 502,
        provider: this.id,
      });
    }

    return {
      providerSandboxId,
      workspaceRoot: AUTHORIZED_WORKSPACE_ROOT,
      status: 'running',
      image,
    };
  }

  public async getSandboxStatus(providerSandboxId: string): Promise<{ status: SandboxStatus; error?: string }> {
    const data = await this.requestJson<{ state?: string }>(`/sandbox/${encodeURIComponent(providerSandboxId)}`, {
      method: 'GET',
      timeoutMs: 8000,
    });
    const raw = (data.state || 'running').toLowerCase();
    if (raw.includes('start') || raw.includes('run')) return { status: 'running' };
    if (raw.includes('stop') || raw.includes('archiv')) return { status: 'stopped' };
    return { status: 'idle' };
  }

  public async destroySandbox(providerSandboxId: string): Promise<void> {
    await this.requestJson(`/sandbox/${encodeURIComponent(providerSandboxId)}`, {
      method: 'DELETE',
      timeoutMs: 10_000,
    });
  }

  public async executeCommand(input: ProviderCommandInput): Promise<ProviderCommandResult> {
    const started = Date.now();
    const data = await this.requestJson<{
      executionId?: string;
      stdout?: string;
      stderr?: string;
      result?: string;
      exitCode?: number | null;
      timedOut?: boolean;
    }>(`/toolbox/${encodeURIComponent(input.providerSandboxId)}/toolbox/process/execute`, {
      method: 'POST',
      timeoutMs: input.timeoutMs + 5000,
      body: JSON.stringify({
        command: input.command,
        cwd: input.cwd,
        env: input.env,
        timeout: Math.ceil(input.timeoutMs / 1000),
      }),
    });

    const stdout = typeof data.stdout === 'string' ? data.stdout : typeof data.result === 'string' ? data.result : '';
    const stderr = typeof data.stderr === 'string' ? data.stderr : '';
    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : 0;

    if (input.onEvent) {
      const ts = new Date().toISOString();
      if (stdout) input.onEvent({ type: 'stdout', executionId: data.executionId || '', data: stdout, timestamp: ts });
      if (stderr) input.onEvent({ type: 'stderr', executionId: data.executionId || '', data: stderr, timestamp: ts });
      input.onEvent({
        type: 'exit',
        executionId: data.executionId || '',
        exitCode,
        status: data.timedOut ? 'timed_out' : exitCode === 0 ? 'completed' : 'failed',
        timestamp: ts,
      });
    }

    return {
      providerExecutionId: data.executionId,
      stdout,
      stderr,
      exitCode,
      timedOut: Boolean(data.timedOut),
      durationMs: Date.now() - started,
    };
  }

  public async cancelCommand(providerSandboxId: string, providerExecutionId: string): Promise<boolean> {
    try {
      await this.requestJson(
        `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/process/${encodeURIComponent(providerExecutionId)}/cancel`,
        { method: 'POST', timeoutMs: 8000 },
      );
      return true;
    } catch {
      return false;
    }
  }

  public async listFiles(providerSandboxId: string, absolutePath: string): Promise<WorkspaceFileEntry[]> {
    const data = await this.requestJson<Array<{ name: string; isDir?: boolean; size?: number; modTime?: string }>>(
      `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/files?path=${encodeURIComponent(absolutePath)}`,
      { method: 'GET' },
    );
    return (Array.isArray(data) ? data : []).map((f) => ({
      name: f.name,
      path: `${absolutePath.replace(/\/$/, '')}/${f.name}`,
      type: f.isDir ? 'directory' : 'file',
      size: f.size || 0,
      modifiedAt: f.modTime,
    }));
  }

  public async readFile(providerSandboxId: string, absolutePath: string): Promise<string> {
    return this.requestJson<string>(
      `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/files/download?path=${encodeURIComponent(absolutePath)}`,
      { method: 'GET' },
    );
  }

  public async writeFile(providerSandboxId: string, absolutePath: string, content: string): Promise<void> {
    await this.requestJson(
      `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/files/upload?path=${encodeURIComponent(absolutePath)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: content,
      },
    );
  }

  public async deletePath(providerSandboxId: string, absolutePath: string): Promise<void> {
    await this.requestJson(
      `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/files?path=${encodeURIComponent(absolutePath)}`,
      { method: 'DELETE' },
    );
  }

  public async makeDirectory(providerSandboxId: string, absolutePath: string): Promise<void> {
    await this.requestJson(
      `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/files/folder?path=${encodeURIComponent(absolutePath)}&mode=755`,
      { method: 'POST' },
    );
  }

  public async renamePath(providerSandboxId: string, fromAbsolutePath: string, toAbsolutePath: string): Promise<void> {
    await this.requestJson(
      `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/files/move?source=${encodeURIComponent(fromAbsolutePath)}&destination=${encodeURIComponent(toAbsolutePath)}`,
      { method: 'POST' },
    );
  }

  public async searchFiles(
    providerSandboxId: string,
    rootAbsolutePath: string,
    query: string,
  ): Promise<WorkspaceSearchMatch[]> {
    const data = await this.requestJson<Array<{ file: string; line: number; content: string }>>(
      `/toolbox/${encodeURIComponent(providerSandboxId)}/toolbox/files/find?path=${encodeURIComponent(rootAbsolutePath)}&pattern=${encodeURIComponent(query)}`,
      { method: 'GET' },
    );
    return (Array.isArray(data) ? data : []).map((m) => ({
      path: m.file,
      line: m.line,
      preview: (m.content || '').slice(0, 240),
    }));
  }

  public async getPreviewUrl(providerSandboxId: string, port: number): Promise<string> {
    const data = await this.requestJson<{ url?: string }>(
      `/sandbox/${encodeURIComponent(providerSandboxId)}/ports/${port}/preview-url`,
      { method: 'GET' },
    );
    if (!data?.url) {
      throw new SandboxProviderError({
        code: 'PREVIEW_URL_UNAVAILABLE',
        message: 'Daytona did not return a preview URL for the requested port.',
        statusCode: 502,
        provider: this.id,
      });
    }
    return data.url;
  }
}
