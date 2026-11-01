import { describe, it, expect } from 'vitest';
import { routeQuery } from '../netlify/functions/rtie/queryRouter';
import { verifySources, buildCitation } from '../netlify/functions/rtie/sourceVerification';
import { isFresh, categoryForQuery, FRESHNESS_TTL_MS } from '../netlify/functions/rtie/freshness';
import { extractText, extractPublicationDate, hashContent, isSafeUrl } from '../netlify/functions/rtie/contentExtraction';
import { validateCacheEntry } from '../netlify/functions/rtie/knowledgeCache';

describe('RTIE query router', () => {
  it('does not research simple greetings or math', () => {
    expect(routeQuery('hello there').needsResearch).toBe(false);
    expect(routeQuery('hi').needsResearch).toBe(false);
    expect(routeQuery('what is 17 * 23?').needsResearch).toBe(false);
    expect(routeQuery('write a haiku about rain').needsResearch).toBe(false);
  });

  it('routes current information to research', () => {
    const news = routeQuery('what is the latest AI news today?');
    expect(news.needsResearch).toBe(true);
    expect(['news', 'complex']).toContain(news.category);
    expect(routeQuery('current price of bitcoin').needsResearch).toBe(true);
    expect(routeQuery('latest stable version of node.js?').needsResearch).toBe(true);
    expect(routeQuery('who won the match yesterday?').needsResearch).toBe(true);
  });

  it('keeps stable historical knowledge on the LLM path', () => {
    expect(routeQuery('who was the first president of the United States?').needsResearch).toBe(false);
    expect(routeQuery('explain the theory of relativity').needsResearch).toBe(false);
  });

  it('returns a reason string for every decision', () => {
    const r1 = routeQuery('hello');
    const r2 = routeQuery('weather in Delhi right now');
    expect(typeof r1.reason).toBe('string');
    expect(typeof r2.reason).toBe('string');
    expect(r2.useGrounding).toBe(true);
  });
});

describe('RTIE source verification', () => {
  it('scores official and reliable domains higher', () => {
    const s = verifySources([
      { url: 'https://blog.google/announcement', title: 'Official announcement' },
      { url: 'https://example-random.org/post', title: 'Random post' },
    ]);
    expect(s.length).toBe(2);
    const official = s.find((x) => x.url.includes('blog.google'));
    const random = s.find((x) => x.url.includes('example-random'));
    expect(official!.credibility).toBeGreaterThan(random!.credibility);
  });

  it('deduplicates sources by normalized URL', () => {
    const s = verifySources([
      { url: 'https://example.com/a?utm_source=x', title: 'One' },
      { url: 'https://example.com/a', title: 'One duplicate' },
    ]);
    expect(s.length).toBe(1);
  });

  it('flags conflicting information across sources', () => {
    const s = verifySources([
      { url: 'https://a.com/x', title: 'A', snippet: 'The release version is 2.1.0' },
      { url: 'https://b.com/y', title: 'B', snippet: 'The release version is 2.2.0' },
    ]);
    const conflicts = s.find((x) => x.conflicts && x.conflicts.length > 0);
    expect(conflicts).toBeDefined();
  });

  it('builds citations with clickable absolute URLs only', () => {
    const c = buildCitation({ url: 'https://example.com/page', title: 'Example' });
    expect(c.url).toMatch(/^https:\/\//);
    expect(typeof c.credibility).toBe('number');
  });
  it('rejects javascript: and other unsafe URLs', () => {
    expect(() => buildCitation({ url: 'javascript:alert(1)', title: 'Bad' })).toThrow();
  });
});

describe('RTIE content extraction', () => {
  it('strips scripts and tags from HTML', () => {
    const html = '<html><head><script>alert(1)</script></head><body><h1>Title</h1><p>Body text</p></body></html>';
    const text = extractText(html);
    expect(text).toContain('Body text');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('<');
  });

  it('extracts publication dates from common formats', () => {
    expect(extractPublicationDate('<meta property="article:published_time" content="2026-10-20T10:00:00Z">')).toBe('2026-10-20');
    expect(extractPublicationDate('Published on October 20, 2026 by staff')).toBe('2026-10-20');
  });

  it('hashes content deterministically', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
  });

  it('blocks SSRF targets', () => {
    expect(isSafeUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeUrl('http://localhost:8080/admin')).toBe(false);
    expect(isSafeUrl('http://192.168.1.1/router')).toBe(false);
    expect(isSafeUrl('ftp://example.com/file')).toBe(false);
    expect(isSafeUrl('https://example.com/page')).toBe(true);
  });
});

describe('RTIE freshness', () => {
  it('assigns shorter TTLs to volatile categories', () => {
    const news = FRESHNESS_TTL_MS[categoryForQuery('breaking news today')] ?? FRESHNESS_TTL_MS.news;
    const docs = FRESHNESS_TTL_MS.docs ?? FRESHNESS_TTL_MS.documentation;
    expect(news).toBeLessThan(docs);
  });

  it('marks old cache entries as stale', () => {
    expect(isFresh({ retrievedAt: Date.now() - 1000, expiresInMs: 60000, category: 'news' })).toBe(true);
    expect(isFresh({ retrievedAt: Date.now() - 120000, expiresInMs: 60000, category: 'news' })).toBe(false);
  });
});

describe('RTIE knowledge cache', () => {
  it('round-trips an entry through serialization', () => {
    const entry = {
      id: 'test-id',
      query: 'latest ai news',
      answer: 'summary',
      sources: [],
      retrievedAt: Date.now(),
      lastVerifiedAt: Date.now(),
      contentHash: 'abc123',
      category: 'news',
      confidence: 0.8,
    };
    const restored = validateCacheEntry(JSON.parse(JSON.stringify(entry)));
    expect(restored.query).toBe('latest ai news');
    expect(restored.category).toBe('news');
  });
  it('rejects malformed entries', () => {
    expect(validateCacheEntry({})).toBeNull();
    expect(validateCacheEntry(null)).toBeNull();
  });
});
