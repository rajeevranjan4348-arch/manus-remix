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

export interface EmitActivityInput {
  taskId: string;
  eventId?: string;
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

export interface ActivityHandle {
  eventId: string;
  startedAt: number;
  update: (patch: Partial<Omit<EmitActivityInput, 'taskId' | 'eventId' | 'toolName'>>) => AgentActivityEvent;
  complete: (resultSummary?: string, patch?: Partial<Omit<EmitActivityInput, 'taskId' | 'eventId' | 'toolName' | 'status'>>) => AgentActivityEvent;
  fail: (error: unknown, patch?: Partial<Omit<EmitActivityInput, 'taskId' | 'eventId' | 'toolName' | 'status'>>) => AgentActivityEvent;
  cancel: (reason?: string) => AgentActivityEvent;
}

const MAX_TASKS = 80;
const MAX_EVENTS_PER_TASK = 150;

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Strip private chain-of-thought tags completely
  { pattern: /<think>[\s\S]*?<\/think>/gi, replacement: '' },
  { pattern: /<think>[\s\S]*$/gi, replacement: '' },
  // Bearer / OAuth tokens & JWTs
  { pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\bya29\.[A-Za-z0-9\-._]+/g, replacement: '[REDACTED_OAUTH_TOKEN]' },
  { pattern: /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g, replacement: '[REDACTED_JWT]' },
  // API keys (Gemini / Google / OpenAI / OpenRouter / GitHub / Stripe / AWS)
  { pattern: /\bAIza[0-9A-Za-z\-_]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\bsk-(?:or-v1-|proj-)?[A-Za-z0-9\-_]{16,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  // Credentials inside URLs (protocol://user:pass@host)
  { pattern: /(https?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, replacement: '$1[REDACTED]:[REDACTED]@' },
  // Key-value secrets in text/env assignments
  {
    pattern: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret[_-]?key|gemini_api_key|openrouter_api_key|database_url)\b(\s*[:=]\s*)(["']?)([^"'\s,;}\]]+)\3/gi,
    replacement: '$1$2[REDACTED]',
  },
];

export function redactSensitiveActivityText(value: unknown, maxLength = 260): string {
  if (typeof value !== 'string') return '';
  let text = value;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
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
  const safe: Record<string, string | number | boolean> = {};
  const blockedKey = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|private[_-]?key|credential)/i;
  for (const [key, val] of Object.entries(metadata)) {
    if (!key || blockedKey.test(key)) continue;
    if (typeof val === 'string') {
      const cleaned = redactSensitiveActivityText(val, 140);
      if (cleaned) safe[key] = cleaned;
    } else if (typeof val === 'number' && Number.isFinite(val)) {
      safe[key] = val;
    } else if (typeof val === 'boolean') {
      safe[key] = val;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function sanitizeActivityEvent(event: AgentActivityEvent): AgentActivityEvent {
  return {
    taskId: String(event.taskId || 'default').slice(0, 120),
    eventId: String(event.eventId || `evt_${Date.now()}`).slice(0, 120),
    seq: Number.isFinite(event.seq) ? event.seq : 0,
    title: redactSensitiveActivityText(event.title, 140) || 'Processing agent step',
    description: redactSensitiveActivityText(event.description, 260),
    toolName: redactSensitiveActivityText(event.toolName, 64) || 'agent',
    status: event.status,
    timestamp: event.timestamp || new Date().toISOString(),
    ...(event.category ? { category: event.category } : {}),
    ...(event.resultSummary ? { resultSummary: redactSensitiveActivityText(event.resultSummary, 280) } : {}),
    ...(event.error ? { error: redactSensitiveActivityText(event.error, 240) } : {}),
    ...(event.verificationStage ? { verificationStage: redactSensitiveActivityText(event.verificationStage, 64) } : {}),
    ...(event.verificationOutcome ? { verificationOutcome: event.verificationOutcome } : {}),
    ...(typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
      ? { durationMs: Math.max(0, Math.round(event.durationMs)) }
      : {}),
    ...(event.metadata ? { metadata: sanitizeMetadata(event.metadata) } : {}),
  };
}

interface TaskActivityState {
  taskId: string;
  seq: number;
  updatedAt: number;
  eventsById: Map<string, AgentActivityEvent>;
  eventOrder: string[];
  historyLog: AgentActivityEvent[];
  listeners: Set<(event: AgentActivityEvent) => void>;
}

export class AgentActivityHub {
  private tasks = new Map<string, TaskActivityState>();

  private getOrCreateTask(taskId: string): TaskActivityState {
    const cleanTaskId = String(taskId || 'default').trim().slice(0, 120) || 'default';
    let state = this.tasks.get(cleanTaskId);
    if (!state) {
      if (this.tasks.size >= MAX_TASKS) {
        let oldestId: string | null = null;
        let oldestTime = Infinity;
        for (const [id, entry] of this.tasks.entries()) {
          if (entry.listeners.size === 0 && entry.updatedAt < oldestTime) {
            oldestTime = entry.updatedAt;
            oldestId = id;
          }
        }
        if (oldestId) {
          this.tasks.delete(oldestId);
        }
      }
      state = {
        taskId: cleanTaskId,
        seq: 0,
        updatedAt: Date.now(),
        eventsById: new Map(),
        eventOrder: [],
        historyLog: [],
        listeners: new Set(),
      };
      this.tasks.set(cleanTaskId, state);
    }
    state.updatedAt = Date.now();
    return state;
  }

  public emit(input: EmitActivityInput): AgentActivityEvent {
    const state = this.getOrCreateTask(input.taskId);
    const eventId = (input.eventId && input.eventId.trim())
      ? input.eventId.trim().slice(0, 120)
      : `evt_${state.taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const existing = state.eventsById.get(eventId);
    const nextSeq = ++state.seq;
    const rawEvent: AgentActivityEvent = {
      taskId: state.taskId,
      eventId,
      seq: nextSeq,
      title: input.title || existing?.title || 'Executing task step',
      description: input.description ?? existing?.description ?? '',
      toolName: input.toolName || existing?.toolName || 'agent',
      status: input.status,
      timestamp: input.timestamp || new Date().toISOString(),
      category: input.category ?? existing?.category,
      resultSummary: input.resultSummary ?? existing?.resultSummary,
      error: input.error ?? (input.status === 'FAILED' ? existing?.error : undefined),
      verificationStage: input.verificationStage ?? existing?.verificationStage,
      verificationOutcome: input.verificationOutcome ?? existing?.verificationOutcome,
      durationMs: input.durationMs ?? existing?.durationMs,
      metadata: sanitizeMetadata({ ...(existing?.metadata || {}), ...(input.metadata || {}) }),
    };

    const sanitized = sanitizeActivityEvent(rawEvent);

    if (!existing) {
      state.eventOrder.push(eventId);
      if (state.eventOrder.length > MAX_EVENTS_PER_TASK) {
        const droppedId = state.eventOrder.shift();
        if (droppedId) state.eventsById.delete(droppedId);
      }
    }
    state.eventsById.set(eventId, sanitized);
    state.historyLog.push(sanitized);
    if (state.historyLog.length > MAX_EVENTS_PER_TASK * 3) {
      state.historyLog.splice(0, state.historyLog.length - MAX_EVENTS_PER_TASK * 2);
    }

    for (const listener of state.listeners) {
      try {
        listener(sanitized);
      } catch {
        // Isolate subscriber errors so one broken SSE client never disrupts others
      }
    }

    return sanitized;
  }

  public startActivity(
    taskId: string,
    opts: Omit<EmitActivityInput, 'taskId' | 'status'> & { initialStatus?: 'QUEUED' | 'RUNNING' },
    onEmit?: (event: AgentActivityEvent) => void
  ): ActivityHandle {
    const startedAt = Date.now();
    const initial = this.emit({
      ...opts,
      taskId,
      status: opts.initialStatus || 'RUNNING',
    });
    onEmit?.(initial);

    let finalized = false;

    const emitNext = (next: EmitActivityInput): AgentActivityEvent => {
      const ev = this.emit(next);
      onEmit?.(ev);
      return ev;
    };

    return {
      eventId: initial.eventId,
      startedAt,
      update: (patch) => {
        return emitNext({
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
        });
      },
      complete: (resultSummary, patch) => {
        if (finalized) return this.getEventById(taskId, initial.eventId) || initial;
        finalized = true;
        return emitNext({
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
        });
      },
      fail: (error, patch) => {
        if (finalized) return this.getEventById(taskId, initial.eventId) || initial;
        finalized = true;
        const errMsg = error instanceof Error ? error.message : String(error || 'Operation failed');
        return emitNext({
          taskId,
          eventId: initial.eventId,
          toolName: opts.toolName,
          title: patch?.title || initial.title,
          description: patch?.description ?? initial.description,
          status: 'FAILED',
          category: patch?.category ?? opts.category,
          error: errMsg,
          resultSummary: patch?.resultSummary,
          verificationStage: patch?.verificationStage ?? opts.verificationStage,
          verificationOutcome: patch?.verificationOutcome ?? (opts.verificationStage ? 'FAILED' : undefined),
          durationMs: Date.now() - startedAt,
          metadata: patch?.metadata,
        });
      },
      cancel: (reason) => {
        if (finalized) return this.getEventById(taskId, initial.eventId) || initial;
        finalized = true;
        return emitNext({
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
        });
      },
    };
  }

  public getEventById(taskId: string, eventId: string): AgentActivityEvent | undefined {
    const state = this.tasks.get(taskId);
    return state?.eventsById.get(eventId);
  }

  /**
   * Returns deduplicated ordered current activities for a task.
   * When `sinceSeq` is provided, returns only events updated after `sinceSeq`
   * so reconnecting SSE clients resume safely without duplicates.
   */
  public getEvents(taskId: string, sinceSeq?: number): AgentActivityEvent[] {
    const state = this.tasks.get(taskId);
    if (!state) return [];
    const ordered = state.eventOrder
      .map((id) => state.eventsById.get(id))
      .filter((ev): ev is AgentActivityEvent => Boolean(ev));

    if (typeof sinceSeq === 'number' && Number.isFinite(sinceSeq) && sinceSeq > 0) {
      return ordered.filter((ev) => ev.seq > sinceSeq);
    }
    return ordered;
  }

  public getLatestSeq(taskId: string): number {
    return this.tasks.get(taskId)?.seq || 0;
  }

  public cancelActiveActivities(taskId: string, reason = 'Cancelled by user'): AgentActivityEvent[] {
    const state = this.tasks.get(taskId);
    if (!state) return [];
    const cancelled: AgentActivityEvent[] = [];
    for (const id of state.eventOrder) {
      const existing = state.eventsById.get(id);
      if (existing && (existing.status === 'QUEUED' || existing.status === 'RUNNING')) {
        const updated = this.emit({
          taskId,
          eventId: existing.eventId,
          title: existing.title,
          description: existing.description,
          toolName: existing.toolName,
          status: 'CANCELLED',
          category: existing.category,
          resultSummary: reason,
          verificationStage: existing.verificationStage,
          verificationOutcome: existing.verificationStage ? 'SKIPPED' : undefined,
        });
        cancelled.push(updated);
      }
    }
    return cancelled;
  }

  public subscribe(taskId: string, listener: (event: AgentActivityEvent) => void): () => void {
    const state = this.getOrCreateTask(taskId);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  public clearTask(taskId: string): void {
    this.tasks.delete(taskId);
  }
}

export const agentActivityHub = new AgentActivityHub();
