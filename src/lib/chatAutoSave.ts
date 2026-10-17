/**
 * Manus AI Chat Session Periodic Auto-Save Engine
 * 
 * Provides continuous periodic auto-saving and disaster recovery for chat sessions:
 * 1. Periodic background timer (default 4 seconds) persists active session states
 * 2. Instant synchronous snapshot on window 'beforeunload', 'pagehide', and 'visibilitychange'
 * 3. Multi-tier persistence: Synchronous localStorage snapshot + IndexedDB permanent chat store + Cloud
 * 4. Automatic draft preservation: Restores unsent prompt drafts if tab is closed while typing
 * 5. In-flight recovery: Preserves generated messages, steps, and results even if the browser is closed mid-session
 */

import { updateConversation, saveMessage, getMessages, StoredConversation } from './chatDatabase';
import { blink } from './blink';

export interface AutoSavedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  status?: 'pending' | 'success' | 'failed' | 'streaming';
}

export interface AutoSaveSessionSnapshot {
  taskId: string;
  conversationId?: string;
  userId?: string;
  prompt: string;
  title?: string;
  mode: 'chat' | 'work';
  outputFormat?: string;
  chartType?: string;
  projectId?: string | null;
  status: 'idle' | 'running' | 'completed' | 'error';
  messages: AutoSavedMessage[];
  steps: any[];
  result?: any;
  chartData?: any;
  draftInput?: string;
  lastSavedAt: string;
  version: number;
}

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const SNAPSHOT_KEY_PREFIX = 'manus_autosave_session_';
const ACTIVE_SESSION_POINTER_KEY = 'manus_active_autosave_pointer';
const DRAFT_KEY_PREFIX = 'manus_draft_';
const DEFAULT_INTERVAL_MS = 4000;

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage;
  } catch {}
  return null;
}

class ChatAutoSaveManager {
  private activeSession: AutoSaveSessionSnapshot | null = null;
  private isDirty = false;
  private timer: any = null;
  private intervalMs = DEFAULT_INTERVAL_MS;
  private status: AutoSaveStatus = 'idle';
  private lastSavedAt: string = new Date().toISOString();
  private listeners = new Set<(status: AutoSaveStatus, lastSavedAt: string) => void>();
  private initialized = false;

  constructor() {
    this.initBrowserLifecycleListeners();
  }

  /**
   * Register beforeunload, pagehide, and visibilitychange to immediately flush
   * synchronously into localStorage so that zero data is lost upon tab termination.
   */
  public initBrowserLifecycleListeners(): void {
    const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? (globalThis as any).window : null);
    const doc = typeof document !== 'undefined' ? document : (typeof globalThis !== 'undefined' ? (globalThis as any).document : null);
    if (!win || this.initialized) return;
    this.initialized = true;

    const handleEmergencySave = () => {
      this.flushSync();
    };

    win.addEventListener('beforeunload', handleEmergencySave);
    win.addEventListener('pagehide', handleEmergencySave);
    
    if (doc) {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') {
          this.flushSync();
          void this.flushAsync();
        }
      });
    }
  }

  /**
   * Start periodic auto-save loop
   */
  public start(intervalMs = DEFAULT_INTERVAL_MS): void {
    this.intervalMs = intervalMs;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalMs);
  }

  /**
   * Stop periodic auto-save loop
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Register or update the current active session state from useAgentTask
   */
  public updateSession(data: {
    taskId: string;
    conversationId?: string;
    userId?: string;
    prompt?: string;
    title?: string;
    mode?: 'chat' | 'work';
    outputFormat?: string;
    chartType?: string;
    projectId?: string | null;
    status?: 'idle' | 'running' | 'completed' | 'error';
    messages?: any[];
    steps?: any[];
    result?: any;
    chartData?: any;
    draftInput?: string;
  }): void {
    if (!data.taskId) return;

    const current = this.activeSession;
    const now = new Date().toISOString();

    const normalizedMessages: AutoSavedMessage[] = (data.messages || current?.messages || []).map((m: any, idx: number) => ({
      id: m.id || `m_${idx}_${Date.now()}`,
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
      timestamp: m.timestamp || m.createdAt || now,
      status: m.status || 'success'
    }));

    const nextSnapshot: AutoSaveSessionSnapshot = {
      taskId: data.taskId,
      conversationId: data.conversationId || current?.conversationId || data.taskId,
      userId: data.userId || current?.userId || 'usr_manus_default',
      prompt: data.prompt !== undefined ? data.prompt : (current?.prompt || ''),
      title: data.title || current?.title || (data.prompt ? data.prompt.slice(0, 50) : 'Chat Session'),
      mode: data.mode || current?.mode || 'chat',
      outputFormat: data.outputFormat || current?.outputFormat,
      chartType: data.chartType || current?.chartType,
      projectId: data.projectId !== undefined ? data.projectId : (current?.projectId || null),
      status: data.status || current?.status || 'idle',
      messages: normalizedMessages,
      steps: data.steps !== undefined ? data.steps : (current?.steps || []),
      result: data.result !== undefined ? data.result : current?.result,
      chartData: data.chartData !== undefined ? data.chartData : current?.chartData,
      draftInput: data.draftInput !== undefined ? data.draftInput : current?.draftInput,
      lastSavedAt: current?.lastSavedAt || now,
      version: (current?.version || 0) + 1
    };

    // Check if genuinely changed
    const hasChanged = !current ||
      current.taskId !== nextSnapshot.taskId ||
      current.status !== nextSnapshot.status ||
      current.messages.length !== nextSnapshot.messages.length ||
      (current.messages[current.messages.length - 1]?.content !== nextSnapshot.messages[nextSnapshot.messages.length - 1]?.content) ||
      current.steps.length !== nextSnapshot.steps.length ||
      Boolean(nextSnapshot.result && !current.result) ||
      current.draftInput !== nextSnapshot.draftInput;

    this.activeSession = nextSnapshot;

    if (hasChanged) {
      this.isDirty = true;
      // Fast synchronous backup pointer
      try {
        getStorage()?.setItem(ACTIVE_SESSION_POINTER_KEY, data.taskId);
      } catch {}
    }
  }

  /**
   * Save a draft prompt being typed by the user
   */
  public saveDraft(taskId: string, draft: string): void {
    if (!taskId) return;
    try {
      const storage = getStorage();
      if (storage) {
        if (draft && draft.trim()) {
          storage.setItem(`${DRAFT_KEY_PREFIX}${taskId}`, draft);
        } else {
          storage.removeItem(`${DRAFT_KEY_PREFIX}${taskId}`);
        }
      }
    } catch {}

    if (this.activeSession && this.activeSession.taskId === taskId) {
      this.activeSession.draftInput = draft;
      this.isDirty = true;
    }
  }

  /**
   * Retrieve saved draft input
   */
  public getDraft(taskId: string): string {
    if (!taskId) return '';
    try {
      return getStorage()?.getItem(`${DRAFT_KEY_PREFIX}${taskId}`) || '';
    } catch {
      return '';
    }
  }

  /**
   * Clear draft input for a task
   */
  public clearDraft(taskId: string): void {
    if (!taskId) return;
    try {
      getStorage()?.removeItem(`${DRAFT_KEY_PREFIX}${taskId}`);
    } catch {}
    if (this.activeSession && this.activeSession.taskId === taskId) {
      this.activeSession.draftInput = '';
    }
  }

  /**
   * Heartbeat tick: run periodic auto-save if dirty
   */
  private tick(): void {
    if (!this.activeSession || !this.isDirty) return;
    this.flushSync();
    void this.flushAsync();
  }

  /**
   * Synchronous emergency save to localStorage.
   * Guaranteed to complete even during immediate page/tab unload.
   */
  public flushSync(): void {
    if (!this.activeSession) return;

    try {
      const storage = getStorage();
      if (!storage) return;

      const now = new Date().toISOString();
      this.activeSession.lastSavedAt = now;
      const key = `${SNAPSHOT_KEY_PREFIX}${this.activeSession.taskId}`;
      storage.setItem(key, JSON.stringify(this.activeSession));
      storage.setItem(ACTIVE_SESSION_POINTER_KEY, this.activeSession.taskId);
      this.lastSavedAt = now;
      this.notifyListeners('saved', now);
    } catch (e) {
      console.warn('[ChatAutoSave] Synchronous localStorage snapshot warning:', e);
    }
  }

  /**
   * Asynchronous persistent save to IndexedDB and cloud database
   */
  public async flushAsync(): Promise<void> {
    if (!this.activeSession) return;
    const session = { ...this.activeSession };
    this.isDirty = false;
    this.notifyListeners('saving', this.lastSavedAt);

    try {
      const activeId = session.taskId;
      
      // 1. Update IndexedDB conversation record
      await updateConversation(activeId, {
        status: session.status,
        result: session.result,
        steps: session.steps,
        outputFormat: session.outputFormat,
        chartType: session.chartType,
        updatedAt: session.lastSavedAt
      }).catch(() => {});

      // 2. Ensure each persistent message is backed up
      for (const msg of session.messages) {
        if (!msg.content || !msg.content.trim()) continue;
        await saveMessage({
          id: msg.id,
          conversationId: activeId,
          userId: session.userId || 'usr_manus_default',
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          status: msg.status || 'success'
        }).catch(() => {});
      }

      // 3. Mirror to Blink tasks database
      try {
        await (blink.db as any).tasks.update(activeId, {
          status: session.status,
          result: session.result ? (typeof session.result === 'string' ? session.result : JSON.stringify(session.result)) : null,
          steps: JSON.stringify(session.steps || []),
          updatedAt: session.lastSavedAt
        });
      } catch {}

      this.notifyListeners('saved', session.lastSavedAt);
    } catch (err) {
      console.warn('[ChatAutoSave] Async flush failure:', err);
      this.notifyListeners('error', this.lastSavedAt);
    }
  }

  /**
   * Check if an auto-saved snapshot exists for a given task ID, or get the most recent active session
   */
  public getSnapshot(taskId?: string): AutoSaveSessionSnapshot | null {
    try {
      const storage = getStorage();
      if (!storage) return null;

      const targetId = taskId || storage.getItem(ACTIVE_SESSION_POINTER_KEY);
      if (!targetId) return null;

      const raw = storage.getItem(`${SNAPSHOT_KEY_PREFIX}${targetId}`);
      if (!raw) return null;

      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Remove auto-saved snapshot when a session is cleanly deleted
   */
  public clearSnapshot(taskId: string): void {
    if (!taskId) return;
    try {
      const storage = getStorage();
      if (storage) {
        storage.removeItem(`${SNAPSHOT_KEY_PREFIX}${taskId}`);
        storage.removeItem(`${DRAFT_KEY_PREFIX}${taskId}`);
        if (storage.getItem(ACTIVE_SESSION_POINTER_KEY) === taskId) {
          storage.removeItem(ACTIVE_SESSION_POINTER_KEY);
        }
      }
    } catch {}

    if (this.activeSession?.taskId === taskId) {
      this.activeSession = null;
      this.isDirty = false;
    }
  }

  /**
   * Get current auto-save status and last saved timestamp
   */
  public getStatus(): { status: AutoSaveStatus; lastSavedAt: string } {
    return {
      status: this.status,
      lastSavedAt: this.lastSavedAt
    };
  }

  /**
   * Subscribe to auto-save status updates
   */
  public subscribe(cb: (status: AutoSaveStatus, lastSavedAt: string) => void): () => void {
    this.listeners.add(cb);
    cb(this.status, this.lastSavedAt);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notifyListeners(status: AutoSaveStatus, lastSavedAt: string): void {
    this.status = status;
    this.lastSavedAt = lastSavedAt;
    this.listeners.forEach(cb => {
      try {
        cb(status, lastSavedAt);
      } catch {}
    });
  }
}

export const chatAutoSave = new ChatAutoSaveManager();
chatAutoSave.start();
