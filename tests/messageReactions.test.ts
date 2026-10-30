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
  });

  it('persists multiple independent message reactions in localStorage', () => {
    setMessageReaction('msg-a', 'up');
    setMessageReaction('msg-b', 'down');

    const stored = getStoredMessageReactions();
    expect(stored['msg-a']).toBe('up');
    expect(stored['msg-b']).toBe('down');

    setMessageReaction('msg-a', null);
    expect(getStoredMessageReactions()['msg-a']).toBeUndefined();
    expect(getStoredMessageReactions()['msg-b']).toBe('down');
  });

  it('wires MessageHoverReactions into ChatView.tsx and MyAIChat.tsx AI message rows', () => {
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

    // Verify spring-based pop animation and active monochrome icon states
    expect(hoverSource).toContain('animate-reaction-spring-pop');
    expect(hoverSource).toContain('animate-reaction-icon-pop');
    expect(hoverSource).toContain('cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(hoverSource).toContain('text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20');

    expect(actionBarSource).toContain('animate-reaction-spring-pop');
    expect(actionBarSource).toContain('animate-reaction-icon-pop');
    expect(actionBarSource).toContain('text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20');

    expect(cssSource).toContain('@keyframes reaction-spring-pop');
    expect(cssSource).toContain('@keyframes reaction-icon-spring-pop');
    expect(cssSource).toContain('cubic-bezier(0.34, 1.56, 0.64, 1)');

    expect(chatViewSource).toContain('MessageHoverReactions');
    expect(chatViewSource).toContain('group/ai-message');

    expect(myAiChatSource).toContain('MessageHoverReactions');
    expect(myAiChatSource).toContain('group/ai-message');
  });
});
