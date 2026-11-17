/**
 * Persistent Knowledge Database & Research Cache for Manus Remix (RTIE)
 *
 * Integrates with Firebase Firestore (`/users/{userId}/settings/knowledge_cache`)
 * and bounded localStorage to store:
 * - Verified research results & facts
 * - Source metadata (URL, domain, credibility score, publication timestamp)
 * - Knowledge freshness timestamps & content hashes
 * - User research history
 * - Cached documentation
 *
 * Enforces automatic freshness validation, cache invalidation, duplicate prevention,
 * and strict per-user data isolation.
 */

import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { observability } from './observability';

export interface StoredKnowledgeSource {
  title: string;
  url: string;
  domain?: string;
  credibilityScore: number;
  publishedAt?: string;
  provider: string;
}

export interface PersistentKnowledgeRecord {
  id: string;
  userId: string;
  query: string;
  normalizedKey: string;
  category: string;
  summary: string;
  sources: StoredKnowledgeSource[];
  contentHash: string;
  retrievedAt: string;
  publishedAt?: string;
  lastVerifiedAt: string;
  expirationPolicyMs: number;
  expiresAtMs: number;
  sourceConfidence: number;
}

export interface UserResearchHistoryEntry {
  id: string;
  userId: string;
  query: string;
  category: string;
  sourceCount: number;
  topSourceUrl?: string;
  timestamp: string;
}

const LOCAL_CACHE_PREFIX = 'manus_rtie_knowledge_cache_';
const LOCAL_HISTORY_PREFIX = 'manus_rtie_research_history_';
const MAX_STORED_RECORDS = 50;
const MAX_HISTORY_ENTRIES = 60;

function computeFastHash(input: string): string {
  const s = String(input || '').toLowerCase().trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

class PersistentKnowledgeStoreService {
  private memoryRecords = new Map<string, PersistentKnowledgeRecord[]>();
  private memoryHistory = new Map<string, UserResearchHistoryEntry[]>();

  private getCacheStorageKey(userId: string): string {
    return `${LOCAL_CACHE_PREFIX}${encodeURIComponent(userId || 'default')}`;
  }

  private getHistoryStorageKey(userId: string): string {
    return `${LOCAL_HISTORY_PREFIX}${encodeURIComponent(userId || 'default')}`;
  }

  public normalizeQueryKey(query: string, category = 'general'): string {
    const clean = String(query || '')
      .toLowerCase()
      .replace(/[^\w\s/-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${category}:${computeFastHash(clean)}`;
  }

  public isRecordFresh(record: PersistentKnowledgeRecord, nowMs = Date.now()): boolean {
    if (!record || typeof record.expiresAtMs !== 'number') return false;
    return nowMs < record.expiresAtMs;
  }

  /**
   * Loads user-isolated knowledge records and evicts expired entries automatically.
   */
  public async getKnowledgeRecords(userId: string, nowMs = Date.now()): Promise<PersistentKnowledgeRecord[]> {
    if (!userId) return [];

    let records = this.memoryRecords.get(userId);
    if (!records && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.getCacheStorageKey(userId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) records = parsed;
        }
      } catch {}
    }

    if (!records) {
      records = [];
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.uid === userId) {
        try {
          const snap = await Promise.race([
            getDoc(doc(db, 'users', userId, 'settings', 'knowledge_cache')),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
          ]);
          if (snap && snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data?.entries)) {
              records = data.entries as PersistentKnowledgeRecord[];
            }
            if (Array.isArray(data?.history)) {
              this.memoryHistory.set(userId, data.history as UserResearchHistoryEntry[]);
            }
          }
        } catch (err) {
          console.warn('[PersistentKnowledgeStore] Firestore read notice:', err);
        }
      }
    }

    const freshRecords = records.filter(
      (r) => r.userId === userId && this.isRecordFresh(r, nowMs)
    );
    if (freshRecords.length !== records.length) {
      this.memoryRecords.set(userId, freshRecords);
      this.saveLocally(userId, freshRecords, this.memoryHistory.get(userId) || []);
    } else {
      this.memoryRecords.set(userId, freshRecords);
    }

    return freshRecords;
  }

  /**
   * Retrieves a fresh verified knowledge record for a query if available and not expired.
   */
  public async findFreshRecord(
    userId: string,
    query: string,
    category?: string,
    nowMs = Date.now()
  ): Promise<PersistentKnowledgeRecord | null> {
    if (!userId || !query.trim()) return null;
    const records = await this.getKnowledgeRecords(userId, nowMs);
    const key = this.normalizeQueryKey(query, category || 'any');
    const cleanQuery = query.toLowerCase().trim();

    for (const rec of records) {
      if (
        (rec.normalizedKey === key || rec.query.toLowerCase().trim() === cleanQuery) &&
        this.isRecordFresh(rec, nowMs)
      ) {
        return rec;
      }
    }
    return null;
  }

  /**
   * Stores a verified research result with duplicate prevention and Firestore sync.
   */
  public async saveKnowledgeRecord(params: {
    userId: string;
    query: string;
    category: string;
    summary: string;
    sources: StoredKnowledgeSource[];
    expirationPolicyMs?: number;
    sourceConfidence?: number;
    publishedAt?: string;
    nowMs?: number;
  }): Promise<PersistentKnowledgeRecord> {
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expirationPolicyMs = params.expirationPolicyMs ?? 20 * 60 * 1000;
    const expiresAtMs = nowMs + expirationPolicyMs;
    const normalizedKey = this.normalizeQueryKey(params.query, params.category);
    const contentHash = computeFastHash(`${params.query}|${params.summary}`);

    const newRecord: PersistentKnowledgeRecord = {
      id: `know_${nowMs}_${contentHash.slice(0, 6)}`,
      userId: params.userId,
      query: params.query.trim().slice(0, 500),
      normalizedKey,
      category: params.category,
      summary: params.summary.trim().slice(0, 4000),
      sources: (params.sources || []).slice(0, 8),
      contentHash,
      retrievedAt: nowIso,
      publishedAt: params.publishedAt,
      lastVerifiedAt: nowIso,
      expirationPolicyMs,
      expiresAtMs,
      sourceConfidence: params.sourceConfidence ?? 0.85,
    };

    const existing = await this.getKnowledgeRecords(params.userId, nowMs);
    // Duplicate prevention: remove older entry with same normalizedKey or contentHash
    const deduplicated = existing.filter(
      (r) => r.normalizedKey !== normalizedKey && r.contentHash !== contentHash
    );
    const updatedRecords = [newRecord, ...deduplicated].slice(0, MAX_STORED_RECORDS);

    const historyEntry: UserResearchHistoryEntry = {
      id: `hist_${nowMs}`,
      userId: params.userId,
      query: newRecord.query,
      category: newRecord.category,
      sourceCount: newRecord.sources.length,
      topSourceUrl: newRecord.sources[0]?.url,
      timestamp: nowIso,
    };
    const existingHistory = this.memoryHistory.get(params.userId) || [];
    const updatedHistory = [
      historyEntry,
      ...existingHistory.filter((h) => h.query.toLowerCase() !== newRecord.query.toLowerCase()),
    ].slice(0, MAX_HISTORY_ENTRIES);

    this.memoryRecords.set(params.userId, updatedRecords);
    this.memoryHistory.set(params.userId, updatedHistory);
    await this.persist(params.userId, updatedRecords, updatedHistory);

    observability.log({
      level: 'info',
      category: 'knowledge_base',
      message: `Saved verified knowledge record for "${newRecord.query.slice(0, 60)}" (${newRecord.sources.length} sources)`,
    });

    return newRecord;
  }

  /**
   * Invalidates a specific cached query or clears all expired records for a user
   */
  public async invalidateRecord(userId: string, recordIdOrKey: string): Promise<boolean> {
    const records = await this.getKnowledgeRecords(userId);
    const filtered = records.filter(
      (r) => r.id !== recordIdOrKey && r.normalizedKey !== recordIdOrKey
    );
    if (filtered.length !== records.length) {
      this.memoryRecords.set(userId, filtered);
      await this.persist(userId, filtered, this.memoryHistory.get(userId) || []);
      return true;
    }
    return false;
  }

  public async clearUserKnowledgeCache(userId: string): Promise<void> {
    this.memoryRecords.set(userId, []);
    this.memoryHistory.set(userId, []);
    await this.persist(userId, [], []);
  }

  private async persist(
    userId: string,
    entries: PersistentKnowledgeRecord[],
    history: UserResearchHistoryEntry[]
  ): Promise<void> {
    this.saveLocally(userId, entries, history);

    const currentUser = auth.currentUser;
    if (currentUser && currentUser.uid === userId) {
      try {
        await setDoc(
          doc(db, 'users', userId, 'settings', 'knowledge_cache'),
          {
            entries: entries.slice(0, 35),
            history: history.slice(0, 40),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('[PersistentKnowledgeStore] Firestore persist notice:', err);
      }
    }
  }

  private saveLocally(
    userId: string,
    entries: PersistentKnowledgeRecord[],
    history: UserResearchHistoryEntry[]
  ): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.getCacheStorageKey(userId), JSON.stringify(entries));
      localStorage.setItem(this.getHistoryStorageKey(userId), JSON.stringify(history));
    } catch {}
  }
}

export const persistentKnowledgeStore = new PersistentKnowledgeStoreService();
