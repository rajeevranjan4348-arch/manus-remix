/**
 * Knowledge freshness service — category-based expiration policies.
 * Old cached information is never presented as current; expired records
 * must be re-verified or refreshed before reuse.
 */
import type { FreshnessCategory } from './types';

const TTL_MS: Record<FreshnessCategory, number> = {
  news: 15 * 60 * 1000,           // 15 minutes
  prices: 10 * 60 * 1000,         // 10 minutes
  weather: 30 * 60 * 1000,        // 30 minutes
  releases: 12 * 60 * 60 * 1000,  // 12 hours
  documentation: 24 * 60 * 60 * 1000, // 24 hours
  default: 6 * 60 * 60 * 1000,    // 6 hours
  stable_fact: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export function ttlForCategory(category: FreshnessCategory): number {
  return TTL_MS[category] ?? TTL_MS.default;
}

export function expiresForCategory(category: FreshnessCategory): string {
  return new Date(Date.now() + ttlForCategory(category)).toISOString();
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  const t = new Date(expiresAt).getTime();
  return isNaN(t) || t <= now;
}

/** A record whose content hash changed upstream must be re-verified. */
export function needsRefresh(contentHash: string, expectedHash: string): boolean {
  return contentHash !== expectedHash;
}
