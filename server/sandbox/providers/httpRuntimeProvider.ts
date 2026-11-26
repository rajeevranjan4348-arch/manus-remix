/**
 * Real Self-Hosted / Custom Container Runtime HTTP Provider Adapter.
 * Connects over HTTPS to an isolated remote worker service (Fly.io, Cloud Run, Kubernetes, Docker host)
 * configured via SANDBOX_RUNTIME_URL and SANDBOX_RUNTIME_API_KEY.
 */

import { AUTHORIZED_WORKSPACE_ROOT } from '../security';
import type {
  ProviderCapabilityReport,
  SandboxRuntime,
  SandboxStatus,
  WorkspaceArtifact,
  WorkspaceFileEntry,
  WorkspaceSearchMatch,
} from '../types';
import {
  SandboxProviderError,
  type ProviderCommandInput,
  type ProviderCommandResult,
  type ProviderCreateSandboxInput,
  type ProviderCreateSandboxResult,
  type SandboxProviderAdapter,
} from './types';

export class HttpRuntimeSandboxProvider implements SandboxProviderAdapter {
  public readonly id = 'http-runtime' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config?: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = (config?.baseUrl ?? process.env.SANDBOX_RUNTIME_URL ?? '').trim().replace(/\/$/, '');
    this.apiKey = (config?.apiKey ?? process.env.SANDBOX_RUNTIME_API_KEY ?? '').trim();
  }

  public isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0;
  }

  public getMissingCredentials(): string[] {
    const missing: string[] = [];
    if (!this.baseUrl) missing.push('SANDBOX_RUNTIME_URL');
    if (!this.apiKey) missing.push('SANDBOX_RUNTIME_API_KEY');
    return missing;
  }

  public getSupportedRuntimes(): SandboxRuntime[] {
    return ['node', 'typescript', 'javascript', 'python', 'html', 'react', 'vite', 'nextjs', 'custom'];
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new SandboxProviderError({
        code: 'SANDBOX_PROVIDER_UNAVAILABLE',
        message: 'Custom sandbox runtime is not configured. Set SANDBOX_RUNTIME_URL and SANDBOX_RUNTIME_API_KEY.',
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
      res = await fetch(`${this.baseUrl}${endpoint}`, {
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
        message: timedOut
          ? 'Sandbox runtime request timed out.'
          : `Sandbox runtime connection error: ${err?.message || 'unknown'}`,
        statusCode: timedOut ? 504 : 502,
        retryable: true,
        provider: this.id,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SandboxProviderError({
        code: `RUNTIME_HTTP_${res.status}`,
        message: `Sandbox runtime returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
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
        features: ['isolated-container', 'terminal', 'terminal-streaming', 'filesystem', 'preview-urls', 'artifacts'],
        missingCredentials: this.getMissingCredentials(),
        checkedAt,
        error: `Missing credentials: ${this.getMissingCredentials().join(', ')}`,
      };
    }

    try {
      const data = await this.requestJson<{ ok?: boolean; supportedRuntimes?: SandboxRuntime[] }>('/health', {
        method: 'GET',
        timeoutMs: 8000,
      });
      return {
        provider: this.id,
        configured: true,
        operational: data?.ok !== false,
        liveCheckPerformed: true,
        supportedRuntimes: data?.supportedRuntimes || this.getSupportedRuntimes(),
        features: ['isolated-container', 'terminal', 'terminal-streaming', 'filesystem', 'preview-urls', 'artifacts'],
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
        features: ['isolated-container', 'terminal', 'terminal-streaming', 'filesystem', 'preview-urls', 'artifacts'],
        missingCredentials: [],
        checkedAt,
        error: err?.message || 'Sandbox runtime health check failed.',
      };
    }
  }

  public async createSandbox(input: ProviderCreateSandboxInput): Promise<ProviderCreateSandboxResult> {
    const data = await this.requestJson<{
      providerSandboxId?: string;
      id?: string;
      workspaceRoot?: string;
      status?: SandboxStatus;
      image?: string;
    }>('/sandboxes', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    const providerSandboxId = data.providerSandboxId || data.id;
    if (!providerSandboxId) {
      throw new SandboxProviderError({
        code: 'RUNTIME_INVALID_CREATE_RESPONSE',
        message: 'Sandbox runtime did not return a sandbox ID.',
        statusCode: 502,
        provider: this.id,
      });
    }

    return {
      providerSandboxId,
      workspaceRoot: data.workspaceRoot || AUTHORIZED_WORKSPACE_ROOT,
      status: data.status || 'running',
      image: data.image || input.image,
    };
  }

  public async getSandboxStatus(providerSandboxId: string): Promise<{ status: SandboxStatus; error?: string }> {
    return this.requestJson<{ status: SandboxStatus; error?: string }>(
      `/sandboxes/${encodeURIComponent(providerSandboxId)}`,
      { method: 'GET', timeoutMs: 8000 },
    );
  }

  public async destroySandbox(providerSandboxId: string): Promise<void> {
    await this.requestJson(`/sandboxes/${encodeURIComponent(providerSandboxId)}`, {
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
      exitCode?: number | null;
      timedOut?: boolean;
      cancelled?: boolean;
      chunks?: Array<{ stream: 'stdout' | 'stderr'; data: string }>;
    }>(`/sandboxes/${encodeURIComponent(input.providerSandboxId)}/terminal/execute`, {
      method: 'POST',
      timeoutMs: input.timeoutMs + 5000,
      body: JSON.stringify({
        command: input.command,
        cwd: input.cwd,
        env: input.env || {},
        timeoutMs: input.timeoutMs,
        background: Boolean(input.background),
      }),
    });

    const stdout = typeof data.stdout === 'string' ? data.stdout : '';
    const stderr = typeof data.stderr === 'string' ? data.stderr : '';
    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : input.background ? null : 0;

    if (input.onEvent) {
      if (Array.isArray(data.chunks) && data.chunks.length > 0) {
        for (const chunk of data.chunks) {
          input.onEvent({
            type: chunk.stream,
            executionId: data.executionId || '',
            data: chunk.data,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        if (stdout) {
          input.onEvent({
            type: 'stdout',
            executionId: data.executionId || '',
            data: stdout,
            timestamp: new Date().toISOString(),
          });
        }
        if (stderr) {
          input.onEvent({
            type: 'stderr',
            executionId: data.executionId || '',
            data: stderr,
            timestamp: new Date().toISOString(),
          });
        }
      }
      input.onEvent({
        type: 'exit',
        executionId: data.executionId || '',
        exitCode,
        status: data.cancelled
          ? 'cancelled'
          : data.timedOut
            ? 'timed_out'
            : exitCode === 0 || exitCode === null
              ? 'completed'
              : 'failed',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      providerExecutionId: data.executionId,
      stdout,
      stderr,
      exitCode,
      timedOut: Boolean(data.timedOut),
      cancelled: Boolean(data.cancelled),
      durationMs: Date.now() - started,
    };
  }

  public async cancelCommand(providerSandboxId: string, providerExecutionId: string): Promise<boolean> {
    const res = await this.requestJson<{ cancelled?: boolean }>(
      `/sandboxes/${encodeURIComponent(providerSandboxId)}/terminal/${encodeURIComponent(providerExecutionId)}/cancel`,
      { method: 'POST', timeoutMs: 8000 },
    );
    return res?.cancelled !== false;
  }

  public async listFiles(providerSandboxId: string, absolutePath: string): Promise<WorkspaceFileEntry[]> {
    const res = await this.requestJson<{ entries?: WorkspaceFileEntry[] }>(
      `/sandboxes/${encodeURIComponent(providerSandboxId)}/files/list?path=${encodeURIComponent(absolutePath)}`,
      { method: 'GET' },
    );
    return Array.isArray(res?.entries) ? res.entries : [];
  }

  public async readFile(providerSandboxId: string, absolutePath: string): Promise<string> {
    const res = await this.requestJson<{ content?: string }>(
      `/sandboxes/${encodeURIComponent(providerSandboxId)}/files/read?path=${encodeURIComponent(absolutePath)}`,
      { method: 'GET' },
    );
    return typeof res?.content === 'string' ? res.content : '';
  }

  public async writeFile(providerSandboxId: string, absolutePath: string, content: string): Promise<void> {
    await this.requestJson(`/sandboxes/${encodeURIComponent(providerSandboxId)}/files/write`, {
      method: 'POST',
      body: JSON.stringify({ path: absolutePath, content }),
    });
  }

  public async deletePath(providerSandboxId: string, absolutePath: string): Promise<void> {
    await this.requestJson(`/sandboxes/${encodeURIComponent(providerSandboxId)}/files/delete`, {
      method: 'POST',
      body: JSON.stringify({ path: absolutePath }),
    });
  }

  public async makeDirectory(providerSandboxId: string, absolutePath: string): Promise<void> {
    await this.requestJson(`/sandboxes/${encodeURIComponent(providerSandboxId)}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path: absolutePath }),
    });
  }

  public async renamePath(providerSandboxId: string, fromAbsolutePath: string, toAbsolutePath: string): Promise<void> {
    await this.requestJson(`/sandboxes/${encodeURIComponent(providerSandboxId)}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ fromPath: fromAbsolutePath, toPath: toAbsolutePath }),
    });
  }

  public async searchFiles(
    providerSandboxId: string,
    rootAbsolutePath: string,
    query: string,
  ): Promise<WorkspaceSearchMatch[]> {
    const res = await this.requestJson<{ matches?: WorkspaceSearchMatch[] }>(
      `/sandboxes/${encodeURIComponent(providerSandboxId)}/files/search?path=${encodeURIComponent(rootAbsolutePath)}&query=${encodeURIComponent(query)}`,
      { method: 'GET' },
    );
    return Array.isArray(res?.matches) ? res.matches : [];
  }

  public async createArtifact(providerSandboxId: string, rootAbsolutePath: string): Promise<WorkspaceArtifact> {
    return this.requestJson<WorkspaceArtifact>(
      `/sandboxes/${encodeURIComponent(providerSandboxId)}/files/artifact`,
      {
        method: 'POST',
        body: JSON.stringify({ path: rootAbsolutePath }),
      },
    );
  }

  public async getPreviewUrl(providerSandboxId: string, port: number): Promise<string> {
    const res = await this.requestJson<{ previewUrl?: string; url?: string }>(
      `/sandboxes/${encodeURIComponent(providerSandboxId)}/preview/${port}`,
      { method: 'GET' },
    );
    const previewUrl = res?.previewUrl || res?.url;
    if (!previewUrl) {
      throw new SandboxProviderError({
        code: 'PREVIEW_URL_UNAVAILABLE',
        message: 'Sandbox runtime did not provide a preview URL.',
        statusCode: 502,
        provider: this.id,
      });
    }
    return previewUrl;
  }
}
