/**
 * Sandbox provider factory & capability inspector.
 * Resolves the active external sandbox provider strictly from server-side environment variables.
 * Never fabricates a local host fallback.
 */

import type { ProviderCapabilityReport, SandboxProviderId } from '../types';
import { DaytonaSandboxProvider } from './daytonaProvider';
import { E2BSandboxProvider } from './e2bProvider';
import { HttpRuntimeSandboxProvider } from './httpRuntimeProvider';
import { SandboxProviderError, type SandboxProviderAdapter } from './types';

export function resolveSandboxProvider(preferredProvider?: string): SandboxProviderAdapter {
  const configuredName = (preferredProvider || process.env.SANDBOX_PROVIDER || '').trim().toLowerCase();

  if (configuredName) {
    if (configuredName === 'e2b') {
      const provider = new E2BSandboxProvider();
      if (!provider.isConfigured()) {
        throw new SandboxProviderError({
          code: 'SANDBOX_PROVIDER_UNAVAILABLE',
          message: 'Configured sandbox provider "e2b" is missing E2B_API_KEY.',
          statusCode: 503,
          provider: 'e2b',
        });
      }
      return provider;
    }
    if (configuredName === 'daytona') {
      const provider = new DaytonaSandboxProvider();
      if (!provider.isConfigured()) {
        throw new SandboxProviderError({
          code: 'SANDBOX_PROVIDER_UNAVAILABLE',
          message: 'Configured sandbox provider "daytona" is missing DAYTONA_API_KEY.',
          statusCode: 503,
          provider: 'daytona',
        });
      }
      return provider;
    }
    if (configuredName === 'http-runtime' || configuredName === 'custom') {
      const provider = new HttpRuntimeSandboxProvider();
      if (!provider.isConfigured()) {
        throw new SandboxProviderError({
          code: 'SANDBOX_PROVIDER_UNAVAILABLE',
          message: 'Configured sandbox provider "http-runtime" requires SANDBOX_RUNTIME_URL and SANDBOX_RUNTIME_API_KEY.',
          statusCode: 503,
          provider: 'http-runtime',
        });
      }
      return provider;
    }
    throw new SandboxProviderError({
      code: 'SANDBOX_PROVIDER_UNSUPPORTED',
      message: `Unsupported sandbox provider "${configuredName}". Supported providers: e2b, daytona, http-runtime.`,
      statusCode: 400,
      provider: 'unconfigured',
    });
  }

  // Auto-detect configured provider in priority order
  const candidates: SandboxProviderAdapter[] = [
    new HttpRuntimeSandboxProvider(),
    new E2BSandboxProvider(),
    new DaytonaSandboxProvider(),
  ];

  for (const candidate of candidates) {
    if (candidate.isConfigured()) {
      return candidate;
    }
  }

  throw new SandboxProviderError({
    code: 'SANDBOX_PROVIDER_UNAVAILABLE',
    message:
      'No isolated sandbox provider is configured. Set E2B_API_KEY, DAYTONA_API_KEY, or SANDBOX_RUNTIME_URL + SANDBOX_RUNTIME_API_KEY in server environment variables.',
    statusCode: 503,
    retryable: false,
    provider: 'unconfigured',
  });
}

export async function getSandboxProviderCapabilities(liveCheck = false): Promise<ProviderCapabilityReport> {
  const checkedAt = new Date().toISOString();
  const preferred = (process.env.SANDBOX_PROVIDER || '').trim().toLowerCase();

  let adapter: SandboxProviderAdapter | null = null;
  try {
    adapter = resolveSandboxProvider(preferred || undefined);
  } catch (err: any) {
    return {
      provider: (preferred as SandboxProviderId) || 'unconfigured',
      configured: false,
      operational: false,
      liveCheckPerformed: false,
      supportedRuntimes: [],
      features: [],
      missingCredentials: ['E2B_API_KEY or DAYTONA_API_KEY or SANDBOX_RUNTIME_URL+SANDBOX_RUNTIME_API_KEY'],
      checkedAt,
      error: err?.message || 'No sandbox provider configured.',
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
    supportedRuntimes: adapter.getSupportedRuntimes(),
    features: ['isolated-sandbox', 'terminal', 'filesystem', 'preview-urls'],
    missingCredentials: adapter.getMissingCredentials(),
    checkedAt,
  };
}

export { DaytonaSandboxProvider, E2BSandboxProvider, HttpRuntimeSandboxProvider, SandboxProviderError };
export type { SandboxProviderAdapter };
