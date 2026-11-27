/**
 * Netlify Serverless Function: Live Background Task Notifications & Cross-Device Sync API
 * Routes: /api/sync/* and /.netlify/functions/sync/*
 *
 * - GET  /api/sync/stream   — Authenticated real-time SSE stream with Last-Event-ID / sinceSeq replay & keep-alive
 * - GET  /api/sync/events   — Durable catch-up events since `sinceSeq` or `sinceTimestamp`
 * - GET  /api/sync/snapshot — Authoritative cross-device state snapshot (active tasks, unread notifications, pending approvals)
 * - POST /api/sync/ack      — Acknowledge/mark notifications read across devices
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import {
  defaultBackgroundTaskEngine,
  type BackgroundTaskEngine,
} from '../../server/queue/backgroundTaskEngine';
import {
  permissionsGateway,
  type PermissionsGatewayService,
} from '../../server/permissionsGateway';
import {
  defaultLiveSyncHub,
  type LiveSyncEvent,
  type LiveSyncHub,
} from '../../server/realtime/liveSyncHub';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
} from '../../server/sandbox/durableStore';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
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

export interface SyncHandlerDeps {
  syncHub?: LiveSyncHub;
  taskEngine?: BackgroundTaskEngine;
  permissions?: PermissionsGatewayService;
  auditStore?: DurableExecutionStore;
  streamDurationMs?: number;
}

export async function handleSyncRequest(
  req: Request,
  deps?: SyncHandlerDeps,
): Promise<Response> {
  const syncHub = deps?.syncHub ?? defaultLiveSyncHub;
  const taskEngine = deps?.taskEngine ?? defaultBackgroundTaskEngine;
  const permissions = deps?.permissions ?? permissionsGateway;
  const auditStore = deps?.auditStore ?? defaultDurableStore;

  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/sync/, '')
      .replace(/^\/api\/sync/, '') || '/';

  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`sync:${decoded.uid}`, 120, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for live sync API.' }, 429);
  }

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && subPath === '/health') {
      return jsonResponse({
        ok: true,
        activeSubscribers: syncHub.getActiveSubscriberCount(ctx.userId),
        transport: ['sse', 'firestore-onSnapshot', 'broadcast-channel'],
      });
    }

    if (req.method === 'GET' && (subPath === '/events' || subPath === '/')) {
      const sinceSeqRaw = url.searchParams.get('sinceSeq') || req.headers.get('last-event-id') || '0';
      const sinceSeq = Number(sinceSeqRaw);
      const sinceTimestamp = url.searchParams.get('sinceTimestamp') || undefined;
      const limit = Number(url.searchParams.get('limit') || '60');
      const result = await syncHub.getEventsSince(ctx, {
        sinceSeq: Number.isFinite(sinceSeq) ? sinceSeq : 0,
        sinceTimestamp,
        limit: Number.isFinite(limit) ? limit : 60,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (req.method === 'GET' && subPath === '/snapshot') {
      const [tasks, notifications, approvals, recentEvents] = await Promise.all([
        taskEngine.listTasks(ctx, { limit: 30 }),
        taskEngine.listNotifications(ctx, { unreadOnly: false, limit: 30 }),
        permissions.listApprovalHistoryDurable(ctx, 50).catch(() => []),
        syncHub.getEventsSince(ctx, { limit: 25 }),
      ]);

      const pendingApprovals = approvals.filter((a: any) => a?.status === 'pending');
      const activeTasks = tasks.filter((t) => t.status === 'queued' || t.status === 'claimed' || t.status === 'running');
      const unreadCount = notifications.filter((n) => !n.read).length;

      return jsonResponse({
        ok: true,
        latestSeq: recentEvents.latestSeq,
        activeTasks,
        recentTasks: tasks.slice(0, 15),
        notifications,
        unreadCount,
        pendingApprovals,
        recentEvents: recentEvents.events,
        serverTime: new Date().toISOString(),
      });
    }

    if (req.method === 'POST' && subPath === '/ack') {
      const raw = await req.text();
      if (Buffer.byteLength(raw, 'utf8') > 32 * 1024) {
        return jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Ack payload too large.' }, 413);
      }
      let body: Record<string, any> = {};
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400);
        }
      }

      const ids: string[] = [];
      if (typeof body.notificationId === 'string' && body.notificationId.trim()) {
        ids.push(body.notificationId.trim());
      }
      if (Array.isArray(body.notificationIds)) {
        for (const id of body.notificationIds.slice(0, 50)) {
          if (typeof id === 'string' && id.trim()) ids.push(id.trim());
        }
      }

      const acknowledged: string[] = [];
      for (const id of ids) {
        const updated = await taskEngine.markNotificationRead(ctx, id);
        if (updated) {
          acknowledged.push(id);
          await syncHub.publish(ctx, {
            type: 'notification:read',
            title: 'Notification Acknowledged',
            message: `Notification ${id} marked read across devices.`,
            notificationId: id,
            severity: 'info',
            notifyUser: false,
            persist: false,
            data: { notificationId: id },
          });
        }
      }

      return jsonResponse({ ok: true, acknowledged });
    }

    if (req.method === 'GET' && subPath === '/stream') {
      const sinceSeqRaw = url.searchParams.get('sinceSeq') || req.headers.get('last-event-id') || '0';
      const sinceSeq = Number.isFinite(Number(sinceSeqRaw)) ? Number(sinceSeqRaw) : 0;
      const maxDurationMs = Math.min(
        25_000,
        Math.max(200, deps?.streamDurationMs ?? Number(url.searchParams.get('durationMs') || '20000')),
      );

      const catchUp = await syncHub.getEventsSince(ctx, { sinceSeq, limit: 50 });
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        start(controller) {
          let closed = false;
          const sendFrame = (chunk: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              closed = true;
            }
          };

          const formatEvent = (ev: LiveSyncEvent) =>
            `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;

          // Send retry directive + initial sync handshake
          sendFrame(`retry: 3000\n`);
          sendFrame(
            `event: sync:connected\ndata: ${JSON.stringify({
              userId: ctx.userId,
              latestSeq: catchUp.latestSeq,
              replayed: catchUp.events.length,
              serverTime: new Date().toISOString(),
            })}\n\n`,
          );

          for (const ev of catchUp.events) {
            sendFrame(formatEvent(ev));
          }

          const unsubscribe = syncHub.subscribe(ctx.userId, (ev) => {
            sendFrame(formatEvent(ev));
          });

          const heartbeat = setInterval(() => {
            sendFrame(`: keepalive ${Date.now()}\n\n`);
          }, 8000);

          const cleanup = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            clearTimeout(closeTimer);
            unsubscribe();
            try {
              controller.close();
            } catch {}
          };

          const closeTimer = setTimeout(cleanup, maxDurationMs);
          req.signal?.addEventListener('abort', cleanup, { once: true });
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in live sync API.' }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected sync error.';
    return jsonResponse({ ok: false, code: 'SYNC_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
  }
}

export default async (req: Request) => handleSyncRequest(req);
