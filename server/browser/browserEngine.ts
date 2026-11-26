/**
 * Core Real Isolated Browser Execution Engine.
 *
 * Orchestrates isolated browser sessions, SSRF/private-network/DNS-rebinding protection,
 * DOM inspection, clicks, form filling with explicit approval enforcement, scrolling,
 * waiting, real visual screenshots, console error capture, durable state, and session cleanup.
 */

import crypto from 'node:crypto';
import { permissionsGateway, type PermissionChallenge, type PermissionsGatewayService } from '../permissionsGateway';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
  type PersistenceMode,
} from '../sandbox/durableStore';
import {
  isValidResourceId,
  redactSensitiveExecutionText,
  requiresApprovalForBrowserAction,
  validateBrowserNavigationUrl,
  validateBrowserNavigationUrlWithDns,
} from '../sandbox/security';
import type {
  BrowserPageState,
  BrowserScreenshotResult,
  BrowserSessionRecord,
  EngineActionAuditEntry,
  ProviderCapabilityReport,
} from '../sandbox/types';
import {
  BrowserProviderError,
  getBrowserProviderCapabilities,
  resolveBrowserProvider,
  type BrowserProviderAdapter,
} from './providers';

export class BrowserEngineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly challenge?: PermissionChallenge;

  constructor(params: { message: string; code: string; statusCode?: number; challenge?: PermissionChallenge }) {
    super(params.message);
    this.name = 'BrowserEngineError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 400;
    this.challenge = params.challenge;
  }
}

export interface BrowserEngineOptions {
  store?: DurableExecutionStore;
  providerResolver?: (preferred?: string) => BrowserProviderAdapter;
  gateway?: PermissionsGatewayService;
  skipDnsLookup?: boolean;
}

export class BrowserExecutionEngine {
  private readonly store: DurableExecutionStore;
  private readonly providerResolver: (preferred?: string) => BrowserProviderAdapter;
  private readonly gateway: PermissionsGatewayService;
  private readonly skipDnsLookup: boolean;

  constructor(options?: BrowserEngineOptions) {
    this.store = options?.store ?? defaultDurableStore;
    this.providerResolver = options?.providerResolver ?? resolveBrowserProvider;
    this.gateway = options?.gateway ?? permissionsGateway;
    this.skipDnsLookup = Boolean(options?.skipDnsLookup);
  }

  public async getHealth(liveCheck = false): Promise<{
    provider: ProviderCapabilityReport;
    persistenceMode: PersistenceMode;
  }> {
    const provider = await getBrowserProviderCapabilities(liveCheck);
    return {
      provider,
      persistenceMode: this.store.getMode(),
    };
  }

  private async audit(
    ctx: DurableRequestContext,
    action: string,
    sessionId: string,
    status: EngineActionAuditEntry['status'],
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.store.appendAudit(ctx, {
      auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      userId: ctx.userId,
      action,
      resourceType: 'browser',
      resourceId: sessionId,
      status,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  private sanitizePageState(state: BrowserPageState): BrowserPageState {
    return {
      ...state,
      title: redactSensitiveExecutionText(state.title || '').slice(0, 300),
      textContent: redactSensitiveExecutionText(state.textContent || '').slice(0, 8000),
      headings: (state.headings || []).slice(0, 30).map((h) => redactSensitiveExecutionText(h).slice(0, 200)),
      links: (state.links || []).slice(0, 50).map((l) => ({
        text: redactSensitiveExecutionText(l.text || '').slice(0, 120),
        href: l.href,
      })),
      interactiveElements: (state.interactiveElements || []).slice(0, 60),
      consoleErrors: (state.consoleErrors || []).slice(0, 40).map((c) => ({
        ...c,
        text: redactSensitiveExecutionText(c.text || '').slice(0, 500),
      })),
      untrustedData: true,
    };
  }

  private async requireOwnedSession(
    ctx: DurableRequestContext,
    sessionId: string,
    allowClosed = false,
  ): Promise<BrowserSessionRecord> {
    if (!isValidResourceId(sessionId)) {
      throw new BrowserEngineError({ code: 'INVALID_SESSION_ID', message: 'Invalid browser sessionId.', statusCode: 400 });
    }
    const session = await this.store.getBrowserSession(ctx, sessionId);
    if (!session) {
      throw new BrowserEngineError({ code: 'SESSION_NOT_FOUND', message: 'Browser session not found.', statusCode: 404 });
    }
    if (session.userId !== ctx.userId) {
      await this.audit(ctx, 'browser_access_denied', sessionId, 'denied', {
        reason: 'Cross-user browser session access blocked.',
      });
      throw new BrowserEngineError({
        code: 'FORBIDDEN',
        message: 'Access denied: you do not own this browser session.',
        statusCode: 403,
      });
    }

    if (!allowClosed && session.status !== 'closed' && session.status !== 'expired') {
      if (Date.now() > Date.parse(session.expiresAt)) {
        try {
          const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
          await provider.closeSession(session.providerSessionId);
        } catch {
          // Best-effort cleanup
        }
        session.status = 'expired';
        session.closedAt = new Date().toISOString();
        session.updatedAt = session.closedAt;
        await this.store.saveBrowserSession(ctx, session);
        throw new BrowserEngineError({
          code: 'BROWSER_SESSION_EXPIRED',
          message: 'Browser session expired and has been cleaned up.',
          statusCode: 410,
        });
      }
    }

    if (!allowClosed && (session.status === 'closed' || session.status === 'expired')) {
      throw new BrowserEngineError({
        code: 'BROWSER_SESSION_INACTIVE',
        message: `Browser session is "${session.status}" and cannot execute actions.`,
        statusCode: 409,
      });
    }

    return session;
  }

  public async createSession(
    ctx: DurableRequestContext,
    input?: {
      projectId?: string;
      taskId?: string;
      viewport?: { width?: number; height?: number };
      timeoutSec?: number;
      provider?: string;
    },
  ): Promise<BrowserSessionRecord> {
    if (!ctx.userId) {
      throw new BrowserEngineError({ code: 'UNAUTHENTICATED', message: 'Authentication required.', statusCode: 401 });
    }

    const viewport = {
      width: Math.min(1920, Math.max(320, Number(input?.viewport?.width) || 1280)),
      height: Math.min(1200, Math.max(320, Number(input?.viewport?.height) || 720)),
    };
    const timeoutSec = Math.min(1800, Math.max(60, Number(input?.timeoutSec) || 600));
    const sessionId = `bs_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    const provider = this.providerResolver(input?.provider);
    const created = await provider.createSession({
      sessionId,
      userId: ctx.userId,
      viewport,
      timeoutSec,
    });

    const now = Date.now();
    const record: BrowserSessionRecord = {
      sessionId,
      provider: provider.id,
      providerSessionId: created.providerSessionId,
      userId: ctx.userId,
      projectId: input?.projectId,
      taskId: input?.taskId,
      status: 'active',
      viewport,
      isolatedStorage: true,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      lastActiveAt: new Date(now).toISOString(),
      expiresAt: new Date(now + timeoutSec * 1000).toISOString(),
    };

    await this.store.saveBrowserSession(ctx, record);
    await this.audit(ctx, 'browser_session_create', sessionId, 'succeeded', {
      provider: provider.id,
      viewport,
    });

    return record;
  }

  public async navigate(
    ctx: DurableRequestContext,
    input: {
      sessionId: string;
      url: string;
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      timeoutMs?: number;
      allowedHosts?: string[];
    },
  ): Promise<{ session: BrowserSessionRecord; page: BrowserPageState }> {
    const session = await this.requireOwnedSession(ctx, input.sessionId);

    const urlCheck = await validateBrowserNavigationUrlWithDns(input.url, {
      allowedHosts: input.allowedHosts,
      skipDnsLookup: this.skipDnsLookup,
    });
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      await this.audit(ctx, 'browser_navigate', session.sessionId, 'denied', {
        url: String(input.url || '').slice(0, 200),
        reason: urlCheck.error,
      });
      throw new BrowserEngineError({
        code: 'BLOCKED_NAVIGATION_TARGET',
        message: urlCheck.error || 'Target URL is blocked by browser network policy.',
        statusCode: 403,
      });
    }

    const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
    const rawPage = await provider.navigate(session.providerSessionId, urlCheck.normalizedUrl, {
      waitUntil: input.waitUntil || 'domcontentloaded',
      timeoutMs: Math.min(45_000, Math.max(2_000, Number(input.timeoutMs) || 20_000)),
    });

    // Post-redirect URL verification to catch open redirects into internal/private networks
    if (rawPage.url) {
      const postRedirect = validateBrowserNavigationUrl(rawPage.url, { allowedHosts: input.allowedHosts });
      if (!postRedirect.valid) {
        await this.audit(ctx, 'browser_navigate', session.sessionId, 'denied', {
          redirectUrl: rawPage.url,
          reason: postRedirect.error,
        });
        throw new BrowserEngineError({
          code: 'BLOCKED_REDIRECT_TARGET',
          message: `Navigation redirected to a forbidden address: ${postRedirect.error}`,
          statusCode: 403,
        });
      }
    }

    const page = this.sanitizePageState(rawPage);
    const now = new Date().toISOString();
    session.currentUrl = page.url || urlCheck.normalizedUrl;
    session.currentTitle = page.title;
    session.lastActiveAt = now;
    session.updatedAt = now;
    await this.store.saveBrowserSession(ctx, session);

    await this.audit(ctx, 'browser_navigate', session.sessionId, 'succeeded', {
      url: session.currentUrl,
      statusCode: page.statusCode,
      consoleErrorCount: page.consoleErrors.length,
    });

    return { session, page };
  }

  public async inspect(
    ctx: DurableRequestContext,
    input: { sessionId: string; selector?: string },
  ): Promise<{ session: BrowserSessionRecord; page: BrowserPageState }> {
    const session = await this.requireOwnedSession(ctx, input.sessionId);
    const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
    const page = this.sanitizePageState(await provider.inspect(session.providerSessionId, input.selector));

    const now = new Date().toISOString();
    session.currentUrl = page.url || session.currentUrl;
    session.currentTitle = page.title || session.currentTitle;
    session.lastActiveAt = now;
    session.updatedAt = now;
    await this.store.saveBrowserSession(ctx, session);

    return { session, page };
  }

  public async click(
    ctx: DurableRequestContext,
    input: {
      sessionId: string;
      selector: string;
      label?: string;
      timeoutMs?: number;
      approvalToken?: string;
    },
  ): Promise<{ session: BrowserSessionRecord; page: BrowserPageState; actionSucceeded: boolean }> {
    const session = await this.requireOwnedSession(ctx, input.sessionId);
    const selector = typeof input.selector === 'string' ? input.selector.trim() : '';
    if (!selector || selector.length > 300) {
      throw new BrowserEngineError({ code: 'INVALID_SELECTOR', message: 'A valid CSS selector is required.', statusCode: 400 });
    }

    const sensitivity = requiresApprovalForBrowserAction({
      action: 'click',
      selector,
      label: input.label,
      url: session.currentUrl,
    });

    if (sensitivity.requiresApproval) {
      const evaluation = await this.gateway.evaluateActionDurable(
        {
          toolName: 'browser_click',
          args: { sessionId: session.sessionId, selector },
          userId: ctx.userId,
          target: `${session.currentUrl || 'page'} -> ${selector}`,
          approvalToken: input.approvalToken,
          forceConfirmation: true,
          reasonOverride: sensitivity.reason,
        },
        ctx,
        this.store,
      );
      if (!evaluation.allowed) {
        throw new BrowserEngineError({
          code: 'APPROVAL_REQUIRED',
          message: evaluation.reason,
          statusCode: 403,
          challenge: evaluation.challenge,
        });
      }
    }

    const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
    const res = await provider.click(
      session.providerSessionId,
      selector,
      Math.min(30_000, Math.max(1_000, Number(input.timeoutMs) || 15_000)),
    );

    const page = this.sanitizePageState(res.pageState);
    const now = new Date().toISOString();
    session.currentUrl = page.url || session.currentUrl;
    session.currentTitle = page.title || session.currentTitle;
    session.lastActiveAt = now;
    session.updatedAt = now;
    await this.store.saveBrowserSession(ctx, session);

    await this.audit(ctx, 'browser_click', session.sessionId, 'succeeded', {
      selector,
      url: session.currentUrl,
    });

    return { session, page, actionSucceeded: res.actionSucceeded };
  }

  public async fill(
    ctx: DurableRequestContext,
    input: {
      sessionId: string;
      selector: string;
      value: string;
      timeoutMs?: number;
      approvalToken?: string;
    },
  ): Promise<{ session: BrowserSessionRecord; page: BrowserPageState; actionSucceeded: boolean }> {
    const session = await this.requireOwnedSession(ctx, input.sessionId);
    const selector = typeof input.selector === 'string' ? input.selector.trim() : '';
    if (!selector || selector.length > 300) {
      throw new BrowserEngineError({ code: 'INVALID_SELECTOR', message: 'A valid CSS selector is required.', statusCode: 400 });
    }
    if (typeof input.value !== 'string' || input.value.length > 4096) {
      throw new BrowserEngineError({ code: 'INVALID_VALUE', message: 'Fill value must be a string under 4096 characters.', statusCode: 400 });
    }

    // Form filling ALWAYS requires explicit user approval
    const evaluation = await this.gateway.evaluateActionDurable(
      {
        toolName: 'browser_fill',
        args: { sessionId: session.sessionId, selector },
        userId: ctx.userId,
        target: `${session.currentUrl || 'page'} -> ${selector}`,
        approvalToken: input.approvalToken,
        forceConfirmation: true,
        reasonOverride: 'Filling website form fields requires explicit user approval.',
      },
      ctx,
      this.store,
    );
    if (!evaluation.allowed) {
      throw new BrowserEngineError({
        code: 'APPROVAL_REQUIRED',
        message: evaluation.reason,
        statusCode: 403,
        challenge: evaluation.challenge,
      });
    }

    const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
    const res = await provider.fill(
      session.providerSessionId,
      selector,
      input.value,
      Math.min(30_000, Math.max(1_000, Number(input.timeoutMs) || 15_000)),
    );

    const page = this.sanitizePageState(res.pageState);
    const now = new Date().toISOString();
    session.lastActiveAt = now;
    session.updatedAt = now;
    await this.store.saveBrowserSession(ctx, session);

    await this.audit(ctx, 'browser_fill', session.sessionId, 'succeeded', {
      selector,
      url: session.currentUrl,
      valueLength: input.value.length,
    });

    return { session, page, actionSucceeded: res.actionSucceeded };
  }

  public async scroll(
    ctx: DurableRequestContext,
    input: { sessionId: string; direction?: 'down' | 'up'; pixels?: number; selector?: string },
  ): Promise<{ session: BrowserSessionRecord; page: BrowserPageState; actionSucceeded: boolean }> {
    const session = await this.requireOwnedSession(ctx, input.sessionId);
    const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
    const res = await provider.scroll(session.providerSessionId, {
      direction: input.direction === 'up' ? 'up' : 'down',
      pixels: Math.min(5000, Math.max(50, Number(input.pixels) || 600)),
      selector: input.selector,
    });
    const page = this.sanitizePageState(res.pageState);
    session.lastActiveAt = new Date().toISOString();
    session.updatedAt = session.lastActiveAt;
    await this.store.saveBrowserSession(ctx, session);
    return { session, page, actionSucceeded: res.actionSucceeded };
  }

  public async waitFor(
    ctx: DurableRequestContext,
    input: { sessionId: string; selector?: string; urlIncludes?: string; timeoutMs?: number },
  ): Promise<{ session: BrowserSessionRecord; page: BrowserPageState; actionSucceeded: boolean }> {
    const session = await this.requireOwnedSession(ctx, input.sessionId);
    const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
    const res = await provider.waitFor(session.providerSessionId, {
      selector: input.selector,
      urlIncludes: input.urlIncludes,
      timeoutMs: Math.min(30_000, Math.max(500, Number(input.timeoutMs) || 10_000)),
    });
    const page = this.sanitizePageState(res.pageState);
    session.lastActiveAt = new Date().toISOString();
    session.updatedAt = session.lastActiveAt;
    await this.store.saveBrowserSession(ctx, session);
    return { session, page, actionSucceeded: res.actionSucceeded };
  }

  public async screenshot(
    ctx: DurableRequestContext,
    input: { sessionId: string; fullPage?: boolean; format?: 'png' | 'jpeg' },
  ): Promise<BrowserScreenshotResult> {
    const session = await this.requireOwnedSession(ctx, input.sessionId);
    const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
    const shot = await provider.screenshot(session.providerSessionId, {
      fullPage: Boolean(input.fullPage),
      format: input.format === 'jpeg' ? 'jpeg' : 'png',
    });

    if (!shot?.dataBase64) {
      throw new BrowserProviderError({
        code: 'SCREENSHOT_EMPTY',
        message: 'Browser provider did not return screenshot image data.',
        statusCode: 502,
        provider: provider.id,
      });
    }

    session.lastActiveAt = new Date().toISOString();
    session.updatedAt = session.lastActiveAt;
    await this.store.saveBrowserSession(ctx, session);
    await this.audit(ctx, 'browser_screenshot', session.sessionId, 'succeeded', {
      url: shot.url || session.currentUrl,
      fullPage: shot.fullPage,
    });

    return {
      ...shot,
      sessionId: session.sessionId,
      title: shot.title || session.currentTitle,
    };
  }

  public async closeSession(
    ctx: DurableRequestContext,
    sessionId: string,
  ): Promise<{ sessionId: string; status: 'closed'; closedAt: string }> {
    const session = await this.requireOwnedSession(ctx, sessionId, true);
    if (session.status !== 'closed' && session.status !== 'expired') {
      const provider = this.providerResolver(session.provider === 'unconfigured' ? undefined : session.provider);
      await provider.closeSession(session.providerSessionId);
    }

    const closedAt = new Date().toISOString();
    session.status = 'closed';
    session.closedAt = closedAt;
    session.updatedAt = closedAt;
    await this.store.saveBrowserSession(ctx, session);
    await this.audit(ctx, 'browser_session_close', sessionId, 'succeeded', {});

    return { sessionId, status: 'closed', closedAt };
  }
}

export const defaultBrowserEngine = new BrowserExecutionEngine();
