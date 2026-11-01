/**
 * Source verification engine — credibility scoring, publication date
 * verification, cross-source comparison, conflict detection and citation
 * generation. Never fabricates citations; sources without URLs are dropped.
 */
import type { SearchResultItem, VerifiedSource, FreshnessCategory } from './types';
import { expiresForCategory } from './freshness';

const HIGH_CREDIBILITY = [
  'gov', 'edu', 'who.int', 'imf.org', 'worldbank.org', 'oecd.org',
  'github.com', 'docs.google.com', 'developer.android.com',
  'openai.com', 'anthropic.com', 'blog.google', 'deepmind.google',
  'microsoft.com', 'apple.com', 'mozilla.org', 'w3.org', 'python.org',
  'nodejs.org', 'react.dev', 'vitejs.dev', 'typescriptlang.org',
];

const MEDIUM_CREDIBILITY = [
  'wikipedia.org', 'wikimedia.org', 'arxiv.org', 'nature.com',
  'reuters.com', 'apnews.com', 'bbc.com', 'bloomberg.com', 'ft.com',
  'theverge.com', 'techcrunch.com', 'arstechnica.com', 'github.blog',
];

const LOW_CREDIBILITY = [
  'medium.com', 'quora.com', 'reddit.com', 'x.com', 'twitter.com',
  'pinterest.com', 'buzzfeed.com',
];

export function credibilityForUrl(url: string): number {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 0.1; }
  if (HIGH_CREDIBILITY.some((d) => host === d || host.endsWith('.' + d))) return 0.9;
  if (MEDIUM_CREDIBILITY.some((d) => host === d || host.endsWith('.' + d))) return 0.65;
  if (LOW_CREDIBILITY.some((d) => host === d || host.endsWith('.' + d))) return 0.35;
  if (/\.(gov|edu)(\/|$)/.test(host) || host.endsWith('.gov') || host.endsWith('.edu')) return 0.9;
  if (host.endsWith('.org')) return 0.55;
  return 0.4;
}

/** Score and verify a batch of search results into cited sources. */
export function verifySources(
  items: SearchResultItem[],
  category: FreshnessCategory,
  minCredibility = 0.3
): VerifiedSource[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: VerifiedSource[] = [];
  for (const item of items) {
    if (!/^https?:\/\//i.test(item.url)) continue;
    const key = item.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const credibility = credibilityForUrl(item.url);
    if (credibility < minCredibility) continue;
    let publishedAt: string | null = null;
    if (item.publishedAt) {
      const d = new Date(item.publishedAt);
      if (!isNaN(d.getTime()) && d.getFullYear() > 1995) publishedAt = d.toISOString();
    }
    out.push({
      title: item.title || item.url,
      url: item.url,
      snippet: item.snippet || '',
      provider: item.provider,
      publishedAt,
      retrievedAt: item.retrievedAt || now,
      lastVerifiedAt: now,
      credibility,
      contentHash: '',
      expiresAt: expiresForCategory(category),
    });
  }
  return out;
}

/**
 * Cross-source comparison: detect conflicting publication dates or
 * mutually exclusive "latest version" claims across sources.
 */
export function detectConflicts(sources: VerifiedSource[]): string[] {
  const conflicts: string[] = [];
  const dates = sources
    .filter((s) => s.publishedAt)
    .map((s) => ({ url: s.url, date: new Date(s.publishedAt as string).getTime() }))
    .sort((a, b) => a.date - b.date);
  if (dates.length >= 2) {
    const oldest = dates[0];
    const newest = dates[dates.length - 1];
    if (newest.date - oldest.date > 1000 * 60 * 60 * 24 * 365) {
      conflicts.push('Sources disagree by more than a year on publication dates (' + new Date(oldest.date).toISOString().slice(0, 10) + ' vs ' + new Date(newest.date).toISOString().slice(0, 10) + ').');
    }
  }
  const versionClaims = new Map<string, string[]>();
  for (const source of sources) {
    const matches = source.snippet.match(/v?(\d+\.\d+(?:\.\d+)?)\b/g) || [];
    for (const version of matches.slice(0, 3)) {
      const list = versionClaims.get(version) || [];
      list.push(source.url);
      versionClaims.set(version, list);
    }
  }
  if (versionClaims.size >= 3) {
    conflicts.push('Multiple different version numbers appear across sources; verify against the official release page.');
  }
  return conflicts;
}

/** Build the clickable "Sources" markdown block. Only real, verified URLs. */
export function buildCitations(sources: VerifiedSource[], max = 8): string {
  if (!sources.length) return '';
  const lines = sources
    .slice(0, max)
    .map((s) => {
      const safeTitle = s.title.replace(/[\[\]]/g, '').slice(0, 120);
      const date = s.publishedAt ? ' (' + s.publishedAt.slice(0, 10) + ')' : '';
      return '- [' + safeTitle + '](' + s.url + ')' + date;
    });
  return '\n\n**Sources**\n' + lines.join('\n');
}
