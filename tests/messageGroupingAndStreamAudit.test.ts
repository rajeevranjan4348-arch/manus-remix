import { describe, it, expect } from 'vitest';
import {
  deduplicateDisplayMessages,
  computeMessageGroupingMetadata,
  groupConsecutiveMessages,
  GroupableChatMessage,
} from '../src/lib/messageGrouping';
import { generateResilientResponse, streamGeminiResponse } from '../server/geminiService';

describe('Consecutive Same-Sender Message Grouping (ChatView)', () => {
  it('groups consecutive user messages into a single block with reduced vertical gap metadata', () => {
    const messages: GroupableChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hey there' },
      { id: 'u2', role: 'user', content: 'Quick question:' },
      { id: 'u3', role: 'user', content: 'What is 2 + 2?' },
      { id: 'a1', role: 'assistant', content: '2 + 2 is 4.' },
    ];

    const groups = groupConsecutiveMessages(messages);
    expect(groups).toHaveLength(2);

    const userGroup = groups[0];
    expect(userGroup.role).toBe('user');
    expect(userGroup.messages).toHaveLength(3);
    expect(userGroup.messages[0].meta).toMatchObject({
      isFirstInGroup: true,
      isLastInGroup: false,
      isGroupedWithPrev: false,
      isGroupedWithNext: true,
      groupPosition: 0,
      groupSize: 3,
    });
    expect(userGroup.messages[1].meta).toMatchObject({
      isFirstInGroup: false,
      isLastInGroup: false,
      isGroupedWithPrev: true,
      isGroupedWithNext: true,
      groupPosition: 1,
      groupSize: 3,
    });
    expect(userGroup.messages[2].meta).toMatchObject({
      isFirstInGroup: false,
      isLastInGroup: true,
      isGroupedWithPrev: true,
      isGroupedWithNext: false,
      groupPosition: 2,
      groupSize: 3,
    });

    const assistantGroup = groups[1];
    expect(assistantGroup.role).toBe('assistant');
    expect(assistantGroup.messages).toHaveLength(1);
    expect(assistantGroup.messages[0].meta).toMatchObject({
      isFirstInGroup: true,
      isLastInGroup: true,
      isGroupedWithPrev: false,
      isGroupedWithNext: false,
      groupPosition: 0,
      groupSize: 1,
    });
  });

  it('groups consecutive assistant messages into a single block while preserving alternating turns', () => {
    const messages: GroupableChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Analyze this' },
      { id: 'a1', role: 'assistant', content: 'Part 1: Initial findings' },
      { id: 'a2', role: 'assistant', content: 'Part 2: Detailed synthesis' },
      { id: 'u2', role: 'user', content: 'Thanks!' },
    ];

    const groups = groupConsecutiveMessages(messages);
    expect(groups).toHaveLength(3);
    expect(groups[0].role).toBe('user');
    expect(groups[0].messages).toHaveLength(1);

    expect(groups[1].role).toBe('assistant');
    expect(groups[1].messages).toHaveLength(2);
    expect(groups[1].messages[0].meta.isGroupedWithPrev).toBe(false);
    expect(groups[1].messages[0].meta.isGroupedWithNext).toBe(true);
    expect(groups[1].messages[1].meta.isGroupedWithPrev).toBe(true);
    expect(groups[1].messages[1].meta.isGroupedWithNext).toBe(false);

    expect(groups[2].role).toBe('user');
    expect(groups[2].messages).toHaveLength(1);
  });

  it('preserves distinct consecutive messages with different IDs even if text matches, while deduplicating identical IDs', () => {
    const messages: GroupableChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello' },
      { id: 'u1', role: 'user', content: 'Hello' }, // duplicate ID -> dropped
      { id: 'u2', role: 'user', content: 'Hello' }, // distinct ID -> preserved!
      { role: 'assistant', content: 'Hi!' },
      { role: 'assistant', content: 'Hi!' }, // anonymous duplicate frame -> dropped
    ];

    const deduped = deduplicateDisplayMessages(messages);
    expect(deduped).toHaveLength(3);
    expect(deduped[0].id).toBe('u1');
    expect(deduped[1].id).toBe('u2');
    expect(deduped[2].role).toBe('assistant');
  });

  it('computes accurate global indices when startOffset is provided for windowed virtualization', () => {
    const slice: GroupableChatMessage[] = [
      { id: 'u10', role: 'user', content: 'First in window' },
      { id: 'u11', role: 'user', content: 'Second in window' },
    ];
    const groups = groupConsecutiveMessages(slice, 10);
    expect(groups).toHaveLength(1);
    expect(groups[0].startIndex).toBe(10);
    expect(groups[0].endIndex).toBe(11);
    expect(groups[0].messages[0].index).toBe(10);
    expect(groups[0].messages[1].index).toBe(11);
  });
});

describe('AI Request & Streaming Lifecycle Audit', () => {
  it('evaluates direct arithmetic queries accurately in resilient generator', () => {
    expect(generateResilientResponse('What is 2 + 2?')).toContain('2 + 2 = 4');
    expect(generateResilientResponse('15 * 4')).toContain('15 × 4 = 60');
  });

  it('streams a complete non-empty response and activity lifecycle for short and long prompts', async () => {
    const activities: any[] = [];
    const chunks: string[] = [];

    const stream = streamGeminiResponse({
      messages: [{ role: 'user', content: 'Hello, what is 2 + 2?' }],
      taskId: 'test_audit_short',
      onActivity: (ev) => activities.push(ev),
    });

    for await (const delta of stream) {
      chunks.push(delta);
    }

    const fullText = chunks.join('').trim();
    expect(fullText.length).toBeGreaterThan(0);
    expect(activities.length).toBeGreaterThanOrEqual(2);
    // Verify no activity is left stuck in RUNNING state after stream completes
    const finalStatusById = new Map<string, string>();
    for (const act of activities) {
      finalStatusById.set(act.eventId, act.status);
    }
    for (const status of finalStatusById.values()) {
      expect(status).not.toBe('RUNNING');
    }
  });
});
