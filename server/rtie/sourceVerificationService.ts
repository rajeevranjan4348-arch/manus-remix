/**
 * Real-Time Intelligence Engine (RTIE) — Source Verification Engine
 *
 * Implements:
 * - Domain & source credibility scoring (official, trusted, standard, low)
 * - Publication date verification
 * - Duplicate URL & content hash deduplication
 * - Cross-source comparison & conflicting claim detection
 * - Unsupported claim detection
 */

import { extractPublicationDate, sanitizeUntrustedWebContent, validateSafeExternalUrl } from './contentExtractionService';
import { computeContentHash } from './knowledgeFreshnessService';
import {
  ConflictingClaim,
  RawSearchResult,
  SourceVerificationReport,
  VerifiedSourceRecord,
} from './types';

const OFFICIAL_DOMAINS = [
  'ai.google.dev',
  'blog.google',
  'deepmind.google',
  'cloud.google.com',
  'developers.google.com',
  'github.com',
  'api.github.com',
  'docs.github.com',
  'npmjs.com',
  'registry.npmjs.org',
  'pypi.org',
  'developer.mozilla.org',
  'react.dev',
  'nextjs.org',
  'vitejs.dev',
  'vite.dev',
  'typescriptlang.org',
  'nodejs.org',
  'python.org',
  'openai.com',
  'anthropic.com',
  'meta.com',
  'usgs.gov',
  'earthquake.usgs.gov',
  'nasa.gov',
  'open-meteo.com',
  'frankfurter.dev',
  'who.int',
  'nih.gov',
  'arxiv.org',
  'w3.org',
];

const TRUSTED_DOMAINS = [
  'wikipedia.org',
  'en.wikipedia.org',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'nature.com',
  'science.org',
  'ieee.org',
  'acm.org',
  'techcrunch.com',
  'theverge.com',
  'arstechnica.com',
  'wired.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'nytimes.com',
  'spaceflightnewsapi.net',
  'news.ycombinator.com',
  'coingecko.com',
  'coinbase.com',
  'exchangerate-api.com',
];

const LOW_CREDIBILITY_PATTERNS = [
  /pastebin\.com/i,
  /blogspot\./i,
  /rumor/i,
  /unverified/i,
];

export function scoreDomainCredibility(urlStr: string): {
  score: number;
  tier: VerifiedSourceRecord['credibilityTier'];
  domain: string;
} {
  try {
    const parsed = new URL(urlStr);
    const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (
      domain.endsWith('.gov') ||
      domain.endsWith('.edu') ||
      domain.endsWith('.mil') ||
      OFFICIAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
    ) {
      return { score: 0.96, tier: 'official', domain };
    }

    if (TRUSTED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      return { score: 0.86, tier: 'trusted', domain };
    }

    if (LOW_CREDIBILITY_PATTERNS.some((p) => p.test(domain))) {
      return { score: 0.35, tier: 'low', domain };
    }

    return { score: 0.68, tier: 'standard', domain };
  } catch {
    return { score: 0.3, tier: 'low', domain: 'unknown' };
  }
}

function normalizeUrlForDedup(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']) {
      u.searchParams.delete(param);
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Detects conflicting numerical or version claims across multiple sources
 */
export function detectCrossSourceConflicts(sources: VerifiedSourceRecord[]): ConflictingClaim[] {
  const conflicts: ConflictingClaim[] = [];
  if (sources.length < 2) return conflicts;

  // 1. Check for conflicting semantic version numbers (e.g., v19.0.0 vs v18.2.0 for the same subject)
  const versionClaims: Array<{ version: string; major: string; source: VerifiedSourceRecord }> = [];
  const priceClaims: Array<{ amount: number; raw: string; source: VerifiedSourceRecord }> = [];

  for (const src of sources) {
    const text = `${src.title} ${src.snippet} ${src.extractedContent || ''}`;

    const verMatch = text.match(/\b(?:version|release|v)\s*(\d+\.\d+(?:\.\d+)?)\b/i);
    if (verMatch?.[1]) {
      const major = verMatch[1].split('.')[0];
      versionClaims.push({ version: verMatch[1], major, source: src });
    }

    const priceMatch = text.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/);
    if (priceMatch?.[1]) {
      const val = Number(priceMatch[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) {
        priceClaims.push({ amount: val, raw: `$${priceMatch[1]}`, source: src });
      }
    }
  }

  if (versionClaims.length >= 2) {
    const first = versionClaims[0];
    for (let i = 1; i < versionClaims.length; i++) {
      const other = versionClaims[i];
      if (other.version !== first.version && other.source.url !== first.source.url) {
        conflicts.push({
          topic: 'Software / Model Version Discrepancy',
          claimA: {
            value: `v${first.version}`,
            sourceUrl: first.source.url,
            sourceTitle: first.source.title,
          },
          claimB: {
            value: `v${other.version}`,
            sourceUrl: other.source.url,
            sourceTitle: other.source.title,
          },
          description: `Source "${first.source.title}" reports v${first.version} while "${other.source.title}" reports v${other.version}.`,
        });
        break;
      }
    }
  }

  if (priceClaims.length >= 2) {
    const first = priceClaims[0];
    for (let i = 1; i < priceClaims.length; i++) {
      const other = priceClaims[i];
      const diffRatio = Math.abs(first.amount - other.amount) / Math.max(first.amount, other.amount);
      if (diffRatio > 0.15 && other.source.url !== first.source.url) {
        conflicts.push({
          topic: 'Price / Numerical Value Discrepancy',
          claimA: {
            value: first.raw,
            sourceUrl: first.source.url,
            sourceTitle: first.source.title,
          },
          claimB: {
            value: other.raw,
            sourceUrl: other.source.url,
            sourceTitle: other.source.title,
          },
          description: `Reported figures differ by ${(diffRatio * 100).toFixed(1)}% between "${first.source.title}" (${first.raw}) and "${other.source.title}" (${other.raw}).`,
        });
        break;
      }
    }
  }

  return conflicts;
}

/**
 * Verifies, deduplicates, scores, and cross-checks raw search results
 */
export function verifyAndRankSources(
  rawResults: RawSearchResult[],
  ttlMs = 20 * 60 * 1000,
  nowMs = Date.now()
): SourceVerificationReport {
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  const verified: VerifiedSourceRecord[] = [];
  const unsupportedClaimsFlagged: string[] = [];
  let duplicatesRemoved = 0;

  for (const raw of rawResults) {
    const urlCheck = validateSafeExternalUrl(raw.url);
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      continue;
    }

    const dedupUrl = normalizeUrlForDedup(urlCheck.normalizedUrl);
    const cleanSnippet = sanitizeUntrustedWebContent(raw.snippet || raw.content || '', 1200);
    const cleanTitle = sanitizeUntrustedWebContent(raw.title || dedupUrl, 240);
    const contentHash = computeContentHash(`${cleanTitle}|${cleanSnippet}`);

    if (seenUrls.has(dedupUrl) || (cleanSnippet.length > 40 && seenHashes.has(contentHash))) {
      duplicatesRemoved++;
      continue;
    }

    seenUrls.add(dedupUrl);
    seenHashes.add(contentHash);

    const { score: baseScore, tier, domain } = scoreDomainCredibility(dedupUrl);
    const publishedAt = raw.publishedAt || extractPublicationDate(`${raw.snippet || ''} ${raw.content || ''}`);
    const publicationDateVerified = Boolean(publishedAt && !Number.isNaN(Date.parse(publishedAt)));

    // Boost score slightly if publication date is verified and recent
    let finalScore = baseScore;
    if (publicationDateVerified && publishedAt) {
      const ageDays = (nowMs - Date.parse(publishedAt)) / (1000 * 60 * 60 * 24);
      if (ageDays >= -1 && ageDays <= 30) {
        finalScore = Math.min(0.99, finalScore + 0.03);
      }
    }

    if (/\b(rumor|unconfirmed|allegedly|speculation|leaked)\b/i.test(cleanSnippet) && tier !== 'official') {
      unsupportedClaimsFlagged.push(
        `Unconfirmed or speculative statement detected in "${cleanTitle}" (${domain}).`
      );
      finalScore = Math.max(0.25, finalScore - 0.2);
    }

    const nowIso = new Date(nowMs).toISOString();
    verified.push({
      id: `src_${contentHash.slice(0, 10)}`,
      title: cleanTitle,
      url: dedupUrl,
      domain,
      snippet: cleanSnippet,
      extractedContent: raw.content ? sanitizeUntrustedWebContent(raw.content, 2000) : undefined,
      provider: raw.provider,
      credibilityScore: Math.round(finalScore * 100) / 100,
      credibilityTier: tier,
      publishedAt: publicationDateVerified ? publishedAt : undefined,
      publicationDateVerified,
      retrievedAt: raw.retrievedAt || nowIso,
      lastVerifiedAt: nowIso,
      contentHash,
      expirationTimestampMs: nowMs + ttlMs,
      isFresh: true,
    });
  }

  // Sort by credibilityScore descending
  verified.sort((a, b) => b.credibilityScore - a.credibilityScore);

  const conflicts = detectCrossSourceConflicts(verified);
  const overallConfidence =
    verified.length > 0
      ? Math.round(
          (verified.slice(0, 4).reduce((acc, s) => acc + s.credibilityScore, 0) /
            Math.min(4, verified.length)) *
            100
        ) / 100
      : 0;

  const verificationSummary =
    verified.length === 0
      ? 'No external web sources could be verified for this query.'
      : `Verified ${verified.length} source(s) (avg credibility ${(overallConfidence * 100).toFixed(0)}%, ${duplicatesRemoved} duplicate(s) removed${
          conflicts.length > 0 ? `, ${conflicts.length} cross-source discrepancy noted` : ''
        }).`;

  return {
    verifiedSources: verified,
    duplicatesRemoved,
    conflicts,
    unsupportedClaimsFlagged,
    overallConfidence,
    verificationSummary,
  };
}
