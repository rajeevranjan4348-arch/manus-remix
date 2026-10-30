import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeOneSentenceSummary,
  getStoredSessionSummaries,
  saveSessionSummary,
  removeSessionSummary,
  generateSessionSummary,
} from '../src/lib/sessionSummaryService';
import {
  formatSingleSentenceSummary,
  summarizeSessionHistory,
} from '../server/geminiService';
import { filterTasks, TaskHistoryItem } from '../src/components/history/HistoryPanel';
import fs from 'fs';
import path from 'path';

describe('Session Summary Feature (HistoryPanel & Gemini API)', () => {
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

  it('normalizes generated summaries into a clean one-sentence descriptive summary', () => {
    const raw = 'Summary: The user asked how to optimize React performance and received profiling guidance. A second extra sentence.';
    const result = normalizeOneSentenceSummary(raw, 'Fallback title');
    expect(result).toBe('The user asked how to optimize React performance and received profiling guidance.');
  });

  it('persists, retrieves, and removes session summaries in localStorage', () => {
    saveSessionSummary('session-123', 'Discussed database indexing strategies and query optimization.');
    expect(getStoredSessionSummaries()['session-123']).toBe(
      'Discussed database indexing strategies and query optimization.'
    );

    removeSessionSummary('session-123');
    expect(getStoredSessionSummaries()['session-123']).toBeUndefined();
  });

  it('filters tasks by generated session summary text in filterTasks', () => {
    const tasks: TaskHistoryItem[] = [
      {
        id: 't-1',
        prompt: 'Build a dashboard',
        created_at: new Date().toISOString(),
        summary: 'Created an interactive Kubernetes telemetry dashboard with real-time alerts.',
      },
      {
        id: 't-2',
        prompt: 'Write unit tests',
        created_at: new Date().toISOString(),
        summary: 'Implemented Vitest unit tests for authentication.',
      },
    ];

    const matched = filterTasks(tasks, 'Kubernetes telemetry');
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe('t-1');
  });

  it('calls POST /api/summarize-session and stores the returned summary', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: 'The conversation covered setting up a Vite dev server and fixing TypeScript build errors.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const summary = await generateSessionSummary({
      id: 'task-42',
      title: 'Fix TypeScript build errors',
      messages: [
        { role: 'user', content: 'Help me fix the TypeScript build error in my Vite app.' },
        { role: 'assistant', content: 'Updated the BlobPart type cast and verified the build.' },
      ],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/summarize-session');
    expect(summary).toBe('The conversation covered setting up a Vite dev server and fixing TypeScript build errors.');
    expect(getStoredSessionSummaries()['task-42']).toBe(summary);
  });

  it('formats server-side single sentence summaries and provides fallback when API key is missing', async () => {
    expect(formatSingleSentenceSummary('Built an export dropdown supporting PDF, Markdown, and JSON')).toBe(
      'Built an export dropdown supporting PDF, Markdown, and JSON.'
    );

    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const summary = await summarizeSessionHistory({
        title: 'Add export dropdown to topbar',
        messages: [
          { role: 'user', content: 'Add PDF, Markdown, and JSON export options.' },
          { role: 'assistant', content: 'Implemented ExportChatDropdown in the Topbar.' },
        ],
      });
      expect(summary.endsWith('.')).toBe(true);
      expect(summary.length).toBeGreaterThan(10);
    } finally {
      if (originalKey !== undefined) {
        process.env.GEMINI_API_KEY = originalKey;
      }
    }
  });

  it('renders the Generate Summary button, batch summarize controls, and summary actions in HistoryPanel.tsx', () => {
    const historyPanelPath = path.resolve(__dirname, '../src/components/history/HistoryPanel.tsx');
    const source = fs.readFileSync(historyPanelPath, 'utf-8');

    expect(source).toContain('Generate Summary');
    expect(source).toContain('generate-summary-btn-${task.id}');
    expect(source).toContain('session-summary-${task.id}');
    expect(source).toContain('copy-summary-btn-${task.id}');
    expect(source).toContain('clear-summary-btn-${task.id}');
    expect(source).toContain('summarize-all-sessions-btn');
    expect(source).toContain('summarize-selected-sessions-btn');
    expect(source).toContain('handleGenerateSessionSummary');
  });
});
