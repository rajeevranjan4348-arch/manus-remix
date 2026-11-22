import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/lib/firebaseAuthorization', () => ({
  getFirebaseAuthorizationHeader: vi.fn().mockResolvedValue(null),
}));
import { getFirebaseAuthorizationHeader } from '../src/lib/firebaseAuthorization';
import {
  classifyTaskTags,
  normalizeClientTaskTags,
  getStoredSessionTags,
  saveSessionTags,
  removeSessionTags,
  resolveTaskTags,
  analyzeTaskTagsWithGemini,
  autoTagSessionBatch,
  tagTaskAfterCompletion,
  getAvailableTags,
  SESSION_TAGS_STORAGE_KEY,
} from '../src/lib/taskTaggingService';
import { tagTaskWithAI, processTaskTags } from '../src/services/taskTagger';
import {
  normalizeTaskCategories,
  classifySessionCategoriesFallback,
  categorizeSessionWithGemini,
} from '../server/geminiService';
import { filterTasks, TaskHistoryItem } from '../src/components/history/HistoryPanel';

describe('Automated Gemini Session Tagging & HistoryPanel Categorization', () => {
  const storageMap = new Map<string, string>();

  beforeEach(() => {
    storageMap.clear();
    const mockLocalStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, val: string) => storageMap.set(key, val),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
    };

    vi.stubGlobal('window', {
      localStorage: mockLocalStorage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.restoreAllMocks();
    vi.mocked(getFirebaseAuthorizationHeader).mockResolvedValue(null);
  });

  describe('Server-side Gemini categorization service', () => {
    it('normalizes raw Gemini category responses and synonyms into canonical categories', () => {
      expect(normalizeTaskCategories(['coding', 'programming'])).toEqual(['Coding']);
      expect(normalizeTaskCategories(['Research', 'Writing', 'General'])).toEqual(['Research', 'Writing']);
      expect(normalizeTaskCategories(['copywriting', 'ui'])).toEqual(['Writing', 'Design']);
      expect(normalizeTaskCategories(['unknown_category'], 'Write a blog post about AI')).toEqual(['Writing']);
    });

    it('accurately categorizes Research, Coding, Writing, Analysis, Design, and Automation tasks', () => {
      expect(
        classifySessionCategoriesFallback(
          'Research the latest peer-reviewed articles and citations on quantum computing'
        )
      ).toContain('Research');

      expect(
        classifySessionCategoriesFallback(
          'Refactor the TypeScript React component and fix the SQL database query bug'
        )
      ).toContain('Coding');

      expect(
        classifySessionCategoriesFallback(
          'Write and proofread a persuasive blog article and email newsletter draft'
        )
      ).toContain('Writing');

      expect(
        classifySessionCategoriesFallback(
          'Analyze the Q4 revenue CSV dataset and plot a statistical forecast chart'
        )
      ).toContain('Analysis');

      expect(
        classifySessionCategoriesFallback(
          'Design a responsive UI layout mockup with custom typography and icon wireframe'
        )
      ).toContain('Design');

      expect(
        classifySessionCategoriesFallback(
          'Automate a Google Calendar and Gmail workspace webhook workflow trigger'
        )
      ).toContain('Automation');
    });

    it('categorizeSessionWithGemini returns valid normalized categories even without an API key', async () => {
      const result = await categorizeSessionWithGemini({
        title: 'Build a TypeScript Express API endpoint',
        prompt: 'Implement a REST API route in Node and TypeScript with unit tests',
        content: '```ts\nexport function handler() {}\n```',
      });

      expect(Array.isArray(result.tags)).toBe(true);
      expect(result.tags).toContain('Coding');
      result.tags.forEach((tag) => {
        expect(getAvailableTags()).toContain(tag);
      });
    });
  });

  describe('Client-side Gemini API tagging & persistence', () => {
    it('persists, retrieves, and removes session tags in localStorage', () => {
      saveSessionTags('session-101', ['Research', 'Writing']);
      const stored = getStoredSessionTags();
      expect(stored['session-101']).toEqual(['Research', 'Writing']);

      removeSessionTags('session-101');
      expect(getStoredSessionTags()['session-101']).toBeUndefined();
    });

    it('calls POST /api/tag-task via analyzeTaskTagsWithGemini and persists returned Gemini categories', async () => {
      vi.mocked(getFirebaseAuthorizationHeader).mockResolvedValue('Bearer test-id-token');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tags: ['Writing', 'Research'],
          source: 'gemini',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const tags = await analyzeTaskTagsWithGemini({
        id: 'task-gemini-1',
        title: 'AI Safety Literature Review',
        prompt: 'Research and draft an executive article on AI alignment papers',
        content: 'Comprehensive review of alignment methodologies...',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('/api/tag-task');
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-id-token');
      expect(tags).toEqual(['Writing', 'Research']);
      expect(getStoredSessionTags()['task-gemini-1']).toEqual(['Writing', 'Research']);
    });

    it('batch categorizes untagged sessions via autoTagSessionBatch and stores results', async () => {
      vi.mocked(getFirebaseAuthorizationHeader).mockResolvedValue('Bearer test-id-token');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: {
            'sess-a': ['Research'],
            'sess-b': ['Coding', 'Design'],
            'sess-c': ['Writing'],
          },
          source: 'gemini-batch',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const results = await autoTagSessionBatch([
        { id: 'sess-a', prompt: 'Investigate latest solar cell efficiency studies' },
        { id: 'sess-b', prompt: 'Build a React UI component with Tailwind CSS' },
        { id: 'sess-c', prompt: 'Draft a press release and blog post' },
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(results['sess-a']).toEqual(['Research']);
      expect(results['sess-b']).toEqual(['Coding', 'Design']);
      expect(results['sess-c']).toEqual(['Writing']);
    });

    it('uses local classification without a protected backend request when signed out', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const tags = await analyzeTaskTagsWithGemini({
        id: 'task-local-1',
        prompt: 'Debug a TypeScript compiler error in a React component',
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(tags).toContain('Coding');
    });

    it('delegates taskTagger.tagTaskWithAI and processTaskTags through the unified Gemini pipeline', async () => {
      vi.mocked(getFirebaseAuthorizationHeader).mockResolvedValue('Bearer test-id-token');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tags: ['Coding'],
          source: 'gemini',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const directTags = await tagTaskWithAI('Write a Python sorting algorithm', 'def quicksort(arr): pass');
      expect(directTags).toEqual(['Coding']);

      const processedTags = await processTaskTags(
        'task-processed-99',
        'Debug TypeScript compiler error',
        'Fixed tsconfig.json types'
      );
      expect(processedTags).toEqual(['Coding']);
      expect(getStoredSessionTags()['task-processed-99']).toEqual(['Coding']);
    });
  });

  describe('HistoryPanel session categorization & filtering integration', () => {
    const sampleTasks: TaskHistoryItem[] = [
      {
        id: 't-research',
        prompt: 'Find and compare recent arXiv papers on transformer architectures',
        title: 'Transformer Architecture Literature Study',
        created_at: new Date().toISOString(),
      },
      {
        id: 't-coding',
        prompt: 'Implement a TypeScript React hook for WebSocket state synchronization',
        title: 'WebSocket Hook Implementation',
        created_at: new Date().toISOString(),
      },
      {
        id: 't-writing',
        prompt: 'Write a 1,500-word essay and newsletter draft on sustainable cities',
        title: 'Sustainable Cities Essay Draft',
        created_at: new Date().toISOString(),
      },
    ];

    it('resolves Gemini-persisted categories for HistoryPanel tasks and filters by tag pill', () => {
      saveSessionTags('t-research', ['Research']);
      saveSessionTags('t-coding', ['Coding']);
      saveSessionTags('t-writing', ['Writing']);

      expect(resolveTaskTags(sampleTasks[0])).toEqual(['Research']);
      expect(resolveTaskTags(sampleTasks[1])).toEqual(['Coding']);
      expect(resolveTaskTags(sampleTasks[2])).toEqual(['Writing']);

      const researchOnly = filterTasks(sampleTasks, '', 'all', undefined, undefined, new Date(), 'Research');
      expect(researchOnly.map((t) => t.id)).toEqual(['t-research']);

      const codingOnly = filterTasks(sampleTasks, '', 'all', undefined, undefined, new Date(), 'Coding');
      expect(codingOnly.map((t) => t.id)).toEqual(['t-coding']);

      const writingOnly = filterTasks(sampleTasks, '', 'all', undefined, undefined, new Date(), 'Writing');
      expect(writingOnly.map((t) => t.id)).toEqual(['t-writing']);
    });

    it('supports searching sessions by their Gemini-assigned category name in HistoryPanel', () => {
      saveSessionTags('t-writing', ['Writing']);
      const matched = filterTasks(sampleTasks, 'writing', 'all', undefined, undefined, new Date(), 'all');
      expect(matched.some((t) => t.id === 't-writing')).toBe(true);
    });
  });
});
