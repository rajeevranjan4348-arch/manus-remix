export const DEKU_PRODUCT_NAME = 'Deku AI' as const;
export const MODEL_UNAVAILABLE_TEXT = '' as const;

export type CanonicalProviderId =
  | 'google'
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'other'
  | 'unavailable';

export type ModelExecutionStatus =
  | 'verified'
  | 'fallback'
  | 'unavailable'
  | 'degraded';

export type RuntimeSource =
  | 'google-genai-sdk'
  | 'anthropic-api'
  | 'openai-api'
  | 'openrouter-api'
  | 'local-fallback'
  | 'unknown';

export interface VerifiedExecutionMetadata {
  product: 'Deku AI';
  provider: CanonicalProviderId;
  provider_name: string;
  model: string | null;
  model_display_name: string | null;
  requested_model: string | null;
  runtime_source: RuntimeSource;
  execution_status: ModelExecutionStatus;
  verified: boolean;
  is_fallback: boolean;
  fallback_from: string | null;
  fallback_reason: string | null;
  timestamp: string;
}

const VALID_PROVIDERS = new Set<CanonicalProviderId>([
  'google',
  'anthropic',
  'openai',
  'openrouter',
  'other',
  'unavailable',
]);

const VALID_STATUSES = new Set<ModelExecutionStatus>([
  'verified',
  'fallback',
  'unavailable',
  'degraded',
]);

const VALID_SOURCES = new Set<RuntimeSource>([
  'google-genai-sdk',
  'anthropic-api',
  'openai-api',
  'openrouter-api',
  'local-fallback',
  'unknown',
]);

const SECRET_PATTERN =
  /(sk-[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|sk-ant-[a-zA-Z0-9_-]{12,}|sk-or-v1-[a-zA-Z0-9]{12,}|Bearer\s+[a-zA-Z0-9._-]{12,}|api[_-]?key\s*[:=]\s*\S+)/gi;

function sanitizeText(value: unknown, maxLen = 140): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(SECRET_PATTERN, '[redacted]').trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

export function createUnavailableMetadata(options?: {
  requestedModel?: string | null;
  reason?: string | null;
  executionStatus?: 'unavailable' | 'degraded';
  runtimeSource?: RuntimeSource;
}): VerifiedExecutionMetadata {
  return {
    product: DEKU_PRODUCT_NAME,
    provider: 'unavailable',
    provider_name: 'Unavailable',
    model: null,
    model_display_name: null,
    requested_model: sanitizeText(options?.requestedModel, 100),
    runtime_source: options?.runtimeSource ?? 'unknown',
    execution_status: options?.executionStatus ?? 'unavailable',
    verified: false,
    is_fallback: false,
    fallback_from: null,
    fallback_reason: sanitizeText(options?.reason, 140),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validates and normalizes execution metadata received exclusively from the backend.
 * Never fabricates `verified: true` if model or provider is missing.
 */
export function parseBackendExecutionMetadata(
  raw: unknown,
): VerifiedExecutionMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;

  const rawProvider =
    typeof candidate.provider === 'string'
      ? (candidate.provider.trim().toLowerCase() as CanonicalProviderId)
      : 'unavailable';
  const provider: CanonicalProviderId = VALID_PROVIDERS.has(rawProvider)
    ? rawProvider
    : 'other';

  const model = sanitizeText(candidate.model, 120);
  const modelDisplayName = sanitizeText(candidate.model_display_name, 120);
  const providerName = sanitizeText(candidate.provider_name, 80) || 'Unavailable';
  const requestedModel = sanitizeText(candidate.requested_model, 120);
  const rawSource =
    typeof candidate.runtime_source === 'string'
      ? (candidate.runtime_source.trim() as RuntimeSource)
      : 'unknown';
  const runtimeSource: RuntimeSource = VALID_SOURCES.has(rawSource)
    ? rawSource
    : 'unknown';

  const rawStatus =
    typeof candidate.execution_status === 'string'
      ? (candidate.execution_status.trim().toLowerCase() as ModelExecutionStatus)
      : 'unavailable';
  const executionStatus: ModelExecutionStatus = VALID_STATUSES.has(rawStatus)
    ? rawStatus
    : 'unavailable';

  const verified =
    candidate.verified === true &&
    Boolean(model) &&
    provider !== 'unavailable' &&
    runtimeSource !== 'local-fallback' &&
    runtimeSource !== 'unknown' &&
    (executionStatus === 'verified' || executionStatus === 'fallback');

  if (!verified) {
    return createUnavailableMetadata({
      requestedModel,
      reason: sanitizeText(candidate.fallback_reason, 140),
      executionStatus: executionStatus === 'degraded' ? 'degraded' : 'unavailable',
      runtimeSource,
    });
  }

  const isFallback =
    candidate.is_fallback === true || executionStatus === 'fallback';

  return {
    product: DEKU_PRODUCT_NAME,
    provider,
    provider_name: providerName,
    model,
    model_display_name: modelDisplayName || model,
    requested_model: requestedModel,
    runtime_source: runtimeSource,
    execution_status: isFallback ? 'fallback' : 'verified',
    verified: true,
    is_fallback: isFallback,
    fallback_from: isFallback ? sanitizeText(candidate.fallback_from, 120) : null,
    fallback_reason: isFallback ? sanitizeText(candidate.fallback_reason, 140) : null,
    timestamp:
      typeof candidate.timestamp === 'string' && candidate.timestamp.trim()
        ? candidate.timestamp.trim()
        : new Date().toISOString(),
  };
}

export function formatExecutionIdentityLabel(
  meta?: VerifiedExecutionMetadata | null,
): string {
  if (!meta || !meta.verified || !meta.model) {
    return MODEL_UNAVAILABLE_TEXT;
  }

  const displayName = meta.model_display_name || meta.model;
  const base =
    meta.provider_name && meta.provider_name !== 'Unavailable'
      ? `${meta.provider_name} · ${displayName}`
      : displayName;

  return meta.is_fallback ? `${base} (Fallback)` : base;
}

export function formatExecutionTooltip(
  meta?: VerifiedExecutionMetadata | null,
): string {
  if (!meta || !meta.verified || !meta.model) {
    return DEKU_PRODUCT_NAME;
  }

  const lines = [
    `${DEKU_PRODUCT_NAME}`,
    `Provider: ${meta.provider_name}`,
    `Executed Model: ${meta.model}`,
  ];

  if (meta.requested_model && meta.requested_model !== meta.model) {
    lines.push(`Requested Model: ${meta.requested_model}`);
  }
  if (meta.is_fallback) {
    lines.push(
      meta.fallback_from
        ? `Fallback from: ${meta.fallback_from}`
        : 'Executed via fallback route',
    );
  }
  return lines.join('\n');
}

type StoreListener = () => void;

class ModelExecutionStore {
  private byRequestId = new Map<string, VerifiedExecutionMetadata>();
  private byMessageId = new Map<string, VerifiedExecutionMetadata>();
  private latestByTaskId = new Map<string, VerifiedExecutionMetadata>();
  private listeners = new Set<StoreListener>();

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Ignore subscriber errors
      }
    });
  }

  recordBackendMetadata(params: {
    requestId?: string | null;
    taskId?: string | null;
    messageId?: string | null;
    metadata: VerifiedExecutionMetadata;
  }) {
    const { requestId, taskId, messageId, metadata } = params;
    if (requestId) {
      this.byRequestId.set(requestId, metadata);
    }
    if (taskId) {
      this.latestByTaskId.set(taskId, metadata);
    }
    if (messageId) {
      this.byMessageId.set(messageId, metadata);
    }
    this.emit();
  }

  bindRequestToMessage(
    requestId: string | null | undefined,
    messageId: string,
    taskId?: string | null,
  ): VerifiedExecutionMetadata {
    const resolved =
      (requestId ? this.byRequestId.get(requestId) : undefined) ||
      (taskId ? this.latestByTaskId.get(taskId) : undefined) ||
      createUnavailableMetadata({ reason: 'Backend model metadata unavailable' });

    this.byMessageId.set(messageId, resolved);
    if (taskId) {
      this.latestByTaskId.set(taskId, resolved);
    }
    this.emit();
    return resolved;
  }

  getForRequest(requestId?: string | null): VerifiedExecutionMetadata | null {
    if (!requestId) return null;
    return this.byRequestId.get(requestId) ?? null;
  }

  getForMessage(messageId?: string | null): VerifiedExecutionMetadata | null {
    if (!messageId) return null;
    return this.byMessageId.get(messageId) ?? null;
  }

  getLatestForTask(taskId?: string | null): VerifiedExecutionMetadata | null {
    if (!taskId) return null;
    return this.latestByTaskId.get(taskId) ?? null;
  }

  reset() {
    this.byRequestId.clear();
    this.byMessageId.clear();
    this.latestByTaskId.clear();
    this.emit();
  }
}

export const modelExecutionStore = new ModelExecutionStore();
