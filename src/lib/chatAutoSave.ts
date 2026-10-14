/**
 * Chat Auto-Save and Recovery Service
 * 
 * Automatically saves the current chat history to localStorage periodically and
 * on page lifecycle events (beforeunload, pagehide) so that active tasks and
 * full conversation histories can be seamlessly resumed after a browser refresh.
 */

export interface SavedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  status?: 'pending' | 'success' | 'failed' | 'streaming';
  data?: any;
  chartData?: any;
}

export interface SavedStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  trace?: string[];
}

export interface ChatHistoryBackup {
  taskId: string;
  currentTask: {
    prompt: string;
    options: any;
    fileData?: string;
    url?: string;
  } | null;
  messages: SavedChatMessage[];
  steps: SavedStep[];
  taskStatus: 'idle' | 'running' | 'completed' | 'error';
  phase?: string;
  result?: any;
  chartData?: any;
  savedAt: number; // Unix timestamp ms
  version: number;
}

const STORAGE_PREFIX = 'manus_chat_history_backup_';
const ACTIVE_BACKUP_KEY = 'manus_active_chat_backup';
const LAST_ACTIVE_TASK_ID_KEY = 'manus_last_active_task_id';
const BACKUP_INDEX_KEY = 'manus_chat_backup_index';
const CURRENT_VERSION = 1;
const MAX_BACKUP_ENTRIES = 20;

/**
 * Get the list of task IDs that currently have backups saved in localStorage
 */
export function getSavedTaskIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BACKUP_INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Fallback: scan keys in localStorage
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        ids.push(key.slice(STORAGE_PREFIX.length));
      }
    }
  } catch {}
  return ids;
}

/**
 * Register a taskId in the backup index
 */
function recordTaskIdInIndex(taskId: string) {
  if (typeof localStorage === 'undefined' || !taskId) return;
  try {
    const ids = getSavedTaskIds().filter(id => id !== taskId);
    ids.unshift(taskId);
    if (ids.length > MAX_BACKUP_ENTRIES) {
      const toRemove = ids.slice(MAX_BACKUP_ENTRIES);
      toRemove.forEach(id => {
        try {
          localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
        } catch {}
      });
      ids.splice(MAX_BACKUP_ENTRIES);
    }
    localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(ids));
  } catch {}
}

/**
 * Remove oldest backups if localStorage quota is exceeded
 */
export function pruneOldChatBackups(keepLimit = 10) {
  if (typeof localStorage === 'undefined') return;
  try {
    const ids = getSavedTaskIds();
    if (ids.length <= keepLimit) return;

    const toRemove = ids.slice(keepLimit);
    toRemove.forEach(id => {
      try {
        localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
      } catch {}
    });

    const kept = ids.slice(0, keepLimit);
    localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(kept));
  } catch (err) {
    console.warn('[ChatAutoSave] Error during backup pruning:', err);
  }
}

/**
 * Save chat history snapshot to localStorage for a specific task
 */
export function saveChatHistoryToLocalStorage(params: {
  taskId: string;
  currentTask: { prompt: string; options: any; fileData?: string; url?: string } | null;
  messages: any[];
  steps?: SavedStep[];
  taskStatus?: 'idle' | 'running' | 'completed' | 'error';
  phase?: string;
  result?: any;
  chartData?: any;
}): boolean {
  if (typeof localStorage === 'undefined' || !params.taskId) return false;

  try {
    // Sanitize messages to avoid circular structures or oversized transient objects
    const sanitizedMessages: SavedChatMessage[] = (params.messages || []).map((m: any, index: number) => ({
      id: m.id || `msg_${Date.now()}_${index}`,
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : String(m.content || ''),
      timestamp: m.timestamp || new Date().toISOString(),
      status: m.status || 'success',
      data: m.data,
      chartData: m.chartData,
    }));

    const sanitizedSteps: SavedStep[] = (params.steps || []).map((s: any, idx: number) => ({
      id: s.id || String(idx + 1),
      label: s.label || 'Step',
      status: s.status || 'completed',
      trace: Array.isArray(s.trace) ? s.trace.slice(-10) : undefined,
    }));

    const backup: ChatHistoryBackup = {
      taskId: params.taskId,
      currentTask: params.currentTask,
      messages: sanitizedMessages,
      steps: sanitizedSteps,
      taskStatus: params.taskStatus || 'idle',
      phase: params.phase,
      result: params.result || null,
      chartData: params.chartData || null,
      savedAt: Date.now(),
      version: CURRENT_VERSION,
    };

    const payload = JSON.stringify(backup);
    const key = `${STORAGE_PREFIX}${params.taskId}`;

    try {
      localStorage.setItem(key, payload);
      localStorage.setItem(ACTIVE_BACKUP_KEY, payload);
      localStorage.setItem(LAST_ACTIVE_TASK_ID_KEY, params.taskId);
      recordTaskIdInIndex(params.taskId);
      return true;
    } catch (writeErr: any) {
      // If quota exceeded, prune older backups and retry once
      if (writeErr?.name === 'QuotaExceededError' || writeErr?.code === 22) {
        pruneOldChatBackups(8);
        localStorage.setItem(key, payload);
        localStorage.setItem(ACTIVE_BACKUP_KEY, payload);
        return true;
      }
      throw writeErr;
    }
  } catch (err) {
    console.warn('[ChatAutoSave] Failed to save chat history to localStorage:', err);
    return false;
  }
}

/**
 * Retrieve chat history backup for a specific taskId
 */
export function getChatHistoryFromLocalStorage(taskId: string): ChatHistoryBackup | null {
  if (typeof localStorage === 'undefined' || !taskId) return null;

  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${taskId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatHistoryBackup;
      if (parsed && parsed.taskId === taskId) {
        return parsed;
      }
    }

    // Fallback: Check if active backup matches this taskId
    const activeRaw = localStorage.getItem(ACTIVE_BACKUP_KEY);
    if (activeRaw) {
      const activeParsed = JSON.parse(activeRaw) as ChatHistoryBackup;
      if (activeParsed && activeParsed.taskId === taskId) {
        return activeParsed;
      }
    }
  } catch (err) {
    console.warn(`[ChatAutoSave] Failed to read backup for task ${taskId}:`, err);
  }

  return null;
}

/**
 * Retrieve the active chat history backup (most recent active session)
 */
export function getActiveChatHistoryFromLocalStorage(): ChatHistoryBackup | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const activeRaw = localStorage.getItem(ACTIVE_BACKUP_KEY);
    if (activeRaw) {
      const activeParsed = JSON.parse(activeRaw) as ChatHistoryBackup;
      if (activeParsed && activeParsed.taskId) {
        return activeParsed;
      }
    }

    const lastId = localStorage.getItem(LAST_ACTIVE_TASK_ID_KEY);
    if (lastId) {
      return getChatHistoryFromLocalStorage(lastId);
    }
  } catch (err) {
    console.warn('[ChatAutoSave] Failed to read active chat backup:', err);
  }

  return null;
}

/**
 * Delete chat history backup for a specific task
 */
export function clearChatHistoryBackup(taskId: string): void {
  if (typeof localStorage === 'undefined' || !taskId) return;

  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${taskId}`);
    const active = getActiveChatHistoryFromLocalStorage();
    if (active?.taskId === taskId) {
      localStorage.removeItem(ACTIVE_BACKUP_KEY);
      localStorage.removeItem(LAST_ACTIVE_TASK_ID_KEY);
    }
    const ids = getSavedTaskIds().filter(id => id !== taskId);
    localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn(`[ChatAutoSave] Failed to clear backup for task ${taskId}:`, err);
  }
}

/**
 * Clear the active chat history backup
 */
export function clearActiveChatHistoryBackup(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE_BACKUP_KEY);
    localStorage.removeItem(LAST_ACTIVE_TASK_ID_KEY);
  } catch {}
}

/**
 * Reconciles two lists of chat messages (e.g. from local storage and remote DB/IndexedDB).
 * Preserves message ordering, deduplicates identical IDs, and updates status if newer.
 */
export function reconcileChatMessages(primary: any[], secondary: any[]): any[] {
  const map = new Map<string, any>();

  // Add primary messages
  for (const m of primary || []) {
    if (!m) continue;
    const id = m.id || `temp_${m.role}_${m.content?.slice(0, 20)}`;
    map.set(id, { ...m, id });
  }

  // Merge secondary messages without blowing away fresher content
  for (const m of secondary || []) {
    if (!m) continue;
    const id = m.id || `temp_${m.role}_${m.content?.slice(0, 20)}`;
    if (map.has(id)) {
      const existing = map.get(id);
      // If incoming secondary has more content or success status, prefer it
      if (
        (m.content && m.content.length > (existing.content?.length || 0)) ||
        (m.status === 'success' && existing.status !== 'success')
      ) {
        map.set(id, { ...existing, ...m });
      }
    } else {
      map.set(id, { ...m, id });
    }
  }

  return Array.from(map.values());
}
