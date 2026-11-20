export interface VoiceStreamEvent {
  type?: string;
  data: string;
}

export interface VoiceStreamCallbacks {
  onTextDelta?: (delta: string, fullText: string) => void;
  onResearchStage?: (event: Record<string, unknown>) => void;
}

/** Incrementally parses Server-Sent Events, including events split across network chunks. */
export class SseEventParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventType = '';

  push(chunk: string): VoiceStreamEvent[] {
    this.buffer += chunk;
    const events: VoiceStreamEvent[] = [];
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex >= 0) {
      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.readLine(line, events);
      newlineIndex = this.buffer.indexOf('\n');
    }

    return events;
  }

  finish(): VoiceStreamEvent[] {
    const events: VoiceStreamEvent[] = [];
    if (this.buffer) {
      let line = this.buffer;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.readLine(line, events);
      this.buffer = '';
    }
    this.dispatch(events);
    return events;
  }

  private readLine(line: string, events: VoiceStreamEvent[]) {
    if (!line) {
      this.dispatch(events);
      return;
    }
    if (line.startsWith(':')) return;

    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const rawValue = separator < 0 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventType = value;
  }

  private dispatch(events: VoiceStreamEvent[]) {
    if (!this.dataLines.length) {
      this.eventType = '';
      return;
    }
    events.push({ type: this.eventType || undefined, data: this.dataLines.join('\n') });
    this.dataLines = [];
    this.eventType = '';
  }
}

/** Reads the app's existing authenticated AI SSE response and forwards real text deltas. */
export async function readVoiceResponse(
  response: Response,
  callbacks: VoiceStreamCallbacks = {},
): Promise<string> {
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 240).trim();
    } catch {
      // The HTTP status still provides a useful user-facing error.
    }
    throw new Error(detail || `AI service returned ${response.status}.`);
  }

  if (!response.body) throw new Error('The AI service returned an empty response stream.');
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !contentType.toLowerCase().includes('text/event-stream')) {
    throw new Error('The AI service did not return a streaming response.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseEventParser();
  let fullText = '';
  let streamError = '';

  const consume = (events: VoiceStreamEvent[]) => {
    for (const event of events) {
      if (event.data === '[DONE]') continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (payload.type === 'error') {
        streamError = typeof payload.error === 'string' ? payload.error : 'The AI response could not be completed.';
        continue;
      }
      if (payload.type === 'research-stage') {
        callbacks.onResearchStage?.(payload);
        continue;
      }
      if (payload.type !== 'text-delta') continue;

      const deltaValue = payload.delta ?? payload.textDelta ?? payload.content;
      if (typeof deltaValue !== 'string' || !deltaValue) continue;
      fullText += deltaValue;
      callbacks.onTextDelta?.(deltaValue, fullText);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(parser.push(decoder.decode(value, { stream: true })));
      if (streamError) throw new Error(streamError);
    }
    consume(parser.push(decoder.decode()));
    consume(parser.finish());
  } catch (error) {
    try { await reader.cancel(error); } catch { /* Stream may already be closed. */ }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* Stream may already be released. */ }
  }

  if (streamError) throw new Error(streamError);
  if (!fullText.trim()) throw new Error('The AI service returned no response text.');
  return fullText.trim();
}
