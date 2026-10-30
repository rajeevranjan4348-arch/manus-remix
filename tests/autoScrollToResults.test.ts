import { describe, it, expect, vi, beforeEach } from 'vitest';

// Polyfill window & localStorage in test environment
const store = new Map<string, string>();
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

// Lightweight mock element constructor if document is undefined
class MockElement {
  attributes = new Map<string, string>();
  className = '';
  textContent = '';
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  scrollTop = 0;
  clientHeight = 500;
  scrollHeight = 1000;
  scrollTo = vi.fn();
  _rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} };

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) || null;
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  getBoundingClientRect() {
    return this._rect;
  }

  querySelectorAll<T = MockElement>(selector: string): T[] {
    const results: MockElement[] = [];
    const selectors = selector.split(',').map(s => s.trim());

    const traverse = (el: MockElement) => {
      for (const sel of selectors) {
        if (sel.startsWith('[') && sel.endsWith(']')) {
          const match = sel.slice(1, -1).split('=');
          const attr = match[0];
          const val = match[1] ? match[1].replace(/["']/g, '') : null;
          if (val === null ? el.attributes.has(attr) : el.attributes.get(attr) === val) {
            if (!results.includes(el)) results.push(el);
          }
        } else if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          if (el.className.split(/\s+/).includes(cls)) {
            if (!results.includes(el)) results.push(el);
          }
        }
      }
      for (const child of el.children) {
        traverse(child);
      }
    };

    for (const child of this.children) {
      traverse(child);
    }
    return results as unknown as T[];
  }
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    createElement: () => new MockElement(),
  };
}

import { centerElementInContainer, findSearchContentElement, evaluateAutoScrollState } from '@/components/agent/ChatView';
import { parseSourcesFromMarkdown, resolveMessageSourcesAndQueries } from '@/components/agent/SourceCitations';
import { computeTypingSequenceState } from '@/components/agent/MarkdownRenderer';
import { deriveContextualThinkingStages } from '@/components/agent/WorkModeThinkingAnimation';
import { getSettings, saveSettings, DEFAULT_SETTINGS, resetSettings } from '@/lib/settingsStore';

describe('Auto-scroll to Results Feature', () => {
  beforeEach(() => {
    store.clear();
    resetSettings();
  });

  describe('centerElementInContainer Helper', () => {
    it('calculates the vertically centered position of a search element in a scrollable container', () => {
      // Mock container element: height 600px, scrollHeight 2000px, current scrollTop 100px
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });
      container.scrollTop = 100;

      container.getBoundingClientRect = () => ({
        top: 50,
        bottom: 650,
        left: 0,
        right: 800,
        width: 800,
        height: 600,
        x: 0,
        y: 50,
        toJSON: () => {},
      });

      // Mock target search content: height 120px, located at y=400 on screen
      const target = document.createElement('div');
      target.getBoundingClientRect = () => ({
        top: 400,
        bottom: 520,
        left: 50,
        right: 750,
        width: 700,
        height: 120,
        x: 50,
        y: 400,
        toJSON: () => {},
      });

      container.appendChild(target);

      const scrollToMock = vi.fn();
      container.scrollTo = scrollToMock;

      // Relative top: (400 - 50) + 100 = 450
      // Centered top: 450 - (600 / 2) + (120 / 2) = 450 - 300 + 60 = 210
      const finalTop = centerElementInContainer(container, target, 'smooth');

      expect(finalTop).toBe(210);
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 210,
        behavior: 'smooth',
      });
    });

    it('clamps the centered scroll position to container top (0) if target is near top', () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1500, configurable: true });
      container.scrollTop = 0;

      container.getBoundingClientRect = () => ({
        top: 0,
        bottom: 500,
        left: 0,
        right: 500,
        width: 500,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const target = document.createElement('div');
      target.getBoundingClientRect = () => ({
        top: 20,
        bottom: 60,
        left: 10,
        right: 490,
        width: 480,
        height: 40,
        x: 10,
        y: 20,
        toJSON: () => {},
      });

      container.appendChild(target);
      const scrollToMock = vi.fn();
      container.scrollTo = scrollToMock;

      const finalTop = centerElementInContainer(container, target, 'smooth');
      expect(finalTop).toBe(0);
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 0,
        behavior: 'smooth',
      });
    });

    it('clamps the centered scroll position to maximum scroll offset', () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      container.scrollTop = 500;

      container.getBoundingClientRect = () => ({
        top: 0,
        bottom: 400,
        left: 0,
        right: 400,
        width: 400,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Target at deep bottom
      const target = document.createElement('div');
      target.getBoundingClientRect = () => ({
        top: 950,
        bottom: 1000,
        left: 10,
        right: 390,
        width: 380,
        height: 50,
        x: 10,
        y: 950,
        toJSON: () => {},
      });

      container.appendChild(target);
      const scrollToMock = vi.fn();
      container.scrollTo = scrollToMock;

      // Max scroll: 1000 - 400 = 600
      const finalTop = centerElementInContainer(container, target, 'smooth');
      expect(finalTop).toBe(600);
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 600,
        behavior: 'smooth',
      });
    });

    it('falls back to scrollTop assignment when scrollTo is not available', () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      container.scrollTop = 0;
      delete (container as any).scrollTo;

      container.getBoundingClientRect = () => ({
        top: 0,
        bottom: 400,
        left: 0,
        right: 400,
        width: 400,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const target = document.createElement('div');
      target.getBoundingClientRect = () => ({
        top: 300,
        bottom: 400,
        left: 0,
        right: 400,
        width: 400,
        height: 100,
        x: 0,
        y: 300,
        toJSON: () => {},
      });

      const finalTop = centerElementInContainer(container, target);
      // relativeTargetTop: 300 + 0 = 300. centeredTop: 300 - 200 + 50 = 150.
      expect(finalTop).toBe(150);
      expect(container.scrollTop).toBe(150);
    });
  });

  describe('findSearchContentElement Detection Priority', () => {
    it('prioritizes search source citations when present', () => {
      const container = document.createElement('div');
      
      const stepTrace = document.createElement('div');
      stepTrace.setAttribute('data-search-content', 'true');
      stepTrace.setAttribute('data-search-trace', 'true');
      container.appendChild(stepTrace);

      const citations = document.createElement('div');
      citations.setAttribute('data-testid', 'search-citations');
      citations.className = 'search-content-result';
      container.appendChild(citations);

      const found = findSearchContentElement(container);
      expect(found).toBe(citations);
    });

    it('finds search result visual card if citations are absent', () => {
      const container = document.createElement('div');

      const searchStep = document.createElement('div');
      searchStep.setAttribute('data-search-step', 'true');
      container.appendChild(searchStep);

      const resultCard = document.createElement('div');
      resultCard.setAttribute('data-testid', 'task-result-content');
      container.appendChild(resultCard);

      const found = findSearchContentElement(container);
      expect(found).toBe(resultCard);
    });

    it('finds search step or trace items when no card or citations exist', () => {
      const container = document.createElement('div');

      const regularMsg = document.createElement('div');
      container.appendChild(regularMsg);

      const searchTrace = document.createElement('div');
      searchTrace.setAttribute('data-search-trace', 'true');
      searchTrace.setAttribute('data-search-content', 'true');
      container.appendChild(searchTrace);

      const found = findSearchContentElement(container);
      expect(found).toBe(searchTrace);
    });

    it('finds assistant search message when tagged', () => {
      const container = document.createElement('div');

      const searchMsg = document.createElement('div');
      searchMsg.setAttribute('data-search-message', 'true');
      searchMsg.textContent = 'Found the latest information from web sources...';
      container.appendChild(searchMsg);

      const found = findSearchContentElement(container);
      expect(found).toBe(searchMsg);
    });

    it('returns null if no search elements exist in container', () => {
      const container = document.createElement('div');
      const plainDiv = document.createElement('div');
      plainDiv.textContent = 'Hello world';
      container.appendChild(plainDiv);

      const found = findSearchContentElement(container);
      expect(found).toBeNull();
    });
  });

  describe('Settings Integration for autoScrollToResults', () => {
    it('defaults autoScrollToResults to true in DEFAULT_SETTINGS and getSettings()', () => {
      expect(DEFAULT_SETTINGS.autoScrollToResults).toBe(true);
      const settings = getSettings();
      expect(settings.autoScrollToResults).toBe(true);
    });

    it('persists changes to autoScrollToResults', () => {
      saveSettings({ autoScrollToResults: false });
      expect(getSettings().autoScrollToResults).toBe(false);

      saveSettings({ autoScrollToResults: true });
      expect(getSettings().autoScrollToResults).toBe(true);
    });
  });

  describe('evaluateAutoScrollState Pause & Resume Behavior', () => {
    it('pauses auto-scroll when user scrolls upward to inspect older messages', () => {
      const state = evaluateAutoScrollState({
        scrollTop: 900,
        scrollHeight: 2000,
        clientHeight: 600,
        previousScrollTop: 1200,
        userScrolledUp: false,
      });

      expect(state.shouldAutoScroll).toBe(false);
      expect(state.userScrolledUp).toBe(true);
      expect(state.isAtBottom).toBe(false);
    });

    it('keeps auto-scroll paused while user views older messages even on small downward adjustments', () => {
      const state = evaluateAutoScrollState({
        scrollTop: 1050,
        scrollHeight: 2000,
        clientHeight: 600,
        previousScrollTop: 1000,
        userScrolledUp: true,
      });

      expect(state.shouldAutoScroll).toBe(false);
      expect(state.userScrolledUp).toBe(true);
      expect(state.isAtBottom).toBe(false);
    });

    it('automatically resumes auto-scroll when user reaches the bottom again', () => {
      const state = evaluateAutoScrollState({
        scrollTop: 1360,
        scrollHeight: 2000,
        clientHeight: 600,
        previousScrollTop: 1100,
        userScrolledUp: true,
      });

      expect(state.isAtBottom).toBe(true);
      expect(state.shouldAutoScroll).toBe(true);
      expect(state.userScrolledUp).toBe(false);
    });
  });

  describe('Contextual Thinking Stage Pipeline', () => {
    it('builds multi-stage thinking pipeline with image inspection when an image is attached', () => {
      const stages = deriveContextualThinkingStages(
        '[Attached Image: chart.png]\n[IMAGE_DATA_URL:data:image/jpeg;base64,abc]\nWhat does this chart show?',
        true,
        undefined,
        1
      );

      expect(stages.length).toBe(4);
      expect(stages[0].status).toBe('completed');
      expect(stages[1].label).toContain('Inspecting visual content');
      expect(stages[1].status).toBe('running');
      expect(stages[2].label).toContain('Multi-angle chain-of-thought');
      expect(stages[3].status).toBe('pending');
    });
  });

  describe('Show Sources Toggle & Search Query/URL Extraction', () => {
    it('extracts both **Search Queries** and **Sources** blocks from grounded markdown', () => {
      const markdown = `Here is the latest update on NVIDIA Blackwell architecture.\n\n**Search Queries**\n- NVIDIA Blackwell architecture specs\n- NVIDIA GB200 release 2026\n\n**Sources**\n- [NVIDIA Official Blackwell Architecture](https://www.nvidia.com/en-us/data-center/technologies/blackwell-architecture/)\n- [Reuters Technology Report](https://www.reuters.com/technology/nvidia-blackwell/)`;

      const parsed = parseSourcesFromMarkdown(markdown);
      expect(parsed.cleanedContent).toBe('Here is the latest update on NVIDIA Blackwell architecture.');
      expect(parsed.searchQueries).toEqual([
        'NVIDIA Blackwell architecture specs',
        'NVIDIA GB200 release 2026',
      ]);
      expect(parsed.sources).toHaveLength(2);
      expect(parsed.sources[0].domain).toBe('nvidia.com');
      expect(parsed.sources[0].url).toBe('https://www.nvidia.com/en-us/data-center/technologies/blackwell-architecture/');
      expect(parsed.sources[1].domain).toBe('reuters.com');
    });

    it('merges step search traces and synthesizes fallback queries and URLs when needed', () => {
      const parsed = parseSourcesFromMarkdown('NVIDIA designs GPUs and AI accelerators.');
      const resolved = resolveMessageSourcesAndQueries({
        parsed,
        userPrompt: 'Tell me about Nvidia GPUs',
        assistantContent: parsed.cleanedContent,
        steps: [
          {
            label: 'Searching Web',
            trace: [
              'Searching for: Nvidia GPU architecture overview',
              'Fetching: https://developer.nvidia.com/cuda-zone',
            ],
          },
        ],
      });

      expect(resolved.searchQueries).toContain('Nvidia GPU architecture overview');
      expect(resolved.sources.some(s => s.url === 'https://developer.nvidia.com/cuda-zone')).toBe(true);
    });
  });

  describe('Typing Animation Sequence Transitions (lead-in -> typing -> settled)', () => {
    it('starts in lead-in phase when typewriter begins and transitions through typing to settled', () => {
      const leadInState = computeTypingSequenceState({
        totalLength: 120,
        displayedLength: 8,
        animateTypewriter: true,
        inLeadIn: true,
      });
      expect(leadInState.phase).toBe('lead-in');
      expect(leadInState.isComplete).toBe(false);

      const typingState = computeTypingSequenceState({
        totalLength: 120,
        displayedLength: 60,
        animateTypewriter: true,
        inLeadIn: false,
      });
      expect(typingState.phase).toBe('typing');
      expect(typingState.progress).toBeCloseTo(0.5);
      expect(typingState.isComplete).toBe(false);

      const settledState = computeTypingSequenceState({
        totalLength: 120,
        displayedLength: 120,
        animateTypewriter: true,
        inLeadIn: false,
      });
      expect(settledState.phase).toBe('settled');
      expect(settledState.progress).toBe(1);
      expect(settledState.isComplete).toBe(true);
    });
  });
});
