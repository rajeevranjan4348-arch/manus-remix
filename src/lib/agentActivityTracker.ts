import { useEffect, useState } from 'react';

export type AgentActivityStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type VerificationOutcome =
  | 'QUEUED'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'SKIPPED';

export type AgentActivityCategory =
  | 'analysis'
  | 'search'
  | 'browser'
  | 'github'
  | 'file'
  | 'terminal'
  | 'api'
  | 'database'
  | 'auth'
  | 'code'
  | 'model'
  | 'verification'
  | 'tool';

export interface AgentActivityEvent {
  taskId: string;
  eventId: string;
  seq: number;
  title: string;
  description: string;
  toolName: string;
  status: AgentActivityStatus;
  timestamp: string;
  category?: AgentActivityCategory;
  resultSummary?: string;
  error?: string;
  verificationStage?: string;
  verificationOutcome?: VerificationOutcome;
  durationMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ClientEmitActivityInput {
  taskId: string;
  eventId?: string;
  seq?: number;
  title: string;
  description?: string;
  toolName: string;
  status: AgentActivityStatus;
  timestamp?: string;
  category?: AgentActivityCategory;
  resultSummary?: string;
  error?: string;
  verificationStage?: string;
  verificationOutcome?: VerificationOutcome;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ClientActivityHandle {
  eventId: string;
  update: (patch: Partial<Omit<ClientEmitActivityInput, 'taskId' | 'eventId' | 'toolName'>>) => AgentActivityEvent;
  complete: (resultSummary?: string, patch?: Partial<Omit<ClientEmitActivityInput, 'taskId' | 'eventId' | 'toolName' | 'status'>>) => AgentActivityEvent;
  fail: (error: unknown, patch?: Partial<Omit<ClientEmitActivityInput, 'taskId' | 'eventId' | 'toolName' | 'status'>>) => AgentActivityEvent;
  cancel: (reason?: string) => AgentActivityEvent;
}

const STORAGE_KEY = 'manus_agent_activity_feeds_v1';
const MAX_PERSISTED_TASKS = 20;
const MAX_EVENTS_PER_TASK = 120;

const CLIENT_SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /<think>[\s\S]*?<\/think>/gi, replacement: '' },
  { pattern: /<think>[\s\S]*$/gi, replacement: '' },
  { pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\bya29\.[A-Za-z0-9\-._]+/g, replacement: '[REDACTED_OAUTH_TOKEN]' },
  { pattern: /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g, replacement: '[REDACTED_JWT]' },
  { pattern: /\bAIza[0-9A-Za-z\-_]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\bsk-(?:or-v1-|proj-)?[A-Za-z0-9\-_]{16,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  { pattern: /(https?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, replacement: '$1[REDACTED]:[REDACTED]@' },
  {
    pattern: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret[_-]?key|gemini_api_key|openrouter_api_key|database_url)\b(\s*[:=]\s*)(["']?)([^"'\s,;}\]]+)\3/gi,
    replacement: '$1$2[REDACTED]',
  },
];

export function redactSensitiveActivityText(value: unknown, maxLength = 260): string {
  if (typeof value !== 'string') return '';
  let text = value;
  for (const { pattern, replacement } of CLIENT_SENSITIVE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (text.length > maxLength) {
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }
  return text;
}

function sanitizeMetadata(
  metadata?: Record<string, unknown>
): Record<string, string | number | boolean> | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const blocked = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|private[_-]?key|credential)/i;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!k || blocked.test(k)) continue;
    if (typeof v === 'string') {
      const cleaned = redactSensitiveActivityText(v, 140);
      if (cleaned) out[k] = cleaned;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const VALID_STATUSES: ReadonlySet<AgentActivityStatus> = new Set([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

function normalizeStatus(status: unknown): AgentActivityStatus {
  const upper = String(status || '').toUpperCase() as AgentActivityStatus;
  return VALID_STATUSES.has(upper) ? upper : 'RUNNING';
}

interface TaskFeedRecord {
  taskId: string;
  latestServerSeq: number;
  localSeq: number;
  updatedAt: number;
  eventsById: Map<string, AgentActivityEvent>;
  order: string[];
  snapshot: AgentActivityEvent[];
}

export class AgentActivityTracker {
  private feeds = new Map<string, TaskFeedRecord>();
  private listeners = new Map<string, Set<() => void>>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      if (typeof sessionStorage === 'undefined') return;
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      for (const [taskId, items] of Object.entries(parsed)) {
        if (!Array.isArray(items)) continue;
        const record = this.getOrCreateRecord(taskId);
        for (const item of items) {
          if (!item || typeof item !== 'object' || !item.eventId) continue;
          const ev = this.normalizeEvent(taskId, item as ClientEmitActivityInput, record);
          // Any activity that was still RUNNING when the tab closed/reloaded is no longer actively running
          if (ev.status === 'RUNNING' || ev.status === 'QUEUED') {
            ev.status = 'CANCELLED';
            ev.resultSummary = ev.resultSummary || 'Session refreshed before completion';
          }
          record.eventsById.set(ev.eventId, ev);
          if (!record.order.includes(ev.eventId)) {
            record.order.push(ev.eventId);
          }
          if (ev.seq > record.latestServerSeq) record.latestServerSeq = ev.seq;
        }
        this.rebuildSnapshot(record);
      }
    } catch {
      // Ignore corrupt session storage gracefully
    }
  }

  private schedulePersist(): void {
    if (typeof sessionStorage === 'undefined') return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        const entries = Array.from(this.feeds.entries())
          .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
          .slice(0, MAX_PERSISTED_TASKS);
        const payload: Record<string, AgentActivityEvent[]> = {};
        for (const [taskId, rec] of entries) {
          payload[taskId] = rec.snapshot.slice(-60);
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Ignore quota errors on low-memory devices
      }
    }, 180);
  }

  private getOrCreateRecord(taskId: string): TaskFeedRecord {
    const cleanId = String(taskId || 'default').trim().slice(0, 120) || 'default';
    let rec = this.feeds.get(cleanId);
    if (!rec) {
      if (this.feeds.size >= MAX_PERSISTED_TASKS * 2) {
        let oldestKey: string | null = null;
        let oldestTs = Infinity;
        for (const [key, value] of this.feeds.entries()) {
          if (!this.listeners.get(key)?.size && value.updatedAt < oldestTs) {
            oldestTs = value.updatedAt;
            oldestKey = key;
          }
        }
        if (oldestKey) this.feeds.delete(oldestKey);
      }
      rec = {
        taskId: cleanId,
        latestServerSeq: 0,
        localSeq: 0,
        updatedAt: Date.now(),
        eventsById: new Map(),
        order: [],
        snapshot: [],
      };
      this.feeds.set(cleanId, rec);
    }
    rec.updatedAt = Date.now();
    return rec;
  }

  private rebuildSnapshot(rec: TaskFeedRecord): void {
    rec.snapshot = rec.order
      .map((id) => rec.eventsById.get(id))
      .filter((ev): ev is AgentActivityEvent => Boolean(ev));
  }

  private notify(taskId: string): void {
    const set = this.listeners.get(taskId);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        fn();
      } catch {
        // Isolate listener failures
      }
    }
  }

  private normalizeEvent(
    taskId: string,
    input: ClientEmitActivityInput,
    rec: TaskFeedRecord
  ): AgentActivityEvent {
    const eventId =
      typeof input.eventId === 'string' && input.eventId.trim()
        ? input.eventId.trim().slice(0, 120)
        : `cli_${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const existing = rec.eventsById.get(eventId);
    const seq =
      typeof input.seq === 'number' && Number.isFinite(input.seq) && input.seq > 0
        ? input.seq
        : existing?.seq || ++rec.localSeq;

    return {
      taskId: rec.taskId,
      eventId,
      seq,
      title: redactSensitiveActivityText(input.title || existing?.title || 'Processing step', 140) || 'Processing step',
      description: redactSensitiveActivityText(input.description ?? existing?.description ?? '', 260),
      toolName: redactSensitiveActivityText(input.toolName || existing?.toolName || 'agent', 64) || 'agent',
      status: normalizeStatus(input.status),
      timestamp: input.timestamp || new Date().toISOString(),
      category: input.category ?? existing?.category,
      resultSummary:
        input.resultSummary !== undefined
          ? redactSensitiveActivityText(input.resultSummary, 280)
          : existing?.resultSummary,
      error:
        input.error !== undefined
          ? redactSensitiveActivityText(input.error, 240)
          : normalizeStatus(input.status) === 'FAILED'
            ? existing?.error
            : undefined,
      verificationStage: input.verificationStage ?? existing?.verificationStage,
      verificationOutcome: input.verificationOutcome ?? existing?.verificationOutcome,
      durationMs:
        typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
          ? Math.max(0, Math.round(input.durationMs))
          : existing?.durationMs,
      metadata: sanitizeMetadata({ ...(existing?.metadata || {}), ...(input.metadata || {}) }),
    };
  }

  public ingestEvent(raw: ClientEmitActivityInput, fromServer = true): AgentActivityEvent | null {
    this.ensureHydrated();
    if (!raw || typeof raw !== 'object' || !raw.taskId) return null;
    const rec = this.getOrCreateRecord(raw.taskId);
    const existing = raw.eventId ? rec.eventsById.get(raw.eventId) : undefined;

    // Prevent stale replayed server frames from regressing a newer event state
    if (
      fromServer &&
      existing &&
      typeof raw.seq === 'number' &&
      raw.seq > 0 &&
      existing.seq >= raw.seq &&
      existing.status === normalizeStatus(raw.status)
    ) {
      return existing;
    }

    const normalized = this.normalizeEvent(rec.taskId, raw, rec);
    if (fromServer && normalized.seq > rec.latestServerSeq) {
      rec.latestServerSeq = normalized.seq;
    }

    if (!existing) {
      rec.order.push(normalized.eventId);
      if (rec.order.length > MAX_EVENTS_PER_TASK) {
        const dropped = rec.order.shift();
        if (dropped) rec.eventsById.delete(dropped);
      }
    }

    rec.eventsById.set(normalized.eventId, normalized);
    this.rebuildSnapshot(rec);
    this.notify(rec.taskId);
    this.schedulePersist();
    return normalized;
  }

  public startActivity(
    taskId: string,
    opts: Omit<ClientEmitActivityInput, 'taskId' | 'status'> & { initialStatus?: 'QUEUED' | 'RUNNING' }
  ): ClientActivityHandle {
    const startedAt = Date.now();
    const initial = this.ingestEvent(
      {
        ...opts,
        taskId,
        status: opts.initialStatus || 'RUNNING',
      },
      false
    )!;
    let finalized = false;

    return {
      eventId: initial.eventId,
      update: (patch) =>
        this.ingestEvent(
          {
            taskId,
            eventId: initial.eventId,
            toolName: opts.toolName,
            title: patch.title || initial.title,
            description: patch.description ?? initial.description,
            status: patch.status || 'RUNNING',
            category: patch.category ?? opts.category,
            resultSummary: patch.resultSummary,
            error: patch.error,
            verificationStage: patch.verificationStage ?? opts.verificationStage,
            verificationOutcome: patch.verificationOutcome ?? opts.verificationOutcome,
            metadata: patch.metadata,
          },
          false
        ) || initial,
      complete: (resultSummary, patch) => {
        if (finalized) return this.getEventById(taskId, initial.eventId) || initial;
        finalized = true;
        return (
          this.ingestEvent(
            {
              taskId,
              eventId: initial.eventId,
              toolName: opts.toolName,
              title: patch?.title || initial.title,
              description: patch?.description ?? initial.description,
              status: 'COMPLETED',
              category: patch?.category ?? opts.category,
              resultSummary: resultSummary ?? patch?.resultSummary,
              verificationStage: patch?.verificationStage ?? opts.verificationStage,
              verificationOutcome: patch?.verificationOutcome ?? opts.verificationOutcome,
              durationMs: Date.now() - startedAt,
              metadata: patch?.metadata,
            },
            false
          ) || initial
        );
      },
      fail: (error, patch) => {
        if (finalized) return this.getEventById(taskId, initial.eventId) || initial;
        finalized = true;
        const message = error instanceof Error ? error.message : String(error || 'Operation failed');
        return (
          this.ingestEvent(
            {
              taskId,
              eventId: initial.eventId,
              toolName: opts.toolName,
              title: patch?.title || initial.title,
              description: patch?.description ?? initial.description,
              status: 'FAILED',
              category: patch?.category ?? opts.category,
              error: message,
              resultSummary: patch?.resultSummary,
              verificationStage: patch?.verificationStage ?? opts.verificationStage,
              verificationOutcome: patch?.verificationOutcome ?? (opts.verificationStage ? 'FAILED' : undefined),
              durationMs: Date.now() - startedAt,
              metadata: patch?.metadata,
            },
            false
          ) || initial
        );
      },
      cancel: (reason) => {
        if (finalized) return this.getEventById(taskId, initial.eventId) || initial;
        finalized = true;
        return (
          this.ingestEvent(
            {
              taskId,
              eventId: initial.eventId,
              toolName: opts.toolName,
              title: initial.title,
              description: initial.description,
              status: 'CANCELLED',
              category: opts.category,
              resultSummary: reason || 'Cancelled before completion',
              verificationStage: opts.verificationStage,
              verificationOutcome: opts.verificationStage ? 'SKIPPED' : undefined,
              durationMs: Date.now() - startedAt,
            },
            false
          ) || initial
        );
      },
    };
  }

  public getEventById(taskId: string, eventId: string): AgentActivityEvent | undefined {
    this.ensureHydrated();
    return this.feeds.get(taskId)?.eventsById.get(eventId);
  }

  public getTaskActivities(taskId: string | null | undefined): AgentActivityEvent[] {
    this.ensureHydrated();
    if (!taskId) return [];
    return this.feeds.get(taskId)?.snapshot || [];
  }

  public getLatestServerSeq(taskId: string): number {
    this.ensureHydrated();
    return this.feeds.get(taskId)?.latestServerSeq || 0;
  }

  public cancelTaskActivities(taskId: string | null | undefined, reason = 'Stopped by user'): void {
    this.ensureHydrated();
    if (!taskId) return;
    const rec = this.feeds.get(taskId);
    if (!rec) return;
    let changed = false;
    for (const id of rec.order) {
      const ev = rec.eventsById.get(id);
      if (ev && (ev.status === 'RUNNING' || ev.status === 'QUEUED')) {
        rec.eventsById.set(id, {
          ...ev,
          status: 'CANCELLED',
          resultSummary: redactSensitiveActivityText(reason, 180),
          timestamp: new Date().toISOString(),
        });
        changed = true;
      }
    }
    if (changed) {
      this.rebuildSnapshot(rec);
      this.notify(taskId);
      this.schedulePersist();
    }
  }

  public failActiveActivities(taskId: string | null | undefined, errorMessage: string): void {
    this.ensureHydrated();
    if (!taskId) return;
    const rec = this.feeds.get(taskId);
    if (!rec) return;
    let changed = false;
    for (const id of rec.order) {
      const ev = rec.eventsById.get(id);
      if (ev && (ev.status === 'RUNNING' || ev.status === 'QUEUED')) {
        rec.eventsById.set(id, {
          ...ev,
          status: 'FAILED',
          error: redactSensitiveActivityText(errorMessage, 220),
          timestamp: new Date().toISOString(),
        });
        changed = true;
      }
    }
    if (changed) {
      this.rebuildSnapshot(rec);
      this.notify(taskId);
      this.schedulePersist();
    }
  }

  public completeActiveActivities(taskId: string | null | undefined, summary = 'Completed'): void {
    this.ensureHydrated();
    if (!taskId) return;
    const rec = this.feeds.get(taskId);
    if (!rec) return;
    let changed = false;
    for (const id of rec.order) {
      const ev = rec.eventsById.get(id);
      if (ev && ev.status === 'RUNNING') {
        rec.eventsById.set(id, {
          ...ev,
          status: 'COMPLETED',
          resultSummary: ev.resultSummary || redactSensitiveActivityText(summary, 180),
          timestamp: new Date().toISOString(),
        });
        changed = true;
      }
    }
    if (changed) {
      this.rebuildSnapshot(rec);
      this.notify(taskId);
      this.schedulePersist();
    }
  }

  public clearTask(taskId: string): void {
    this.feeds.delete(taskId);
    this.notify(taskId);
    this.schedulePersist();
  }

  public subscribe(taskId: string, callback: () => void): () => void {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(callback);
    return () => {
      set?.delete(callback);
      if (set && set.size === 0) {
        this.listeners.delete(taskId);
      }
    };
  }
}

export const agentActivityTracker = new AgentActivityTracker();

/**
 * Connects to the real-time SSE endpoint `/api/agent/activity/stream` for a given taskId.
 * Reconnects safely after transient network interruptions using `sinceSeq` without duplicating events,
 * and cleans up cleanly on unmount or when stopped.
 */
export function connectTaskActivityStream(
  taskId: string,
  options?: { maxReconnectAttempts?: number }
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined' || !taskId) {
    return () => {};
  }

  const maxAttempts = options?.maxReconnectAttempts ?? 3;
  let closed = false;
  let attempts = 0;
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const openStream = () => {
    if (closed) return;
    const sinceSeq = agentActivityTracker.getLatestServerSeq(taskId);
    const url = `/api/agent/activity/stream?taskId=${encodeURIComponent(taskId)}&sinceSeq=${sinceSeq}`;

    try {
      eventSource = new EventSource(url);
    } catch {
      return;
    }

    const handleFrame = (rawData: string) => {
      try {
        const parsed = JSON.parse(rawData);
        const ev = parsed?.event || parsed;
        if (ev && ev.taskId === taskId) {
          agentActivityTracker.ingestEvent(ev, true);
        }
      } catch {
        // Ignore non-JSON keepalive frames
      }
    };

    eventSource.addEventListener('agent-activity', (evt: MessageEvent) => {
      attempts = 0;
      handleFrame(evt.data);
    });

    eventSource.onmessage = (evt: MessageEvent) => {
      attempts = 0;
      handleFrame(evt.data);
    };

    eventSource.onerror = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (closed || attempts >= maxAttempts) return;
      attempts += 1;
      const delayMs = Math.min(4000, 600 * Math.pow(2, attempts - 1));
      reconnectTimer = setTimeout(openStream, delayMs);
    };
  };

  openStream();

  return () => {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

/**
 * React hook returning live, deduplicated, per-task AgentActivityEvent[].
 * Automatically subscribes to SSE when `isRunning` is true and cleans up on unmount.
 */
export function useTaskActivities(
  taskId: string | null | undefined,
  isRunning = false
): AgentActivityEvent[] {
  const [events, setEvents] = useState<AgentActivityEvent[]>(() =>
    agentActivityTracker.getTaskActivities(taskId)
  );

  useEffect(() => {
    if (!taskId) {
      setEvents([]);
      return;
    }
    setEvents(agentActivityTracker.getTaskActivities(taskId));
    const unsubscribe = agentActivityTracker.subscribe(taskId, () => {
      setEvents(agentActivityTracker.getTaskActivities(taskId));
    });

    let disconnectSse: (() => void) | null = null;
    if (isRunning) {
      disconnectSse = connectTaskActivityStream(taskId);
    }

    return () => {
      unsubscribe();
      disconnectSse?.();
    };
  }, [taskId, isRunning]);

  return events;
}
