/**
 * Long-Term Memory System for Manus AI
 * 
 * Provides durable, user-isolated preferences and facts with full
 * CRUD capability, Firestore synchronization, and relevance retrieval.
 */

import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { observability } from './observability';
import { securityCenter } from './securityCenter';

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
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.getStorageKey(userId));
        if (raw) {
          records = JSON.parse(raw);
        }
      } catch {}
    }

    // 2. Sync from Firestore if authenticated
    const currentUser = auth.currentUser;
    if (currentUser && currentUser.uid === userId) {
      try {
        const snap = await getDoc(doc(db, 'users', userId, 'settings', 'memories'));
        if (snap.exists()) {
          const remoteRecords = snap.data()?.records as MemoryRecord[];
          if (Array.isArray(remoteRecords) && remoteRecords.length > 0) {
            records = remoteRecords;
            this.saveLocally(userId, records);
          }
        }
      } catch (e) {
        console.warn('[LongTermMemory] Firestore sync read notice:', e);
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
    const { userId, category, key, value, source } = params;

    // Redact secrets
    const sanitizedVal = securityCenter.scanInput(value).sanitizedText;
    const cleanKey = key.trim().slice(0, 80);

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
    // Replace duplicate key if already present
    const updated = current.filter(m => m.key.toLowerCase() !== cleanKey.toLowerCase());
    updated.unshift(newRecord);

    await this.persistMemories(userId, updated);
    return newRecord;
  }

  /**
   * Update an existing memory
   */
  public async updateMemory(userId: string, id: string, updates: Partial<MemoryRecord>): Promise<boolean> {
    const records = await this.getMemories(userId);
    const index = records.findIndex(r => r.id === id);
    if (index === -1) return false;

    records[index] = {
      ...records[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.persistMemories(userId, records);
    return true;
  }

  /**
   * Delete a memory
   */
  public async deleteMemory(userId: string, id: string): Promise<boolean> {
    const records = await this.getMemories(userId);
    const filtered = records.filter(r => r.id !== id);
    if (filtered.length !== records.length) {
      await this.persistMemories(userId, filtered);
      return true;
    }
    return false;
  }

  /**
   * Clear all memories for a user
   */
  public async clearAllMemories(userId: string): Promise<void> {
    await this.persistMemories(userId, []);
  }

  /**
   * Retrieve relevant active memories formatted for prompt injection
   */
  public async getRelevantContext(userId: string, queryText = ''): Promise<string> {
    const records = (await this.getMemories(userId)).filter(r => r.isEnabled);
    if (records.length === 0) return '';

    let relevant = records;
    if (queryText.trim()) {
      const qTokens = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);
      relevant = records.filter(r => {
        const text = `${r.key} ${r.value} ${r.category}`.toLowerCase();
        return qTokens.some(token => text.includes(token));
      });
      // Fallback: if no specific match, include preferences and instructions
      if (relevant.length === 0) {
        relevant = records.filter(r => r.category === 'preference' || r.category === 'instruction');
      }
    }

    if (relevant.length === 0) return '';

    return relevant
      .slice(0, 10)
      .map(r => `- [${r.category.toUpperCase()}] ${r.key}: ${r.value}`)
      .join('\n');
  }

  private async persistMemories(userId: string, records: MemoryRecord[]) {
    this.memoryCache.set(userId, records);
    this.saveLocally(userId, records);

    // Save to Firestore if authenticated
    const currentUser = auth.currentUser;
    if (currentUser && currentUser.uid === userId) {
      try {
        await setDoc(
          doc(db, 'users', userId, 'settings', 'memories'),
          { records, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      } catch (e) {
        console.warn('[LongTermMemory] Firestore persist notice:', e);
      }
    }
  }

  private saveLocally(userId: string, records: MemoryRecord[]) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.getStorageKey(userId), JSON.stringify(records));
      window.dispatchEvent(new CustomEvent('manus_memory_updated', { detail: { userId } }));
    } catch {}
  }
}

export const longTermMemory = new LongTermMemoryService();
