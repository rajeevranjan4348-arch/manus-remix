/**
 * Real Browserbase v1 Sessions REST Provider Adapter.
 * Uses server-side BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.
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

export class BrowserbaseProvider implements BrowserProviderAdapter {
  public readonly id = 'browserbase' as const;
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly baseUrl: string;

  constructor(config?: { apiKey?: string; projectId?: string; baseUrl?: string }) {
    this.apiKey = (config?.apiKey ?? process.env.BROWSERBASE_API_KEY ?? '').trim();
    this.projectId = (config?.projectId ?? process.env.BROWSERBASE_PROJECT_ID ?? '').trim();
    this.baseUrl = (config?.baseUrl ?? process.env.BROWSERBASE_API_URL ?? 'https://api.browserbase.com/v1').replace(/\/$/, '');
  }

  public isConfigured(): boolean {
    return this.apiKey.length > 0 && this.projectId.length > 0;
  }

  public getMissingCredentials(): string[] {
    const missing: string[] = [];
    if (!this.apiKey) missing.push('BROWSERBASE_API_KEY');
    if (!this.projectId) missing.push('BROWSERBASE_PROJECT_ID');
    return missing;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BrowserProviderError({
        code: 'BROWSER_PROVIDER_UNAVAILABLE',
        message: 'Browserbase provider is not configured. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.',
        statusCode: 503,
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
          'X-BB-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          ...(rest.headers || {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new BrowserProviderError({
        code: timedOut ? 'BROWSER_TIMEOUT' : 'BROWSER_NETWORK_ERROR',
        message: timedOut ? 'Browserbase API timed out.' : `Browserbase network error: ${err?.message || 'unknown'}`,
        statusCode: timedOut ? 504 : 502,
        retryable: true,
        provider: this.id,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BrowserProviderError({
        code: `BROWSERBASE_HTTP_${res.status}`,
        message: `Browserbase API returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
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
        features: ['isolated-browser', 'session-isolation', 'navigate', 'inspect', 'click', 'fill', 'screenshot'],
        missingCredentials: this.getMissingCredentials(),
        checkedAt,
        error: `Missing credentials: ${this.getMissingCredentials().join(', ')}`,
      };
    }

    try {
      await this.requestJson('/sessions', { method: 'GET', timeoutMs: 8000 });
      return {
        provider: this.id,
        configured: true,
        operational: true,
        liveCheckPerformed: true,
        features: ['isolated-browser', 'session-isolation', 'navigate', 'inspect', 'click', 'fill', 'screenshot'],
        missingCredentials: [],
        checkedAt,
      };
    } catch (err: any) {
      return {
        provider: this.id,
        configured: true,
        operational: false,
        liveCheckPerformed: true,
        features: ['isolated-browser', 'session-isolation', 'navigate', 'inspect', 'click', 'fill', 'screenshot'],
        missingCredentials: [],
        checkedAt,
        error: err?.message || 'Browserbase health check failed.',
      };
    }
  }

  public async createSession(input: ProviderBrowserCreateInput): Promise<ProviderBrowserCreateResult> {
    const data = await this.requestJson<{ id?: string; connectUrl?: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: this.projectId,
        timeout: input.timeoutSec,
        browserSettings: {
          viewport: input.viewport,
        },
        userMetadata: {
          sessionId: input.sessionId,
          userId: input.userId,
        },
      }),
    });

    if (!data?.id) {
      throw new BrowserProviderError({
        code: 'BROWSERBASE_INVALID_SESSION',
        message: 'Browserbase did not return a session ID.',
        statusCode: 502,
        provider: this.id,
      });
    }

    return {
      providerSessionId: data.id,
      wsEndpoint: data.connectUrl,
    };
  }

  public async closeSession(providerSessionId: string): Promise<void> {
    await this.requestJson(`/sessions/${encodeURIComponent(providerSessionId)}`, {
      method: 'POST',
      body: JSON.stringify({ projectId: this.projectId, status: 'REQUEST_RELEASE' }),
    });
  }

  private async runSessionAction<T>(providerSessionId: string, action: string, payload: Record<string, unknown>): Promise<T> {
    return this.requestJson<T>(`/sessions/${encodeURIComponent(providerSessionId)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async navigate(
    providerSessionId: string,
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number },
  ): Promise<BrowserPageState> {
    const state = await this.runSessionAction<BrowserPageState>(providerSessionId, 'navigate', {
      url,
      waitUntil: options?.waitUntil || 'domcontentloaded',
      timeoutMs: options?.timeoutMs || 20_000,
    });
    return { ...state, untrustedData: true };
  }

  public async inspect(providerSessionId: string, selector?: string): Promise<BrowserPageState> {
    const state = await this.runSessionAction<BrowserPageState>(providerSessionId, 'inspect', { selector });
    return { ...state, untrustedData: true };
  }

  public async click(providerSessionId: string, selector: string, timeoutMs = 15_000): Promise<ProviderBrowserActionResult> {
    return this.runSessionAction<ProviderBrowserActionResult>(providerSessionId, 'click', { selector, timeoutMs });
  }

  public async fill(
    providerSessionId: string,
    selector: string,
    value: string,
    timeoutMs = 15_000,
  ): Promise<ProviderBrowserActionResult> {
    return this.runSessionAction<ProviderBrowserActionResult>(providerSessionId, 'fill', { selector, value, timeoutMs });
  }

  public async scroll(
    providerSessionId: string,
    options: { direction?: 'down' | 'up'; pixels?: number; selector?: string },
  ): Promise<ProviderBrowserActionResult> {
    return this.runSessionAction<ProviderBrowserActionResult>(providerSessionId, 'scroll', options);
  }

  public async waitFor(
    providerSessionId: string,
    options: { selector?: string; urlIncludes?: string; timeoutMs?: number },
  ): Promise<ProviderBrowserActionResult> {
    return this.runSessionAction<ProviderBrowserActionResult>(providerSessionId, 'wait', options);
  }

  public async screenshot(
    providerSessionId: string,
    options?: { fullPage?: boolean; format?: 'png' | 'jpeg' },
  ): Promise<BrowserScreenshotResult> {
    return this.runSessionAction<BrowserScreenshotResult>(providerSessionId, 'screenshot', {
      fullPage: Boolean(options?.fullPage),
      format: options?.format || 'png',
    });
  }
}
