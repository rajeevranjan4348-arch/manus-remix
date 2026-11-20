/**
 * Production-Grade Backend & Stream Reliability Engine
 *
 * Centralizes timeout budgets, Gemini model waterfall resolution, transient error classification,
 * controlled retry with exponential backoff, per-attempt first-token and chunk-idle watchdogs,
 * and SSE heartbeat management.
 */

export interface TimeoutBudgetConfig {
  /** Maximum time allowed for pre-LLM RTIE live web research (ms) */
  rtieResearchMaxMs: number;
  /** Maximum time allowed for first token on a standard Gemini attempt (ms) */
  firstTokenTimeoutMs: number;
  /** Maximum time allowed for first token when Google Search grounding is enabled (ms) */
  firstTokenWithSearchTimeoutMs: number;
  /** Maximum idle gap between consecutive streaming chunks once generation has started (ms) */
  chunkIdleTimeoutMs: number;
  /** Total wall-clock budget for the entire model waterfall before falling back to resilient synthesis (ms) */
  totalWaterfallBudgetMs: number;
  /** Periodic SSE heartbeat interval sent to keep connections and proxies alive (ms) */
  sseHeartbeatIntervalMs: number;
  /** Client-side inactivity timeout — resets on every SSE byte, heartbeat, activity, or delta (ms) */
  clientInactivityTimeoutMs: number;
  /** Client-side absolute safety ceiling for a single streaming generation (ms) */
  clientMaxCeilingMs: number;
}

export const DEFAULT_TIMEOUT_BUDGETS: TimeoutBudgetConfig = {
  rtieResearchMaxMs: 4200,
  firstTokenTimeoutMs: 7500,
  firstTokenWithSearchTimeoutMs: 10000,
  chunkIdleTimeoutMs: 14000,
  totalWaterfallBudgetMs: 21000,
  sseHeartbeatIntervalMs: 5000,
  clientInactivityTimeoutMs: 45000,
  clientMaxCeilingMs: 180000,
};

/**
 * Valid, active Gemini models in priority order.
 * Avoids deprecated/legacy aliases that return 404 or hang waiting for capacity.
 */
export const ACTIVE_GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite-preview',
] as const;

const MODEL_ALIAS_MAP: Record<string, string> = {
  'gemini-3.8-flash': 'gemini-3-flash-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
  'gemini-flash-latest': 'gemini-2.5-flash',
  'gemini-flash-lite-latest': 'gemini-3.1-flash-lite-preview',
  'manus-1.6-lite': 'gemini-3-flash-preview',
  'manus-1.6-max': 'gemini-3.1-pro-preview',
};

/**
 * Normalizes any requested model identifier into a clean, bounded list of active Gemini models
 * (max 3 models) so the backend never gets trapped in a 12-step sequential waterfall.
 */
export function resolveCandidateModels(requestedModel?: string): string[] {
  const raw = (requestedModel || 'gemini-3-flash-preview').replace(/^google\//i, '').trim();
  const normalized = (!raw || raw.includes('/'))
    ? 'gemini-3-flash-preview'
    : (MODEL_ALIAS_MAP[raw] || raw);

  const candidates = Array.from(
    new Set([
      normalized,
      ...ACTIVE_GEMINI_MODELS,
    ])
  );

  return candidates.slice(0, 3);
}

export interface ClassifiedGeminiError {
  statusCode?: number;
  category:
    | 'cancelled'
    | 'timeout'
    | 'rate_limit'
    | 'server_overload'
    | 'model_not_found'
    | 'tool_unsupported'
    | 'auth_error'
    | 'invalid_request'
    | 'unknown';
  /** True if the same model attempt can be retried after a short exponential backoff */
  retrySameModel: boolean;
  /** True if trying the same model again without Google Search tools is pointless (e.g. 404 model not found or auth error) */
  skipModelEntirely: boolean;
  /** True if the entire waterfall should stop immediately (e.g. user cancelled or invalid API key) */
  abortWaterfall: boolean;
  userFriendlyMessage: string;
}

/**
 * Inspects an error thrown by `@google/genai` or `fetch` and classifies it for safe retry/fallback routing.
 */
export function classifyGeminiError(err: unknown, signalAborted = false): ClassifiedGeminiError {
  if (signalAborted) {
    return {
      category: 'cancelled',
      retrySameModel: false,
      skipModelEntirely: true,
      abortWaterfall: true,
      userFriendlyMessage: 'Generation stopped.',
    };
  }

  const anyErr = err as any;
  const rawStatus =
    typeof anyErr?.status === 'number'
      ? anyErr.status
      : typeof anyErr?.statusCode === 'number'
        ? anyErr.statusCode
        : typeof anyErr?.code === 'number'
          ? anyErr.code
          : undefined;
  const name = String(anyErr?.name || '');
  const msg = String(anyErr?.message || err || '').toLowerCase();

  if (name === 'AbortError' || msg.includes('cancelled by caller') || msg.includes('aborted by user')) {
    return {
      statusCode: rawStatus,
      category: 'cancelled',
      retrySameModel: false,
      skipModelEntirely: true,
      abortWaterfall: true,
      userFriendlyMessage: 'Generation stopped.',
    };
  }

  if (
    name === 'TimeoutError' ||
    msg.includes('first-token timeout') ||
    msg.includes('chunk-idle timeout') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    rawStatus === 408 ||
    rawStatus === 504
  ) {
    return {
      statusCode: rawStatus || 408,
      category: 'timeout',
      retrySameModel: false, // Switch immediately to next faster model instead of waiting again on the slow model
      skipModelEntirely: false,
      abortWaterfall: false,
      userFriendlyMessage: 'The AI model took too long to respond. Please retry your request.',
    };
  }

  if (
    rawStatus === 401 ||
    rawStatus === 403 ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('permission_denied') ||
    msg.includes('unauthenticated')
  ) {
    return {
      statusCode: rawStatus || 401,
      category: 'auth_error',
      retrySameModel: false,
      skipModelEntirely: true,
      abortWaterfall: true,
      userFriendlyMessage: 'AI provider authentication failed. Please verify the server Gemini API configuration.',
    };
  }

  if (
    rawStatus === 404 ||
    msg.includes('not_found') ||
    msg.includes('is not found for api version') ||
    msg.includes('model not found') ||
    msg.includes('does not exist')
  ) {
    return {
      statusCode: 404,
      category: 'model_not_found',
      retrySameModel: false,
      skipModelEntirely: true, // Do NOT retry the same non-existent model without tools
      abortWaterfall: false,
      userFriendlyMessage: 'The requested AI model is currently unavailable.',
    };
  }

  if (
    rawStatus === 429 ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return {
      statusCode: 429,
      category: 'rate_limit',
      retrySameModel: true,
      skipModelEntirely: true, // If rate-limited on this model after retry, move to next model
      abortWaterfall: false,
      userFriendlyMessage: 'AI rate limit reached. Retrying with backup model...',
    };
  }

  if (
    rawStatus === 500 ||
    rawStatus === 502 ||
    rawStatus === 503 ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('internal error') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed') ||
    msg.includes('socket hang up')
  ) {
    return {
      statusCode: rawStatus || 503,
      category: 'server_overload',
      retrySameModel: true,
      skipModelEntirely: true,
      abortWaterfall: false,
      userFriendlyMessage: 'The AI service is temporarily overloaded. Please retry in a moment.',
    };
  }

  if (
    rawStatus === 400 &&
    (msg.includes('tool') || msg.includes('google_search') || msg.includes('googlesearch') || msg.includes('search grounding'))
  ) {
    return {
      statusCode: 400,
      category: 'tool_unsupported',
      retrySameModel: false,
      skipModelEntirely: false, // Try same model without googleSearch tool
      abortWaterfall: false,
      userFriendlyMessage: 'Live search grounding was not supported for this model; falling back to standard generation.',
    };
  }

  if (rawStatus === 400 || msg.includes('invalid_argument')) {
    return {
      statusCode: 400,
      category: 'invalid_request',
      retrySameModel: false,
      skipModelEntirely: true,
      abortWaterfall: false,
      userFriendlyMessage: 'The AI service could not process the request format.',
    };
  }

  return {
    statusCode: rawStatus,
    category: 'unknown',
    retrySameModel: false,
    skipModelEntirely: false,
    abortWaterfall: false,
    userFriendlyMessage: 'The AI service encountered an unexpected error. Please try again.',
  };
}

/**
 * Computes exponential backoff delay with bounded jitter (ms).
 * Kept fast so retries never cause HTTP request timeouts.
 */
export function computeBackoffDelayMs(attemptIndex: number, baseDelayMs = 280, maxDelayMs = 1200): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attemptIndex)));
  const jitter = Math.floor(Math.random() * 90);
  return Math.min(maxDelayMs, exp + jitter);
}

/**
 * Sleeps for `ms` milliseconds, rejecting or resolving early immediately if `signal` aborts.
 */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Creates a child AbortController linked to an optional parent signal and a timeout in ms.
 */
export function createScopedAbortController(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  timeoutReason = 'Operation timed out'
): {
  controller: AbortController;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason || new DOMException('Cancelled by caller', 'AbortError'));
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort(new DOMException(timeoutReason, 'TimeoutError'));
    }
  }, Math.max(50, timeoutMs));

  const cleanup = () => {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return {
    controller,
    cleanup,
    didTimeout: () => timedOut,
  };
}

/**
 * Iterates an async iterable with strict First-Token Timeout and Chunk-Idle Timeout.
 * Prevents hung connections from stalling the server stream indefinitely.
 */
export async function* iterateStreamWithTimeouts<T>(
  iterableFactory: () => Promise<AsyncIterable<T>>,
  options: {
    firstTokenTimeoutMs: number;
    chunkIdleTimeoutMs: number;
    signal?: AbortSignal;
    extractText?: (chunk: T) => string;
  }
): AsyncGenerator<T, void, unknown> {
  const { firstTokenTimeoutMs, chunkIdleTimeoutMs, signal, extractText } = options;

  if (signal?.aborted) {
    throw new DOMException('Cancelled by caller', 'AbortError');
  }

  const raceWithTimeout = async <R>(promise: Promise<R>, timeoutMs: number, label: string): Promise<R> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new DOMException(`${label} (${timeoutMs}ms)`, 'TimeoutError'));
      }, Math.max(50, timeoutMs));

      if (signal) {
        onAbort = () => {
          if (timer) clearTimeout(timer);
          reject(new DOMException('Cancelled by caller', 'AbortError'));
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  };

  const startMs = Date.now();
  const streamIterable = await raceWithTimeout(
    iterableFactory(),
    firstTokenTimeoutMs,
    'First-token timeout connecting to Gemini stream'
  );

  const iterator = streamIterable[Symbol.asyncIterator]();
  let receivedFirstMeaningfulChunk = false;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Cancelled by caller', 'AbortError');
      }

      const elapsedBeforeFirst = Date.now() - startMs;
      const remainingFirstTokenMs = Math.max(500, firstTokenTimeoutMs - elapsedBeforeFirst);
      const waitBudgetMs = receivedFirstMeaningfulChunk ? chunkIdleTimeoutMs : remainingFirstTokenMs;
      const timeoutLabel = receivedFirstMeaningfulChunk
        ? 'Chunk-idle timeout waiting for next Gemini token'
        : 'First-token timeout waiting for initial Gemini token';

      const nextResult = await raceWithTimeout(iterator.next(), waitBudgetMs, timeoutLabel);
      if (nextResult.done) {
        break;
      }

      const value = nextResult.value;
      if (!receivedFirstMeaningfulChunk) {
        const text = extractText ? extractText(value) : String(value ?? '');
        if (text.length > 0) {
          receivedFirstMeaningfulChunk = true;
        }
      }

      yield value;
    }
  } finally {
    if (typeof iterator.return === 'function') {
      try {
        void iterator.return();
      } catch {}
    }
  }
}
