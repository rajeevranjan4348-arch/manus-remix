/**
 * Sandbox provider abstraction (Feature 06).
 *
 * Providers are resolved from configuration (SANDBOX_PROVIDER env var) and are
 * fully swappable. When no provider credentials exist the system returns an
 * explicit UnavailableProvider whose every action fails with PROVIDER_UNAVAILABLE:
 * the platform reports the feature as unavailable instead of pretending that
 * execution works. Credentials are read from server-side env vars only and are
 * never returned to clients.
 */

import type { ProviderCapabilities, ProviderHealth, SandboxCreateOptions, SandboxLimits,
  CommandExecutionRequest, FilesystemEntry, SandboxProvider } from './types';
import { E2BProviderAdapter } from './e2bProvider';

export type { SandboxProvider, ProviderCapabilities, ProviderHealth, SandboxCreateOptions, SandboxLimits } from './types';

export class ProviderUnavailableError extends Error {
  code = 'PROVIDER_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * Fail-closed provider returned when the configured vendor is not usable.
 * Every method reports honestly that execution cannot happen.
 */
export class UnavailableProvider implements SandboxProvider {
  readonly id = 'unavailable';
  readonly capabilities: ProviderCapabilities = {
    terminal: false,
    filesystem: false,
    devServerPreview: false,
    browser: false,
    browserScreenshots: false,
    runtimes: [],
  };

  constructor(private readonly detail: string) {}

  isConfigured() {
    return false;
  }
  configurationErrors(): string[] {
    return [this.detail];
  }
  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerId: this.id,
      configured: false,
      available: false,
      detail: this.detail,
      checkedAt: new Date().toISOString(),
    };
  }

  private refusal(): never {
    throw new ProviderUnavailableError(this.detail);
  }

  async createSession(): Promise<any> { this.refusal(); }
  async terminateSession(): Promise<void> { this.refusal(); }
  async execCommand(): Promise<any> { this.refusal(); }
  async readPreviewHostUrl(): Promise<string | null> { this.refusal(); }
  async fetchPreviewStatus(): Promise<any> { this.refusal(); }
  async writeFile(): Promise<any> { this.refusal(); }
  async readFile(): Promise<any> { this.refusal(); }
  async listFiles(): Promise<FilesystemEntry[]> { this.refusal(); }
  async deletePath(): Promise<void> { this.refusal(); }
  async movePath(): Promise<void> { this.refusal(); }
  async statPath(): Promise<any> { this.refusal(); }
  async browserCreate(): Promise<void> { this.refusal(); }
  async browserNavigate(): Promise<any> { this.refusal(); }
  async browserInspect(): Promise<any> { this.refusal(); }
  async browserClick(): Promise<any> { this.refusal(); }
  async browserFill(): Promise<any> { this.refusal(); }
  async browserScroll(): Promise<void> { this.refusal(); }
  async browserWaitFor(): Promise<void> { this.refusal(); }
  async browserScreenshot(): Promise<any> { this.refusal(); }
  async browserClose(): Promise<void> { this.refusal(); }
}

export interface ResolvedProvider {
  provider: SandboxProvider;
  available: boolean;
  reason: string;
}

const SUPPORTED_PROVIDERS = ['e2b', 'off'] as const;

/**
 * Resolve the active provider from configuration. Never throws: an
 * unavailable configuration still yields a fail-closed provider so routes can
 * answer with a precise, non-fabricated refusal.
 */
export function resolveProvider(): ResolvedProvider {
  const configured = (process.env.SANDBOX_PROVIDER || '').trim().toLowerCase();
  if (!configured || configured === 'off') {
    return {
      provider: new UnavailableProvider(
        'No sandbox provider is configured. Set SANDBOX_PROVIDER (supported: e2b) with provider credentials on the server. Sandbox, terminal, browser and preview execution are unavailable.',
      ),
      available: false,
      reason: 'SANDBOX_PROVIDER is not configured',
    };
  }
  if (!SUPPORTED_PROVIDERS.includes(configured as any)) {
    return {
      provider: new UnavailableProvider(
        `SANDBOX_PROVIDER='${configured}' is not a supported provider. Supported values: e2b, off.`,
      ),
      available: false,
      reason: `SANDBOX_PROVIDER='${configured}' is not a supported provider. Supported values: e2b, off.`,
    };
  }

  const candidate = new E2BProviderAdapter();
  const errors = candidate.configurationErrors();
  if (errors.length > 0) {
    return {
      provider: new UnavailableProvider(`E2B provider is not usable: ${errors.join(' ')}`),
      available: false,
      reason: errors.join(' '),
    };
  }
  return { provider: candidate, available: true, reason: `Provider 'e2b' configured and available` };
}

export function isProviderAvailable(resolved: ResolvedProvider): boolean {
  return resolved.available && resolved.provider.isConfigured();
}

export const VALID_RUNTIMES = ['node', 'typescript', 'javascript', 'python', 'html-css', 'react-vite', 'next', 'custom'] as const;
