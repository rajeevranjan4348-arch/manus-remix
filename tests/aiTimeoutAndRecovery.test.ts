import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_TIMEOUT_BUDGETS,
  resolveCandidateModels,
  classifyGeminiError,
  computeBackoffDelayMs,
  abortableDelay,
  createScopedAbortController,
  iterateStreamWithTimeouts,
} from '../server/streamReliability';
import { streamGeminiResponse } from '../server/geminiService';
import { createAutonomousStreamResponse } from '../src/lib/blink';

describe('AI Response Timeout & Production-Grade Stream Reliability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Candidate Model Waterfall & Alias Resolution', () => {
    it('normalizes legacy and deprecated aliases into a bounded 3-model active Gemini waterfall', () => {
      const models1 = resolveCandidateModels('gemini-flash-latest');
      expect(models1).toEqual([
        'gemini-2.5-flash',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite-preview',
      ]);
      expect(models1).not.toContain('gemini-flash-latest');
      expect(models1).not.toContain('gemini-flash-lite-latest');
      expect(models1.length).toBeLessThanOrEqual(3);

      const models2 = resolveCandidateModels('google/gemini-3.8-flash');
      expect(models2[0]).toBe('gemini-3-flash-preview');
      expect(models2.length).toBe(3);
    });

    it('enforces bounded timeout budgets within platform execution limits', () => {
      expect(DEFAULT_TIMEOUT_BUDGETS.rtieResearchMaxMs).toBeLessThanOrEqual(5000);
      expect(DEFAULT_TIMEOUT_BUDGETS.firstTokenTimeoutMs).toBeLessThanOrEqual(10000);
      expect(DEFAULT_TIMEOUT_BUDGETS.firstTokenWithSearchTimeoutMs).toBeLessThanOrEqual(12000);
      expect(DEFAULT_TIMEOUT_BUDGETS.totalWaterfallBudgetMs).toBeLessThanOrEqual(25000);
      expect(DEFAULT_TIMEOUT_BUDGETS.sseHeartbeatIntervalMs).toBeLessThanOrEqual(8000);
      expect(DEFAULT_TIMEOUT_BUDGETS.clientInactivityTimeoutMs).toBeGreaterThanOrEqual(40000);
    });
  });

  describe('2. Gemini API Error Classification & Exponential Backoff', () => {
    it('classifies rate-limit (429) and server overload (503) errors as retryable on the same model', () => {
      const rateLimit = classifyGeminiError({ status: 429, message: 'RESOURCE_EXHAUSTED: Quota exceeded' });
      expect(rateLimit.category).toBe('rate_limit');
      expect(rateLimit.retrySameModel).toBe(true);
      expect(rateLimit.abortWaterfall).toBe(false);

      const overload = classifyGeminiError({ status: 503, message: 'Service temporarily unavailable' });
      expect(overload.category).toBe('server_overload');
      expect(overload.retrySameModel).toBe(true);
      expect(overload.abortWaterfall).toBe(false);
    });

    it('classifies 404 model_not_found to skip the model entirely without retrying without tools', () => {
      const notFound = classifyGeminiError({
        status: 404,
        message: 'models/gemini-flash-latest is not found for API version v1beta',
      });
      expect(notFound.category).toBe('model_not_found');
      expect(notFound.retrySameModel).toBe(false);
      expect(notFound.skipModelEntirely).toBe(true);
    });

    it('classifies 401/403 auth errors to abort the Gemini waterfall immediately', () => {
      const authErr = classifyGeminiError({
        status: 401,
        message: 'API_KEY_INVALID: API key not valid',
      });
      expect(authErr.category).toBe('auth_error');
      expect(authErr.abortWaterfall).toBe(true);
    });

    it('classifies user cancellation / AbortSignal accurately', () => {
      const cancelled = classifyGeminiError(new DOMException('Aborted', 'AbortError'), true);
      expect(cancelled.category).toBe('cancelled');
      expect(cancelled.abortWaterfall).toBe(true);
    });

    it('computes bounded exponential backoff with jitter and respects AbortSignal', async () => {
      const d0 = computeBackoffDelayMs(0, 200, 1000);
      const d1 = computeBackoffDelayMs(1, 200, 1000);
      expect(d0).toBeGreaterThanOrEqual(200);
      expect(d0).toBeLessThanOrEqual(350);
      expect(d1).toBeGreaterThanOrEqual(400);
      expect(d1).toBeLessThanOrEqual(1000);

      const controller = new AbortController();
      const start = Date.now();
      setTimeout(() => controller.abort(), 30);
      await abortableDelay(2000, controller.signal);
      expect(Date.now() - start).toBeLessThan(300);
    });
  });

  describe('3. Per-Attempt First-Token & Chunk-Idle Stream Watchdogs', () => {
    it('aborts a hung model connection on first-token timeout', async () => {
      const hungIterableFactory = () =>
        new Promise<AsyncIterable<{ text: string }>>(() => {
          // Never resolves
        });

      const stream = iterateStreamWithTimeouts(hungIterableFactory, {
        firstTokenTimeoutMs: 120,
        chunkIdleTimeoutMs: 250,
        extractText: (c) => c.text,
      });

      await expect(async () => {
        for await (const _chunk of stream) {
          // should not reach
        }
      }).rejects.toThrow(/First-token timeout/i);
    });

    it('streams chunks normally when tokens arrive within first-token and chunk-idle budgets', async () => {
      async function* mockFastGenerator() {
        await new Promise((r) => setTimeout(r, 20));
        yield { text: 'Hello ' };
        await new Promise((r) => setTimeout(r, 20));
        yield { text: 'production ' };
        await new Promise((r) => setTimeout(r, 20));
        yield { text: 'world!' };
      }

      const stream = iterateStreamWithTimeouts(async () => mockFastGenerator(), {
        firstTokenTimeoutMs: 300,
        chunkIdleTimeoutMs: 300,
        extractText: (c) => c.text,
      });

      let output = '';
      for await (const chunk of stream) {
        output += chunk.text;
      }
      expect(output).toBe('Hello production world!');
    });

    it('aborts mid-stream if a subsequent chunk stalls past chunkIdleTimeoutMs', async () => {
      async function* mockStallingGenerator() {
        yield { text: 'Partial token 1. ' };
        yield { text: 'Partial token 2. ' };
        // Hang after emitting 2 tokens
        await new Promise(() => {});
      }

      const stream = iterateStreamWithTimeouts(async () => mockStallingGenerator(), {
        firstTokenTimeoutMs: 300,
        chunkIdleTimeoutMs: 120,
        extractText: (c) => c.text,
      });

      const received: string[] = [];
      await expect(async () => {
        for await (const chunk of stream) {
          received.push(chunk.text);
        }
      }).rejects.toThrow(/Chunk-idle timeout/i);

      expect(received.join('')).toBe('Partial token 1. Partial token 2. ');
    });

    it('cancels immediately when parent AbortSignal is triggered', async () => {
      const controller = new AbortController();
      const scope = createScopedAbortController(5000, controller.signal);
      expect(scope.controller.signal.aborted).toBe(false);
      controller.abort();
      expect(scope.controller.signal.aborted).toBe(true);
      scope.cleanup();
    });
  });

  describe('4. Short & Extremely Long Prompts + Chat & Work Mode Execution', () => {
    it('completes short conversational prompts and extremely long prompts reliably without timing out', async () => {
      // Short prompt in Chat mode
      let shortResult = '';
      for await (const delta of streamGeminiResponse({
        messages: [{ role: 'user', content: 'Hello' }],
        mode: 'chat',
      })) {
        shortResult += delta;
      }
      expect(shortResult.trim().length).toBeGreaterThan(0);

      // Extremely long prompt in Work mode (15,000+ chars)
      const longContext = 'Analyze system module performance metrics. '.repeat(360);
      let longResult = '';
      for await (const delta of streamGeminiResponse({
        messages: [{ role: 'user', content: `Write code for a TypeScript service:\n${longContext}` }],
        mode: 'work',
        thinkHarder: true,
      })) {
        longResult += delta;
      }
      expect(longResult.trim().length).toBeGreaterThan(20);
    });
  });

  describe('5. Client-Side SSE Stream Stability, Heartbeats, Partial Preservation & No Duplicate Error Text', () => {
    it('keeps stream alive across periodic SSE heartbeats and ignores heartbeat metadata frames in text output', async () => {
      const encoder = new TextEncoder();
      const mockSseStream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'stream-open', requestId: 'req_hb_1' })}\n\n`)
          );
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', requestId: 'req_hb_1', timestamp: Date.now() })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: 'First part ' })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', requestId: 'req_hb_1', timestamp: Date.now() })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: 'Second part.' })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(mockSseStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      try {
        const res = createAutonomousStreamResponse({
          requestId: 'req_hb_1',
          messages: [{ role: 'user', content: 'Test heartbeats' }],
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let rawSse = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawSse += decoder.decode(value, { stream: true });
        }

        let assembledText = '';
        for (const line of rawSse.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const json = JSON.parse(payload);
          if (json.type === 'text-delta') {
            assembledText += json.delta;
          }
        }

        expect(assembledText).toBe('First part Second part.');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('preserves partial streamed content when a stream is interrupted mid-generation instead of overwriting with timeout error', async () => {
      const encoder = new TextEncoder();
      const interruptedStream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: 'Important partial answer ' })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: 'that must be preserved.' })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Upstream connection reset' })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(interruptedStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      try {
        const res = createAutonomousStreamResponse({
          requestId: 'req_partial_1',
          messages: [{ role: 'user', content: 'Explain quantum computing' }],
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let rawSse = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawSse += decoder.decode(value, { stream: true });
        }

        let assembledText = '';
        let finishReason = '';
        for (const line of rawSse.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const json = JSON.parse(payload);
          if (json.type === 'text-delta') {
            assembledText += json.delta;
          } else if (json.type === 'finish') {
            finishReason = json.finishReason;
          }
        }

        expect(assembledText).toBe('Important partial answer that must be preserved.');
        expect(assembledText).not.toContain('timed out');
        expect(finishReason).toBe('stop');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('does NOT dispatch manus_stream_delta for a fake assistant chat bubble when zero tokens were generated before failure', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'The AI response timed out. Please try again.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const liveBubbleDeltas: string[] = [];
      const onLiveDelta = (e: Event) => {
        const detail = (e as CustomEvent)?.detail;
        if (detail?.requestId === 'req_zero_err_1' && detail?.delta) {
          liveBubbleDeltas.push(detail.delta);
        }
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('manus_stream_delta', onLiveDelta);
      }

      try {
        const res = createAutonomousStreamResponse({
          requestId: 'req_zero_err_1',
          messages: [{ role: 'user', content: 'Trigger timeout' }],
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let rawSse = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawSse += decoder.decode(value, { stream: true });
        }

        const nonErrorTextDeltas: string[] = [];
        let finishEvent: any = null;
        for (const line of rawSse.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const json = JSON.parse(payload);
          if (json.type === 'text-delta' && !json.errorDelta) {
            nonErrorTextDeltas.push(json.delta);
          } else if (json.type === 'finish') {
            finishEvent = json;
          }
        }

        // Critical: No non-error text-delta or manus_stream_delta should be emitted to create a duplicate assistant bubble above the Execution Interrupted card
        expect(nonErrorTextDeltas).toHaveLength(0);
        expect(liveBubbleDeltas).toHaveLength(0);
        expect(finishEvent?.finishReason).toBe('error');
        expect(finishEvent?.error).toContain('The AI response timed out. Please try again.');
      } finally {
        if (typeof window !== 'undefined') {
          window.removeEventListener('manus_stream_delta', onLiveDelta);
        }
        globalThis.fetch = originalFetch;
      }
    });

    it('automatically performs a safe pre-first-token retry when initial fetch encounters a transient 503 error', async () => {
      const encoder = new TextEncoder();
      const recoveryStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: 'Recovered on retry!' })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      const originalFetch = globalThis.fetch;
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Service temporarily overloaded' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(recoveryStream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        );
      globalThis.fetch = mockFetch;

      try {
        const res = createAutonomousStreamResponse({
          requestId: 'req_retry_503',
          messages: [{ role: 'user', content: 'Test 503 recovery' }],
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let rawSse = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawSse += decoder.decode(value, { stream: true });
        }

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(rawSse).toContain('Recovered on retry!');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
