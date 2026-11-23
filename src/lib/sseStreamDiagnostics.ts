export type SseConnectionState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'stalled'
  | 'completed'
  | 'error'
  | 'restarting';

export interface SseDiagnosticLogEntry {
  /** Monotonic sequence index within the diagnostic session */
  seq: number;
  /** Event identifier from SSE `id:` field, payload `eventId`, or generated fallback */
  eventId: string;
  /** Request ID correlated with the SSE stream */
  requestId: string;
  /** Task ID correlated with the SSE stream */
  taskId?: string;
  /** Categorized SSE frame type (e.g. stream-open, text-delta, agent-activity, research-stage, heartbeat, finish, done, error) */
  eventType: string;
  /** Raw or structured payload chunk preview */
  payloadChunk: string;
  /** Byte length of the incoming chunk */
  byteLength: number;
  /** Timestamp in milliseconds when the chunk arrived */
  timestampMs: number;
  /** ISO timestamp string */
  timestampIso: string;
  /** Milliseconds elapsed since the previous SSE frame in the active request */
  deltaSinceLastFrameMs: number;
}

export interface SseDiagnosticSnapshot {
  connectionState: SseConnectionState;
  activeRequestId: string | null;
  activeTaskId: string | null;
  endpoint: string | null;
  streamStartedAtMs: number | null;
  lastEventAtMs: number | null;
  silenceDurationMs: number;
  isHungOverThreshold: boolean;
  hangThresholdMs: number;
  totalEventsLogged: number;
  totalBytesReceived: number;
  restartCount: number;
  lastError: string | null;
  logs: SseDiagnosticLogEntry[];
}

export const SSE_HANG_THRESHOLD_MS = 5000;
const MAX_DIAGNOSTIC_LOG_ENTRIES = 120;

export class SseStreamDiagnosticsTracker {
  private connectionState: SseConnectionState = 'idle';
  private activeRequestId: string | null = null;
  private activeTaskId: string | null = null;
  private endpoint: string | null = null;
  private streamStartedAtMs: number | null = null;
  private lastEventAtMs: number | null = null;
  private totalEventsLogged = 0;
  private totalBytesReceived = 0;
  private restartCount = 0;
  private lastError: string | null = null;
  private seqCounter = 0;
  private logs: SseDiagnosticLogEntry[] = [];
  private listeners = new Set<(snapshot: SseDiagnosticSnapshot) => void>();
  private readonly hangThresholdMs: number;

  constructor(hangThresholdMs = SSE_HANG_THRESHOLD_MS) {
    this.hangThresholdMs = hangThresholdMs;
  }

  public recordConnecting(params: {
    requestId: string;
    taskId?: string;
    endpoint?: string;
    nowMs?: number;
  }): SseDiagnosticSnapshot {
    const now = params.nowMs ?? Date.now();
    this.connectionState = 'connecting';
    this.activeRequestId = params.requestId;
    this.activeTaskId = params.taskId || params.requestId;
    this.endpoint = params.endpoint || '/api/gemini/stream';
    this.streamStartedAtMs = now;
    this.lastEventAtMs = now;
    this.lastError = null;

    this.appendEntry({
      eventId: `conn_init_${params.requestId}`,
      requestId: params.requestId,
      taskId: this.activeTaskId,
      eventType: 'connecting',
      payloadChunk: JSON.stringify({
        type: 'connecting',
        endpoint: this.endpoint,
        requestId: params.requestId,
      }),
      nowMs: now,
    });

    return this.notifyAndReturn(now);
  }

  public recordEventChunk(params: {
    requestId?: string;
    taskId?: string;
    eventId?: string;
    eventType: string;
    payloadChunk: string;
    nowMs?: number;
  }): SseDiagnosticSnapshot {
    const now = params.nowMs ?? Date.now();
    const requestId = params.requestId || this.activeRequestId || 'req_unknown';
    const taskId = params.taskId || this.activeTaskId || requestId;

    if (!this.streamStartedAtMs) {
      this.streamStartedAtMs = now;
    }
    this.activeRequestId = requestId;
    this.activeTaskId = taskId;

    const normalizedType = String(params.eventType || 'message').toLowerCase();
    if (normalizedType === 'error') {
      this.connectionState = 'error';
      this.lastError = params.payloadChunk;
    } else if (normalizedType === 'done' || normalizedType === 'finish') {
      this.connectionState = 'completed';
    } else {
      this.connectionState = 'streaming';
    }

    this.appendEntry({
      eventId: params.eventId,
      requestId,
      taskId,
      eventType: normalizedType,
      payloadChunk: params.payloadChunk,
      nowMs: now,
    });

    return this.notifyAndReturn(now);
  }

  public recordStreamCompleted(params?: {
    requestId?: string;
    finishReason?: string;
    nowMs?: number;
  }): SseDiagnosticSnapshot {
    const now = params?.nowMs ?? Date.now();
    const requestId = params?.requestId || this.activeRequestId || 'req_unknown';
    const finishReason = params?.finishReason || 'stop';

    if (finishReason === 'error') {
      this.connectionState = 'error';
    } else {
      this.connectionState = 'completed';
    }

    this.appendEntry({
      eventId: `eof_${requestId}_${this.seqCounter + 1}`,
      requestId,
      taskId: this.activeTaskId || requestId,
      eventType: 'stream-closed',
      payloadChunk: JSON.stringify({ type: 'stream-closed', finishReason }),
      nowMs: now,
    });

    return this.notifyAndReturn(now);
  }

  public recordStreamError(params: {
    requestId?: string;
    error: string;
    nowMs?: number;
  }): SseDiagnosticSnapshot {
    const now = params.nowMs ?? Date.now();
    const requestId = params.requestId || this.activeRequestId || 'req_unknown';
    this.connectionState = 'error';
    this.lastError = params.error;

    this.appendEntry({
      eventId: `err_${requestId}_${this.seqCounter + 1}`,
      requestId,
      taskId: this.activeTaskId || requestId,
      eventType: 'error',
      payloadChunk: JSON.stringify({ type: 'error', error: params.error }),
      nowMs: now,
    });

    return this.notifyAndReturn(now);
  }

  public recordRestartRequested(nowMs?: number): SseDiagnosticSnapshot {
    const now = nowMs ?? Date.now();
    const requestId = this.activeRequestId || `restart_${now}`;
    this.restartCount += 1;
    this.connectionState = 'restarting';
    this.streamStartedAtMs = now;
    this.lastEventAtMs = now;
    this.lastError = null;

    this.appendEntry({
      eventId: `restart_${this.restartCount}_${now}`,
      requestId,
      taskId: this.activeTaskId || requestId,
      eventType: 'stream-restart',
      payloadChunk: JSON.stringify({
        type: 'stream-restart',
        restartCount: this.restartCount,
        reason: 'Manual stream restart triggered after hang threshold (>5000ms)',
      }),
      nowMs: now,
    });

    return this.notifyAndReturn(now);
  }

  /**
   * Evaluates whether the active SSE connection has hung for more than `hangThresholdMs` (default 5000ms)
   * without receiving any chunk or completion event.
   */
  public evaluateWatchdog(
    nowMs = Date.now(),
    externalIsStreaming?: boolean
  ): SseDiagnosticSnapshot {
    const isActivelyWaiting =
      this.connectionState === 'connecting' ||
      this.connectionState === 'streaming' ||
      this.connectionState === 'restarting' ||
      this.connectionState === 'stalled' ||
      Boolean(externalIsStreaming && this.connectionState !== 'completed' && this.connectionState !== 'error');

    if (isActivelyWaiting) {
      if (!this.lastEventAtMs) {
        this.lastEventAtMs = nowMs;
      }
      if (!this.streamStartedAtMs) {
        this.streamStartedAtMs = nowMs;
      }
      const silenceMs = Math.max(0, nowMs - this.lastEventAtMs);
      if (silenceMs >= this.hangThresholdMs && this.connectionState !== 'stalled') {
        this.connectionState = 'stalled';
        return this.notifyAndReturn(nowMs);
      }
    }

    return this.getSnapshot(nowMs, externalIsStreaming);
  }

  public clearLogs(nowMs = Date.now()): SseDiagnosticSnapshot {
    this.logs = [];
    this.totalEventsLogged = 0;
    this.totalBytesReceived = 0;
    return this.notifyAndReturn(nowMs);
  }

  public reset(nowMs = Date.now()): SseDiagnosticSnapshot {
    this.connectionState = 'idle';
    this.activeRequestId = null;
    this.activeTaskId = null;
    this.endpoint = null;
    this.streamStartedAtMs = null;
    this.lastEventAtMs = null;
    this.totalEventsLogged = 0;
    this.totalBytesReceived = 0;
    this.restartCount = 0;
    this.lastError = null;
    this.seqCounter = 0;
    this.logs = [];
    return this.notifyAndReturn(nowMs);
  }

  public getSnapshot(nowMs = Date.now(), externalIsStreaming?: boolean): SseDiagnosticSnapshot {
    const isActiveState =
      this.connectionState === 'connecting' ||
      this.connectionState === 'streaming' ||
      this.connectionState === 'restarting' ||
      this.connectionState === 'stalled' ||
      Boolean(externalIsStreaming && this.connectionState !== 'completed' && this.connectionState !== 'error');

    const referenceTimeMs = this.lastEventAtMs ?? this.streamStartedAtMs;
    const silenceDurationMs =
      isActiveState && referenceTimeMs !== null ? Math.max(0, nowMs - referenceTimeMs) : 0;

    const isHungOverThreshold = isActiveState && silenceDurationMs >= this.hangThresholdMs;
    const effectiveState: SseConnectionState = isHungOverThreshold
      ? 'stalled'
      : isActiveState && this.connectionState === 'idle'
        ? 'connecting'
        : this.connectionState;

    return {
      connectionState: effectiveState,
      activeRequestId: this.activeRequestId,
      activeTaskId: this.activeTaskId,
      endpoint: this.endpoint,
      streamStartedAtMs: this.streamStartedAtMs,
      lastEventAtMs: this.lastEventAtMs,
      silenceDurationMs,
      isHungOverThreshold,
      hangThresholdMs: this.hangThresholdMs,
      totalEventsLogged: this.totalEventsLogged,
      totalBytesReceived: this.totalBytesReceived,
      restartCount: this.restartCount,
      lastError: this.lastError,
      logs: [...this.logs],
    };
  }

  public subscribe(listener: (snapshot: SseDiagnosticSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private appendEntry(params: {
    eventId?: string;
    requestId: string;
    taskId?: string;
    eventType: string;
    payloadChunk: string;
    nowMs: number;
  }): void {
    this.seqCounter += 1;
    const prevTimestamp = this.lastEventAtMs ?? params.nowMs;
    const deltaSinceLastFrameMs = Math.max(0, params.nowMs - prevTimestamp);
    this.lastEventAtMs = params.nowMs;

    const rawChunk = String(params.payloadChunk ?? '');
    const byteLength = new TextEncoder().encode(rawChunk).length;
    this.totalEventsLogged += 1;
    this.totalBytesReceived += byteLength;

    const resolvedEventId =
      (params.eventId && String(params.eventId).trim()) ||
      extractEventIdFromPayload(rawChunk) ||
      `sse_${params.requestId}_${this.seqCounter}`;

    const entry: SseDiagnosticLogEntry = {
      seq: this.seqCounter,
      eventId: resolvedEventId,
      requestId: params.requestId,
      taskId: params.taskId,
      eventType: params.eventType,
      payloadChunk: rawChunk.length > 600 ? `${rawChunk.slice(0, 600)}…` : rawChunk,
      byteLength,
      timestampMs: params.nowMs,
      timestampIso: new Date(params.nowMs).toISOString(),
      deltaSinceLastFrameMs,
    };

    this.logs.push(entry);
    if (this.logs.length > MAX_DIAGNOSTIC_LOG_ENTRIES) {
      this.logs.splice(0, this.logs.length - MAX_DIAGNOSTIC_LOG_ENTRIES);
    }
  }

  private notifyAndReturn(nowMs: number): SseDiagnosticSnapshot {
    const snap = this.getSnapshot(nowMs);
    this.listeners.forEach((listener) => {
      try {
        listener(snap);
      } catch {}
    });
    return snap;
  }
}

export function extractEventIdFromPayload(rawChunk: string): string | null {
  if (!rawChunk) return null;
  try {
    const parsed = JSON.parse(rawChunk);
    if (typeof parsed?.eventId === 'string' && parsed.eventId.trim()) {
      return parsed.eventId.trim();
    }
    if (typeof parsed?.event?.eventId === 'string' && parsed.event.eventId.trim()) {
      return parsed.event.eventId.trim();
    }
    if (typeof parsed?.id === 'string' && parsed.id.trim()) {
      return parsed.id.trim();
    }
    if (typeof parsed?.seq === 'number') {
      return `seq_${parsed.seq}`;
    }
    if (typeof parsed?.event?.seq === 'number') {
      return `act_seq_${parsed.event.seq}`;
    }
  } catch {}
  return null;
}

export const sseStreamDiagnostics = new SseStreamDiagnosticsTracker(SSE_HANG_THRESHOLD_MS);
