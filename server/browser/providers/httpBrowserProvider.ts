/**
 * Real Self-Hosted Isolated Browser Worker HTTP Provider Adapter.
 * Connects to an external isolated Playwright/Chromium browser service
 * configured via BROWSER_RUNTIME_URL and BROWSER_RUNTIME_API_KEY.
 */

import type {
  BrowserPageState,
  BrowserScreenshotResult,
  ProviderCapabilityReport,
} from '../../sandbox/types';
import {
  BrowserProviderError,
  type BrowserProviderAdapter,
  type ProviderBrowserActionResult,
  type ProviderBrowserCreateInput,
  type ProviderBrowserCreateResult,
} from './types';

export class HttpBrowserProvider implements BrowserProviderAdapter {
  public readonly id = 'http-browser' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config?: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = (config?.baseUrl ?? process.env.BROWSER_RUNTIME_URL ?? '').trim().replace(/\/$/, '');
    this.apiKey = (config?.apiKey ?? process.env.BROWSER_RUNTIME_API_KEY ?? '').trim();
  }

  public isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0;
  }

  public getMissingCredentials(): string[] {
    const missing: string[] = [];
    if (!this.baseUrl) missing.push('BROWSER_RUNTIME_URL');
    if (!this.apiKey) missing.push('BROWSER_RUNTIME_API_KEY');
    return missing;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BrowserProviderError({
        code: 'BROWSER_PROVIDER_UNAVAILABLE',
        message: 'Custom browser runtime is not configured. Set BROWSER_RUNTIME_URL and BROWSER_RUNTIME_API_KEY.',
        statusCode: 503,
        provider: this.id,
      });
    }
  }

  private async requestJson<T>(endpoint: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    this.assertConfigured();
    const { timeoutMs = 25_000, ...rest } = init;
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
      throw new BrowserProviderError({
        code: timedOut ? 'BROWSER_TIMEOUT' : 'BROWSER_NETWORK_ERROR',
        message: timedOut ? 'Browser runtime timed out.' : `Browser runtime network error: ${err?.message || 'unknown'}`,
        statusCode: timedOut ? 504 : 502,
        retryable: true,
        provider: this.id,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BrowserProviderError({
        code: `BROWSER_RUNTIME_HTTP_${res.status}`,
        message: `Browser runtime returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
        statusCode: res.status >= 500 ? 502 : res.status,
        retryable: res.status === 429 || res.status >= 500,
        provider: this.id,
      });
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  public async healthCheck(): Promise<ProviderCapabilityReport> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.id,
        configured: false,
        operational: false,
        liveCheckPerformed: false,
        features: ['isolated-browser', 'navigate', 'inspect', 'click', 'fill', 'scroll', 'wait', 'screenshot', 'console-errors'],
        missingCredentials: this.getMissingCredentials(),
        checkedAt,
        error: `Missing credentials: ${this.getMissingCredentials().join(', ')}`,
      };
    }

    try {
      const data = await this.requestJson<{ ok?: boolean }>('/health', { method: 'GET', timeoutMs: 8000 });
      return {
        provider: this.id,
        configured: true,
        operational: data?.ok !== false,
        liveCheckPerformed: true,
        features: ['isolated-browser', 'navigate', 'inspect', 'click', 'fill', 'scroll', 'wait', 'screenshot', 'console-errors'],
        missingCredentials: [],
        checkedAt,
      };
    } catch (err: any) {
      return {
        provider: this.id,
        configured: true,
        operational: false,
        liveCheckPerformed: true,
        features: ['isolated-browser', 'navigate', 'inspect', 'click', 'fill', 'scroll', 'wait', 'screenshot', 'console-errors'],
        missingCredentials: [],
        checkedAt,
        error: err?.message || 'Browser runtime health check failed.',
      };
    }
  }

  public async createSession(input: ProviderBrowserCreateInput): Promise<ProviderBrowserCreateResult> {
    const data = await this.requestJson<{ providerSessionId?: string; id?: string; wsEndpoint?: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const providerSessionId = data.providerSessionId || data.id;
    if (!providerSessionId) {
      throw new BrowserProviderError({
        code: 'BROWSER_INVALID_CREATE_RESPONSE',
        message: 'Browser runtime did not return a session ID.',
        statusCode: 502,
        provider: this.id,
      });
    }
    return { providerSessionId, wsEndpoint: data.wsEndpoint };
  }

  public async closeSession(providerSessionId: string): Promise<void> {
    await this.requestJson(`/sessions/${encodeURIComponent(providerSessionId)}`, {
      method: 'DELETE',
      timeoutMs: 10_000,
    });
  }

  public async navigate(
    providerSessionId: string,
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number },
  ): Promise<BrowserPageState> {
    const state = await this.requestJson<BrowserPageState>(
      `/sessions/${encodeURIComponent(providerSessionId)}/navigate`,
      {
        method: 'POST',
        body: JSON.stringify({
          url,
          waitUntil: options?.waitUntil || 'domcontentloaded',
          timeoutMs: options?.timeoutMs || 20_000,
        }),
        timeoutMs: (options?.timeoutMs || 20_000) + 5000,
      },
    );
    return { ...state, untrustedData: true };
  }

  public async inspect(providerSessionId: string, selector?: string): Promise<BrowserPageState> {
    const state = await this.requestJson<BrowserPageState>(
      `/sessions/${encodeURIComponent(providerSessionId)}/inspect`,
      {
        method: 'POST',
        body: JSON.stringify({ selector }),
      },
    );
    return { ...state, untrustedData: true };
  }

  public async click(
    providerSessionId: string,
    selector: string,
    timeoutMs = 15_000,
  ): Promise<ProviderBrowserActionResult> {
    return this.requestJson<ProviderBrowserActionResult>(
      `/sessions/${encodeURIComponent(providerSessionId)}/click`,
      {
        method: 'POST',
        body: JSON.stringify({ selector, timeoutMs }),
        timeoutMs: timeoutMs + 5000,
      },
    );
  }

  public async fill(
    providerSessionId: string,
    selector: string,
    value: string,
    timeoutMs = 15_000,
  ): Promise<ProviderBrowserActionResult> {
    return this.requestJson<ProviderBrowserActionResult>(
      `/sessions/${encodeURIComponent(providerSessionId)}/fill`,
      {
        method: 'POST',
        body: JSON.stringify({ selector, value, timeoutMs }),
        timeoutMs: timeoutMs + 5000,
      },
    );
  }

  public async scroll(
    providerSessionId: string,
    options: { direction?: 'down' | 'up'; pixels?: number; selector?: string },
  ): Promise<ProviderBrowserActionResult> {
    return this.requestJson<ProviderBrowserActionResult>(
      `/sessions/${encodeURIComponent(providerSessionId)}/scroll`,
      {
        method: 'POST',
        body: JSON.stringify(options),
      },
    );
  }

  public async waitFor(
    providerSessionId: string,
    options: { selector?: string; urlIncludes?: string; timeoutMs?: number },
  ): Promise<ProviderBrowserActionResult> {
    return this.requestJson<ProviderBrowserActionResult>(
      `/sessions/${encodeURIComponent(providerSessionId)}/wait`,
      {
        method: 'POST',
        body: JSON.stringify(options),
        timeoutMs: (options.timeoutMs || 15_000) + 5000,
      },
    );
  }

  public async screenshot(
    providerSessionId: string,
    options?: { fullPage?: boolean; format?: 'png' | 'jpeg' },
  ): Promise<BrowserScreenshotResult> {
    return this.requestJson<BrowserScreenshotResult>(
      `/sessions/${encodeURIComponent(providerSessionId)}/screenshot`,
      {
        method: 'POST',
        body: JSON.stringify({
          fullPage: Boolean(options?.fullPage),
          format: options?.format || 'png',
        }),
      },
    );
  }
}
