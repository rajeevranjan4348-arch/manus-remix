/**
 * Webhook & Event-Driven Agent Triggers Engine
 *
 * Extends the persistent scheduler and background task queue with:
 * 1. Inbound Webhooks:
 *    - Cryptographically signed ingress endpoints (/api/webhooks/ingest/:triggerId)
 *    - Provider-native signature verification: GitHub (`x-hub-signature-256`),
 *      Stripe (`stripe-signature` + replay window), Slack (`x-slack-signature` + `x-slack-request-timestamp`),
 *      and generic HMAC-SHA256 (`x-webhook-signature`)
 *    - Event filtering, safe payload template rendering (`{{event}}`, `{{payload.a.b}}`),
 *      idempotent delivery deduplication, and automatic durable BackgroundTaskEngine enqueueing.
 * 2. Outbound Webhooks:
 *    - SSRF-validated webhook subscriptions (`task.completed`, `task.failed`, `approval.required`,
 *      `schedule.executed`, `multi_agent.completed`, `webhook.test`)
 *    - Provider-aware payload formatting (Slack Incoming Webhook, Discord Webhook, Email Relay, Generic JSON)
 *    - HMAC-SHA256 `X-Deku-Signature` header, exponential backoff retries (up to 3), and durable delivery logs.
 */

import crypto from 'node:crypto';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from '../infrastructure/durableCollectionStore';
import {
  permissionsGateway,
  type PermissionsGatewayService,
} from '../permissionsGateway';
import {
  defaultBackgroundTaskEngine,
  type BackgroundTaskEngine,
  type BackgroundTaskPriority,
  type BackgroundTaskType,
} from '../queue/backgroundTaskEngine';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
  type PersistenceMode,
} from '../sandbox/durableStore';
import {
  redactSensitiveExecutionText,
  validateBrowserNavigationUrlWithDns,
} from '../sandbox/security';
import { defaultLiveSyncHub, type LiveSyncHub } from '../realtime/liveSyncHub';

export type InboundWebhookProvider = 'generic' | 'github' | 'stripe' | 'slack';
export type OutboundWebhookFormat = 'generic' | 'slack' | 'discord' | 'email_relay';
export type OutboundWebhookEventType =
  | 'task.completed'
  | 'task.failed'
  | 'approval.required'
  | 'schedule.executed'
  | 'multi_agent.completed'
  | 'webhook.test';

interface EncryptedSecretBox {
  iv: string;
  encryptedData: string;
  authTag: string;
}

export interface InboundWebhookRecord {
  webhookId: string;
  userId: string;
  name: string;
  description?: string;
  provider: InboundWebhookProvider;
  enabled: boolean;
  /** Event names allowed (empty = allow all events) */
  allowedEvents: string[];
  /** Stored encrypted at rest if TOKEN_ENCRYPTION_SECRET is configured, or HMAC-derived key hash metadata */
  encryptedSecret?: EncryptedSecretBox;
  /** Dev/test-only fallback secret storage when TOKEN_ENCRYPTION_SECRET is not set outside production */
  devSecret?: string;
  secretFingerprint: string;
  taskTemplate: {
    titleTemplate: string;
    promptTemplate: string;
    type: BackgroundTaskType;
    priority: BackgroundTaskPriority;
    maxAttempts: number;
  };
  triggerCount: number;
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicInboundWebhook = Omit<InboundWebhookRecord, 'encryptedSecret' | 'devSecret'>;

export interface OutboundWebhookRecord {
  subscriptionId: string;
  userId: string;
  name: string;
  url: string;
  format: OutboundWebhookFormat;
  events: OutboundWebhookEventType[];
  enabled: boolean;
  encryptedSecret?: EncryptedSecretBox;
  devSecret?: string;
  secretFingerprint: string;
  customHeaders?: Record<string, string>;
  deliveryCount: number;
  lastDeliveredAt?: string;
  lastStatus?: 'succeeded' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export type PublicOutboundWebhook = Omit<OutboundWebhookRecord, 'encryptedSecret' | 'devSecret'>;

export interface WebhookDeliveryRecord {
  deliveryId: string;
  userId: string;
  direction: 'inbound' | 'outbound';
  webhookId: string;
  eventType: string;
  status: 'succeeded' | 'failed' | 'ignored' | 'deduplicated';
  httpStatus?: number;
  attempts: number;
  taskId?: string;
  targetUrl?: string;
  error?: string;
  createdAt: string;
}

export class WebhookEngineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'WEBHOOK_ERROR', statusCode = 400) {
    super(message);
    this.name = 'WebhookEngineError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const INBOUND_COLLECTION = 'webhooks';
const OUTBOUND_COLLECTION = 'outbound_webhooks';
const DELIVERIES_COLLECTION = 'webhook_deliveries';
const INBOUND_DEDUP_COLLECTION = 'webhook_dedup';

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  Boolean(process.env.NETLIFY) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

function resolveSecretEncryptionKey(): Buffer | null {
  const secret = (process.env.TOKEN_ENCRYPTION_SECRET || process.env.WEBHOOK_SIGNING_SECRET || '').trim();
  if (secret.length >= 32) {
    return crypto.scryptSync(secret, 'deku-webhook-secret-v1', 32);
  }
  return null;
}

function sealSecret(plain: string): { encryptedSecret?: EncryptedSecretBox; devSecret?: string; fingerprint: string } {
  const fingerprint = crypto.createHash('sha256').update(plain).digest('hex').slice(0, 12);
  const key = resolveSecretEncryptionKey();
  if (key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encryptedData = cipher.update(plain, 'utf8', 'hex');
    encryptedData += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return {
      encryptedSecret: { iv: iv.toString('hex'), encryptedData, authTag },
      fingerprint,
    };
  }
  if (IS_PRODUCTION) {
    throw new WebhookEngineError(
      'TOKEN_ENCRYPTION_SECRET (min 32 chars) must be configured in production to store webhook signing secrets securely.',
      'ENCRYPTION_SECRET_REQUIRED',
      503,
    );
  }
  return { devSecret: plain, fingerprint };
}

function unsealSecret(record: { encryptedSecret?: EncryptedSecretBox; devSecret?: string }): string | null {
  if (record.encryptedSecret) {
    const key = resolveSecretEncryptionKey();
    if (!key) return null;
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(record.encryptedSecret.iv, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(record.encryptedSecret.authTag, 'hex'));
      let plain = decipher.update(record.encryptedSecret.encryptedData, 'hex', 'utf8');
      plain += decipher.final('utf8');
      return plain;
    } catch {
      return null;
    }
  }
  return record.devSecret ?? null;
}

function timingSafeHexEquals(aHex: string, bHex: string): boolean {
  const cleanA = aHex.trim().toLowerCase();
  const cleanB = bHex.trim().toLowerCase();
  if (!/^[a-f0-9]+$/.test(cleanA) || !/^[a-f0-9]+$/.test(cleanB) || cleanA.length !== cleanB.length) {
    return false;
  }
  const bufA = Buffer.from(cleanA, 'hex');
  const bufB = Buffer.from(cleanB, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies inbound webhook signatures across GitHub, Stripe, Slack, and Generic HMAC-SHA256 providers.
 */
export function verifyInboundSignature(params: {
  provider: InboundWebhookProvider;
  rawBody: string;
  headers: Headers;
  secret: string;
  nowSec?: number;
}): { valid: boolean; reason: string } {
  const { provider, rawBody, headers, secret } = params;
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000);

  if (!secret || secret.length < 16) {
    return { valid: false, reason: 'Trigger signing secret is missing or invalid.' };
  }

  if (provider === 'github') {
    const sig = (headers.get('x-hub-signature-256') || '').trim();
    if (!sig.toLowerCase().startsWith('sha256=')) {
      return { valid: false, reason: 'Missing GitHub x-hub-signature-256 header.' };
    }
    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const provided = sig.slice(7);
    return timingSafeHexEquals(provided, expected)
      ? { valid: true, reason: 'GitHub HMAC-SHA256 verified.' }
      : { valid: false, reason: 'Invalid GitHub webhook signature.' };
  }

  if (provider === 'stripe') {
    const sigHeader = (headers.get('stripe-signature') || '').trim();
    if (!sigHeader) {
      return { valid: false, reason: 'Missing stripe-signature header.' };
    }
    const parts = Object.fromEntries(
      sigHeader.split(',').map((kv) => {
        const [k, v] = kv.trim().split('=');
        return [k, v];
      }),
    );
    const ts = Number(parts.t);
    const v1 = parts.v1 || '';
    if (!Number.isFinite(ts) || !v1) {
      return { valid: false, reason: 'Malformed stripe-signature header.' };
    }
    if (Math.abs(nowSec - ts) > 300) {
      return { valid: false, reason: 'Stripe webhook timestamp outside 5-minute replay tolerance.' };
    }
    const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
    return timingSafeHexEquals(v1, expected)
      ? { valid: true, reason: 'Stripe webhook signature verified.' }
      : { valid: false, reason: 'Invalid Stripe webhook signature.' };
  }

  if (provider === 'slack') {
    const sig = (headers.get('x-slack-signature') || '').trim();
    const tsHeader = (headers.get('x-slack-request-timestamp') || '').trim();
    const ts = Number(tsHeader);
    if (!sig.startsWith('v0=') || !Number.isFinite(ts)) {
      return { valid: false, reason: 'Missing Slack signature or timestamp header.' };
    }
    if (Math.abs(nowSec - ts) > 300) {
      return { valid: false, reason: 'Slack webhook timestamp outside 5-minute replay tolerance.' };
    }
    const expected = crypto.createHmac('sha256', secret).update(`v0:${tsHeader}:${rawBody}`, 'utf8').digest('hex');
    return timingSafeHexEquals(sig.slice(3), expected)
      ? { valid: true, reason: 'Slack webhook signature verified.' }
      : { valid: false, reason: 'Invalid Slack webhook signature.' };
  }

  // Generic HMAC-SHA256 via x-webhook-signature ("sha256=<hex>" or raw "<hex>")
  const genericSig = (headers.get('x-webhook-signature') || headers.get('x-hub-signature-256') || '').trim();
  if (!genericSig) {
    return { valid: false, reason: 'Missing x-webhook-signature header.' };
  }
  const providedHex = genericSig.replace(/^sha256=/i, '');
  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeHexEquals(providedHex, expectedHex)
    ? { valid: true, reason: 'HMAC-SHA256 signature verified.' }
    : { valid: false, reason: 'Invalid webhook HMAC signature.' };
}

function resolveDotPath(obj: unknown, pathStr: string): string {
  const parts = pathStr.split('.').filter(Boolean);
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return '';
    // Guard against prototype pollution keys
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return '';
    cur = cur[part];
  }
  if (cur == null) return '';
  if (typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean') {
    return String(cur).slice(0, 1000);
  }
  return JSON.stringify(cur).slice(0, 1000);
}

/**
 * Safely render `{{event}}`, `{{provider}}`, and `{{payload.field.nested}}` placeholders without eval.
 */
export function renderWebhookTemplate(
  template: string,
  context: { event: string; provider: string; payload: Record<string, unknown> },
): string {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, expr: string) => {
    if (expr === 'event') return context.event;
    if (expr === 'provider') return context.provider;
    if (expr === 'payload') return JSON.stringify(context.payload).slice(0, 4000);
    if (expr.startsWith('payload.')) {
      return resolveDotPath(context.payload, expr.slice('payload.'.length));
    }
    return resolveDotPath(context.payload, expr);
  });
}

function sanitizeInboundForPublic(rec: InboundWebhookRecord): PublicInboundWebhook {
  const { encryptedSecret: _e, devSecret: _d, ...pub } = rec;
  return pub;
}

function sanitizeOutboundForPublic(rec: OutboundWebhookRecord): PublicOutboundWebhook {
  const { encryptedSecret: _e, devSecret: _d, ...pub } = rec;
  return pub;
}

function formatOutboundPayload(
  format: OutboundWebhookFormat,
  eventType: OutboundWebhookEventType,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const title = String(data.title || `Deku AI Event: ${eventType}`);
  const summary = String(data.summary || data.message || JSON.stringify(data).slice(0, 500));
  const timestamp = new Date().toISOString();

  if (format === 'slack') {
    return {
      text: `*${title}*\n${summary}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: title.slice(0, 150) },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: summary.slice(0, 2500) },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Event: \`${eventType}\` | ${timestamp}` }],
        },
      ],
    };
  }

  if (format === 'discord') {
    const color =
      eventType === 'task.failed'
        ? 0xef4444
        : eventType === 'approval.required'
          ? 0xf59e0b
          : 0x10b981;
    return {
      content: `**${title}**`,
      embeds: [
        {
          title: title.slice(0, 250),
          description: summary.slice(0, 2000),
          color,
          footer: { text: `Deku AI • ${eventType}` },
          timestamp,
        },
      ],
    };
  }

  if (format === 'email_relay') {
    return {
      subject: `[Deku AI] ${title}`.slice(0, 200),
      text: `${title}\n\n${summary}\n\nEvent: ${eventType}\nTimestamp: ${timestamp}`,
      event: eventType,
      timestamp,
      data,
    };
  }

  return {
    source: 'deku-ai',
    event: eventType,
    timestamp,
    title,
    summary,
    data,
  };
}

export interface WebhookEngineOptions {
  store?: DurableCollectionStore;
  auditStore?: DurableExecutionStore;
  permissions?: PermissionsGatewayService;
  taskEngine?: BackgroundTaskEngine;
  syncHub?: LiveSyncHub;
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
}

export class WebhookEngine {
  private readonly store: DurableCollectionStore;
  private readonly auditStore: DurableExecutionStore;
  private readonly permissions: PermissionsGatewayService;
  private readonly taskEngine: BackgroundTaskEngine;
  private readonly syncHub: LiveSyncHub;
  private readonly fetchImpl: typeof fetch;
  private readonly skipDnsLookup: boolean;

  constructor(options?: WebhookEngineOptions) {
    this.store = options?.store ?? defaultCollectionStore;
    this.auditStore = options?.auditStore ?? defaultDurableStore;
    this.permissions = options?.permissions ?? permissionsGateway;
    this.taskEngine = options?.taskEngine ?? defaultBackgroundTaskEngine;
    this.syncHub = options?.syncHub ?? defaultLiveSyncHub;
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.skipDnsLookup = Boolean(options?.skipDnsLookup);
  }

  public getHealth(ctx?: DurableRequestContext): {
    persistenceMode: PersistenceMode;
    supportedInboundProviders: InboundWebhookProvider[];
    supportedOutboundFormats: OutboundWebhookFormat[];
    supportedOutboundEvents: OutboundWebhookEventType[];
  } {
    return {
      persistenceMode: this.store.getMode(ctx),
      supportedInboundProviders: ['generic', 'github', 'stripe', 'slack'],
      supportedOutboundFormats: ['generic', 'slack', 'discord', 'email_relay'],
      supportedOutboundEvents: [
        'task.completed',
        'task.failed',
        'approval.required',
        'schedule.executed',
        'multi_agent.completed',
        'webhook.test',
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Inbound Webhook Trigger CRUD
  // ---------------------------------------------------------------------------

  public async createInboundWebhook(
    ctx: DurableRequestContext,
    input: {
      name: string;
      description?: string;
      provider?: InboundWebhookProvider;
      allowedEvents?: string[];
      titleTemplate?: string;
      promptTemplate: string;
      taskType?: BackgroundTaskType;
      priority?: BackgroundTaskPriority;
      maxAttempts?: number;
      customSecret?: string;
    },
  ): Promise<{ webhook: PublicInboundWebhook; signingSecret: string; ingestPath: string }> {
    const name = String(input.name || '').trim().slice(0, 140);
    const promptTemplate = String(input.promptTemplate || '').trim().slice(0, 8000);
    if (!name || !promptTemplate) {
      throw new WebhookEngineError('name and promptTemplate are required.', 'INVALID_WEBHOOK_INPUT', 400);
    }

    const provider: InboundWebhookProvider =
      input.provider && ['generic', 'github', 'stripe', 'slack'].includes(input.provider)
        ? input.provider
        : 'generic';

    const signingSecret =
      input.customSecret && input.customSecret.trim().length >= 16
        ? input.customSecret.trim().slice(0, 128)
        : `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const sealed = sealSecret(signingSecret);
    const nowIso = new Date().toISOString();
    const webhookId = `whin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const record: InboundWebhookRecord = {
      webhookId,
      userId: ctx.userId,
      name,
      description: input.description?.slice(0, 400),
      provider,
      enabled: true,
      allowedEvents: Array.isArray(input.allowedEvents)
        ? input.allowedEvents.map((e) => String(e).trim()).filter(Boolean).slice(0, 30)
        : [],
      encryptedSecret: sealed.encryptedSecret,
      devSecret: sealed.devSecret,
      secretFingerprint: sealed.fingerprint,
      taskTemplate: {
        titleTemplate: (input.titleTemplate || `${name}: {{event}}`).slice(0, 180),
        promptTemplate,
        type: input.taskType || 'automation',
        priority: input.priority || 'normal',
        maxAttempts: Math.min(5, Math.max(1, input.maxAttempts ?? 3)),
      },
      triggerCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.put(ctx, INBOUND_COLLECTION, webhookId, record);

    await this.permissions.recordSecurityAuditDurable(
      ctx,
      {
        action: 'create_inbound_webhook',
        category: 'external_api_access',
        resourceId: webhookId,
        status: 'succeeded',
        details: { provider, name },
      },
      this.auditStore,
    );

    return {
      webhook: sanitizeInboundForPublic(record),
      signingSecret,
      ingestPath: `/api/webhooks/ingest/${webhookId}`,
    };
  }

  public async listInboundWebhooks(ctx: DurableRequestContext): Promise<PublicInboundWebhook[]> {
    const all = await this.store.list<InboundWebhookRecord>(ctx, INBOUND_COLLECTION, 100);
    return all
      .filter((w) => w.userId === ctx.userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(sanitizeInboundForPublic);
  }

  public async updateInboundWebhook(
    ctx: DurableRequestContext,
    webhookId: string,
    patch: Partial<{
      name: string;
      description: string;
      enabled: boolean;
      allowedEvents: string[];
      titleTemplate: string;
      promptTemplate: string;
      priority: BackgroundTaskPriority;
    }>,
  ): Promise<PublicInboundWebhook> {
    const existing = await this.store.get<InboundWebhookRecord>(ctx, INBOUND_COLLECTION, webhookId);
    if (!existing || existing.userId !== ctx.userId) {
      throw new WebhookEngineError('Inbound webhook not found.', 'WEBHOOK_NOT_FOUND', 404);
    }
    if (patch.name) existing.name = patch.name.trim().slice(0, 140);
    if (patch.description !== undefined) existing.description = patch.description.slice(0, 400);
    if (typeof patch.enabled === 'boolean') existing.enabled = patch.enabled;
    if (Array.isArray(patch.allowedEvents)) {
      existing.allowedEvents = patch.allowedEvents.map((e) => String(e).trim()).filter(Boolean).slice(0, 30);
    }
    if (patch.titleTemplate) existing.taskTemplate.titleTemplate = patch.titleTemplate.slice(0, 180);
    if (patch.promptTemplate) existing.taskTemplate.promptTemplate = patch.promptTemplate.slice(0, 8000);
    if (patch.priority) existing.taskTemplate.priority = patch.priority;
    existing.updatedAt = new Date().toISOString();

    await this.store.put(ctx, INBOUND_COLLECTION, webhookId, existing);
    return sanitizeInboundForPublic(existing);
  }

  public async deleteInboundWebhook(ctx: DurableRequestContext, webhookId: string): Promise<boolean> {
    const existing = await this.store.get<InboundWebhookRecord>(ctx, INBOUND_COLLECTION, webhookId);
    if (!existing || existing.userId !== ctx.userId) return false;
    await this.store.delete(ctx, INBOUND_COLLECTION, webhookId);
    return true;
  }

  /**
   * Publicly reachable signed webhook ingress handler: verifies HMAC signature, deduplicates
   * delivery IDs, checks event allowlist, renders agent prompt, and enqueues a durable background task.
   */
  public async handleInboundEvent(params: {
    webhookId: string;
    rawBody: string;
    headers: Headers;
    nowSec?: number;
  }): Promise<{
    accepted: boolean;
    status: 'enqueued' | 'ignored' | 'deduplicated';
    taskId?: string;
    deliveryId: string;
    eventType: string;
    reason: string;
  }> {
    const allInbound = await this.store.listAllForSystem<InboundWebhookRecord>(INBOUND_COLLECTION, 500);
    const trigger = allInbound.find((w) => w.webhookId === params.webhookId);
    if (!trigger) {
      throw new WebhookEngineError('Webhook trigger not found.', 'WEBHOOK_NOT_FOUND', 404);
    }
    if (!trigger.enabled) {
      throw new WebhookEngineError('Webhook trigger is currently disabled.', 'WEBHOOK_DISABLED', 403);
    }

    const secret = unsealSecret(trigger);
    if (!secret) {
      throw new WebhookEngineError('Webhook signing secret could not be resolved.', 'SECRET_UNAVAILABLE', 503);
    }

    const sigCheck = verifyInboundSignature({
      provider: trigger.provider,
      rawBody: params.rawBody,
      headers: params.headers,
      secret,
      nowSec: params.nowSec,
    });
    if (!sigCheck.valid) {
      throw new WebhookEngineError(sigCheck.reason, 'INVALID_SIGNATURE', 401);
    }

    let payload: Record<string, unknown> = {};
    if (params.rawBody.trim()) {
      try {
        const parsed = JSON.parse(params.rawBody);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        } else {
          payload = { value: parsed };
        }
      } catch {
        throw new WebhookEngineError('Webhook payload must be valid JSON.', 'INVALID_JSON', 400);
      }
    }

    const eventType = (
      params.headers.get('x-github-event') ||
      params.headers.get('x-webhook-event') ||
      (typeof payload.type === 'string' ? payload.type : '') ||
      (typeof payload.event === 'string' ? payload.event : '') ||
      'event'
    )
      .trim()
      .slice(0, 100);

    const externalDeliveryId = (
      params.headers.get('x-github-delivery') ||
      params.headers.get('x-webhook-id') ||
      params.headers.get('x-request-id') ||
      ''
    )
      .trim()
      .slice(0, 128);

    const ownerCtx: DurableRequestContext = { userId: trigger.userId };
    const deliveryId = `whdel_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Deduplicate repeated deliveries with the same external delivery ID
    if (externalDeliveryId) {
      const dedupKey = `in_${trigger.webhookId}_${crypto.createHash('sha256').update(externalDeliveryId).digest('hex').slice(0, 24)}`;
      const seen = await this.store.get<{ taskId?: string }>(ownerCtx, INBOUND_DEDUP_COLLECTION, dedupKey);
      if (seen) {
        const rec: WebhookDeliveryRecord = {
          deliveryId,
          userId: trigger.userId,
          direction: 'inbound',
          webhookId: trigger.webhookId,
          eventType,
          status: 'deduplicated',
          attempts: 1,
          taskId: seen.taskId,
          createdAt: new Date().toISOString(),
        };
        await this.store.put(ownerCtx, DELIVERIES_COLLECTION, deliveryId, rec);
        return {
          accepted: true,
          status: 'deduplicated',
          taskId: seen.taskId,
          deliveryId,
          eventType,
          reason: `Duplicate delivery '${externalDeliveryId}' ignored.`,
        };
      }
    }

    // Event allowlist check
    if (trigger.allowedEvents.length > 0 && !trigger.allowedEvents.includes('*') && !trigger.allowedEvents.includes(eventType)) {
      const rec: WebhookDeliveryRecord = {
        deliveryId,
        userId: trigger.userId,
        direction: 'inbound',
        webhookId: trigger.webhookId,
        eventType,
        status: 'ignored',
        attempts: 1,
        createdAt: new Date().toISOString(),
      };
      await this.store.put(ownerCtx, DELIVERIES_COLLECTION, deliveryId, rec);
      return {
        accepted: true,
        status: 'ignored',
        deliveryId,
        eventType,
        reason: `Event '${eventType}' not in allowedEvents filter.`,
      };
    }

    const renderedTitle = renderWebhookTemplate(trigger.taskTemplate.titleTemplate, {
      event: eventType,
      provider: trigger.provider,
      payload,
    }).slice(0, 180);

    const renderedPrompt = renderWebhookTemplate(trigger.taskTemplate.promptTemplate, {
      event: eventType,
      provider: trigger.provider,
      payload,
    }).slice(0, 18_000);

    const idempotencyKey = externalDeliveryId ? `wh_${trigger.webhookId}_${externalDeliveryId}` : undefined;
    const enqueued = await this.taskEngine.enqueueTask(ownerCtx, {
      title: renderedTitle || `${trigger.name} (${eventType})`,
      prompt: renderedPrompt,
      type: trigger.taskTemplate.type,
      priority: trigger.taskTemplate.priority,
      maxAttempts: trigger.taskTemplate.maxAttempts,
      idempotencyKey,
      payload: {
        webhookId: trigger.webhookId,
        provider: trigger.provider,
        eventType,
        deliveryId: externalDeliveryId || deliveryId,
        webhookPayload: payload,
      },
    });

    if (externalDeliveryId) {
      const dedupKey = `in_${trigger.webhookId}_${crypto.createHash('sha256').update(externalDeliveryId).digest('hex').slice(0, 24)}`;
      await this.store.put(ownerCtx, INBOUND_DEDUP_COLLECTION, dedupKey, {
        taskId: enqueued.task.taskId,
        createdAt: new Date().toISOString(),
      }, 86400 * 7);
    }

    trigger.triggerCount += 1;
    trigger.lastTriggeredAt = new Date().toISOString();
    trigger.updatedAt = trigger.lastTriggeredAt;
    await this.store.put(ownerCtx, INBOUND_COLLECTION, trigger.webhookId, trigger);

    const deliveryRec: WebhookDeliveryRecord = {
      deliveryId,
      userId: trigger.userId,
      direction: 'inbound',
      webhookId: trigger.webhookId,
      eventType,
      status: enqueued.deduplicated ? 'deduplicated' : 'succeeded',
      attempts: 1,
      taskId: enqueued.task.taskId,
      createdAt: new Date().toISOString(),
    };
    await this.store.put(ownerCtx, DELIVERIES_COLLECTION, deliveryId, deliveryRec);

    void this.syncHub.publish(ownerCtx, {
      type: 'webhook:triggered',
      title: `Webhook Triggered: ${trigger.name}`,
      message: `Received '${eventType}' from ${trigger.provider} and queued task '${enqueued.task.title}'.`,
      resourceId: trigger.webhookId,
      taskId: enqueued.task.taskId,
      severity: 'info',
      notifyUser: true,
      data: { provider: trigger.provider, eventType, taskId: enqueued.task.taskId },
    });

    return {
      accepted: true,
      status: enqueued.deduplicated ? 'deduplicated' : 'enqueued',
      taskId: enqueued.task.taskId,
      deliveryId,
      eventType,
      reason: `Verified ${trigger.provider} event '${eventType}' and enqueued background task '${enqueued.task.taskId}'.`,
    };
  }

  // ---------------------------------------------------------------------------
  // Outbound Webhook Subscription CRUD & SSRF-Safe Delivery
  // ---------------------------------------------------------------------------

  public async createOutboundWebhook(
    ctx: DurableRequestContext,
    input: {
      name: string;
      url: string;
      format?: OutboundWebhookFormat;
      events?: OutboundWebhookEventType[];
      customHeaders?: Record<string, string>;
      customSecret?: string;
    },
  ): Promise<{ subscription: PublicOutboundWebhook; signingSecret: string }> {
    const name = String(input.name || '').trim().slice(0, 140);
    const rawUrl = String(input.url || '').trim();
    if (!name || !rawUrl) {
      throw new WebhookEngineError('name and url are required.', 'INVALID_WEBHOOK_INPUT', 400);
    }

    const urlCheck = await validateBrowserNavigationUrlWithDns(rawUrl, {
      skipDnsLookup: this.skipDnsLookup,
    });
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      throw new WebhookEngineError(
        urlCheck.error || 'Webhook target URL blocked by network security policy.',
        'SSRF_BLOCKED',
        400,
      );
    }

    const format: OutboundWebhookFormat =
      input.format && ['generic', 'slack', 'discord', 'email_relay'].includes(input.format)
        ? input.format
        : 'generic';

    const validEvents: OutboundWebhookEventType[] = [
      'task.completed',
      'task.failed',
      'approval.required',
      'schedule.executed',
      'multi_agent.completed',
      'webhook.test',
    ];
    const events = Array.isArray(input.events) && input.events.length > 0
      ? input.events.filter((e): e is OutboundWebhookEventType => validEvents.includes(e))
      : (['task.completed', 'task.failed', 'schedule.executed'] as OutboundWebhookEventType[]);

    const signingSecret =
      input.customSecret && input.customSecret.trim().length >= 16
        ? input.customSecret.trim().slice(0, 128)
        : `whout_${crypto.randomBytes(24).toString('hex')}`;

    const sealed = sealSecret(signingSecret);
    const sanitizedHeaders: Record<string, string> = {};
    if (input.customHeaders && typeof input.customHeaders === 'object') {
      for (const [k, v] of Object.entries(input.customHeaders).slice(0, 10)) {
        const cleanK = k.trim();
        if (!cleanK || !/^[a-zA-Z0-9-]+$/.test(cleanK)) continue;
        if (/^(host|content-length|transfer-encoding|connection)$/i.test(cleanK)) continue;
        sanitizedHeaders[cleanK] = String(v).slice(0, 500);
      }
    }

    const nowIso = new Date().toISOString();
    const subscriptionId = `whout_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const record: OutboundWebhookRecord = {
      subscriptionId,
      userId: ctx.userId,
      name,
      url: urlCheck.normalizedUrl,
      format,
      events,
      enabled: true,
      encryptedSecret: sealed.encryptedSecret,
      devSecret: sealed.devSecret,
      secretFingerprint: sealed.fingerprint,
      customHeaders: Object.keys(sanitizedHeaders).length > 0 ? sanitizedHeaders : undefined,
      deliveryCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.put(ctx, OUTBOUND_COLLECTION, subscriptionId, record);

    await this.permissions.recordSecurityAuditDurable(
      ctx,
      {
        action: 'create_outbound_webhook',
        category: 'external_api_access',
        resourceId: subscriptionId,
        status: 'succeeded',
        details: { format, events, host: urlCheck.hostname },
      },
      this.auditStore,
    );

    return {
      subscription: sanitizeOutboundForPublic(record),
      signingSecret,
    };
  }

  public async listOutboundWebhooks(ctx: DurableRequestContext): Promise<PublicOutboundWebhook[]> {
    const all = await this.store.list<OutboundWebhookRecord>(ctx, OUTBOUND_COLLECTION, 100);
    return all
      .filter((s) => s.userId === ctx.userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(sanitizeOutboundForPublic);
  }

  public async deleteOutboundWebhook(ctx: DurableRequestContext, subscriptionId: string): Promise<boolean> {
    const existing = await this.store.get<OutboundWebhookRecord>(ctx, OUTBOUND_COLLECTION, subscriptionId);
    if (!existing || existing.userId !== ctx.userId) return false;
    await this.store.delete(ctx, OUTBOUND_COLLECTION, subscriptionId);
    return true;
  }

  public async listDeliveries(
    ctx: DurableRequestContext,
    options?: { webhookId?: string; direction?: 'inbound' | 'outbound'; limit?: number },
  ): Promise<WebhookDeliveryRecord[]> {
    const limit = Math.min(100, Math.max(1, options?.limit ?? 50));
    const all = await this.store.list<WebhookDeliveryRecord>(ctx, DELIVERIES_COLLECTION, 150);
    return all
      .filter(
        (d) =>
          d.userId === ctx.userId &&
          (!options?.webhookId || d.webhookId === options.webhookId) &&
          (!options?.direction || d.direction === options.direction),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Dispatch an outbound event to all matching enabled user subscriptions with SSRF re-verification,
   * HMAC-SHA256 signing, exponential backoff retries, and durable delivery logs.
   */
  public async dispatchOutboundEvent(
    ctx: DurableRequestContext,
    eventType: OutboundWebhookEventType,
    data: Record<string, unknown>,
    options?: { subscriptionId?: string; maxAttempts?: number },
  ): Promise<WebhookDeliveryRecord[]> {
    const all = await this.store.list<OutboundWebhookRecord>(ctx, OUTBOUND_COLLECTION, 100);
    const targets = all.filter((sub) => {
      if (sub.userId !== ctx.userId || !sub.enabled) return false;
      if (options?.subscriptionId) return sub.subscriptionId === options.subscriptionId;
      return sub.events.includes(eventType) || eventType === 'webhook.test';
    });

    const deliveries: WebhookDeliveryRecord[] = [];
    const maxAttempts = Math.min(3, Math.max(1, options?.maxAttempts ?? 3));

    for (const sub of targets) {
      const deliveryId = `whdel_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // Re-validate URL at dispatch time (guards against DNS rebinding)
      const urlCheck = await validateBrowserNavigationUrlWithDns(sub.url, {
        skipDnsLookup: this.skipDnsLookup,
      });
      if (!urlCheck.valid || !urlCheck.normalizedUrl) {
        const failedRec: WebhookDeliveryRecord = {
          deliveryId,
          userId: ctx.userId,
          direction: 'outbound',
          webhookId: sub.subscriptionId,
          eventType,
          status: 'failed',
          attempts: 0,
          targetUrl: sub.url,
          error: urlCheck.error || 'Target URL blocked by SSRF protection.',
          createdAt: new Date().toISOString(),
        };
        await this.store.put(ctx, DELIVERIES_COLLECTION, deliveryId, failedRec);
        deliveries.push(failedRec);
        continue;
      }

      const payloadObj = formatOutboundPayload(sub.format, eventType, data);
      const rawBody = JSON.stringify(payloadObj);
      const secret = unsealSecret(sub);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Deku-AI-Webhooks/1.0',
        'X-Deku-Event': eventType,
        'X-Deku-Delivery': deliveryId,
        ...(sub.customHeaders || {}),
      };
      if (secret) {
        const sig = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
        headers['X-Deku-Signature'] = `sha256=${sig}`;
      }

      let attempts = 0;
      let lastHttpStatus: number | undefined;
      let lastError: string | undefined;
      let succeeded = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        attempts = attempt;
        try {
          const res = await this.fetchImpl(urlCheck.normalizedUrl, {
            method: 'POST',
            headers,
            body: rawBody,
            redirect: 'error', // Block redirects to private/internal targets
            signal: AbortSignal.timeout(8000),
          });
          lastHttpStatus = res.status;
          if (res.ok) {
            succeeded = true;
            lastError = undefined;
            break;
          }
          lastError = `Endpoint returned HTTP ${res.status}.`;
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            break; // Do not retry non-429 client errors
          }
        } catch (err) {
          lastError = redactSensitiveExecutionText(
            err instanceof Error ? err.message : 'Outbound webhook transport error.',
          );
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 150 * Math.pow(2, attempt - 1)));
        }
      }

      const nowIso = new Date().toISOString();
      sub.deliveryCount += 1;
      sub.lastDeliveredAt = nowIso;
      sub.lastStatus = succeeded ? 'succeeded' : 'failed';
      sub.updatedAt = nowIso;
      await this.store.put(ctx, OUTBOUND_COLLECTION, sub.subscriptionId, sub);

      const rec: WebhookDeliveryRecord = {
        deliveryId,
        userId: ctx.userId,
        direction: 'outbound',
        webhookId: sub.subscriptionId,
        eventType,
        status: succeeded ? 'succeeded' : 'failed',
        httpStatus: lastHttpStatus,
        attempts,
        targetUrl: sub.url,
        error: lastError,
        createdAt: nowIso,
      };
      await this.store.put(ctx, DELIVERIES_COLLECTION, deliveryId, rec);
      deliveries.push(rec);
    }

    return deliveries;
  }
}

export const defaultWebhookEngine = new WebhookEngine();
