/**
 * Swappable isolated browser provider abstraction & error definitions.
 */

import type {
  BrowserPageState,
  BrowserProviderId,
  BrowserScreenshotResult,
  ProviderCapabilityReport,
} from '../../sandbox/types';

export class BrowserProviderError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly provider: BrowserProviderId;

  constructor(params: {
    message: string;
    code: string;
    statusCode?: number;
    retryable?: boolean;
    provider?: BrowserProviderId;
  }) {
    super(params.message);
    this.name = 'BrowserProviderError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 502;
    this.retryable = params.retryable ?? false;
    this.provider = params.provider ?? 'unconfigured';
  }
}

export interface ProviderBrowserCreateInput {
  sessionId: string;
  userId: string;
  viewport: { width: number; height: number };
  timeoutSec: number;
}

export interface ProviderBrowserCreateResult {
  providerSessionId: string;
  wsEndpoint?: string;
}

export interface ProviderBrowserActionResult {
  pageState: BrowserPageState;
  actionSucceeded: boolean;
  message?: string;
}

export interface BrowserProviderAdapter {
  readonly id: BrowserProviderId;
  isConfigured(): boolean;
  getMissingCredentials(): string[];
  healthCheck(): Promise<ProviderCapabilityReport>;

  createSession(input: ProviderBrowserCreateInput): Promise<ProviderBrowserCreateResult>;
  closeSession(providerSessionId: string): Promise<void>;

  navigate(providerSessionId: string, url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number }): Promise<BrowserPageState>;
  inspect(providerSessionId: string, selector?: string): Promise<BrowserPageState>;
  click(providerSessionId: string, selector: string, timeoutMs?: number): Promise<ProviderBrowserActionResult>;
  fill(providerSessionId: string, selector: string, value: string, timeoutMs?: number): Promise<ProviderBrowserActionResult>;
  scroll(providerSessionId: string, options: { direction?: 'down' | 'up'; pixels?: number; selector?: string }): Promise<ProviderBrowserActionResult>;
  waitFor(providerSessionId: string, options: { selector?: string; urlIncludes?: string; timeoutMs?: number }): Promise<ProviderBrowserActionResult>;
  screenshot(providerSessionId: string, options?: { fullPage?: boolean; format?: 'png' | 'jpeg' }): Promise<BrowserScreenshotResult>;
}
