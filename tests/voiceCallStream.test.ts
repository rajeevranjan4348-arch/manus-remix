import { describe, expect, it, vi } from 'vitest';
import { readVoiceResponse, SseEventParser } from '../src/components/voice/voiceCallStream';

function eventStream(chunks: string[], status = 200, contentType = 'text/event-stream; charset=utf-8') {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('voice call response stream', () => {
  it('parses SSE events when network chunks split through JSON and event boundaries', async () => {
    const onTextDelta = vi.fn();
    const result = await readVoiceResponse(eventStream([
      'data: {"type":"text-del',
      'ta","delta":"Hello ","requestId":"1"}\n\n',
      'data: {"type":"text-delta","delta":"there!"}\n\ndata: [DONE]\n\n',
    ]), { onTextDelta });

    expect(result).toBe('Hello there!');
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello ', 'Hello ');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'there!', 'Hello there!');
  });

  it('forwards live research stages while the existing AI backend is searching', async () => {
    const onResearchStage = vi.fn();
    const stage = { stage: 'searching_sources', label: 'Searching sources' };
    const result = await readVoiceResponse(eventStream([
      `data: ${JSON.stringify({ type: 'research-stage', ...stage })}\n\n`,
      'data: {"type":"text-delta","textDelta":"Found an answer."}\n\n',
      'data: [DONE]\n\n',
    ]), { onResearchStage });

    expect(result).toBe('Found an answer.');
    expect(onResearchStage).toHaveBeenCalledWith(expect.objectContaining(stage));
  });

  it('does not manufacture an answer when the backend emits an error', async () => {
    await expect(readVoiceResponse(eventStream([
      'data: {"type":"error","error":"Provider unavailable"}\n\n',
      'data: [DONE]\n\n',
    ]))).rejects.toThrow('Provider unavailable');
  });

  it('rejects non-stream HTML fallbacks instead of treating them as AI output', async () => {
    await expect(readVoiceResponse(eventStream(['<html>application fallback</html>'], 200, 'text/html')))
      .rejects.toThrow('did not return a streaming response');
  });

  it('dispatches a final event without a trailing blank line', () => {
    const parser = new SseEventParser();
    expect(parser.push('data: {"type":"text-delta","delta":"complete"}')).toEqual([]);
    expect(parser.finish()).toEqual([
      { data: '{"type":"text-delta","delta":"complete"}', type: undefined },
    ]);
  });
});
