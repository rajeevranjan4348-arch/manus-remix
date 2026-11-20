export interface GeminiStreamingClient {
  models: {
    generateContentStream(params: any): Promise<AsyncIterable<any>>;
  };
}

export function isRetryableGeminiError(error: unknown): boolean {
  const value = error as any;
  const status = Number(value?.status ?? value?.statusCode ?? value?.response?.status ?? 0);
  const code = String(value?.code ?? '').toUpperCase();
  const message = String(value?.message ?? error ?? '').toLowerCase();

  if (value?.name === 'AbortError' || value?.name === 'TimeoutError') return false;
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) return false;
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) return true;

  return [
    'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  ].includes(code) || /temporarily unavailable|overloaded|resource_exhausted|rate limit|quota|fetch failed|network error|connection reset|timed? ?out|deadline exceeded/i.test(message);
}

export function getGeminiRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.min(4, Math.floor(attempt) - 1));
  const ceiling = Math.min(2500, 350 * (2 ** exponent));
  const jitter = 0.5 + Math.max(0, Math.min(1, random())) * 0.5;
  return Math.round(ceiling * jitter);
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason || new DOMException('Generation cancelled.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason || new DOMException('Generation cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Retry a transient Gemini failure once, but only while no chunk has been
 * yielded to the caller. After the first chunk, failures are surfaced so the
 * client can retain the partial answer instead of receiving duplicate text.
 */
export async function* streamGeminiWithRetry(
  client: GeminiStreamingClient,
  params: any,
  signal?: AbortSignal,
): AsyncGenerator<any> {
  let retryCount = 0;

  while (true) {
    if (signal?.aborted) {
      throw signal.reason || new DOMException('Generation cancelled.', 'AbortError');
    }

    let emittedChunk = false;
    try {
      const stream = await client.models.generateContentStream({
        ...params,
        config: { ...params.config, ...(signal ? { abortSignal: signal } : {}) },
      });
      for await (const chunk of stream) {
        emittedChunk = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (signal?.aborted || emittedChunk || retryCount >= 1 || !isRetryableGeminiError(error)) {
        throw error;
      }
      retryCount += 1;
      await waitForRetry(getGeminiRetryDelayMs(retryCount), signal);
    }
  }
}
