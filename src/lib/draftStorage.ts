/**
 * Local storage persistence helper for draft prompt and chat inputs.
 * Ensures unsent prompts and chat inputs are preserved across page reloads and route navigations.
 */

export const DRAFT_STORAGE_KEYS = {
  PROMPT: 'manus_draft_prompt',
  CHAT_INPUT: 'manus_draft_chat_input',
  CHAT_VIEW: 'manus_chat_view_draft_input',
} as const;

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Retrieves the draft prompt for the main chat interface on Home page.
 */
export function getDraftPrompt(): string {
  try {
    const storage = getStorage();
    if (!storage) return '';
    return (
      storage.getItem(DRAFT_STORAGE_KEYS.CHAT_INPUT) ||
      storage.getItem(DRAFT_STORAGE_KEYS.PROMPT) ||
      ''
    );
  } catch {
    return '';
  }
}

/**
 * Saves the draft prompt to local storage. Clears storage if draft is empty.
 */
export function saveDraftPrompt(text: string): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    if (!text || !text.trim()) {
      clearDraftPrompt();
    } else {
      storage.setItem(DRAFT_STORAGE_KEYS.CHAT_INPUT, text);
      storage.setItem(DRAFT_STORAGE_KEYS.PROMPT, text);
    }
  } catch {
    // Handles private browsing, disabled cookies or quota limits
  }
}

/**
 * Clears the draft prompt from local storage upon task creation or user discard.
 */
export function clearDraftPrompt(): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.removeItem(DRAFT_STORAGE_KEYS.CHAT_INPUT);
    storage.removeItem(DRAFT_STORAGE_KEYS.PROMPT);
  } catch {
    // ignore
  }
}

/**
 * Retrieves the draft input for the active task ChatView.
 */
export function getChatViewDraft(sessionId?: string): string {
  try {
    const storage = getStorage();
    if (!storage) return '';
    if (sessionId) {
      const scoped = storage.getItem(`${DRAFT_STORAGE_KEYS.CHAT_VIEW}_${sessionId}`);
      if (scoped) return scoped;
    }
    return storage.getItem(DRAFT_STORAGE_KEYS.CHAT_VIEW) || '';
  } catch {
    return '';
  }
}

/**
 * Saves the active ChatView input draft to local storage.
 */
export function saveChatViewDraft(text: string, sessionId?: string): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const key = sessionId ? `${DRAFT_STORAGE_KEYS.CHAT_VIEW}_${sessionId}` : DRAFT_STORAGE_KEYS.CHAT_VIEW;
    if (!text || !text.trim()) {
      storage.removeItem(key);
      if (sessionId) storage.removeItem(DRAFT_STORAGE_KEYS.CHAT_VIEW);
    } else {
      storage.setItem(key, text);
      storage.setItem(DRAFT_STORAGE_KEYS.CHAT_VIEW, text);
    }
  } catch {
    // ignore
  }
}

/**
 * Clears the active ChatView input draft from local storage upon message submission.
 */
export function clearChatViewDraft(sessionId?: string): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    if (sessionId) {
      storage.removeItem(`${DRAFT_STORAGE_KEYS.CHAT_VIEW}_${sessionId}`);
    }
    storage.removeItem(DRAFT_STORAGE_KEYS.CHAT_VIEW);
  } catch {
    // ignore
  }
}
