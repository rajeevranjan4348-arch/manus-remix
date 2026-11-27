/**
 * Live Background Task Notifications & Cross-Device Real-Time Sync Hub
 *
 * Provides server-authoritative real-time event broadcasting per user across open tabs
 * and devices via SSE (/api/sync/stream), durable catch-up replay (/api/sync/events),
 * and full state snapshots (/api/sync/snapshot).
 */

import crypto from 'node:crypto';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from '../infrastructure/durableCollectionStore';
import type { DurableRequestContext } from '../sandbox/durableStore';

export type LiveSyncEventType =
  | 'task:queued'
  | 'task:claimed'
  | 'task:progress'
  | 'task:completed'
  | 'task:failed'
  | 'task:cancelled'
  | 'multi_agent:milestone'
  | 'multi_agent:completed'
  | 'multi_agent:failed'
  | 'approval:required'
  | 'approval:resolved'
  | 'schedule:executed'
  | 'webhook:triggered'
  | 'notification:created'
  | 'notification:read'
  | 'rag:indexed'
  | 'mcp:tools_updated'
  | 'system:ping';

export interface LiveSyncEvent {
  eventId: string;
  seq: number;
  userId: string;
  type: LiveSyncEventType;
  title: string;
  message: string;
  resourceId?: string;
  taskId?: string;
  runId?: string;
  scheduleId?: string;
  challengeId?: string;
  notificationId?: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  notifyUser: boolean;
  data?: Record<string, unknown>;
  createdAt: string;
}

export type LiveSyncSubscriber = (event: LiveSyncEvent) => void;

const SYNC_EVENTS_COLLECTION = 'sync_events';
const MAX_RING_BUFFER_PER_USER = 150;

export class LiveSyncHub {
  private readonly store: DurableCollectionStore;
  private readonly subscribers = new Map<string, Set<LiveSyncSubscriber>>();
  private readonly ringBuffers = new Map<string, LiveSyncEvent[]>();
  private readonly seqCounters = new Map<string, number>();

  constructor(store?: DurableCollectionStore) {
    this.store = store ?? defaultCollectionStore;
  }

  private nextSequence(userId: string): number {
    const current = this.seqCounters.get(userId) ?? 0;
    const next = current + 1;
    this.seqCounters.set(userId, next);
    return next;
  }

  /**
   * Publish a server-authoritative sync event to all live SSE subscribers and persist durably
   * so reconnecting devices or other serverless instances can catch up via `sinceSeq`.
   */
  public async publish(
    ctx: DurableRequestContext,
    input: {
      type: LiveSyncEventType;
      title: string;
      message: string;
      resourceId?: string;
      taskId?: string;
      runId?: string;
      scheduleId?: string;
      challengeId?: string;
      notificationId?: string;
      severity?: LiveSyncEvent['severity'];
      notifyUser?: boolean;
      data?: Record<string, unknown>;
      persist?: boolean;
    },
  ): Promise<LiveSyncEvent> {
    const nowIso = new Date().toISOString();
    const seq = this.nextSequence(ctx.userId);
    const eventId = `evt_${Date.now()}_${seq}_${crypto.randomBytes(3).toString('hex')}`;

    const event: LiveSyncEvent = {
      eventId,
      seq,
      userId: ctx.userId,
      type: input.type,
      title: input.title.slice(0, 180),
      message: input.message.slice(0, 1200),
      resourceId: input.resourceId,
      taskId: input.taskId,
      runId: input.runId,
      scheduleId: input.scheduleId,
      challengeId: input.challengeId,
      notificationId: input.notificationId,
      severity: input.severity ?? 'info',
      notifyUser: Boolean(input.notifyUser),
      data: input.data,
      createdAt: nowIso,
    };

    // Update in-memory per-user ring buffer
    let buffer = this.ringBuffers.get(ctx.userId);
    if (!buffer) {
      buffer = [];
      this.ringBuffers.set(ctx.userId, buffer);
    }
    buffer.push(event);
    if (buffer.length > MAX_RING_BUFFER_PER_USER) {
      buffer.splice(0, buffer.length - MAX_RING_BUFFER_PER_USER);
    }

    // Persist durably (7 day TTL in Redis / Firestore user subcollection)
    if (input.persist !== false) {
      try {
        await this.store.put(ctx, SYNC_EVENTS_COLLECTION, eventId, event, 86400 * 7);
      } catch {
        // Non-fatal: live subscribers still receive the event
      }
    }

    // Broadcast immediately to all active SSE subscribers for this user
    const subs = this.subscribers.get(ctx.userId);
    if (subs && subs.size > 0) {
      for (const listener of subs) {
        try {
          listener(event);
        } catch {
          // Isolate broken listener streams
        }
      }
    }

    return event;
  }

  /**
   * Subscribe to real-time push events for a specific authenticated user.
   */
  public subscribe(userId: string, listener: LiveSyncSubscriber): () => void {
    let set = this.subscribers.get(userId);
    if (!set) {
      set = new Set();
      this.subscribers.set(userId, set);
    }
    set.add(listener);
    return () => {
      const current = this.subscribers.get(userId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.subscribers.delete(userId);
        }
      }
    };
  }

  /**
   * Retrieve events after `sinceSeq` (or `sinceTimestamp`) merging in-memory ring buffer
   * and durable store for seamless cross-instance & cross-device catch-up.
   */
  public async getEventsSince(
    ctx: DurableRequestContext,
    options?: { sinceSeq?: number; sinceTimestamp?: string; limit?: number },
  ): Promise<{ events: LiveSyncEvent[]; latestSeq: number }> {
    const limit = Math.min(200, Math.max(1, options?.limit ?? 60));
    const sinceSeq = typeof options?.sinceSeq === 'number' && Number.isFinite(options.sinceSeq)
      ? options.sinceSeq
      : 0;
    const sinceMs = options?.sinceTimestamp ? new Date(options.sinceTimestamp).getTime() : 0;

    const merged = new Map<string, LiveSyncEvent>();

    const memEvents = this.ringBuffers.get(ctx.userId) || [];
    for (const ev of memEvents) {
      merged.set(ev.eventId, ev);
    }

    try {
      const persisted = await this.store.list<LiveSyncEvent>(ctx, SYNC_EVENTS_COLLECTION, 150);
      for (const ev of persisted) {
        if (ev && ev.userId === ctx.userId && ev.eventId) {
          merged.set(ev.eventId, ev);
        }
      }
    } catch {
      // Fallback to in-memory ring buffer
    }

    const sorted = Array.from(merged.values()).sort((a, b) => {
      const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.seq - b.seq;
    });

    const latestSeq = sorted.reduce(
      (max, ev) => Math.max(max, ev.seq),
      this.seqCounters.get(ctx.userId) ?? 0,
    );

    const filtered = sorted.filter((ev) => {
      if (sinceSeq > 0 && ev.seq <= sinceSeq) return false;
      if (sinceMs > 0 && new Date(ev.createdAt).getTime() <= sinceMs) return false;
      return true;
    });

    return {
      events: filtered.slice(-limit),
      latestSeq,
    };
  }

  public getActiveSubscriberCount(userId?: string): number {
    if (userId) {
      return this.subscribers.get(userId)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.subscribers.values()) {
      total += set.size;
    }
    return total;
  }
}

export const defaultLiveSyncHub = new LiveSyncHub();
