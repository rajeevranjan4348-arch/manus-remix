import { describe, expect, it, vi } from 'vitest';
import {
  getGeminiRetryDelayMs,
  isRetryableGeminiError,
  streamGeminiWithRetry,
} from '../server/geminiStreamReliability';

describe('Gemini streaming reliability', () => {
  it('retries transient provider failures before the first chunk', async () => {
    const generateContentStream = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporarily unavailable'), { status: 503 }))
      .mockResolvedValueOnce((async function* () { yield { text: 'hello' }; })());

    const chunks: any[] = [];
    for await (const chunk of streamGeminiWithRetry(
      { models: { generateContentStream } },
      { model: 'gemini-test', contents: [] },
    )) chunks.push(chunk);

    expect(generateContentStream).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([{ text: 'hello' }]);
  });

  it('does not retry after a chunk has already been yielded', async () => {
    const generateContentStream = vi.fn().mockResolvedValue(
      (async function* () {
        yield { text: 'partial' };
        throw Object.assign(new Error('upstream reset'), { code: 'ECONNRESET' });
      })(),
    );

    const chunks: any[] = [];
    await expect(async () => {
      for await (const chunk of streamGeminiWithRetry(
        { models: { generateContentStream } },
        { model: 'gemini-test', contents: [] },
      )) chunks.push(chunk);
    }).rejects.toThrow('upstream reset');

    expect(chunks).toEqual([{ text: 'partial' }]);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-transient client errors or cancellation', () => {
    expect(isRetryableGeminiError({ status: 400 })).toBe(false);
    expect(isRetryableGeminiError({ status: 401 })).toBe(false);
    expect(isRetryableGeminiError({ status: 429 })).toBe(true);
    expect(isRetryableGeminiError({ status: 503 })).toBe(true);
    expect(isRetryableGeminiError({ name: 'AbortError' })).toBe(false);
  });

  it('uses bounded exponential backoff with jitter', () => {
    expect(getGeminiRetryDelayMs(1, () => 0)).toBe(175);
    expect(getGeminiRetryDelayMs(2, () => 1)).toBe(700);
    expect(getGeminiRetryDelayMs(99, () => 1)).toBeLessThanOrEqual(2500);
  });
});
