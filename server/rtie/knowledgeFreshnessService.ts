/**
 * Real-Time Intelligence Engine (RTIE) — Knowledge Freshness Service
 *
 * Manages content hashes, expiration policies, publication timestamps,
 * and automatic freshness validation so outdated cached records are never
 * presented as current facts.
 */

import { CATEGORY_TTL_MS } from './intelligenceRouter';
import { KnowledgeFreshnessRecord, QueryCategory, ResearchOrchestrationResult } from './types';

/**
 * Deterministic fast hash (FNV-1a 64-bit hex representation) for content deduplication & change detection
 */
export function computeContentHash(content: string): string {
  const normalized = String(content || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  let h1 = 0xdeadbeef ^ normalized.length;
  let h2 = 0x41c6ce57 ^ normalized.length;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function getExpirationPolicyMs(category: QueryCategory, importanceBoost = false): number {
  const base = CATEGORY_TTL_MS[category] ?? 15 * 60 * 1000;
  // High-volatility or breaking queries expire twice as fast to guarantee freshness
  return importanceBoost ? Math.max(60 * 1000, Math.floor(base / 2)) : base;
}

export function isRecordFresh(record: KnowledgeFreshnessRecord, nowMs = Date.now()): boolean {
  if (!record || typeof record.expiresAtMs !== 'number') return false;
  if (nowMs >= record.expiresAtMs) return false;
  if (!record.retrievedAt || !record.contentHash) return false;
  return true;
}

export function buildKnowledgeFreshnessRecord(params: {
  key: string;
  query: string;
  category: QueryCategory;
  sourceUrl: string;
  publishedAt?: string;
  sourceConfidence: number;
  payload: ResearchOrchestrationResult;
  nowMs?: number;
  customTtlMs?: number;
}): KnowledgeFreshnessRecord {
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expirationPolicyMs = params.customTtlMs ?? getExpirationPolicyMs(params.category);
  const expiresAtMs = nowMs + expirationPolicyMs;
  const contentHash = computeContentHash(
    `${params.query}|${params.payload.systemContextBlock}|${params.payload.citationsMarkdown}`
  );

  return {
    key: params.key,
    query: params.query,
    category: params.category,
    sourceUrl: params.sourceUrl,
    retrievedAt: nowIso,
    publishedAt: params.publishedAt,
    lastVerifiedAt: nowIso,
    contentHash,
    expirationPolicyMs,
    expiresAtMs,
    sourceConfidence: params.sourceConfidence,
    payload: {
      ...params.payload,
      freshness: {
        retrievedAt: nowIso,
        lastVerifiedAt: nowIso,
        expiresAt: new Date(expiresAtMs).toISOString(),
        isFresh: true,
        contentHash,
      },
    },
  };
}
