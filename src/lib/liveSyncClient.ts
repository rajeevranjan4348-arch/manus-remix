/**
 * Cross-Device & Cross-Tab Real-Time Live Sync Client for Deku AI
 *
 * Streams live background task progress, multi-agent milestones, approval challenges,
 * and scheduled run completions in real time by combining:
 * 1. Authenticated SSE stream (/api/sync/stream?sinceSeq=...) with automatic reconnect & catch-up
 * 2. Firestore real-time `onSnapshot` listeners (when signed in) for instant multi-device updates
 * 3. `BroadcastChannel` cross-tab coordination & eventId deduplication so alerts never double-fire
 */

import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';
import { observability } from './observability';

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

export interface LiveSyncClientEvent {
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
  source?: 'sse' | 'firestore' | 'broadcast' | 'snapshot';
}

export interface LiveSyncSnapshot {
  latestSeq: number;
  activeTasks: any[];
  recentTasks: any[];
  unreadNotifications: any[];
  pendingApprovals: any[];
  serverTime: string;
}

export type LiveSyncEventListener = (event: LiveSyncClientEvent) => void;

const BROADCAST_CHANNEL_NAME = 'deku_live_sync_v1';
const SEEN_STORAGE_KEY = 'deku_live_sync_seen_v1';
const MAX_SEEN_IDS = 300;

export class LiveSyncClient {
  private activeUserId: string | null = null;
  private lastSeq = 0;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private listeners = new Set<LiveSyncEventListener>();
  private firestoreUnsubs: Array<() => void> = [];
  private broadcastChannel: BroadcastChannel | null = null;
  private seenEventIds = new Set<string>();
  private tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  public subscribe(listener: LiveSyncEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getLastSeq(): number {
    return this.lastSeq;
  }

  public isConnected(): boolean {
    return this.isRunning;
  }

  public start(userId: string): void {
    if (typeof window === 'undefined' || !userId) return;
    if (this.isRunning && this.activeUserId === userId) return;

    this.stop();
    this.activeUserId = userId;
    this.isRunning = true;
    this.reconnectAttempts = 0;

    this.setupBroadcastChannel();
    this.setupFirestoreListeners(userId);
    void this.connectSseStream();
  }

  public stop(): void {
    this.isRunning = false;
    this.activeUserId = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }
    for (const unsub of this.firestoreUnsubs) {
      try {
        unsub();
      } catch {}
    }
    this.firestoreUnsubs = [];

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }
  }

  public async fetchSnapshot(): Promise<LiveSyncSnapshot | null> {
    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    if (!authHeader) return null;
    try {
      const res = await fetch('/api/sync/snapshot', {
        headers: { Accept: 'application/json', Authorization: authHeader },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data?.latestSeq === 'number' && data.latestSeq > this.lastSeq) {
        this.lastSeq = data.latestSeq;
      }
      return data as LiveSyncSnapshot;
    } catch {
      return null;
    }
  }

  public async acknowledgeNotification(notificationId: string): Promise<boolean> {
    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    if (!authHeader) return false;
    try {
      const res = await fetch('/api/sync/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ notificationId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Mark an eventId as handled across all browser tabs so notifications never duplicate.
   * Returns true if this tab is the first to process this eventId.
   */
  public claimEventDelivery(eventId: string): boolean {
    if (!eventId) return true;
    if (this.seenEventIds.has(eventId)) return false;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
        const list: string[] = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list) && list.includes(eventId)) {
          this.seenEventIds.add(eventId);
          return false;
        }
        const next = [...(Array.isArray(list) ? list : []), eventId].slice(-MAX_SEEN_IDS);
        window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
    }

    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size > MAX_SEEN_IDS) {
      const first = this.seenEventIds.values().next().value;
      if (first) this.seenEventIds.delete(first);
    }
    return true;
  }

  private setupBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.broadcastChannel.onmessage = (msg: MessageEvent) => {
        const payload = msg.data;
        if (!payload || payload.senderTabId === this.tabId) return;
        if (payload.type === 'sync_event' && payload.event) {
          this.emitToListeners({ ...payload.event, source: 'broadcast' }, false);
        }
      };
    } catch {
      this.broadcastChannel = null;
    }
  }

  private setupFirestoreListeners(userId: string): void {
    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== userId || currentUser.isAnonymous || !db) {
      return;
    }

    const subscribeCollection = (
      colName: 'background_tasks' | 'notifications' | 'approvals',
      mapDocChange: (docId: string, data: any) => LiveSyncClientEvent | null,
    ) => {
      try {
        const colRef = collection(db, 'users', userId, colName);
        const q = query(colRef, limit(25));
        let initialized = false;
        const unsub = onSnapshot(
          q,
          (snap) => {
            if (!initialized) {
              initialized = true;
              return;
            }
            for (const change of snap.docChanges()) {
              if (change.type === 'removed') continue;
              const ev = mapDocChange(change.doc.id, change.doc.data());
              if (ev) {
                this.emitToListeners(ev, true);
              }
            }
          },
          (err) => {
            observability.log({
              level: 'warning',
              category: 'live_sync',
              message: `Firestore live listener notice on ${colName}: ${err?.message || 'permission notice'}`,
            });
          },
        );
        this.firestoreUnsubs.push(unsub);
      } catch {
        // Non-fatal; SSE stream still delivers events
      }
    };

    subscribeCollection('background_tasks', (docId, data) => {
      if (!data) return null;
      const status = String(data.status || '');
      const updatedAt = String(data.updatedAt || new Date().toISOString());
      const type: LiveSyncEventType =
        status === 'completed'
          ? 'task:completed'
          : status === 'failed' || status === 'dead_letter'
            ? 'task:failed'
            : status === 'cancelled'
              ? 'task:cancelled'
              : 'task:progress';
      return {
        eventId: `fs_task_${docId}_${status}_${updatedAt}`,
        seq: this.lastSeq,
        userId,
        type,
        title: String(data.title || 'Background Task'),
        message: status === 'completed'
          ? 'Background task completed.'
          : status === 'failed' || status === 'dead_letter'
            ? String(data.error || 'Background task failed.')
            : `Task ${status} (${Number(data.progress || 0)}%).`,
        resourceId: docId,
        taskId: docId,
        severity: status === 'completed' ? 'success' : status === 'failed' || status === 'dead_letter' ? 'error' : 'info',
        notifyUser: status === 'completed' || status === 'failed' || status === 'dead_letter',
        data: { status, progress: data.progress, phase: data.phase },
        createdAt: updatedAt,
        source: 'firestore',
      };
    });

    subscribeCollection('notifications', (docId, data) => {
      if (!data || data.read) return null;
      return {
        eventId: `fs_notif_${docId}`,
        seq: this.lastSeq,
        userId,
        type: 'notification:created',
        title: String(data.title || 'Deku AI Notification'),
        message: String(data.body || ''),
        resourceId: docId,
        notificationId: docId,
        taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
        scheduleId: typeof data.scheduleId === 'string' ? data.scheduleId : undefined,
        severity: data.kind === 'task_failed' ? 'error' : data.kind === 'approval_required' ? 'warning' : 'info',
        notifyUser: true,
        data: { kind: data.kind },
        createdAt: String(data.createdAt || new Date().toISOString()),
        source: 'firestore',
      };
    });

    subscribeCollection('approvals', (docId, data) => {
      if (!data || data.status !== 'pending') return null;
      return {
        eventId: `fs_appr_${docId}_pending`,
        seq: this.lastSeq,
        userId,
        type: 'approval:required',
        title: `Approval Required: ${String(data.displayName || data.toolName || 'Action')}`,
        message: `Action '${String(data.toolName || '')}' requires your confirmation.`,
        resourceId: docId,
        challengeId: docId,
        severity: 'warning',
        notifyUser: true,
        data: { toolName: data.toolName, riskLevel: data.riskLevel },
        createdAt: new Date(Number(data.createdAt) || Date.now()).toISOString(),
        source: 'firestore',
      };
    });
  }

  private async connectSseStream(): Promise<void> {
    if (!this.isRunning || !this.activeUserId) return;

    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    if (!authHeader || !this.isRunning) {
      this.scheduleReconnect();
      return;
    }

    this.abortController = new AbortController();
    try {
      const res = await fetch(`/api/sync/stream?sinceSeq=${encodeURIComponent(String(this.lastSeq))}`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: authHeader,
        },
        signal: this.abortController.signal,
      });

      if (!res.ok || !res.body) {
        this.scheduleReconnect();
        return;
      }

      this.reconnectAttempts = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (this.isRunning) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        for (const frame of frames) {
          const dataLines = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          if (dataLines.length === 0) continue;

          const rawJson = dataLines.join('\n');
          if (!rawJson) continue;
          try {
            const parsed = JSON.parse(rawJson);
            if (parsed?.type === 'connected' && typeof parsed.latestSeq === 'number') {
              if (parsed.latestSeq > this.lastSeq) this.lastSeq = parsed.latestSeq;
              continue;
            }
            if (parsed?.eventId && parsed?.type) {
              if (typeof parsed.seq === 'number' && parsed.seq > this.lastSeq) {
                this.lastSeq = parsed.seq;
              }
              this.emitToListeners({ ...(parsed as LiveSyncClientEvent), source: 'sse' }, true);
            }
          } catch {
            // Ignore malformed SSE comment/ping frames
          }
        }
      }
    } catch {
      // Aborted or network disconnected; schedule reconnect below if still active
    }

    if (this.isRunning) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts += 1;
    const baseMs = Math.min(30_000, 1500 * Math.pow(2, Math.min(5, this.reconnectAttempts - 1)));
    const jitter = Math.floor(Math.random() * 500);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isRunning) return;
      void this.connectSseStream();
    }, baseMs + jitter);
  }

  private emitToListeners(event: LiveSyncClientEvent, broadcastToPeers: boolean): void {
    if (!this.claimEventDelivery(event.eventId)) {
      return;
    }

    if (broadcastToPeers && this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          senderTabId: this.tabId,
          type: 'sync_event',
          event,
        });
      } catch {}
    }

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('deku_live_sync_event', { detail: event }));
      } catch {}
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }
}

export const liveSyncClient = new LiveSyncClient();
