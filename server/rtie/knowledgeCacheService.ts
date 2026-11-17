/**
 * Real-Time Intelligence Engine (RTIE) — Knowledge Cache & Rate Limiter Service
 *
 * Provides bounded LRU caching with automatic freshness validation,
 * cache invalidation, duplicate prevention, and server-side rate limiting.
 */

import { computeContentHash, isRecordFresh } from './knowledgeFreshnessService';
import { KnowledgeFreshnessRecord } from './types';

export class KnowledgeCacheService {
  private cache = new Map<string, KnowledgeFreshnessRecord>();
  private rateLimitBuckets = new Map<string, { count: number; windowStartMs: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 150) {
    this.maxEntries = maxEntries;
  }

  public normalizeKey(query: string, category?: string): string {
    const clean = String(query || '')
      .toLowerCase()
      .replace(/[^\w\s/-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${category || 'any'}:${computeContentHash(clean)}`;
  }

  /**
   * Returns a cached record ONLY if it passes freshness verification.
   * Expired records are automatically evicted and never returned as fresh.
   */
  public getFresh(key: string, nowMs = Date.now()): KnowledgeFreshnessRecord | null {
    const existing = this.cache.get(key);
    if (!existing) return null;

    if (!isRecordFresh(existing, nowMs)) {
      this.cache.delete(key);
      return null;
    }

    // LRU refresh
    this.cache.delete(key);
    this.cache.set(key, existing);
    return existing;
  }

  public set(record: KnowledgeFreshnessRecord): void {
    if (!record || !record.key) return;

    // Duplicate content hash prevention across identical queries
    if (this.cache.has(record.key)) {
      this.cache.delete(record.key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(record.key, record);
  }

  public invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  public pruneExpired(nowMs = Date.now()): number {
    let removed = 0;
    for (const [key, record] of this.cache.entries()) {
      if (!isRecordFresh(record, nowMs)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }

  /**
   * Server-side sliding window rate limiter per client identifier
   */
  public checkRateLimit(
    clientId: string,
    maxRequestsPerMinute = 45,
    nowMs = Date.now()
  ): { allowed: boolean; remaining: number; resetInMs: number } {
    const key = clientId || 'anonymous';
    const windowMs = 60 * 1000;
    const bucket = this.rateLimitBuckets.get(key);

    if (!bucket || nowMs - bucket.windowStartMs >= windowMs) {
      this.rateLimitBuckets.set(key, { count: 1, windowStartMs: nowMs });
      return { allowed: true, remaining: maxRequestsPerMinute - 1, resetInMs: windowMs };
    }

    if (bucket.count >= maxRequestsPerMinute) {
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Math.max(0, windowMs - (nowMs - bucket.windowStartMs)),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, maxRequestsPerMinute - bucket.count),
      resetInMs: Math.max(0, windowMs - (nowMs - bucket.windowStartMs)),
    };
  }
}

export const knowledgeCacheService = new KnowledgeCacheService(150);
