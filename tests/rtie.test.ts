import { describe, it, expect } from 'vitest';
import { routeQuery } from '../netlify/functions/rtie/queryRouter';
import { credibilityForUrl, verifySources, detectConflicts, buildCitations } from '../netlify/functions/rtie/sourceVerification';
import { stripHtml, hashContent, assertSafeUrl } from '../netlify/functions/rtie/contentExtraction';
import { ttlForCategory, isExpired, expiresForCategory, needsRefresh } from '../netlify/functions/rtie/freshness';
import { topicKey, storeKnowledge, lookupKnowledge } from '../netlify/functions/rtie/knowledgeCache';

describe('RTIE query router', () => {
  it('does not research simple greetings, math or creative requests', () => {
    expect(routeQuery('hello there').needsResearch).toBe(false);
    expect(routeQuery('hi').needsResearch).toBe(false);
    expect(routeQuery('what is 17 * 23?').needsResearch).toBe(false);
    expect(routeQuery('write a haiku about rain').needsResearch).toBe(false);
  });

  it('routes current information, news, prices and versions to research', () => {
    const news = routeQuery('what is the latest AI news today?');
    expect(news.needsResearch).toBe(true);
    expect(news.useGrounding).toBe(true);
    expect(news.category).toBe('news');
    expect(routeQuery('current price of bitcoin').needsResearch).toBe(true);
    expect(routeQuery('latest stable version of node.js?').needsResearch).toBe(true);
    expect(routeQuery('who won the match yesterday?').needsResearch).toBe(true);
    expect(routeQuery('weather in Delhi right now').needsResearch).toBe(true);
  });

  it('keeps stable historical knowledge on the LLM path', () => {
    expect(routeQuery('who was the first president of the United States?').needsResearch).toBe(false);
    expect(routeQuery('explain the theory of relativity').needsResearch).toBe(false);
  });

  it('returns a reason string for every decision', () => {
    expect(typeof routeQuery('hello').reason).toBe('string');
    expect(typeof routeQuery('weather in Delhi right now').reason).toBe('string');
    expect(routeQuery('weather in Delhi right now').freshnessCategory).toBe('weather');
  });
});

describe('RTIE source verification', () => {
  it('scores official and reliable domains higher', () => {
    expect(credibilityForUrl('https://blog.google/announcement')).toBeGreaterThan(credibilityForUrl('https://example-random.org/post'));
    expect(credibilityForUrl('https://www.nih.gov/x')).toBeGreaterThan(credibilityForUrl('https://quora.com/x'));
  });

  it('deduplicates sources by normalized URL and drops unsafe URLs', () => {
    const s = verifySources([
      { url: 'https://example.com/a/', title: 'One' },
      { url: 'https://example.com/a', title: 'One duplicate' },
      { url: 'javascript:alert(1)', title: 'Bad' },
    ], 'news');
    expect(s.length).toBe(1);
    expect(s[0].url).toBe('https://example.com/a/');
  });

  it('flags conflicting version claims across sources', () => {
    const sources = verifySources([
      { url: 'https://a.com/x', title: 'A', snippet: 'The release version is 2.1.0' },
      { url: 'https://b.com/y', title: 'B', snippet: 'The release version is 2.2.0' },
      { url: 'https://c.com/z', title: 'C', snippet: 'The release version is 2.3.0' },
    ], 'releases');
    expect(detectConflicts(sources).length).toBeGreaterThan(0);
  });

  it('builds citations only from real clickable URLs', () => {
    const s = verifySources([{ url: 'https://example.com/page', title: 'Example' }], 'news');
    const md = buildCitations(s);
    expect(md).toContain('**Sources**');
    expect(md).toMatch(/\[Example\]\(https:\/\/example\.com\/page\)/);
    expect(md).not.toContain('javascript:');
  });
});

describe('RTIE content extraction', () => {
  it('strips scripts, styles and tags from HTML', () => {
    const html = '<html><head><script>alert(1)</script></head><body><h1>Title</h1><p>Body text</p></body></html>';
    const text = stripHtml(html);
    expect(text).toContain('Body text');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('<');
  });

  it('hashes content deterministically', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
  });

  it('blocks SSRF targets and non-HTTP schemes', () => {
    expect(() => assertSafeUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => assertSafeUrl('http://localhost:8080/admin')).toThrow();
    expect(() => assertSafeUrl('http://192.168.1.1/router')).toThrow();
    expect(() => assertSafeUrl('ftp://example.com/file')).toThrow();
    expect(assertSafeUrl('https://example.com/page').hostname).toBe('example.com');
  });
});

describe('RTIE freshness', () => {
  it('assigns shorter TTLs to volatile categories', () => {
    expect(ttlForCategory('news')).toBeLessThan(ttlForCategory('documentation'));
    expect(ttlForCategory('prices')).toBeLessThan(ttlForCategory('stable_fact'));
  });

  it('marks expired cache entries as stale', () => {
    expect(isExpired(new Date(Date.now() - 120000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 600000).toISOString())).toBe(false);
    expect(isExpired(expiresForCategory('news'))).toBe(false);
  });

  it('detects changed content for refresh decisions', () => {
    expect(needsRefresh('hash-a', 'hash-a')).toBe(false);
    expect(needsRefresh('hash-a', 'hash-b')).toBe(true);
  });
});

describe('RTIE knowledge cache (in-memory fallback)', () => {
  it('round-trips a stored record and reports it fresh', async () => {
    await storeKnowledge('cache round trip query', 'news', 'verified summary content');
    const { record, fresh } = await lookupKnowledge('cache round trip query', 'news');
    expect(record).not.toBeNull();
    expect(fresh).toBe(true);
    expect(record!.content).toBe('verified summary content');
    expect(record!.contentHash).toBe(hashContent('verified summary content'.slice(0, 2000)));
  });

  it('keys the same topic deterministically and misses for unseen queries', async () => {
    expect(topicKey('Latest AI News', 'news')).toBe(topicKey('latest ai news', 'news'));
    const { record } = await lookupKnowledge('completely unseen query xyzzy', 'news');
    expect(record).toBeNull();
  });
});
