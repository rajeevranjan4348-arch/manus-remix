import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectExplicitMemoryIntent,
  longTermMemory,
} from '../src/lib/longTermMemory';
import { formatMemoryHighlight } from '../src/components/agent/MemoryUpdatedIndicator';

const rootDir = path.resolve(__dirname, '..');
const readFile = (relPath: string) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

describe('ChatGPT-style Memory Updated UI & Long-Term Memory Persistence', () => {
  describe('Explicit memory intent detection', () => {
    it('detects the exact screenshot prompt "Reminder one thing is my favourite character is leon"', () => {
      const intent = detectExplicitMemoryIntent('Reminder one thing is my favourite character is leon');
      expect(intent.matched).toBe(true);
      expect(intent.action).toBe('save');
      expect(intent.key).toBe('Favourite character');
      expect(intent.value?.toLowerCase()).toContain('leon');
    });

    it('detects common explicit remember, save-to-memory, note, and preference statements', () => {
      const cases = [
        'Remember that my favorite language is TypeScript',
        'Keep in mind I prefer concise bullet points',
        'Save to memory: I work in the IST timezone',
        "Don't forget my dog's name is Milo",
        'From now on always call me Raj',
        'My preference is dark mode with clean typography',
      ];

      for (const msg of cases) {
        const res = detectExplicitMemoryIntent(msg);
        expect(res.matched, `Expected "${msg}" to match`).toBe(true);
        expect(res.action).toBe('save');
        expect(res.value && res.value.length > 0).toBe(true);
      }
    });

    it('detects explicit clear/forget memory requests', () => {
      const res = detectExplicitMemoryIntent('Please forget my saved memories');
      expect(res.matched).toBe(true);
      expect(res.action).toBe('clear');
    });

    it('does NOT falsely trigger on ordinary chat messages or recall questions', () => {
      const nonMemoryMessages = [
        'Hello, how are you?',
        'Explain how React useMemo works',
        'Do you remember who won the 2022 World Cup?',
        'Can you remind me what time the standup is?',
        'What is the capital of Japan?',
      ];

      for (const msg of nonMemoryMessages) {
        const res = detectExplicitMemoryIntent(msg);
        expect(res.matched, `Expected "${msg}" NOT to match`).toBe(false);
      }
    });
  });

  describe('Verified long-term memory persistence & failure honesty', () => {
    const testUserId = 'usr_test_memory_ui_1';
    const originalWindow = globalThis.window;

    function installMockStorage(options?: { failSetItem?: boolean }) {
      const store = new Map<string, string>();
      const dispatched: string[] = [];
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
          localStorage: {
            getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
            setItem: (k: string, v: string) => {
              if (options?.failSetItem) {
                throw new Error('QuotaExceededError: Storage full');
              }
              store.set(k, v);
            },
            removeItem: (k: string) => {
              store.delete(k);
            },
          },
          dispatchEvent: (ev: Event) => {
            dispatched.push(ev.type);
            return true;
          },
        },
      });
      return { store, dispatched };
    }

    beforeEach(() => {
      longTermMemory.invalidateCache(testUserId);
    });

    afterEach(() => {
      longTermMemory.invalidateCache(testUserId);
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
      vi.restoreAllMocks();
    });

    it('persists explicit memory and retrieves it in prompt context across cache invalidation (session reload)', async () => {
      const { dispatched } = installMockStorage();

      const res = await longTermMemory.captureFromUserMessage({
        userId: testUserId,
        message: 'Reminder one thing is my favourite character is leon',
        sourceMessageId: 'msg_user_1',
      });

      expect(res.matched).toBe(true);
      expect(res.persisted).toBe(true);
      expect(res.action).toBe('save');
      expect(res.record?.key).toBe('Favourite character');
      expect(dispatched).toContain('manus_memory_updated');

      // Simulate fresh session reload by clearing in-memory cache
      longTermMemory.invalidateCache(testUserId);

      // Even with American spelling "favorite", the persisted fact is retrieved for prompt context
      const context = await longTermMemory.getRelevantContext(testUserId, 'Who is my favorite character?');
      expect(context).toContain('Favourite character');
      expect(context.toLowerCase()).toContain('leon');
    });

    it('redacts secrets before persisting memory', async () => {
      installMockStorage();

      const res = await longTermMemory.captureFromUserMessage({
        userId: testUserId,
        message: 'Remember my test key is sk-proj-1234567890abcdef1234567890',
        sourceMessageId: 'msg_user_secret',
      });

      expect(res.matched).toBe(true);
      expect(res.persisted).toBe(true);
      expect(res.record?.value).not.toContain('sk-proj-1234567890abcdef1234567890');
    });

    it('returns persisted: false and error status when persistence fails (never fakes confirmation)', async () => {
      installMockStorage({ failSetItem: true });

      const res = await longTermMemory.captureFromUserMessage({
        userId: testUserId,
        message: 'Remember that my favourite character is Leon',
        sourceMessageId: 'msg_user_fail',
      });

      expect(res.matched).toBe(true);
      expect(res.persisted).toBe(false);
      expect(res.error).toBeTruthy();

      // Cache must not hold unpersisted record
      const cached = await longTermMemory.getMemories(testUserId);
      expect(cached).toHaveLength(0);
    });
  });

  describe('Minimal UI component, CSS animation, and ChatView/useAgentTask wiring', () => {
    it('MemoryUpdatedIndicator renders outlined open-book icon, "Memory updated", failure status, and auto-settle transition', () => {
      const source = readFile('src/components/agent/MemoryUpdatedIndicator.tsx');
      expect(source).toContain('OpenBookIcon');
      expect(source).toContain("'Memory updated'");
      expect(source).toContain("'Memory cleared'");
      expect(source).toContain(`"Couldn't update memory"`);
      expect(source).toContain('memory-updated-enter');
      expect(source).toContain('memory-book-icon-enter');
      expect(source).toContain('settleAfterMs');
      expect(source).toContain("data-testid=\"memory-updated-indicator\"");
      expect(source).toContain('dark:text-[#FFFFFF]');
      expect(source).toContain('dark:text-[#B4B4B4]');
    });

    it('defines subtle fade-slide and open-book scale keyframes with reduced-motion support in index.css', () => {
      const css = readFile('src/index.css');
      expect(css).toContain('@keyframes memory-updated-fade-slide');
      expect(css).toContain('@keyframes memory-book-scale-in');
      expect(css).toContain('.memory-updated-enter');
      expect(css).toContain('.memory-book-icon-enter');
    });

    it('ChatView preserves existing user message UI and renders MemoryUpdatedIndicator below user messages', () => {
      const chatView = readFile('src/components/agent/ChatView.tsx');
      expect(chatView).toContain('bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000]');
      expect(chatView).toContain("import { MemoryUpdatedIndicator } from './MemoryUpdatedIndicator'");
      expect(chatView).toContain('const memoryUpdate = msg.metadata?.memoryUpdate;');
      expect(chatView).toContain('<MemoryUpdatedIndicator memoryUpdate={memoryUpdate} />');
    });

    it('useAgentTask captures memory for sends, edits, and startTask and preserves metadata in loadTask', () => {
      const hook = readFile('src/hooks/useAgentTask.ts');
      expect(hook).toContain('const captureAndAttachUserMemory = useCallback');
      expect(hook).toContain('await longTermMemory.captureFromUserMessage');
      const sendMessageStart = hook.indexOf('const sendMessage = useCallback');
      const editLifecycleStart = hook.indexOf('const runEditLifecycle = async');
      const startTaskStart = hook.indexOf('const startTask = useCallback');
      expect(sendMessageStart).toBeGreaterThanOrEqual(0);
      expect(editLifecycleStart).toBeGreaterThan(sendMessageStart);
      expect(startTaskStart).toBeGreaterThan(editLifecycleStart);
      expect(hook.slice(sendMessageStart, editLifecycleStart)).toContain('await captureAndAttachUserMemory(');
      expect(hook.slice(editLifecycleStart, startTaskStart)).toContain('await captureAndAttachUserMemory(');
      expect(hook.slice(startTaskStart)).toContain('await captureAndAttachUserMemory(');
      expect(hook).toContain('...(m.metadata ? { metadata: m.metadata } : {})');
      expect(hook).toContain('memoryKey: captureRes.record?.key');
      expect(hook).toContain('memoryValue: captureRes.record?.value');
    });

    it('highlights the specific memory added to the Deku AI profile with entrance & sheen animation and clean formatting', () => {
      const cleaned = formatMemoryHighlight({
        status: 'saved',
        action: 'save',
        memoryKey: 'Favourite character',
        memoryValue: 'my favourite character is leon',
        summary: 'Favourite character: my favourite character is leon',
        updatedAt: new Date().toISOString(),
        isFresh: true,
      });
      expect(cleaned).toEqual({
        key: 'Favourite character',
        value: 'leon',
      });

      const fromSummaryOnly = formatMemoryHighlight({
        status: 'saved',
        action: 'save',
        summary: 'Timezone: IST (Asia/Kolkata)',
        updatedAt: new Date().toISOString(),
        isFresh: false,
      });
      expect(fromSummaryOnly).toEqual({
        key: 'Timezone',
        value: 'IST (Asia/Kolkata)',
      });

      const cleared = formatMemoryHighlight({
        status: 'saved',
        action: 'clear',
        summary: 'Cleared saved memories',
        updatedAt: new Date().toISOString(),
        isFresh: true,
      });
      expect(cleared).toEqual({ value: 'Profile memories cleared' });

      const failed = formatMemoryHighlight({
        status: 'failed',
        action: 'save',
        error: 'Storage full',
        updatedAt: new Date().toISOString(),
        isFresh: true,
      });
      expect(failed).toBeNull();

      const source = readFile('src/components/agent/MemoryUpdatedIndicator.tsx');
      expect(source).toContain('data-testid="memory-updated-highlight"');
      expect(source).toContain('data-testid="memory-updated-sheen"');
      expect(source).toContain('memory-highlight-enter');
      expect(source).toContain('memory-highlight-sheen');
      expect(source).toContain('Deku AI');
      expect(source).not.toMatch(/Manus/i);

      const css = readFile('src/index.css');
      expect(css).toContain('@keyframes memory-highlight-reveal');
      expect(css).toContain('@keyframes memory-highlight-sheen');
      expect(css).toContain('@keyframes memory-highlight-border-glow');
      expect(css).toContain('.memory-highlight-enter');
      expect(css).toContain('.memory-highlight-sheen');
    });
  });
});
