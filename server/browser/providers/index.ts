/**
 * Browser provider factory & honest capability inspector.
 * Never returns simulated clicks or fabricated screenshots when no real provider is configured.
 */

import type { BrowserProviderId, ProviderCapabilityReport } from '../../sandbox/types';
import { BrowserbaseProvider } from './browserbaseProvider';
import { BrowserlessProvider } from './browserlessProvider';
import { HttpBrowserProvider } from './httpBrowserProvider';
import { BrowserProviderError, type BrowserProviderAdapter } from './types';

export function resolveBrowserProvider(preferredProvider?: string): BrowserProviderAdapter {
  const configuredName = (preferredProvider || process.env.BROWSER_PROVIDER || '').trim().toLowerCase();

  if (configuredName) {
    if (configuredName === 'browserless') {
      const provider = new BrowserlessProvider();
      if (!provider.isConfigured()) {
        throw new BrowserProviderError({
          code: 'BROWSER_PROVIDER_UNAVAILABLE',
          message: 'Configured browser provider "browserless" requires BROWSERLESS_URL and BROWSERLESS_TOKEN.',
          statusCode: 503,
          provider: 'browserless',
        });
      }
      return provider;
    }
    if (configuredName === 'browserbase') {
      const provider = new BrowserbaseProvider();
      if (!provider.isConfigured()) {
        throw new BrowserProviderError({
          code: 'BROWSER_PROVIDER_UNAVAILABLE',
          message: 'Configured browser provider "browserbase" requires BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.',
          statusCode: 503,
          provider: 'browserbase',
        });
      }
      return provider;
    }
    if (configuredName === 'http-browser' || configuredName === 'custom') {
      const provider = new HttpBrowserProvider();
      if (!provider.isConfigured()) {
        throw new BrowserProviderError({
          code: 'BROWSER_PROVIDER_UNAVAILABLE',
          message: 'Configured browser provider "http-browser" requires BROWSER_RUNTIME_URL and BROWSER_RUNTIME_API_KEY.',
          statusCode: 503,
          provider: 'http-browser',
        });
      }
      return provider;
    }
    throw new BrowserProviderError({
      code: 'BROWSER_PROVIDER_UNSUPPORTED',
      message: `Unsupported browser provider "${configuredName}". Supported providers: browserless, browserbase, http-browser.`,
      statusCode: 400,
      provider: 'unconfigured',
    });
  }

  const candidates: BrowserProviderAdapter[] = [
    new HttpBrowserProvider(),
    new BrowserlessProvider(),
    new BrowserbaseProvider(),
  ];

  for (const candidate of candidates) {
    if (candidate.isConfigured()) {
      return candidate;
    }
  }

  throw new BrowserProviderError({
    code: 'BROWSER_PROVIDER_UNAVAILABLE',
    message:
      'No isolated browser provider is configured. Set BROWSERLESS_URL + BROWSERLESS_TOKEN, BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID, or BROWSER_RUNTIME_URL + BROWSER_RUNTIME_API_KEY.',
    statusCode: 503,
    retryable: false,
    provider: 'unconfigured',
  });
}

export async function getBrowserProviderCapabilities(liveCheck = false): Promise<ProviderCapabilityReport> {
  const checkedAt = new Date().toISOString();
  const preferred = (process.env.BROWSER_PROVIDER || '').trim().toLowerCase();

  let adapter: BrowserProviderAdapter | null = null;
  try {
    adapter = resolveBrowserProvider(preferred || undefined);
  } catch (err: any) {
    return {
      provider: (preferred as BrowserProviderId) || 'unconfigured',
      configured: false,
      operational: false,
      liveCheckPerformed: false,
      features: [],
      missingCredentials: [
        'BROWSERLESS_URL+BROWSERLESS_TOKEN or BROWSERBASE_API_KEY+BROWSERBASE_PROJECT_ID or BROWSER_RUNTIME_URL+BROWSER_RUNTIME_API_KEY',
      ],
      checkedAt,
      error: err?.message || 'No browser provider configured.',
    };
  }

  if (liveCheck) {
    return adapter.healthCheck();
  }

  return {
    provider: adapter.id,
    configured: adapter.isConfigured(),
    operational: false,
    liveCheckPerformed: false,
    features: ['isolated-browser', 'navigate', 'inspect', 'click', 'fill', 'scroll', 'wait', 'screenshot'],
    missingCredentials: adapter.getMissingCredentials(),
    checkedAt,
  };
}

export { BrowserbaseProvider, BrowserlessProvider, BrowserProviderError, HttpBrowserProvider };
export type { BrowserProviderAdapter };
