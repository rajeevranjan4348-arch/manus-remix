/**
 * Long-Term Memory System for Manus AI
 *
 * Provides durable, user-isolated preferences and facts with full
 * CRUD capability, verified Firestore synchronization, explicit memory
 * intent detection, secret redaction, and relevance retrieval.
 */

import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { securityCenter } from './securityCenter';
import { captureExplicitMemory, clearAgentMemory } from './agentMemory';

export interface MemoryRecord {
  id: string;
  userId: string;
  category: 'preference' | 'fact' | 'instruction' | 'project_context';
  key: string;
  value: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  isEnabled: boolean;
}

export interface MessageMemoryUpdate {
  status: 'saved' | 'failed';
  action: 'save' | 'clear';
  recordId?: string;
  summary?: string;
  error?: string;
  updatedAt: string;
  isFresh?: boolean;
}

export interface ExplicitMemoryIntent {
  matched: boolean;
  action?: 'save' | 'clear';
  category?: MemoryRecord['category'];
  key?: string;
  value?: string;
}

export interface MemoryCaptureResult {
  matched: boolean;
  persisted: boolean;
  action?: 'save' | 'clear';
  record?: MemoryRecord;
  summary?: string;
  error?: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const currentUser = auth?.currentUser;
  return {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
  };
}

function stripInternalMessageWrappers(raw: string): string {
  return raw
    .replace(/\[IMAGE_DATA_URL:[^\]]*\]\s*/gi, '')
    .replace(/\[Attached Image:[^\]]*\]\s*/gi, '')
    .replace(/\[Attached File:[^\]]*\]\s*/gi, '')
    .replace(/\[Think Harder[^\]]*\]\s*/gi, '')
    .replace(/\[MODE:[^\]]*\]\s*/gi, '')
    .replace(/\[Requested connectors:[^\]]*\]\s*/gi, '')
    .trim();
}

const CLEAR_MEMORY_REGEX =
  /\b(forget|clear|delete|erase|reset|wipe)\b[\w\s]{0,20}\b(my\s+)?(saved\s+|long[- ]term\s+)?(memories|memory|preferences)\b/i;

// Exclude ordinary recall/question prompts like "Do you remember who won..." or "Remind me what..."
const QUESTION_RECALL_GUARD_REGEX =
  /^(?:do you|did you|can you|could you|will you)\s+(?:remember|recall)\s+(?:who|what|when|where|why|how|if|whether)\b|^(?:remind me|can you remind me|could you remind me)\s+(?:to|about|what|when|where|how)\b/i;

// Explicit remember / save / reminder / preference patterns
const EXPLICIT_MEMORY_PATTERNS: Array<{
  regex: RegExp;
  category: MemoryRecord['category'];
  stripPrefix: RegExp;
}> = [
  {
    regex:
      /\b(?:please\s+)?(?:always\s+)?remember\s+(?:that|this|one\s+thing(?:\s+is)?|for\s+(?:me|later|future))?\b/i,
    category: 'fact',
    stripPrefix:
      /^(?:please\s+|hey\s+|can you\s+|could you\s+)?(?:always\s+)?remember(?:\s+(?:one\s+thing(?:\s+is)?|this|that|for\s+me|for\s+later))?[\s:,-]*/i,
  },
  {
    regex:
      /^(?:a\s+)?reminder(?:\s+one\s+thing(?:\s+is)?|\s+that|\s*[:,-]|\s+for\s+you)\b|\bremind\s+yourself(?:\s+that)?\b/i,
    category: 'fact',
    stripPrefix:
      /^(?:a\s+)?(?:reminder(?:\s+one\s+thing(?:\s+is)?|\s+that|\s+for\s+you)?|remind\s+yourself(?:\s+that)?)[\s:,-]*/i,
  },
  {
    regex:
      /\b(?:save\s+(?:this|that)\s+(?:to|in)\s+memory|save\s+to\s+memory|add\s+(?:this|that)?\s*to\s+(?:my\s+)?memory|update\s+(?:my\s+)?memory|store\s+(?:this|that)\s+in\s+memory|save\s+this\s+fact|save\s+this)\b/i,
    category: 'fact',
    stripPrefix:
      /^(?:please\s+)?(?:save|add|store|update)(?:\s+(?:this|that))?(?:\s+(?:fact|note|info|information))?(?:\s+(?:to|in)\s+(?:my\s+)?memory)?[\s:,-]*/i,
  },
  {
    regex: /\b(?:keep\s+(?:this\s+)?in\s+mind|don'?t\s+forget|do\s+not\s+forget|note\s+that|note\s+down(?:\s+that)?)\b/i,
    category: 'fact',
    stripPrefix:
      /^(?:please\s+)?(?:keep\s+(?:this\s+)?in\s+mind|don'?t\s+forget|do\s+not\s+forget|note\s+(?:down\s+)?(?:that)?)(?:\s+that)?[\s:,-]*/i,
  },
  {
    regex: /\b(?:my\s+preference\s+is|i\s+prefer\s+(?:that|to|using)|from\s+now\s+on|always\s+(?:call\s+me|address\s+me|use|respond|reply|answer))\b/i,
    category: 'preference',
    stripPrefix: /^(?:please\s+)?(?:my\s+preference\s+is|from\s+now\s+on)[\s:,-]*/i,
  },
];

function deriveMemoryKey(value: string, category: MemoryRecord['category']): string {
  const cleaned = value.trim();

  // Extract natural key from "my favourite X is Y" / "my name is X" / "my favorite X is Y"
  const myAttrMatch = cleaned.match(/^my\s+([a-z][a-z0-9\s'-]{1,36}?)\s+(?:is|are)\s+/i);
  if (myAttrMatch && myAttrMatch[1]) {
    const rawAttr = myAttrMatch[1].trim();
    return rawAttr.charAt(0).toUpperCase() + rawAttr.slice(1);
  }

  const callMeMatch = cleaned.match(/^(?:always\s+)?(?:call|address)\s+me\s+/i);
  if (callMeMatch) {
    return 'Preferred name';
  }

  if (category === 'preference') return 'User preference';
  if (category === 'instruction') return 'User instruction';

  // Concise deterministic key from first few meaningful words (<= 48 chars)
  const words = cleaned.replace(/[^\w\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const candidate = words.join(' ').slice(0, 48);
  return candidate ? candidate.charAt(0).toUpperCase() + candidate.slice(1) : 'Saved memory';
}

/**
 * Deterministically detects whether a user message explicitly asks the AI to
 * remember, save, update, or clear long-term memory.
 */
export function detectExplicitMemoryIntent(rawMessage: string): ExplicitMemoryIntent {
  if (typeof rawMessage !== 'string') return { matched: false };
  const text = stripInternalMessageWrappers(rawMessage).replace(/\s+/g, ' ').trim();
  if (!text || text.length < 4) return { matched: false };

  if (CLEAR_MEMORY_REGEX.test(text)) {
    return { matched: true, action: 'clear' };
  }

  if (QUESTION_RECALL_GUARD_REGEX.test(text)) {
    return { matched: false };
  }

  for (const pattern of EXPLICIT_MEMORY_PATTERNS) {
    if (pattern.regex.test(text)) {
      const stripped = text.replace(pattern.stripPrefix, '').trim();
      const value = (stripped.length >= 2 ? stripped : text).slice(0, 600);
      const isInstruction = /\b(from now on|always\s+(?:use|respond|reply|answer|write|format|speak))\b/i.test(text);
      const category: MemoryRecord['category'] = isInstruction ? 'instruction' : pattern.category;
      const key = deriveMemoryKey(value, category);

      return {
        matched: true,
        action: 'save',
        category,
        key,
        value,
      };
    }
  }

  return { matched: false };
}

const LOCAL_STORAGE_PREFIX = 'manus_long_term_memory_';

class LongTermMemoryService {
  private memoryCache = new Map<string, MemoryRecord[]>();

  private getStorageKey(userId: string): string {
    return `${LOCAL_STORAGE_PREFIX}${encodeURIComponent(userId || 'default')}`;
  }

  /**
   * Load memories for user from local storage and sync with Firestore if authenticated
   */
  public async getMemories(userId: string): Promise<MemoryRecord[]> {
    if (!userId) return [];

    // Check cache
    if (this.memoryCache.has(userId)) {
      return this.memoryCache.get(userId)!;
    }

    let records: MemoryRecord[] = [];

    // 1. Read from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(this.getStorageKey(userId));
        if (raw) {
          records = JSON.parse(raw);
        }
      } catch {}
    }

    // 2. Sync from Firestore if authenticated (bounded with 1200ms timeout so it never stalls AI requests)
    const currentUser = auth?.currentUser;
    if (currentUser && currentUser.uid === userId && !currentUser.isAnonymous) {
      const path = `users/${userId}/settings/memories`;
      try {
        const snap = await Promise.race([
          getDoc(doc(db, 'users', userId, 'settings', 'memories')),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
        if (snap && snap.exists()) {
          const remoteRecords = snap.data()?.records as MemoryRecord[];
          if (Array.isArray(remoteRecords)) {
            records = remoteRecords;
            this.saveLocally(userId, records);
          }
        }
      } catch (e) {
        const errInfo = buildFirestoreErrorInfo(e, OperationType.GET, path);
        console.warn('[LongTermMemory] Firestore sync read notice:', JSON.stringify(errInfo));
      }
    }

    this.memoryCache.set(userId, records);
    return records;
  }

  /**
   * Save a new memory record with secret sanitization
   */
  public async addMemory(params: {
    userId: string;
    category: MemoryRecord['category'];
    key: string;
    value: string;
    source?: string;
  }): Promise<MemoryRecord> {
    const result = await this.addMemoryVerified(params);
    if (!result.persisted || !result.record) {
      throw new Error(result.error || 'Failed to persist memory record');
    }
    return result.record;
  }

  /**
   * Save a new memory record and return verified persistence status.
   * Never reports `persisted: true` if backend Firestore or local persistence fails.
   */
  public async addMemoryVerified(params: {
    userId: string;
    category: MemoryRecord['category'];
    key: string;
    value: string;
    source?: string;
  }): Promise<{ persisted: boolean; record?: MemoryRecord; error?: string }> {
    const { userId, category, key, value, source } = params;

    if (!userId || !value || !value.trim()) {
      return { persisted: false, error: 'Invalid memory payload' };
    }

    // Redact secrets before persisting
    const sanitizedVal = securityCenter.scanInput(value).sanitizedText.trim().slice(0, 600);
    const cleanKey = (key || 'Saved memory').trim().slice(0, 80);

    const now = new Date().toISOString();
    const newRecord: MemoryRecord = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId,
      category,
      key: cleanKey,
      value: sanitizedVal,
      source: source || 'User Statement',
      createdAt: now,
      updatedAt: now,
      isEnabled: true,
    };

    const current = await this.getMemories(userId);
    // Replace duplicate key (or identical value) if already present
    const updated = current.filter(
      (m) =>
        m.key.toLowerCase() !== cleanKey.toLowerCase() &&
        m.value.toLowerCase() !== sanitizedVal.toLowerCase()
    );
    updated.unshift(newRecord);

    const persistRes = await this.persistMemoriesVerified(userId, updated);
    if (!persistRes.persisted) {
      // Revert in-memory cache so UI/state never diverges from persisted backend
      this.memoryCache.set(userId, current);
      return { persisted: false, error: persistRes.error };
    }

    return { persisted: true, record: newRecord };
  }

  /**
   * Inspect a user message for explicit memory instructions and persist them
   * through the real long-term memory backend. Returns verified persistence result.
   */
  public async captureFromUserMessage(params: {
    userId: string;
    message: string;
    sourceMessageId?: string;
  }): Promise<MemoryCaptureResult> {
    const { userId, message, sourceMessageId } = params;
    const intent = detectExplicitMemoryIntent(message);
    if (!intent.matched || !intent.action) {
      return { matched: false, persisted: false };
    }

    if (intent.action === 'clear') {
      const clearRes = await this.persistMemoriesVerified(userId, []);
      if (!clearRes.persisted) {
        return {
          matched: true,
          persisted: false,
          action: 'clear',
          error: clearRes.error || 'Could not clear memories',
        };
      }
      clearAgentMemory(userId);
      return {
        matched: true,
        persisted: true,
        action: 'clear',
        summary: 'Cleared saved memories',
      };
    }

    const addRes = await this.addMemoryVerified({
      userId,
      category: intent.category || 'fact',
      key: intent.key || 'Saved memory',
      value: intent.value || message.trim(),
      source: sourceMessageId ? `Chat message (${sourceMessageId})` : 'User Statement',
    });

    if (!addRes.persisted || !addRes.record) {
      return {
        matched: true,
        persisted: false,
        action: 'save',
        error: addRes.error || 'Could not save memory',
      };
    }

    // Mirror to lightweight local agentMemory cache as well
    try {
      captureExplicitMemory(userId, message);
    } catch {
      // Non-fatal mirror
    }

    return {
      matched: true,
      persisted: true,
      action: 'save',
      record: addRes.record,
      summary: `${addRes.record.key}: ${addRes.record.value}`,
    };
  }

  /**
   * Update an existing memory
   */
  public async updateMemory(userId: string, id: string, updates: Partial<MemoryRecord>): Promise<boolean> {
    const records = await this.getMemories(userId);
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return false;

    const next = [...records];
    next[index] = {
      ...next[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const res = await this.persistMemoriesVerified(userId, next);
    return res.persisted;
  }

  /**
   * Delete a memory
   */
  public async deleteMemory(userId: string, id: string): Promise<boolean> {
    const records = await this.getMemories(userId);
    const filtered = records.filter((r) => r.id !== id);
    if (filtered.length !== records.length) {
      const res = await this.persistMemoriesVerified(userId, filtered);
      return res.persisted;
    }
    return false;
  }

  /**
   * Clear all memories for a user
   */
  public async clearAllMemories(userId: string): Promise<void> {
    await this.persistMemoriesVerified(userId, []);
    clearAgentMemory(userId);
  }

  /**
   * Retrieve relevant active memories formatted for prompt injection
   */
  public async getRelevantContext(userId: string, queryText = ''): Promise<string> {
    const records = (await this.getMemories(userId)).filter((r) => r.isEnabled);
    if (records.length === 0) return '';

    let relevant: MemoryRecord[] = [];
    if (queryText.trim()) {
      const qTokens = queryText.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
      relevant = records.filter((r) => {
        const text = `${r.key} ${r.value} ${r.category}`.toLowerCase();
        return qTokens.some((token) => text.includes(token));
      });
    }

    // Always include recent enabled facts, preferences, and instructions so saved personal facts
    // remain accessible even when phrasing/spelling differs (e.g. "favourite" vs "favorite").
    const seen = new Set(relevant.map((r) => r.id));
    for (const r of records) {
      if (relevant.length >= 10) break;
      if (!seen.has(r.id)) {
        seen.add(r.id);
        relevant.push(r);
      }
    }

    if (relevant.length === 0) return '';

    return relevant
      .slice(0, 10)
      .map((r) => `- [${r.category.toUpperCase()}] ${r.key}: ${r.value}`)
      .join('\n');
  }

  /**
   * Clear in-memory cache (useful for testing or account switching)
   */
  public invalidateCache(userId?: string): void {
    if (userId) {
      this.memoryCache.delete(userId);
    } else {
      this.memoryCache.clear();
    }
  }

  private async persistMemoriesVerified(
    userId: string,
    records: MemoryRecord[]
  ): Promise<{ persisted: boolean; error?: string }> {
    const updatedAt = new Date().toISOString();
    const currentUser = auth?.currentUser;
    const isFirebaseAuthenticatedOwner = Boolean(
      currentUser && currentUser.uid === userId && !currentUser.isAnonymous
    );

    if (isFirebaseAuthenticatedOwner) {
      const path = `users/${userId}/settings/memories`;
      try {
        await setDoc(
          doc(db, 'users', userId, 'settings', 'memories'),
          { records, updatedAt },
          { merge: true }
        );
      } catch (e) {
        const errInfo = buildFirestoreErrorInfo(e, OperationType.WRITE, path);
        console.error('Firestore Error: ', JSON.stringify(errInfo));
        return {
          persisted: false,
          error: errInfo.error || 'Failed to persist memory to cloud database',
        };
      }

      this.memoryCache.set(userId, records);
      this.saveLocally(userId, records);
      return { persisted: true };
    }

    // Local / guest fallback when not signed into Firebase Auth: verify localStorage write succeeded
    const localSaved = this.saveLocally(userId, records);
    if (!localSaved) {
      return {
        persisted: false,
        error: 'Unable to save memory to device storage',
      };
    }

    this.memoryCache.set(userId, records);
    return { persisted: true };
  }

  private saveLocally(userId: string, records: MemoryRecord[]): boolean {
    if (typeof window === 'undefined') {
      // Allow server/unit test environments without window when explicitly invoked
      return true;
    }
    try {
      window.localStorage.setItem(this.getStorageKey(userId), JSON.stringify(records));
      window.dispatchEvent(new CustomEvent('manus_memory_updated', { detail: { userId } }));
      return true;
    } catch {
      return false;
    }
  }
}

export const longTermMemory = new LongTermMemoryService();
