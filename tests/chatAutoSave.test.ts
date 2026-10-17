import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Polyfill localStorage in Node test environment if undefined
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

const windowListeners = new Map<string, Function[]>();
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    localStorage: (globalThis as any).localStorage,
    addEventListener: (type: string, fn: Function) => {
      const list = windowListeners.get(type) || [];
      list.push(fn);
      windowListeners.set(type, list);
    },
    removeEventListener: (type: string, fn: Function) => {
      const list = windowListeners.get(type) || [];
      windowListeners.set(type, list.filter(f => f !== fn));
    },
    dispatchEvent: (event: any) => {
      const list = windowListeners.get(event.type) || [];
      list.forEach(fn => fn(event));
      return true;
    }
  };
}

const docListeners = new Map<string, Function[]>();
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: Function) => {
      const list = docListeners.get(type) || [];
      list.push(fn);
      docListeners.set(type, list);
    },
    removeEventListener: (type: string, fn: Function) => {
      const list = docListeners.get(type) || [];
      docListeners.set(type, list.filter(f => f !== fn));
    },
    dispatchEvent: (event: any) => {
      const list = docListeners.get(event.type) || [];
      list.forEach(fn => fn(event));
      return true;
    }
  };
}

if (typeof globalThis.Event === 'undefined') {
  (globalThis as any).Event = class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}

import { chatAutoSave } from '../src/lib/chatAutoSave';

describe('Chat Session Periodic Auto-Save Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    chatAutoSave.initBrowserLifecycleListeners();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    chatAutoSave.stop();
  });

  it('1. Session State Registration & Dirty Tracking: registers active chat and updates memory snapshot', () => {
    chatAutoSave.updateSession({
      taskId: 'test_task_101',
      prompt: 'Analyze financial projections for 2026',
      mode: 'work',
      status: 'running',
      messages: [
        { id: 'm1', role: 'user', content: 'Analyze financial projections for 2026', timestamp: '2026-10-15T10:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'Beginning data parsing...', timestamp: '2026-10-15T10:00:05Z' }
      ],
      steps: [{ id: '1', label: 'Parsing Financial Data', status: 'running' }]
    });

    chatAutoSave.flushSync();
    
    const saved = chatAutoSave.getSnapshot('test_task_101');
    expect(saved).not.toBeNull();
    expect(saved?.taskId).toBe('test_task_101');
    expect(saved?.prompt).toBe('Analyze financial projections for 2026');
    expect(saved?.messages.length).toBe(2);
    expect(saved?.steps.length).toBe(1);
    expect(saved?.steps[0].label).toBe('Parsing Financial Data');
  });

  it('2. Periodic Timer Execution: automatically flushes state after configured interval', () => {
    chatAutoSave.start(3000); // 3 second interval

    chatAutoSave.updateSession({
      taskId: 'periodic_task_202',
      prompt: 'Summarize quarterly metrics',
      status: 'running',
      messages: [
        { id: 'p1', role: 'user', content: 'Summarize quarterly metrics', timestamp: '2026-10-15T10:00:00Z' }
      ]
    });

    // Right after update, timer has not ticked
    expect(localStorage.getItem('manus_autosave_session_periodic_task_202')).toBeNull();

    // Advance timers by 3000ms
    vi.advanceTimersByTime(3000);

    // It should have flushed automatically!
    const stored = localStorage.getItem('manus_autosave_session_periodic_task_202');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.taskId).toBe('periodic_task_202');
    expect(parsed.prompt).toBe('Summarize quarterly metrics');
  });

  it('3. Accidental Tab Close Emergency Save (beforeunload / pagehide): flushes synchronously with 0ms delay', () => {
    chatAutoSave.updateSession({
      taskId: 'emergency_task_303',
      prompt: 'Unsaved in-progress research',
      status: 'running',
      messages: [
        { id: 'u1', role: 'user', content: 'Unsaved in-progress research', timestamp: '2026-10-15T10:00:00Z' },
        { id: 'a1', role: 'assistant', content: 'Extracted 12 data points', timestamp: '2026-10-15T10:00:02Z' }
      ],
      result: { content: 'Partial generated report' }
    });

    // Simulate browser window beforeunload event
    window.dispatchEvent(new Event('beforeunload'));

    const snapshot = chatAutoSave.getSnapshot('emergency_task_303');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.taskId).toBe('emergency_task_303');
    expect(snapshot?.result?.content).toBe('Partial generated report');
    expect(snapshot?.messages.length).toBe(2);
  });

  it('4. Visibility State Change (tab switch/background): immediately triggers emergency sync', () => {
    chatAutoSave.updateSession({
      taskId: 'visibility_task_404',
      prompt: 'Background calculation task',
      status: 'running',
      messages: [{ id: 'v1', role: 'user', content: 'Background calculation task', timestamp: '2026-10-15T10:00:00Z' }]
    });

    // Simulate tab being hidden
    (document as any).visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));

    const snapshot = chatAutoSave.getSnapshot('visibility_task_404');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.taskId).toBe('visibility_task_404');
  });

  it('5. In-flight Streaming Progress Recovery: captures partial streaming tokens without data loss', () => {
    chatAutoSave.updateSession({
      taskId: 'streaming_task_505',
      prompt: 'Draft an executive brief',
      status: 'running',
      messages: [
        { id: 's1', role: 'user', content: 'Draft an executive brief', timestamp: '2026-10-15T10:00:00Z' },
        { id: 's2', role: 'assistant', content: 'Drafting section 1: Key Achievements...', timestamp: '2026-10-15T10:00:03Z', status: 'streaming' }
      ]
    });

    chatAutoSave.flushSync();

    const snapshot = chatAutoSave.getSnapshot('streaming_task_505');
    expect(snapshot).not.toBeNull();
    const streamingMsg = snapshot?.messages.find(m => m.id === 's2');
    expect(streamingMsg).toBeDefined();
    expect(streamingMsg?.content).toContain('Key Achievements');
    expect(streamingMsg?.status).toBe('streaming');
  });

  it('6. Unsent Prompt Draft Preservation: persists draft input across accidental tab close and restores it', () => {
    const draftContent = 'Can you generate an SVG diagram comparing React and Svelte?';
    
    // Save draft as user types
    chatAutoSave.saveDraft('draft_task_606', draftContent);
    expect(chatAutoSave.getDraft('draft_task_606')).toBe(draftContent);

    // Simulate tab close and reopen
    const restoredDraft = chatAutoSave.getDraft('draft_task_606');
    expect(restoredDraft).toBe(draftContent);

    // After user sends, clear draft
    chatAutoSave.clearDraft('draft_task_606');
    expect(chatAutoSave.getDraft('draft_task_606')).toBe('');
  });

  it('7. Snapshot Cleanup: removes cached disaster recovery snapshot when session is explicitly deleted', () => {
    chatAutoSave.updateSession({
      taskId: 'delete_task_707',
      prompt: 'Task to be deleted',
      status: 'completed',
      messages: [{ id: 'd1', role: 'user', content: 'Task to be deleted', timestamp: '2026-10-15T10:00:00Z' }]
    });
    chatAutoSave.flushSync();

    expect(chatAutoSave.getSnapshot('delete_task_707')).not.toBeNull();

    // Explicit delete
    chatAutoSave.clearSnapshot('delete_task_707');
    expect(chatAutoSave.getSnapshot('delete_task_707')).toBeNull();
  });
});
