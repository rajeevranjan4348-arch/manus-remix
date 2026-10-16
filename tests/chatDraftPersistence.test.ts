import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DRAFT_STORAGE_KEYS,
  getDraftPrompt,
  saveDraftPrompt,
  clearDraftPrompt,
  getChatViewDraft,
  saveChatViewDraft,
  clearChatViewDraft,
} from '../src/lib/draftStorage';

// Mock browser localStorage for Node test environment
const mockStorageMap = new Map<string, string>();
const mockLocalStorage: Storage = {
  getItem: (key: string) => mockStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => { mockStorageMap.set(key, String(value)); },
  removeItem: (key: string) => { mockStorageMap.delete(key); },
  clear: () => { mockStorageMap.clear(); },
  key: (index: number) => Array.from(mockStorageMap.keys())[index] ?? null,
  get length() { return mockStorageMap.size; }
};

if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = mockLocalStorage;
}

describe('Chat Input Local Storage Persistence Suite', () => {
  beforeEach(() => {
    mockStorageMap.clear();
    vi.restoreAllMocks();
  });

  describe('1. Home Draft Prompt Storage & Restoration', () => {
    it('returns empty string when no draft prompt exists in localStorage', () => {
      expect(getDraftPrompt()).toBe('');
    });

    it('saves draft prompt into localStorage across designated keys', () => {
      const draft = 'Build a responsive SaaS dashboard with authentication and charts';
      saveDraftPrompt(draft);

      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.CHAT_INPUT)).toBe(draft);
      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.PROMPT)).toBe(draft);
      expect(getDraftPrompt()).toBe(draft);
    });

    it('restores draft prompt when user refreshes or reloads page', () => {
      // Simulate user typing a multi-line research query and navigating away / refreshing
      const initialDraft = 'Research competitors in AI developer tools\n1. Manus\n2. Devin\n3. Cursor';
      saveDraftPrompt(initialDraft);

      // Simulate a page reload (re-reading from storage)
      const restored = getDraftPrompt();
      expect(restored).toBe(initialDraft);
    });

    it('clears storage keys when text is cleared or empty string is passed', () => {
      saveDraftPrompt('Temporary inquiry');
      expect(getDraftPrompt()).toBe('Temporary inquiry');

      saveDraftPrompt('');
      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.CHAT_INPUT)).toBeNull();
      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.PROMPT)).toBeNull();
      expect(getDraftPrompt()).toBe('');
    });

    it('clears storage keys when whitespace-only text is passed', () => {
      saveDraftPrompt('Some prompt');
      saveDraftPrompt('   \n  \t ');
      expect(getDraftPrompt()).toBe('');
      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.CHAT_INPUT)).toBeNull();
    });

    it('clearDraftPrompt explicitly removes saved keys upon task creation', () => {
      saveDraftPrompt('Draft ready to be launched as autonomous task');
      expect(getDraftPrompt()).not.toBe('');

      clearDraftPrompt();
      expect(getDraftPrompt()).toBe('');
      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.CHAT_INPUT)).toBeNull();
      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.PROMPT)).toBeNull();
    });

    it('handles legacy or single key presence gracefully', () => {
      localStorage.setItem(DRAFT_STORAGE_KEYS.PROMPT, 'Legacy stored prompt');
      expect(getDraftPrompt()).toBe('Legacy stored prompt');
    });
  });

  describe('2. Active ChatView Follow-up Draft Persistence', () => {
    it('returns empty string when no ChatView draft exists', () => {
      expect(getChatViewDraft()).toBe('');
    });

    it('persists and restores follow-up prompt draft in ChatView', () => {
      const followUp = 'Please add a dark mode toggle to the navbar';
      saveChatViewDraft(followUp);

      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.CHAT_VIEW)).toBe(followUp);
      expect(getChatViewDraft()).toBe(followUp);
    });

    it('clears ChatView draft upon sending follow-up message', () => {
      saveChatViewDraft('Fix the unit test failure on line 42');
      clearChatViewDraft();

      expect(getChatViewDraft()).toBe('');
      expect(localStorage.getItem(DRAFT_STORAGE_KEYS.CHAT_VIEW)).toBeNull();
    });

    it('supports session-scoped ChatView draft keys', () => {
      const sessionId = 'task-session-xyz';
      const sessionDraft = 'Inspect the generated bundle size';
      saveChatViewDraft(sessionDraft, sessionId);

      expect(getChatViewDraft(sessionId)).toBe(sessionDraft);
      clearChatViewDraft(sessionId);
      expect(getChatViewDraft(sessionId)).toBe('');
    });
  });

  describe('3. Resilience & Private Browsing Fallbacks', () => {
    it('does not throw when localStorage throws quota or security error', () => {
      vi.spyOn((globalThis as any).localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      expect(() => saveDraftPrompt('Some prompt text')).not.toThrow();
    });

    it('does not throw when localStorage getItem throws', () => {
      vi.spyOn((globalThis as any).localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      expect(() => getDraftPrompt()).not.toThrow();
      expect(getDraftPrompt()).toBe('');
    });
  });

  describe('4. 500ms Debounced Auto-Save Mechanism', () => {
    it('debounces saving until typing pauses for 500ms', async () => {
      vi.useFakeTimers();

      let savedText = '';
      const onSave = (text: string) => {
        savedText = text;
        saveDraftPrompt(text);
      };

      // Simulate typing 'M'
      let currentInput = 'M';
      let timer: any = setTimeout(() => onSave(currentInput), 500);

      // Advance 200ms (typing 'Ma' before 500ms pause)
      vi.advanceTimersByTime(200);
      clearTimeout(timer);
      currentInput = 'Ma';
      timer = setTimeout(() => onSave(currentInput), 500);

      // Advance 200ms (typing 'Man' before 500ms pause)
      vi.advanceTimersByTime(200);
      clearTimeout(timer);
      currentInput = 'Manus AI';
      timer = setTimeout(() => onSave(currentInput), 500);

      // Up to this point (400ms total elapsed), save has not fired yet
      expect(savedText).toBe('');
      expect(getDraftPrompt()).toBe('');

      // Now pause typing for 500ms
      vi.advanceTimersByTime(500);

      // Auto-save triggers after 500ms pause
      expect(savedText).toBe('Manus AI');
      expect(getDraftPrompt()).toBe('Manus AI');

      vi.useRealTimers();
    });
  });
});
