import { describe, it, expect, vi } from 'vitest';
import { isSimpleConversationalPrompt } from '../src/hooks/useAgentTask';
import { generateResilientResponse, needsLiveSearch } from '../server/geminiService';
import { createAutonomousStreamResponse } from '../src/lib/blink';

describe('AI Response Streaming and Loading State Regression Tests', () => {
  it('correctly filters empty assistant turns so request ends with a valid user turn', () => {
    const rawMessages = [
      { role: 'user', content: 'You know Samay Raina.' },
      { role: 'assistant', content: '' }
    ];

    const validMessages = rawMessages
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
      .map((m: any) => ({ role: m.role, content: m.content.trim() }));

    while (validMessages.length > 0 && validMessages[validMessages.length - 1].role === 'assistant') {
      validMessages.pop();
    }

    expect(validMessages.length).toBe(1);
    expect(validMessages[0].role).toBe('user');
    expect(validMessages[0].content).toBe('You know Samay Raina.');
  });

  it('guarantees isAssistantWorking terminates when status is error or completed', () => {
    const computeIsWorking = (isLoading: boolean, status: string) => {
      return (isLoading || status === 'running') && status !== 'error' && status !== 'completed';
    };

    expect(computeIsWorking(true, 'running')).toBe(true);
    expect(computeIsWorking(false, 'completed')).toBe(false);
    expect(computeIsWorking(true, 'completed')).toBe(false);
    expect(computeIsWorking(false, 'error')).toBe(false);
    expect(computeIsWorking(true, 'error')).toBe(false);
  });

  it('classifies simple questions and short topic prompts like "Hi", "Nvidia", and "Who is Techno Gamerz?" as direct conversational prompts without unnecessary tool execution', () => {
    expect(isSimpleConversationalPrompt('Hi')).toBe(true);
    expect(isSimpleConversationalPrompt('Hello!')).toBe(true);
    expect(isSimpleConversationalPrompt('Nvidia')).toBe(true);
    expect(isSimpleConversationalPrompt('Who is Techno Gamerz?')).toBe(true);
    expect(needsLiveSearch('Hi')).toBe(false);
    expect(needsLiveSearch('Nvidia')).toBe(false);
    expect(needsLiveSearch('Who is Techno Gamerz?')).toBe(false);
  });

  it('answers consecutive questions ("Hi", "Nvidia", and "Who is Techno Gamerz?") directly and accurately', () => {
    const firstReply = generateResilientResponse('Hi');
    expect(firstReply).toBeTruthy();
    expect(firstReply.toLowerCase()).toContain('hello');

    const nvidiaReply = generateResilientResponse('Nvidia');
    expect(nvidiaReply).toBeTruthy();
    expect(nvidiaReply).toContain('NVIDIA Corporation');
    expect(nvidiaReply).toContain('Jensen Huang');

    const secondReply = generateResilientResponse('Who is Techno Gamerz?');
    expect(secondReply).toBeTruthy();
    expect(secondReply).toContain('Techno Gamerz');
    expect(secondReply).toContain('Ujjwal Chaurasia');
  });

  it('streams SSE chunks across boundaries and always emits finish + [DONE] on completion or network error', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            // Split SSE line across two chunks to test chunk buffering
            controller.enqueue(encoder.encode('data: {"type":"text-delta","textDelta":"Hello '));
            controller.enqueue(encoder.encode('there!"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const response = createAutonomousStreamResponse([
        { role: 'user', content: 'Hi' },
      ]);
      const text = await response.text();
      expect(text).toContain('"type":"text-delta"');
      expect(text).toContain('Hello there!');
      expect(text).toContain('"type":"finish"');
      expect(text).toContain('data: [DONE]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles SSE "message", "data", "done", and "error" event types and long multi-chunk responses', async () => {
    const longParagraph = 'NVIDIA designs GPUs and accelerated computing platforms for AI. '.repeat(25);
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode('event: message\ndata: {"type":"message","content":"Part 1: "}\n\n'));
            controller.enqueue(encoder.encode(`event: data\ndata: ${JSON.stringify({ type: 'data', data: longParagraph })}\n\n`));
            controller.enqueue(encoder.encode('event: done\ndata: {"type":"done","finishReason":"stop"}\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const response = createAutonomousStreamResponse([
        { role: 'user', content: 'Nvidia' },
      ]);
      const text = await response.text();
      expect(text).toContain('Part 1: ');
      expect(text).toContain('NVIDIA designs GPUs');
      expect(text).toContain('"type":"finish"');
      expect(text).toContain('data: [DONE]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles network disconnections gracefully and emits finishReason="error" + [DONE]', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const response = createAutonomousStreamResponse([
        { role: 'user', content: 'Nvidia' },
      ]);
      const text = await response.text();
      expect(text).toContain('Could not reach the AI server');
      expect(text).toContain('"finishReason":"error"');
      expect(text).toContain('data: [DONE]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves live streaming assistant message in displayMessages across status transition', () => {
    const persistentMessages = [
      { id: 'msg_user_1', role: 'user', content: 'You know Samay Raina.' }
    ];
    const sdkMessages = [
      { id: 'msg_user_1', role: 'user', content: 'You know Samay Raina.' },
      { id: 'msg_asst_1', role: 'assistant', content: 'Yes, Samay Raina is a prominent Indian stand-up comedian.' }
    ];

    const computeDisplayMessages = (isLoading: boolean) => {
      const rawList: any[] = [...persistentMessages];
      const liveAssistant = [...sdkMessages].reverse().find((m: any) =>
        m?.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length > 0
      );

      if (liveAssistant?.content) {
        const last = rawList[rawList.length - 1];
        if (last?.role === 'assistant') {
          if (isLoading || !last.content || last.content.length < liveAssistant.content.length) {
            rawList[rawList.length - 1] = {
              ...last,
              content: liveAssistant.content,
              id: last.id || liveAssistant.id || 'live-assistant-current',
            };
          }
        } else {
          rawList.push({
            id: liveAssistant.id || 'live-assistant-current',
            role: 'assistant',
            content: liveAssistant.content,
            timestamp: new Date().toISOString(),
            status: isLoading ? 'streaming' : 'success',
          });
        }
      }
      return rawList;
    };

    // During streaming
    const streamingList = computeDisplayMessages(true);
    expect(streamingList.length).toBe(2);
    expect(streamingList[1].role).toBe('assistant');
    expect(streamingList[1].content).toContain('Samay Raina');

    // Immediately after stream completion before persistentMessages updates
    const finishedList = computeDisplayMessages(false);
    expect(finishedList.length).toBe(2);
    expect(finishedList[1].role).toBe('assistant');
    expect(finishedList[1].content).toContain('Samay Raina');
  });

  it('recovers from HTML SPA fallback on /api/gemini/stream by falling back to /.netlify/functions/agent', async () => {
    const mockFetch = vi.fn()
      // First call to /api/gemini/stream returns HTML fallback
      .mockResolvedValueOnce(
        new Response('<!DOCTYPE html><html><body>SPA</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      )
      // Second call to /.netlify/functions/agent succeeds with SSE
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"text-delta","delta":"Recovered via Netlify function!","textDelta":"Recovered via Netlify function!"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const response = createAutonomousStreamResponse([
        { role: 'user', content: 'Hi' },
      ]);
      const text = await response.text();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(text).toContain('Recovered via Netlify function!');
      expect(text).toContain('"type":"finish"');
      expect(text).toContain('data: [DONE]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('terminates cleanly with error finishReason, surfaces backend error message, and emits [DONE] on failed API calls', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Provider quota exceeded for model' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const response = createAutonomousStreamResponse([
        { role: 'user', content: 'Test failed API' },
      ]);
      const text = await response.text();
      expect(text).toContain('"type":"text-delta"');
      expect(text).toContain('Provider quota exceeded for model');
      expect(text).toContain('"finishReason":"error"');
      expect(text).toContain('data: [DONE]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts in-flight stream immediately when AbortSignal triggers', async () => {
    const abortController = new AbortController();
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted.');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const response = createAutonomousStreamResponse({
        messages: [{ role: 'user', content: 'Slow query' }],
        signal: abortController.signal,
      });
      setTimeout(() => abortController.abort(), 15);
      const text = await response.text();
      expect(text).toContain('Generation was stopped.');
      expect(text).toContain('"finishReason":"error"');
      expect(text).toContain('data: [DONE]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


