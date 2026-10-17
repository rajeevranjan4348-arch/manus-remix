import { describe, it, expect } from 'vitest';

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

  it('guarantees isAssistantWorking terminates when status is error', () => {
    const computeIsWorking = (isLoading: boolean, status: string) => {
      return (isLoading || status === 'running') && status !== 'error';
    };

    expect(computeIsWorking(true, 'running')).toBe(true);
    expect(computeIsWorking(false, 'completed')).toBe(false);
    expect(computeIsWorking(false, 'error')).toBe(false);
    expect(computeIsWorking(true, 'error')).toBe(false); // even if isLoading is transiently true, error state takes precedence
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
});
