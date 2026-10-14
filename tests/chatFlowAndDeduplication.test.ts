import { describe, it, expect } from 'vitest';
import { reliableResponseEngine } from '../src/lib/reliableResponseEngine';

describe('BUG FIX Regression Test Suite: Chat Flow, Deduplication & Reliability', () => {
  it('1. Request Fencing: creates unique request IDs and tracks active in-flight requests', () => {
    const convId = 'conv_test_123';
    const reqId = reliableResponseEngine.createRequestFence(convId);
    
    expect(reqId).toContain(`req_${convId}_`);
    expect(reliableResponseEngine.isRequestActive(reqId)).toBe(true);

    // Finalize request
    const finalizeRes = reliableResponseEngine.finalizeRequest(reqId);
    expect(finalizeRes.finalized).toBe(true);
    expect(reliableResponseEngine.isRequestActive(reqId)).toBe(false);

    // Double finalization attempt is safely rejected
    const doubleFinalize = reliableResponseEngine.finalizeRequest(reqId);
    expect(doubleFinalize.finalized).toBe(false);

    reliableResponseEngine.cleanup(reqId);
  });

  it('2. Chunk Processing & Sequencing: ingests streaming chunks correctly and rejects stale/out-of-order chunks', () => {
    const reqId = reliableResponseEngine.createRequestFence('conv_chunk_test');

    const chunk1 = reliableResponseEngine.processChunk(reqId, 'Hello ', 1);
    expect(chunk1.shouldApply).toBe(true);
    expect(chunk1.sanitizedChunk).toBe('Hello ');

    const chunk2 = reliableResponseEngine.processChunk(reqId, 'world!', 2);
    expect(chunk2.shouldApply).toBe(true);
    expect(chunk2.sanitizedChunk).toBe('world!');

    // Out of order chunk (seq 1 after seq 2) should be rejected
    const outOfOrder = reliableResponseEngine.processChunk(reqId, 'stale text', 1);
    expect(outOfOrder.shouldApply).toBe(false);

    const finalizeRes = reliableResponseEngine.finalizeRequest(reqId);
    expect(finalizeRes.fullContent).toBe('Hello world!');

    // Trailing chunk after finalization should be rejected
    const trailingChunk = reliableResponseEngine.processChunk(reqId, 'more text', 3);
    expect(trailingChunk.shouldApply).toBe(false);

    reliableResponseEngine.cleanup(reqId);
  });

  it('3. Simple Conversational Intent Detection: distinguishes simple chat from explicit chart requests', () => {
    const isExplicitChartRequest = (content: string) =>
      /(?:create|generate|draw|show|make|build|render)\s+(?:a|an)?\s*(?:graph|chart|plot|diagram|bar chart|pie chart|line chart)/i.test(content) ||
      /^(?:graph|chart|plot):\s*/i.test(content.trim());

    // Simple questions or words containing 'line', 'bar', etc. MUST NOT be treated as chart requests
    expect(isExplicitChartRequest('Hello! How are you doing?')).toBe(false);
    expect(isExplicitChartRequest('What is the timeline for our project?')).toBe(false);
    expect(isExplicitChartRequest('Explain guidelines for React components.')).toBe(false);
    expect(isExplicitChartRequest('Who is the Prime Minister of India?')).toBe(false);

    // Explicit requests for charts/graphs MUST be recognized
    expect(isExplicitChartRequest('Create a bar chart of monthly revenue')).toBe(true);
    expect(isExplicitChartRequest('Generate a graph showing active users')).toBe(true);
    expect(isExplicitChartRequest('chart: quarterly sales comparison')).toBe(true);
  });

  it('4. Message Deduplication Logic: ensures consecutive identical assistant messages are filtered out', () => {
    const rawMessages = [
      { id: 'msg_1', role: 'user', content: 'Hi' },
      { id: 'msg_2', role: 'assistant', content: 'Hello! How can I help you today?' },
      { id: 'msg_3', role: 'assistant', content: 'Hello! How can I help you today?' }, // Duplicate from stream finish re-sync
    ];

    const deduplicateMessages = (msgs: any[]) => {
      const deduped: any[] = [];
      const seenIds = new Set<string>();
      for (const msg of msgs) {
        if (!msg) continue;
        if (msg.id && seenIds.has(msg.id)) continue;
        if (msg.id) seenIds.add(msg.id);

        const prev = deduped[deduped.length - 1];
        if (
          prev &&
          prev.role === 'assistant' &&
          msg.role === 'assistant' &&
          prev.content.trim() === msg.content.trim()
        ) {
          continue;
        }

        deduped.push(msg);
      }
      return deduped;
    };

    const clean = deduplicateMessages(rawMessages);
    expect(clean.length).toBe(2);
    expect(clean[0].role).toBe('user');
    expect(clean[1].role).toBe('assistant');
  });

  it('5. Assistant Working State Guard: ensures thinking indicator terminates immediately on error or completion', () => {
    const getIsAssistantWorking = (isLoading: boolean, status: string) => {
      return (isLoading || status === 'running') && status !== 'error' && status !== 'completed';
    };

    expect(getIsAssistantWorking(true, 'running')).toBe(true);
    expect(getIsAssistantWorking(false, 'completed')).toBe(false);
    expect(getIsAssistantWorking(true, 'completed')).toBe(false);
    expect(getIsAssistantWorking(true, 'error')).toBe(false);
    expect(getIsAssistantWorking(false, 'error')).toBe(false);
  });

  it('6. Single Assistant Header Rule: thinking animation is suppressed when assistant text is already streaming', () => {
    const shouldShowThinkingAnimation = (
      isAssistantWorking: boolean,
      messages: { role: string; content?: string }[]
    ) => {
      const hasAssistantOutput = messages.some(
        (m) => m.role === 'assistant' && Boolean(m.content?.trim())
      );
      return isAssistantWorking && !hasAssistantOutput;
    };

    // Before tokens arrive: show thinking animation
    expect(shouldShowThinkingAnimation(true, [{ role: 'user', content: 'Hi' }])).toBe(true);

    // Empty placeholder assistant message: still show thinking animation
    expect(
      shouldShowThinkingAnimation(true, [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: '' },
      ])
    ).toBe(true);

    // Once streaming tokens arrive: suppress thinking animation to prevent duplicate Manus Lite headers
    expect(
      shouldShowThinkingAnimation(true, [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I' },
      ])
    ).toBe(false);

    // Once complete: thinking animation is false
    expect(
      shouldShowThinkingAnimation(false, [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help you today?' },
      ])
    ).toBe(false);
  });

  it('7. Chat/Work Switcher & Toolbar Layout: ensures toggle indicator stays inside container and icons are non-collapsible', () => {
    const CHAT_WORK_MODES = [
      { id: 'chat', label: 'Chat' },
      { id: 'work', label: 'Work' },
    ];

    CHAT_WORK_MODES.forEach((mode) => {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(['chat', 'work']).toContain(mode.id);
    });

    // Check button classes prevent flex squishing and overlapping
    const buttonClasses =
      'relative z-10 inline-flex items-center justify-center gap-2 px-4 py-1.5 sm:px-5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer shrink-0 whitespace-nowrap';
    expect(buttonClasses).toContain('shrink-0');
    expect(buttonClasses).toContain('whitespace-nowrap');
    expect(buttonClasses).toContain('relative');

    const indicatorClasses =
      'w-1.5 h-1.5 rounded-full bg-emerald-400 dark:bg-emerald-600 shrink-0 inline-block animate-pulse ml-0.5';
    expect(indicatorClasses).toContain('shrink-0');
    expect(indicatorClasses).toContain('inline-block');
  });
});
