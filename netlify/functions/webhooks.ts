/**
 * Netlify Serverless Function: Webhook & Event-Driven Agent Triggers API
 * Routes: /api/webhooks/* and /.netlify/functions/webhooks/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import type { DurableRequestContext } from '../../server/sandbox/durableStore';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
import {
  defaultWebhookEngine,
  WebhookEngineError,
  type WebhookEngine,
} from '../../server/webhooks/webhookEngine';
import { verifyBearerToken } from '../../src/middleware/auth';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return undefined;
  const token = auth.slice(7).trim();
  if (!token || token.startsWith('guest_')) return undefined;
  return token;
}

async function readJsonBody(req: Request, maxBytes = 256 * 1024) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Webhook payload exceeds 256KB limit.' }, 413),
    };
  }
  if (!raw.trim()) return { ok: true as const, data: {} as Record<string, any>, raw };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected JSON object body.' }, 400),
      };
    }
    return { ok: true as const, data: parsed as Record<string, any>, raw };
  } catch {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

export async function handleWebhooksRequest(
  req: Request,
  engine: WebhookEngine = defaultWebhookEngine,
): Promise<Response> {
  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/webhooks/, '')
      .replace(/^\/api\/webhooks/, '') || '/';

  // 1. Public signed inbound webhook ingress: POST /api/webhooks/ingest/:webhookId
  const ingestMatch = subPath.match(/^\/ingest\/([a-zA-Z0-9_-]{4,128})$/);
  if (ingestMatch) {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'POST required for webhook ingest.' }, 405);
    }
    const webhookId = ingestMatch[1];
    const rl = await checkSharedRateLimit(`webhook-ingest:${webhookId}`, 120, 60);
    if (!rl.allowed) {
      return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Webhook ingest rate limit exceeded.' }, 429);
    }

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 512 * 1024) {
      return jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Inbound webhook exceeds 512KB.' }, 413);
    }

    try {
      const result = await engine.handleInboundEvent({
        webhookId,
        rawBody,
        headers: req.headers,
      });
      return jsonResponse({ ok: true, ...result }, result.status === 'enqueued' ? 202 : 200);
    } catch (err) {
      if (err instanceof WebhookEngineError) {
        return jsonResponse(
          { ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) },
          err.statusCode,
        );
      }
      const msg = err instanceof Error ? err.message : 'Unexpected webhook ingest error.';
      return jsonResponse({ ok: false, code: 'WEBHOOK_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
    }
  }

  // 2. Authenticated user management routes
  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`webhooks:${decoded.uid}`, 60, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for webhooks API.' }, 429);
  }

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && subPath === '/health') {
      return jsonResponse({ ok: true, ...engine.getHealth(ctx) });
    }

    if (req.method === 'GET' && (subPath === '/inbound/list' || subPath === '/inbound')) {
      const webhooks = await engine.listInboundWebhooks(ctx);
      return jsonResponse({ ok: true, webhooks });
    }

    if (req.method === 'POST' && subPath === '/inbound/create') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const result = await engine.createInboundWebhook(ctx, {
        name: typeof body.name === 'string' ? body.name : '',
        description: typeof body.description === 'string' ? body.description : undefined,
        provider: body.provider,
        allowedEvents: Array.isArray(body.allowedEvents) ? body.allowedEvents : undefined,
        titleTemplate: typeof body.titleTemplate === 'string' ? body.titleTemplate : undefined,
        promptTemplate: typeof body.promptTemplate === 'string' ? body.promptTemplate : '',
        taskType: body.taskType,
        priority: body.priority,
        maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined,
        customSecret: typeof body.customSecret === 'string' ? body.customSecret : undefined,
      });
      return jsonResponse({ ok: true, ...result }, 201);
    }

    if (req.method === 'POST' && subPath === '/inbound/update') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.webhookId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'webhookId is required.' }, 400);
      }
      const webhook = await engine.updateInboundWebhook(ctx, parsed.data.webhookId, parsed.data);
      return jsonResponse({ ok: true, webhook });
    }

    if (req.method === 'POST' && subPath === '/inbound/delete') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.webhookId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'webhookId is required.' }, 400);
      }
      const deleted = await engine.deleteInboundWebhook(ctx, parsed.data.webhookId);
      return jsonResponse({ ok: true, deleted });
    }

    if (req.method === 'GET' && (subPath === '/outbound/list' || subPath === '/outbound')) {
      const subscriptions = await engine.listOutboundWebhooks(ctx);
      return jsonResponse({ ok: true, subscriptions });
    }

    if (req.method === 'POST' && subPath === '/outbound/create') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const result = await engine.createOutboundWebhook(ctx, {
        name: typeof body.name === 'string' ? body.name : '',
        url: typeof body.url === 'string' ? body.url : '',
        format: body.format,
        events: Array.isArray(body.events) ? body.events : undefined,
        customHeaders: body.customHeaders && typeof body.customHeaders === 'object' ? body.customHeaders : undefined,
        customSecret: typeof body.customSecret === 'string' ? body.customSecret : undefined,
      });
      return jsonResponse({ ok: true, ...result }, 201);
    }

    if (req.method === 'POST' && subPath === '/outbound/delete') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.subscriptionId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'subscriptionId is required.' }, 400);
      }
      const deleted = await engine.deleteOutboundWebhook(ctx, parsed.data.subscriptionId);
      return jsonResponse({ ok: true, deleted });
    }

    if (req.method === 'POST' && subPath === '/outbound/test') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const deliveries = await engine.dispatchOutboundEvent(
        ctx,
        'webhook.test',
        {
          title: 'Deku AI Webhook Verification',
          summary: typeof parsed.data.message === 'string'
            ? parsed.data.message.slice(0, 400)
            : 'Test event delivered successfully from Deku AI.',
        },
        {
          subscriptionId: typeof parsed.data.subscriptionId === 'string' ? parsed.data.subscriptionId : undefined,
          maxAttempts: 1,
        },
      );
      return jsonResponse({ ok: true, deliveries });
    }

    if (req.method === 'GET' && subPath === '/deliveries') {
      const webhookId = url.searchParams.get('webhookId') || undefined;
      const direction = url.searchParams.get('direction') as 'inbound' | 'outbound' | null;
      const limit = Number(url.searchParams.get('limit') || '50');
      const deliveries = await engine.listDeliveries(ctx, {
        webhookId,
        direction: direction || undefined,
        limit: Number.isFinite(limit) ? limit : 50,
      });
      return jsonResponse({ ok: true, deliveries });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in webhooks API.' }, 404);
  } catch (err) {
    if (err instanceof WebhookEngineError) {
      return jsonResponse(
        { ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) },
        err.statusCode,
      );
    }
    const msg = err instanceof Error ? err.message : 'Unexpected webhooks error.';
    return jsonResponse({ ok: false, code: 'WEBHOOK_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
  }
}

export default async (req: Request) => handleWebhooksRequest(req);
