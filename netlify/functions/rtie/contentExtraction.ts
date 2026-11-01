/**
 * Content extraction service — SSRF-safe URL fetching, HTML stripping,
 * title and publication-date extraction.
 * All retrieved webpage content is treated as UNTRUSTED DATA, never as
 * instructions (prompt-injection defense).
 */
import type { ExtractedContent } from './types';

const MAX_CONTENT_CHARS = 12000;
const FETCH_TIMEOUT_MS = 8000;

const BLOCKED_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|\[?::1\]?|.*\.local|.*\.internal|metadata\.google\.internal)/i;

export function assertSafeUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }
  if (BLOCKED_HOST_RE.test(parsed.hostname)) {
    throw new Error('Blocked internal or private host: ' + parsed.hostname);
  }
  return parsed;
}

/** FNV-1a content hash — used for duplicate detection and cache keys. */
export function hashContent(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' + text.length.toString(16);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i);
  if (og) return og[1].trim();
  const t = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
  if (t) return stripHtml(t[1]);
  return '';
}

const DATE_PATTERNS: RegExp[] = [
  /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+name=["'](date|pubdate|publish-date|published|dc.date)["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
  /<time[^>]+datetime=["']([^"']+)["']/i,
];

function extractPublishedAt(html: string, url: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = html.match(pattern);
    const raw = match ? (match[2] || match[1]) : null;
    if (raw) {
      const date = new Date(raw);
      if (!isNaN(date.getTime()) && date.getFullYear() > 1995 && date.getFullYear() <= new Date().getFullYear() + 1) {
        return date.toISOString();
      }
    }
  }
  const urlMatch = url.match(/\/(20\d{2})[-/.]?(0[1-9]|1[0-2])[-/.]?(0[1-9]|[12]\d|3[01])\//);
  if (urlMatch) {
    const date = new Date(urlMatch[1] + '-' + urlMatch[2] + '-' + urlMatch[3] + 'T12:00:00Z');
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

export async function extractContent(
  url: string,
  signal?: AbortSignal
): Promise<ExtractedContent> {
  assertSafeUrl(url);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ManusRemix-RTIE/1.0 (+https://manus.im)', Accept: 'text/html,application/xhtml+xml,text/plain' },
    redirect: 'follow',
    signal: signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Fetch failed HTTP ' + response.status);
  const finalUrl = response.url || url;
  assertSafeUrl(finalUrl);
  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|xhtml/i.test(contentType)) {
    throw new Error('Unsupported content type: ' + contentType.slice(0, 60));
  }
  const raw = (await response.text()).slice(0, 400000);
  const text = stripHtml(raw).slice(0, MAX_CONTENT_CHARS);
  if (!text) throw new Error('No extractable text content.');
  return {
    url: finalUrl,
    title: extractTitle(raw).slice(0, 300) || finalUrl,
    text,
    publishedAt: extractPublishedAt(raw, finalUrl),
    extractedAt: new Date().toISOString(),
    contentHash: hashContent(text.slice(0, 2000)),
  };
}
