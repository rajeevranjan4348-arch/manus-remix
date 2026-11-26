/**
 * Real Browserless REST / Function API Provider Adapter.
 * Uses server-side BROWSERLESS_URL and BROWSERLESS_TOKEN (or BROWSERLESS_API_KEY).
 * Executes real isolated Chromium sessions remotely via Browserless.
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

export class BrowserlessProvider implements BrowserProviderAdapter {
  public readonly id = 'browserless' as const;
  private readonly baseUrl: string;
  private readonly token: string;
  private sessionState = new Map<string, { url?: string; viewport: { width: number; height: number } }>();

  constructor(config?: { baseUrl?: string; token?: string }) {
    this.baseUrl = (config?.baseUrl ?? process.env.BROWSERLESS_URL ?? '').trim().replace(/\/$/, '');
    this.token = (config?.token ?? process.env.BROWSERLESS_TOKEN ?? process.env.BROWSERLESS_API_KEY ?? '').trim();
  }

  public isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.token.length > 0;
  }

  public getMissingCredentials(): string[] {
    const missing: string[] = [];
    if (!this.baseUrl) missing.push('BROWSERLESS_URL');
    if (!this.token) missing.push('BROWSERLESS_TOKEN');
    return missing;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BrowserProviderError({
        code: 'BROWSER_PROVIDER_UNAVAILABLE',
        message: 'Browserless provider is not configured. Set BROWSERLESS_URL and BROWSERLESS_TOKEN.',
        statusCode: 503,
        provider: this.id,
      });
    }
  }

  private withToken(endpoint: string): string {
    const sep = endpoint.includes('?') ? '&' : '?';
    return `${this.baseUrl}${endpoint}${sep}token=${encodeURIComponent(this.token)}`;
  }

  private async runFunction<T>(code: string, context: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    this.assertConfigured();
    let res: Response;
    try {
      res = await fetch(this.withToken('/function'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, context }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new BrowserProviderError({
        code: timedOut ? 'BROWSER_TIMEOUT' : 'BROWSER_NETWORK_ERROR',
        message: timedOut ? 'Browserless request timed out.' : `Browserless network error: ${err?.message || 'unknown'}`,
        statusCode: timedOut ? 504 : 502,
        retryable: true,
        provider: this.id,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BrowserProviderError({
        code: `BROWSERLESS_HTTP_${res.status}`,
        message: `Browserless returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
        statusCode: res.status >= 500 ? 502 : res.status,
        retryable: res.status === 429 || res.status >= 500,
        provider: this.id,
      });
    }

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
        features: ['isolated-browser', 'navigate', 'inspect', 'click', 'fill', 'scroll', 'wait', 'screenshot'],
        missingCredentials: this.getMissingCredentials(),
        checkedAt,
        error: `Missing credentials: ${this.getMissingCredentials().join(', ')}`,
      };
    }

    try {
      const res = await fetch(this.withToken('/pressure'), {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      });
      return {
        provider: this.id,
        configured: true,
        operational: res.ok,
        liveCheckPerformed: true,
        features: ['isolated-browser', 'navigate', 'inspect', 'click', 'fill', 'scroll', 'wait', 'screenshot'],
        missingCredentials: [],
        checkedAt,
        error: res.ok ? undefined : `Browserless pressure check returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        provider: this.id,
        configured: true,
        operational: false,
        liveCheckPerformed: true,
        features: ['isolated-browser', 'navigate', 'inspect', 'click', 'fill', 'scroll', 'wait', 'screenshot'],
        missingCredentials: [],
        checkedAt,
        error: err?.message || 'Browserless health check failed.',
      };
    }
  }

  public async createSession(input: ProviderBrowserCreateInput): Promise<ProviderBrowserCreateResult> {
    this.assertConfigured();
    const providerSessionId = `bl_${input.sessionId}`;
    this.sessionState.set(providerSessionId, { viewport: input.viewport });
    return { providerSessionId };
  }

  public async closeSession(providerSessionId: string): Promise<void> {
    this.sessionState.delete(providerSessionId);
  }

  private getSessionUrl(providerSessionId: string): string {
    const state = this.sessionState.get(providerSessionId);
    if (!state?.url) {
      throw new BrowserProviderError({
        code: 'BROWSER_NO_ACTIVE_PAGE',
        message: 'No page has been navigated to in this browser session yet.',
        statusCode: 400,
        provider: this.id,
      });
    }
    return state.url;
  }

  public async navigate(
    providerSessionId: string,
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number },
  ): Promise<BrowserPageState> {
    const state = this.sessionState.get(providerSessionId) || { viewport: { width: 1280, height: 720 } };
    const code = `
      export default async function ({ page, context }) {
        const consoleErrors = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error' || msg.type() === 'warning') {
            consoleErrors.push({ level: msg.type() === 'warning' ? 'warn' : 'error', text: msg.text(), timestamp: new Date().toISOString() });
          }
        });
        await page.setViewport(context.viewport);
        const resp = await page.goto(context.url, { waitUntil: context.waitUntil, timeout: context.timeoutMs });
        const inspected = await page.evaluate(() => {
          const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 20).map(el => (el.textContent || '').trim()).filter(Boolean);
          const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map(a => ({ text: (a.textContent || '').trim().slice(0, 80), href: a.href }));
          const interactive = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"]')).slice(0, 40).map((el, index) => {
            const rect = el.getBoundingClientRect();
            const idSel = el.id ? '#' + el.id : el.tagName.toLowerCase();
            return {
              index,
              tag: el.tagName.toLowerCase(),
              selector: idSel,
              role: el.getAttribute('role') || undefined,
              type: el.getAttribute('type') || undefined,
              text: (el.textContent || '').trim().slice(0, 100) || undefined,
              name: el.getAttribute('name') || undefined,
              placeholder: el.getAttribute('placeholder') || undefined,
              href: el.getAttribute('href') || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
              visible: rect.width > 0 && rect.height > 0,
            };
          });
          return {
            title: document.title || '',
            textContent: (document.body?.innerText || '').slice(0, 6000),
            headings,
            links,
            interactiveElements: interactive,
          };
        });
        return {
          data: {
            url: page.url(),
            statusCode: resp ? resp.status() : undefined,
            ...inspected,
            consoleErrors,
            capturedAt: new Date().toISOString(),
            untrustedData: true,
          },
          type: 'application/json',
        };
      }
    `;

    const result = await this.runFunction<BrowserPageState>(
      code,
      {
        url,
        viewport: state.viewport,
        waitUntil: options?.waitUntil || 'domcontentloaded',
        timeoutMs: options?.timeoutMs || 20_000,
      },
      (options?.timeoutMs || 20_000) + 5000,
    );

    this.sessionState.set(providerSessionId, { ...state, url: result.url || url });
    return { ...result, untrustedData: true };
  }

  public async inspect(providerSessionId: string): Promise<BrowserPageState> {
    return this.navigate(providerSessionId, this.getSessionUrl(providerSessionId));
  }

  public async click(
    providerSessionId: string,
    selector: string,
    timeoutMs = 15_000,
  ): Promise<ProviderBrowserActionResult> {
    const url = this.getSessionUrl(providerSessionId);
    const state = this.sessionState.get(providerSessionId) || { viewport: { width: 1280, height: 720 } };
    const code = `
      export default async function ({ page, context }) {
        const consoleErrors = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push({ level: 'error', text: msg.text(), timestamp: new Date().toISOString() });
        });
        await page.setViewport(context.viewport);
        await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: context.timeoutMs });
        await page.waitForSelector(context.selector, { timeout: context.timeoutMs });
        await page.click(context.selector);
        await new Promise(r => setTimeout(r, 400));
        return {
          data: {
            actionSucceeded: true,
            pageState: {
              url: page.url(),
              title: await page.title(),
              textContent: await page.evaluate(() => (document.body?.innerText || '').slice(0, 5000)),
              headings: [],
              links: [],
              interactiveElements: [],
              consoleErrors,
              capturedAt: new Date().toISOString(),
              untrustedData: true,
            },
          },
          type: 'application/json',
        };
      }
    `;
    const result = await this.runFunction<ProviderBrowserActionResult>(
      code,
      { url, selector, viewport: state.viewport, timeoutMs },
      timeoutMs + 8000,
    );
    this.sessionState.set(providerSessionId, { ...state, url: result.pageState.url || url });
    return result;
  }

  public async fill(
    providerSessionId: string,
    selector: string,
    value: string,
    timeoutMs = 15_000,
  ): Promise<ProviderBrowserActionResult> {
    const url = this.getSessionUrl(providerSessionId);
    const state = this.sessionState.get(providerSessionId) || { viewport: { width: 1280, height: 720 } };
    const code = `
      export default async function ({ page, context }) {
        const consoleErrors = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push({ level: 'error', text: msg.text(), timestamp: new Date().toISOString() });
        });
        await page.setViewport(context.viewport);
        await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: context.timeoutMs });
        await page.waitForSelector(context.selector, { timeout: context.timeoutMs });
        await page.type(context.selector, context.value);
        return {
          data: {
            actionSucceeded: true,
            pageState: {
              url: page.url(),
              title: await page.title(),
              textContent: await page.evaluate(() => (document.body?.innerText || '').slice(0, 4000)),
              headings: [],
              links: [],
              interactiveElements: [],
              consoleErrors,
              capturedAt: new Date().toISOString(),
              untrustedData: true,
            },
          },
          type: 'application/json',
        };
      }
    `;
    return this.runFunction<ProviderBrowserActionResult>(
      code,
      { url, selector, value, viewport: state.viewport, timeoutMs },
      timeoutMs + 8000,
    );
  }

  public async scroll(
    providerSessionId: string,
    options: { direction?: 'down' | 'up'; pixels?: number; selector?: string },
  ): Promise<ProviderBrowserActionResult> {
    const url = this.getSessionUrl(providerSessionId);
    const state = this.sessionState.get(providerSessionId) || { viewport: { width: 1280, height: 720 } };
    const delta = (options.direction === 'up' ? -1 : 1) * (options.pixels || 600);
    const code = `
      export default async function ({ page, context }) {
        await page.setViewport(context.viewport);
        await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.evaluate((y) => window.scrollBy(0, y), context.delta);
        return {
          data: {
            actionSucceeded: true,
            pageState: {
              url: page.url(),
              title: await page.title(),
              textContent: await page.evaluate(() => (document.body?.innerText || '').slice(0, 4000)),
              headings: [],
              links: [],
              interactiveElements: [],
              consoleErrors: [],
              capturedAt: new Date().toISOString(),
              untrustedData: true,
            },
          },
          type: 'application/json',
        };
      }
    `;
    return this.runFunction<ProviderBrowserActionResult>(code, { url, delta, viewport: state.viewport }, 20_000);
  }

  public async waitFor(
    providerSessionId: string,
    options: { selector?: string; urlIncludes?: string; timeoutMs?: number },
  ): Promise<ProviderBrowserActionResult> {
    const url = this.getSessionUrl(providerSessionId);
    const state = this.sessionState.get(providerSessionId) || { viewport: { width: 1280, height: 720 } };
    const timeoutMs = options.timeoutMs || 15_000;
    const code = `
      export default async function ({ page, context }) {
        await page.setViewport(context.viewport);
        await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: context.timeoutMs });
        if (context.selector) {
          await page.waitForSelector(context.selector, { timeout: context.timeoutMs });
        }
        return {
          data: {
            actionSucceeded: true,
            pageState: {
              url: page.url(),
              title: await page.title(),
              textContent: await page.evaluate(() => (document.body?.innerText || '').slice(0, 4000)),
              headings: [],
              links: [],
              interactiveElements: [],
              consoleErrors: [],
              capturedAt: new Date().toISOString(),
              untrustedData: true,
            },
          },
          type: 'application/json',
        };
      }
    `;
    return this.runFunction<ProviderBrowserActionResult>(
      code,
      { url, selector: options.selector, viewport: state.viewport, timeoutMs },
      timeoutMs + 5000,
    );
  }

  public async screenshot(
    providerSessionId: string,
    options?: { fullPage?: boolean; format?: 'png' | 'jpeg' },
  ): Promise<BrowserScreenshotResult> {
    this.assertConfigured();
    const url = this.getSessionUrl(providerSessionId);
    const state = this.sessionState.get(providerSessionId) || { viewport: { width: 1280, height: 720 } };
    const format = options?.format || 'png';

    const res = await fetch(this.withToken('/screenshot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        options: {
          fullPage: Boolean(options?.fullPage),
          type: format,
        },
        viewport: state.viewport,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      throw new BrowserProviderError({
        code: `BROWSERLESS_SCREENSHOT_HTTP_${res.status}`,
        message: `Browserless screenshot failed with HTTP ${res.status}.`,
        statusCode: 502,
        provider: this.id,
      });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      sessionId: providerSessionId,
      url,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      encoding: 'base64',
      dataBase64: buf.toString('base64'),
      width: state.viewport.width,
      height: state.viewport.height,
      fullPage: Boolean(options?.fullPage),
      capturedAt: new Date().toISOString(),
    };
  }
}
