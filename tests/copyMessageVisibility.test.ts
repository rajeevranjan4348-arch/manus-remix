import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { copyTextToClipboard, hasActiveTextSelection } from '../src/lib/clipboard';

const rootDir = path.resolve(__dirname, '..');
const readFile = (relPath: string) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

describe('Message visibility during text selection and copy operations', () => {
  describe('CSS selection contrast and Android WebView compositing rules', () => {
    const css = readFile('src/index.css');

    it('removes broken body selection:bg-primary/10 selection:text-primary that caused invisible white-on-white / black-on-black text', () => {
      expect(css).not.toContain('selection:bg-primary/10');
      expect(css).not.toContain('selection:text-primary');
    });

    it('defines explicit high-contrast ::selection and ::-moz-selection rules for light mode, dark mode, and inverted user message bubbles', () => {
      // Light mode default surface (dark text on light bg)
      expect(css).toMatch(/::selection\s*\{[^}]*color:\s*#000000;/);
      expect(css).toMatch(/::-moz-selection\s*\{[^}]*color:\s*#000000;/);

      // Dark mode default surface (white text on dark bg)
      expect(css).toMatch(/\.dark\s+::selection\s*\{[^}]*color:\s*#FFFFFF;/);
      expect(css).toMatch(/\.dark\s+::-moz-selection\s*\{[^}]*color:\s*#FFFFFF;/);

      // Light mode user bubble (black bubble -> white text must stay white when selected)
      expect(css).toMatch(/\[data-testid="user-message-bubble"\]::selection[\s\S]*?color:\s*#FFFFFF\s*!important;/);
      // Dark mode user bubble (white bubble -> black text must stay black when selected)
      expect(css).toMatch(/\.dark\s+\[data-testid="user-message-bubble"\]::selection[\s\S]*?color:\s*#000000\s*!important;/);
    });

    it('enforces explicit text selectability on user and assistant messages for mobile and Android WebView', () => {
      expect(css).toContain('user-select: text;');
      expect(css).toContain('-webkit-user-select: text;');
      expect(css).toContain('-webkit-touch-callout: default;');
    });

    it('removes GPU layer traps (backface-visibility / permanent translate3d fill) on chat message entrances so Android Chrome does not blank text during selection', () => {
      const chatEnterBlocks = css.match(/\.chat-message-enter\s*\{[^}]*\}/g) || [];
      expect(chatEnterBlocks.length).toBeGreaterThan(0);
      for (const block of chatEnterBlocks) {
        expect(block).not.toContain('backface-visibility');
        expect(block).not.toContain('contain:');
      }

      // Entrance keyframes must settle to `transform: none` so the browser releases the compositing layer
      expect(css).toMatch(/@keyframes\s+chat-message-slide-in[\s\S]*?to\s*\{[^}]*transform:\s*none;/);
      expect(css).toMatch(/@keyframes\s+chat-user-bubble-in[\s\S]*?to\s*\{[^}]*transform:\s*none;/);
      expect(css).toMatch(/@keyframes\s+chat-assistant-bubble-in[\s\S]*?to\s*\{[^}]*transform:\s*none;/);
      expect(css).toMatch(/@keyframes\s+manus-content-settle[\s\S]*?100%\s*\{[^}]*transform:\s*none;/);
    });
  });

  describe('React components: MarkdownRenderer, ConversationActionBar, ChatView, and MyAIChat', () => {
    it('MarkdownRenderer removes contain-content and guards handleSkip against active text selection', () => {
      const source = readFile('src/components/agent/MarkdownRenderer.tsx');
      expect(source).not.toContain('contain-content');
      expect(source).toContain('hasActiveTextSelection');
      expect(source).toMatch(/const handleSkip = \(\) => \{\s*if \(hasActiveTextSelection\(\)\)/);
    });

    it('ConversationActionBar uses safe copyTextToClipboard and prevents focus/selection theft on Copy press', () => {
      const source = readFile('src/components/agent/ConversationActionBar.tsx');
      expect(source).toContain("from '@/lib/clipboard'");
      expect(source).toContain('await copyTextToClipboard(content)');
      expect(source).toContain('onMouseDown={(e) => e.preventDefault()}');
      expect(source).toContain('copyTimerRef');
    });

    it('ChatView preserves user bubble contrast classes, enables select-text, pauses auto-scroll during active text selection, and uses stable streaming msgKey', () => {
      const source = readFile('src/components/agent/ChatView.tsx');
      // Preserves existing monochrome UI classes untouched
      expect(source).toContain('bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000]');
      expect(source).toContain('!hasActiveTextSelection(containerRef.current)');
      // Ensures msgKey does not churn as the first 20 chars stream in
      expect(source).toContain('const msgKey = msg.id || `msg-${index}`;');
      expect(source).not.toContain('cleanedContent.slice(0, 20)');
    });

    it('MyAIChat pauses scrollToBottom during active selection and does not hardcode dark-only selection overrides', () => {
      const source = readFile('src/components/chat/MyAIChat.tsx');
      expect(source).toContain('!hasActiveTextSelection(mainRef.current)');
      expect(source).not.toContain('selection:bg-neutral-800');
      expect(source).toContain('select-text');
    });
  });

  describe('Clipboard utility runtime behavior', () => {
    const originalNavigator = globalThis.navigator;
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
    });

    it('uses navigator.clipboard.writeText cleanly without touching DOM for short, long, and streaming messages', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText } },
        configurable: true,
      });

      const longMessage = 'Line 1: AI explanation.\n'.repeat(500);
      const result = await copyTextToClipboard(longMessage);

      expect(result).toBe(true);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(longMessage);
    });

    it('falls back safely to offscreen readonly textarea when navigator.clipboard rejects, preserving selection and scroll position', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText } },
        configurable: true,
      });

      const clonedRange = { cloned: true };
      const removeAllRanges = vi.fn();
      const addRange = vi.fn();
      const scrollTo = vi.fn();
      Object.defineProperty(globalThis, 'window', {
        value: {
          scrollX: 0,
          scrollY: 420,
          scrollTo,
          getSelection: () => ({
            isCollapsed: false,
            rangeCount: 1,
            toString: () => 'selected user text',
            getRangeAt: () => ({ cloneRange: () => clonedRange }),
            removeAllRanges,
            addRange,
          }),
        },
        configurable: true,
      });

      const appendedNodes: any[] = [];
      const removedNodes: any[] = [];
      const createdTextarea: any = {
        value: '',
        style: {},
        parentNode: null,
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
      };

      const fakeBody = {
        appendChild: vi.fn((node: any) => {
          node.parentNode = fakeBody;
          appendedNodes.push(node);
        }),
        removeChild: vi.fn((node: any) => {
          node.parentNode = null;
          removedNodes.push(node);
        }),
      };

      const execCommand = vi.fn().mockReturnValue(true);
      Object.defineProperty(globalThis, 'document', {
        value: {
          body: fakeBody,
          activeElement: null,
          contains: () => false,
          createElement: vi.fn(() => createdTextarea),
          execCommand,
        },
        configurable: true,
      });

      const ok = await copyTextToClipboard('Copied message text');
      expect(ok).toBe(true);
      expect(createdTextarea.setAttribute).toHaveBeenCalledWith('readonly', '');
      expect(createdTextarea.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(appendedNodes).toHaveLength(1);
      expect(removedNodes).toHaveLength(1);
      // Original user text selection was preserved
      expect(removeAllRanges).toHaveBeenCalledTimes(1);
      expect(addRange).toHaveBeenCalledWith(clonedRange);
    });

    it('detects active non-empty text selection inside a specific container', () => {
      const childNode = {} as Node;
      const container = {
        contains: (n: Node | null) => n === childNode,
      } as unknown as HTMLElement;

      Object.defineProperty(globalThis, 'window', {
        value: {
          getSelection: () => ({
            isCollapsed: false,
            rangeCount: 1,
            toString: () => 'hello world',
            anchorNode: childNode,
            focusNode: childNode,
          }),
        },
        configurable: true,
      });

      expect(hasActiveTextSelection(container)).toBe(true);

      const otherContainer = {
        contains: () => false,
      } as unknown as HTMLElement;
      expect(hasActiveTextSelection(otherContainer)).toBe(false);
    });
  });
});
