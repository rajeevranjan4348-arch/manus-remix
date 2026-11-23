import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getStoredMessageReactions,
  getMessageReaction,
  setMessageReaction,
  toggleMessageReaction,
} from '../src/lib/messageReactions';
import fs from 'fs';
import path from 'path';

describe('AI Message Hover Reactions (Thumbs Up/Down)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      dispatchEvent: vi.fn(),
    });
    vi.restoreAllMocks();
  });

  it('toggles thumbs up and thumbs down reactions for individual message IDs', () => {
    expect(getMessageReaction('msg-101')).toBeNull();

    const first = toggleMessageReaction('msg-101', 'up');
    expect(first.nextReaction).toBe('up');
    expect(getMessageReaction('msg-101')).toBe('up');

    // Switching from thumbs up to thumbs down updates the reaction
    const switched = toggleMessageReaction('msg-101', 'down');
    expect(switched.nextReaction).toBe('down');
    expect(getMessageReaction('msg-101')).toBe('down');

    // Clicking the active reaction again removes it
    const cleared = toggleMessageReaction('msg-101', 'down');
    expect(cleared.nextReaction).toBeNull();
    expect(getMessageReaction('msg-101')).toBeNull();

    // Toggling heart reaction works and persists
    const hearted = toggleMessageReaction('msg-101', 'heart');
    expect(hearted.nextReaction).toBe('heart');
    expect(getMessageReaction('msg-101')).toBe('heart');
  });

  it('persists multiple independent message reactions in localStorage', () => {
    setMessageReaction('msg-a', 'up');
    setMessageReaction('msg-b', 'down');
    setMessageReaction('msg-c', 'heart');

    const stored = getStoredMessageReactions();
    expect(stored['msg-a']).toBe('up');
    expect(stored['msg-b']).toBe('down');
    expect(stored['msg-c']).toBe('heart');

    setMessageReaction('msg-a', null);
    expect(getStoredMessageReactions()['msg-a']).toBeUndefined();
    expect(getStoredMessageReactions()['msg-b']).toBe('down');
  });

  it('wires ConversationActionBar reaction toolbar (thumbs up, heart, copy, thumbs down) with bounce animation into ChatView.tsx', () => {
    const hoverCompPath = path.resolve(__dirname, '../src/components/agent/MessageHoverReactions.tsx');
    const actionBarPath = path.resolve(__dirname, '../src/components/agent/ConversationActionBar.tsx');
    const chatViewPath = path.resolve(__dirname, '../src/components/agent/ChatView.tsx');
    const myAiChatPath = path.resolve(__dirname, '../src/components/chat/MyAIChat.tsx');
    const cssPath = path.resolve(__dirname, '../src/index.css');

    const hoverSource = fs.readFileSync(hoverCompPath, 'utf-8');
    const actionBarSource = fs.readFileSync(actionBarPath, 'utf-8');
    const chatViewSource = fs.readFileSync(chatViewPath, 'utf-8');
    const myAiChatSource = fs.readFileSync(myAiChatPath, 'utf-8');
    const cssSource = fs.readFileSync(cssPath, 'utf-8');

    expect(hoverSource).toContain('ai-message-hover-reactions');
    expect(hoverSource).toContain('hover-reaction-thumbs-up');
    expect(hoverSource).toContain('hover-reaction-thumbs-down');
    expect(hoverSource).toContain('group-hover/ai-message:opacity-100');

    // Verify spring-based bounce animation and active monochrome icon states
    expect(hoverSource).toContain('animate-reaction-spring-pop');
    expect(hoverSource).toContain('animate-reaction-icon-pop');
    expect(hoverSource).toContain('cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(hoverSource).toContain('text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20');

    expect(actionBarSource).toContain('data-testid="action-bar-copy"');
    expect(actionBarSource).toContain('data-testid="action-bar-like"');
    expect(actionBarSource).toContain('data-testid="action-bar-heart"');
    expect(actionBarSource).toContain('data-testid="action-bar-dislike"');
    expect(actionBarSource).toContain('animate-reaction-spring-pop');
    expect(actionBarSource).toContain('animate-reaction-icon-pop');
    expect(actionBarSource).toContain('text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20');

    expect(cssSource).toContain('@keyframes reaction-spring-pop');
    expect(cssSource).toContain('@keyframes reaction-icon-spring-pop');
    expect(cssSource).toContain('cubic-bezier(0.34, 1.56, 0.64, 1)');

    // Verify ChatView and MyAIChat render a single ConversationActionBar per assistant message (no duplicate MessageHoverReactions)
    expect(chatViewSource).toContain('<ConversationActionBar');
    expect(chatViewSource).not.toContain('<MessageHoverReactions');
    expect(chatViewSource).toContain('group/ai-message');

    expect(myAiChatSource).toContain('<ConversationActionBar');
    expect(myAiChatSource).not.toContain('<MessageHoverReactions');
    expect(myAiChatSource).toContain('group/ai-message');
  });

  it('adds BubbleReactionButtons (thumbs up/down) triggering animate-reaction-spring-pop on chat message bubbles', () => {
    const bubbleCompPath = path.resolve(__dirname, '../src/components/agent/BubbleReactionButtons.tsx');
    const chatViewPath = path.resolve(__dirname, '../src/components/agent/ChatView.tsx');
    const myAiChatPath = path.resolve(__dirname, '../src/components/chat/MyAIChat.tsx');

    const bubbleSource = fs.readFileSync(bubbleCompPath, 'utf-8');
    const chatViewSource = fs.readFileSync(chatViewPath, 'utf-8');
    const myAiChatSource = fs.readFileSync(myAiChatPath, 'utf-8');

    expect(bubbleSource).toContain('data-testid="bubble-reaction-buttons"');
    expect(bubbleSource).toContain('data-testid="bubble-reaction-thumbs-up"');
    expect(bubbleSource).toContain('data-testid="bubble-reaction-thumbs-down"');
    expect(bubbleSource).toContain('animate-reaction-spring-pop');
    expect(bubbleSource).toContain('animate-reaction-icon-pop');
    expect(bubbleSource).toContain('toggleMessageReaction');

    expect(chatViewSource).toContain('<BubbleReactionButtons');
    expect(myAiChatSource).toContain('<BubbleReactionButtons');
  });
});
