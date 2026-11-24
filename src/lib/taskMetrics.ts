export interface TokenUsagePayload {
  promptTokens: number;
  completionTokens: number;
  thoughtTokens?: number;
  totalTokens: number;
  model?: string;
  source?: 'exact' | 'estimated' | 'unavailable';
}

export interface TurnMetricRecord {
  id: string;
  taskId: string;
  requestId?: string;
  messageId?: string;
  turnIndex: number;
  promptTokens: number;
  completionTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  durationMs: number;
  ttftMs?: number;
  tokensPerSec: number;
  model?: string;
  source: 'exact' | 'estimated' | 'unavailable';
  timestamp: string;
  isLive?: boolean;
  promptPreview?: string;
}

export interface TurnChartPoint {
  turn: string;
  turnNumber: number;
  promptTokens: number;
  completionTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  durationMs: number;
  durationSec: number;
  ttftMs?: number;
  tokensPerSec: number;
  source: 'exact' | 'estimated' | 'unavailable';
  isLive: boolean;
  promptPreview?: string;
  model?: string;
}

export interface TokenBreakdownSlice {
  name: string;
  key: 'prompt' | 'completion' | 'thought';
  value: number;
  percentage: number;
}

export interface TaskMetricsSummary {
  taskId: string;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalThoughtTokens: number;
  totalDurationMs: number;
  avgTurnDurationMs: number;
  avgTokensPerSec: number;
  completedTurnCount: number;
  hasLiveTurn: boolean;
  hasExactUsage: boolean;
  turnSeries: TurnChartPoint[];
  tokenBreakdown: TokenBreakdownSlice[];
  lastUpdatedAt: number;
}

interface ActiveTurnState {
  taskId: string;
  requestId: string;
  startedAt: number;
  firstTokenAt?: number;
  promptText: string;
  model?: string;
}

interface PersistedTaskMetricsMap {
  version: 1;
  order: string[];
  tasks: Record<string, TurnMetricRecord[]>;
}

const STORAGE_KEY = 'manus_task_metrics_v1';
const MAX_PERSISTED_TASKS = 40;
const MAX_TURNS_PER_TASK = 100;

/**
 * Deterministic token estimator (~4 chars per token for English/code),
 * stripping inline base64 data URLs so uploaded images do not skew estimates.
 */
export function estimateTokenCount(text: unknown): number {
  if (typeof text !== 'string' || !text.trim()) return 0;
  const cleaned = text
    .replace(/\[IMAGE_DATA_URL:[^\]]+\]/gi, ' [image] ')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, ' [image] ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 0;
  return Math.max(1, Math.ceil(cleaned.length / 4));
}

export function formatTokenCount(tokens: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(tokens) ? tokens : 0));
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  }
  if (safe >= 10_000) {
    return `${(safe / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (safe >= 1_000) {
    return `${(safe / 1_000).toFixed(2).replace(/\.?0+$/, '')}k`;
  }
  return safe.toLocaleString();
}

export function formatDurationLabel(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (safe < 1000) {
    return `${Math.round(safe)}ms`;
  }
  const totalSec = safe / 1000;
  if (totalSec < 60) {
    return `${totalSec >= 10 ? totalSec.toFixed(1) : totalSec.toFixed(2).replace(/\.?0+$/, '')}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const remSec = Math.round(totalSec % 60);
  if (mins < 60) {
    return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return remMin > 0 ? `${hrs}h ${remMin}m` : `${hrs}h`;
}

export function normalizeUsagePayload(
  raw: any,
  _fallbackPromptText?: string,
  _fallbackResponseText?: string
): TokenUsagePayload {
  const rawPrompt = Number(raw?.promptTokens ?? raw?.promptTokenCount ?? raw?.inputTokens ?? raw?.prompt_tokens);
  const rawCompletion = Number(raw?.completionTokens ?? raw?.candidatesTokenCount ?? raw?.outputTokens ?? raw?.completion_tokens);
  const rawThought = Number(raw?.thoughtTokens ?? raw?.thoughtsTokenCount ?? raw?.reasoning_tokens ?? 0);
  const rawTotal = Number(raw?.totalTokens ?? raw?.totalTokenCount ?? raw?.total_tokens);

  const hasPrompt = Number.isFinite(rawPrompt) && rawPrompt > 0;
  const hasCompletion = Number.isFinite(rawCompletion) && rawCompletion > 0;
  const hasTotal = Number.isFinite(rawTotal) && rawTotal > 0;
  const hasEnoughUsage = (hasPrompt && hasCompletion) || (hasPrompt && hasTotal) || (hasCompletion && hasTotal);
  if (!hasEnoughUsage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      thoughtTokens: 0,
      totalTokens: 0,
      model: typeof raw?.model === 'string' ? raw.model : undefined,
      source: 'unavailable',
    };
  }

  const thoughtTokens = Number.isFinite(rawThought) && rawThought > 0 ? Math.round(rawThought) : 0;
  const promptTokens = hasPrompt
    ? Math.round(rawPrompt)
    : hasTotal && hasCompletion
      ? Math.max(0, Math.round(rawTotal - rawCompletion - thoughtTokens))
      : 0;
  // Reasoning is a subset of output, so the dashboard invariant is input + output = total.
  const completionTokens = hasTotal && hasPrompt
    ? Math.max(0, Math.round(rawTotal - promptTokens))
    : hasCompletion
      ? Math.round(rawCompletion) + thoughtTokens
      : 0;
  const totalTokens = promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    thoughtTokens: Math.min(thoughtTokens, completionTokens),
    totalTokens,
    model: typeof raw?.model === 'string' ? raw.model : undefined,
    source: raw?.source === 'estimated' ? 'estimated' : 'exact',
  };
}

function normalizeTaskKey(taskId?: string | null): string {
  const trimmed = typeof taskId === 'string' ? taskId.trim() : '';
  return trimmed || 'default_task';
}

function computeTokensPerSec(completionTokens: number, durationMs: number): number {
  if (completionTokens <= 0 || durationMs <= 0) return 0;
  const seconds = Math.max(0.05, durationMs / 1000);
  return Number((completionTokens / seconds).toFixed(1));
}

function safeReadPersistedMap(): PersistedTaskMetricsMap {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { version: 1, order: [], tasks: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, order: [], tasks: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.tasks || typeof parsed.tasks !== 'object') {
      return { version: 1, order: [], tasks: {} };
    }
    return {
      version: 1,
      order: Array.isArray(parsed.order) ? parsed.order.filter((k: unknown) => typeof k === 'string') : Object.keys(parsed.tasks),
      tasks: parsed.tasks,
    };
  } catch {
    return { version: 1, order: [], tasks: {} };
  }
}

function safeWritePersistedMap(map: PersistedTaskMetricsMap): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

class TaskMetricsStore {
  private tasks = new Map<string, TurnMetricRecord[]>();
  private taskOrder: string[] = [];
  private activeTurns = new Map<string, ActiveTurnState>();
  private listeners = new Set<() => void>();
  private hydrated = false;

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const persisted = safeReadPersistedMap();
    this.taskOrder = persisted.order.slice(-MAX_PERSISTED_TASKS);
    for (const key of this.taskOrder) {
      const records = persisted.tasks[key];
      if (Array.isArray(records)) {
        this.tasks.set(key, records.slice(-MAX_TURNS_PER_TASK));
      }
    }
  }

  private persist(): void {
    const tasksObj: Record<string, TurnMetricRecord[]> = {};
    for (const key of this.taskOrder) {
      const records = this.tasks.get(key);
      if (records && records.length > 0) {
        tasksObj[key] = records.slice(-MAX_TURNS_PER_TASK);
      }
    }
    safeWritePersistedMap({
      version: 1,
      order: this.taskOrder.slice(-MAX_PERSISTED_TASKS),
      tasks: tasksObj,
    });
  }

  private touchOrder(taskKey: string): void {
    this.taskOrder = this.taskOrder.filter((k) => k !== taskKey);
    this.taskOrder.push(taskKey);
    while (this.taskOrder.length > MAX_PERSISTED_TASKS) {
      const evicted = this.taskOrder.shift();
      if (evicted) {
        this.tasks.delete(evicted);
      }
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {}
    });
  }

  subscribe(listener: () => void): () => void {
    this.ensureHydrated();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recordTurnStart(params: {
    taskId?: string | null;
    requestId: string;
    promptText?: string;
    startedAt?: number;
    model?: string;
  }): void {
    this.ensureHydrated();
    const taskKey = normalizeTaskKey(params.taskId);
    this.activeTurns.set(taskKey, {
      taskId: taskKey,
      requestId: params.requestId,
      startedAt: params.startedAt ?? Date.now(),
      promptText: String(params.promptText || '').trim(),
      model: params.model,
    });
    this.notify();
  }

  recordFirstToken(params: {
    taskId?: string | null;
    requestId?: string;
    at?: number;
  }): void {
    this.ensureHydrated();
    const taskKey = normalizeTaskKey(params.taskId);
    const active = this.activeTurns.get(taskKey);
    if (!active) return;
    if (params.requestId && active.requestId !== params.requestId) return;
    if (active.firstTokenAt == null) {
      active.firstTokenAt = params.at ?? Date.now();
      this.notify();
    }
  }

  recordTurnComplete(params: {
    taskId?: string | null;
    requestId?: string;
    messageId?: string;
    promptText?: string;
    responseText?: string;
    usage?: Partial<TokenUsagePayload> | null;
    durationMs?: number;
    ttftMs?: number;
    model?: string;
    completedAt?: number;
  }): TurnMetricRecord {
    this.ensureHydrated();
    const taskKey = normalizeTaskKey(params.taskId);
    const active = this.activeTurns.get(taskKey);
    const completedAt = params.completedAt ?? Date.now();

    const promptText = params.promptText ?? active?.promptText ?? '';
    const usage = normalizeUsagePayload(params.usage);

    const computedDurationMs =
      typeof params.durationMs === 'number' && Number.isFinite(params.durationMs) && params.durationMs > 0
        ? Math.round(params.durationMs)
        : active
          ? Math.max(1, Math.round(completedAt - active.startedAt))
          : 0;

    const ttftMs =
      typeof params.ttftMs === 'number' && Number.isFinite(params.ttftMs) && params.ttftMs > 0
        ? Math.round(params.ttftMs)
        : active?.firstTokenAt
          ? Math.max(1, Math.round(active.firstTokenAt - active.startedAt))
          : undefined;

    const existing = this.tasks.get(taskKey) || [];
    const existingIdx = params.requestId
      ? existing.findIndex((r) => r.requestId && r.requestId === params.requestId)
      : params.messageId
        ? existing.findIndex((r) => r.messageId && r.messageId === params.messageId)
        : -1;

    const record: TurnMetricRecord = {
      id: existingIdx >= 0 ? existing[existingIdx].id : `turn_${completedAt}_${Math.random().toString(36).slice(2, 7)}`,
      taskId: taskKey,
      requestId: params.requestId ?? (existingIdx >= 0 ? existing[existingIdx].requestId : active?.requestId),
      messageId: params.messageId ?? (existingIdx >= 0 ? existing[existingIdx].messageId : undefined),
      turnIndex: existingIdx >= 0 ? existing[existingIdx].turnIndex : existing.length,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      thoughtTokens: usage.thoughtTokens ?? 0,
      totalTokens: usage.totalTokens,
      durationMs: computedDurationMs,
      ttftMs,
      tokensPerSec: computeTokensPerSec(usage.completionTokens, computedDurationMs),
      model: params.model || usage.model || active?.model,
      source: usage.source ?? 'unavailable',
      timestamp: new Date(completedAt).toISOString(),
      promptPreview: promptText.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
    };

    const next = [...existing];
    if (existingIdx >= 0) {
      next[existingIdx] = record;
    } else {
      next.push(record);
    }

    this.tasks.set(taskKey, next.slice(-MAX_TURNS_PER_TASK));
    this.touchOrder(taskKey);

    if (active && (!params.requestId || active.requestId === params.requestId)) {
      this.activeTurns.delete(taskKey);
    }

    this.persist();
    this.notify();
    return record;
  }

  bindMessageId(taskId?: string | null, requestId?: string | null, messageId?: string | null): void {
    this.ensureHydrated();
    if (!messageId) return;
    const taskKey = normalizeTaskKey(taskId);
    const records = this.tasks.get(taskKey);
    if (!records || records.length === 0) return;

    let targetIdx = -1;
    if (requestId) {
      targetIdx = records.findIndex((r) => r.requestId === requestId);
    }
    if (targetIdx === -1) {
      // Fallback: attach to the most recent unbound record
      for (let i = records.length - 1; i >= 0; i--) {
        if (!records[i].messageId) {
          targetIdx = i;
          break;
        }
      }
    }
    if (targetIdx === -1) return;
    if (records[targetIdx].messageId === messageId) return;

    const updated = [...records];
    updated[targetIdx] = { ...updated[targetIdx], messageId };
    this.tasks.set(taskKey, updated);
    this.persist();
    this.notify();
  }

  clearActiveTurn(taskId?: string | null): void {
    this.ensureHydrated();
    const taskKey = normalizeTaskKey(taskId);
    if (this.activeTurns.delete(taskKey)) {
      this.notify();
    }
  }

  getTaskTurns(taskId?: string | null): TurnMetricRecord[] {
    this.ensureHydrated();
    const taskKey = normalizeTaskKey(taskId);
    return this.tasks.get(taskKey) || [];
  }

  getActiveTurn(taskId?: string | null): ActiveTurnState | null {
    this.ensureHydrated();
    const taskKey = normalizeTaskKey(taskId);
    return this.activeTurns.get(taskKey) || null;
  }

  resetForTesting(): void {
    this.tasks.clear();
    this.taskOrder = [];
    this.activeTurns.clear();
    this.hydrated = true;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    this.notify();
  }
}

export const taskMetricsStore = new TaskMetricsStore();

export interface BuildTaskMetricsParams {
  taskId?: string | null;
  messages: Array<{
    id?: string;
    role: string;
    content: any;
    timestamp?: string;
    status?: string;
    isStreaming?: boolean;
    metadata?: any;
  }>;
  storedTurns?: TurnMetricRecord[];
  activeTurn?: ActiveTurnState | null;
  isRunning?: boolean;
  liveStreamText?: string;
  nowMs?: number;
}

function parseTimestampMs(ts?: string): number | null {
  if (!ts) return null;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function buildTaskMetricsSummary(params: BuildTaskMetricsParams): TaskMetricsSummary {
  const taskKey = normalizeTaskKey(params.taskId);
  const nowMs = params.nowMs ?? Date.now();
  const storedTurns = params.storedTurns ?? taskMetricsStore.getTaskTurns(taskKey);
  const activeTurn = params.activeTurn !== undefined ? params.activeTurn : taskMetricsStore.getActiveTurn(taskKey);
  const messages = Array.isArray(params.messages) ? params.messages : [];

  const storedByMessageId = new Map<string, TurnMetricRecord>();
  for (const rec of storedTurns) {
    if (rec.messageId) {
      storedByMessageId.set(rec.messageId, rec);
    }
  }

  // Pair user messages with subsequent assistant responses into turns
  const pairedTurns: Array<{
    userMsg?: (typeof messages)[number];
    assistantMsg?: (typeof messages)[number];
    isStreamingAssistant: boolean;
  }> = [];

  let pendingUser: (typeof messages)[number] | undefined;

  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === 'user') {
      if (pendingUser) {
        // Previous user message had no assistant reply yet
        pairedTurns.push({ userMsg: pendingUser, isStreamingAssistant: false });
      }
      pendingUser = msg;
    } else if (msg.role === 'assistant') {
      const isStreamingAssistant = Boolean(msg.status === 'streaming' || msg.isStreaming);
      pairedTurns.push({
        userMsg: pendingUser,
        assistantMsg: msg,
        isStreamingAssistant,
      });
      pendingUser = undefined;
    }
  }

  if (pendingUser) {
    pairedTurns.push({
      userMsg: pendingUser,
      isStreamingAssistant: Boolean(params.isRunning),
    });
  }

  const turnSeries: TurnChartPoint[] = [];
  let hasExactUsage = false;
  let hasLiveTurn = false;
  let usedStoredIndices = new Set<number>();

  pairedTurns.forEach((pair, idx) => {
    const turnNumber = idx + 1;
    const userText = pair.userMsg ? extractTextContent(pair.userMsg.content) : '';
    const assistantText = pair.assistantMsg ? extractTextContent(pair.assistantMsg.content) : '';
    const isLastTurn = idx === pairedTurns.length - 1;
    const isLive = Boolean(
      isLastTurn && (params.isRunning || pair.isStreamingAssistant)
    );

    if (isLive) {
      hasLiveTurn = true;
      const startedAt =
        activeTurn?.startedAt ??
        parseTimestampMs(pair.userMsg?.timestamp) ??
        nowMs;
      const durationMs = Math.max(100, Math.round(nowMs - startedAt));
      const promptTokens = 0;
      const completionTokens = 0;
      const totalTokens = 0;
      turnSeries.push({
        turn: `Turn ${turnNumber}`,
        turnNumber,
        promptTokens,
        completionTokens,
        thoughtTokens: 0,
        totalTokens,
        durationMs,
        durationSec: Number((durationMs / 1000).toFixed(2)),
        ttftMs: activeTurn?.firstTokenAt ? Math.max(1, Math.round(activeTurn.firstTokenAt - startedAt)) : undefined,
        tokensPerSec: computeTokensPerSec(completionTokens, durationMs),
        source: 'unavailable',
        isLive: true,
        promptPreview: userText.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
        model: activeTurn?.model,
      });
      return;
    }

    // Skip orphan user messages without an assistant reply unless running
    if (!pair.assistantMsg && !storedTurns[idx]) {
      return;
    }

    // Resolve stored metric: prefer exact messageId match, then inline metadata.metrics, then positional match
    let matchedRecord: TurnMetricRecord | undefined;
    if (pair.assistantMsg?.id && storedByMessageId.has(pair.assistantMsg.id)) {
      matchedRecord = storedByMessageId.get(pair.assistantMsg.id);
      const storedPos = storedTurns.indexOf(matchedRecord!);
      if (storedPos >= 0) usedStoredIndices.add(storedPos);
    } else if (pair.assistantMsg?.metadata?.metrics) {
      const m = pair.assistantMsg.metadata.metrics;
      const usage = normalizeUsagePayload(m);
      const dur = Number(m.durationMs) > 0 ? Math.round(Number(m.durationMs)) : 0;
      matchedRecord = {
        id: `meta_${pair.assistantMsg.id || idx}`,
        taskId: taskKey,
        messageId: pair.assistantMsg.id,
        turnIndex: idx,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        thoughtTokens: usage.thoughtTokens ?? 0,
        totalTokens: usage.totalTokens,
        durationMs: dur,
        ttftMs: Number(m.ttftMs) > 0 ? Math.round(Number(m.ttftMs)) : undefined,
        tokensPerSec: computeTokensPerSec(usage.completionTokens, dur),
        model: m.model || usage.model,
        source: usage.source ?? 'unavailable',
        timestamp: pair.assistantMsg.timestamp || new Date(nowMs).toISOString(),
      };
    } else if (storedTurns[idx] && !usedStoredIndices.has(idx)) {
      matchedRecord = storedTurns[idx];
      usedStoredIndices.add(idx);
    }

    if (matchedRecord) {
      const matchedUsage = normalizeUsagePayload(matchedRecord);
      if (matchedUsage.source === 'exact') hasExactUsage = true;
      const durationMs = Math.max(0, Number(matchedRecord.durationMs) || 0);
      turnSeries.push({
        turn: `Turn ${turnNumber}`,
        turnNumber,
        promptTokens: matchedUsage.promptTokens,
        completionTokens: matchedUsage.completionTokens,
        thoughtTokens: matchedUsage.thoughtTokens ?? 0,
        totalTokens: matchedUsage.totalTokens,
        durationMs,
        durationSec: Number((durationMs / 1000).toFixed(2)),
        ttftMs: matchedRecord.ttftMs,
        tokensPerSec: computeTokensPerSec(matchedUsage.completionTokens, durationMs),
        source: matchedUsage.source ?? 'unavailable',
        isLive: false,
        promptPreview: matchedRecord.promptPreview || userText.replace(/\\s+/g, ' ').trim().slice(0, 80) || undefined,
        model: matchedRecord.model,
      });
      return;
    }

    // Historical turns without provider telemetry remain unavailable rather than estimated.
    return;
  });

  const totalPromptTokens = turnSeries.reduce((acc, t) => acc + t.promptTokens, 0);
  const totalCompletionTokens = turnSeries.reduce((acc, t) => acc + t.completionTokens, 0);
  const totalThoughtTokens = turnSeries.reduce((acc, t) => acc + t.thoughtTokens, 0);
  const totalTokens = turnSeries.reduce((acc, t) => acc + t.totalTokens, 0);
  const totalDurationMs = turnSeries.reduce((acc, t) => acc + t.durationMs, 0);
  const completedTurns = turnSeries.filter((t) => !t.isLive);
  const completedTurnCount = completedTurns.length;
  const avgTurnDurationMs =
    turnSeries.length > 0 ? Math.round(totalDurationMs / turnSeries.length) : 0;
  const avgTokensPerSec = computeTokensPerSec(totalCompletionTokens, totalDurationMs);

  const safeBreakdownTotal = Math.max(1, totalPromptTokens + totalCompletionTokens);
  const tokenBreakdown: TokenBreakdownSlice[] = [
    {
      name: 'Input',
      key: 'prompt',
      value: totalPromptTokens,
      percentage: Math.round((totalPromptTokens / safeBreakdownTotal) * 100),
    },
    {
      name: 'Output',
      key: 'completion',
      value: totalCompletionTokens,
      percentage: Math.round((totalCompletionTokens / safeBreakdownTotal) * 100),
    },
  ];
  return {
    taskId: taskKey,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    totalThoughtTokens,
    totalDurationMs,
    avgTurnDurationMs,
    avgTokensPerSec,
    completedTurnCount,
    hasLiveTurn,
    hasExactUsage,
    turnSeries,
    tokenBreakdown,
    lastUpdatedAt: nowMs,
  };
}
