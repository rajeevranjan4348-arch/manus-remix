/**
 * Search provider adapters — configurable, multi-provider web search.
 * All keys stay server-side (Netlify environment variables).
 */
import type { SearchResultItem } from './types';

export interface SearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResultItem[]>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_QUERY_CHARS = 1000;

function isValidUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export class FirecrawlProvider implements SearchProvider {
  readonly name = 'firecrawl';
  isConfigured(): boolean { return Boolean(process.env.FIRECRAWL_API_KEY); }
  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResultItem[]> {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) return [];
    const response = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.slice(0, MAX_QUERY_CHARS), limit: Math.min(limit, 10), sources: [{ type: 'web' }] }),
      signal: signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('Firecrawl HTTP ' + response.status);
    const payload: any = await response.json();
    const items: any[] = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : [];
    return items
      .filter((item) => isValidUrl(item?.url) || isValidUrl(item?.link))
      .map((item) => ({
        title: clampText(item?.title, 300) || String(item?.url || item?.link),
        url: String(item?.url || item?.link),
        snippet: clampText(item?.description || item?.snippet, 1000),
        provider: this.name,
        publishedAt: typeof item?.publishedAt === 'string' ? item.publishedAt : null,
        retrievedAt: new Date().toISOString(),
      }));
  }
}

export class AgentReachProvider implements SearchProvider {
  readonly name = 'agent-reach';
  isConfigured(): boolean { return Boolean(process.env.AGENT_REACH_BRIDGE_URL); }
  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResultItem[]> {
    const bridgeUrl = process.env.AGENT_REACH_BRIDGE_URL;
    if (!bridgeUrl) return [];
    const parsed = new URL(bridgeUrl);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error('Agent Reach bridge must use HTTPS outside localhost.');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.AGENT_REACH_BRIDGE_TOKEN) headers.Authorization = 'Bearer ' + process.env.AGENT_REACH_BRIDGE_TOKEN;
    const response = await fetch(parsed.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: query.slice(0, MAX_QUERY_CHARS), limit: Math.min(limit, 10) }),
      signal: signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error('Agent Reach bridge HTTP ' + response.status);
    const payload: any = await response.json();
    const items: any[] = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
    return items
      .filter((item) => isValidUrl(item?.url) || isValidUrl(item?.link))
      .map((item) => ({
        title: clampText(item?.title, 300) || String(item?.url || item?.link),
        url: String(item?.url || item?.link),
        snippet: clampText(item?.description || item?.snippet || item?.content, 1000),
        provider: this.name,
        publishedAt: typeof item?.publishedAt === 'string' ? item.publishedAt : typeof item?.date === 'string' ? item.date : null,
        retrievedAt: new Date().toISOString(),
      }));
  }
}

/**
 * Generic HTTP search provider — speaks the same minimal JSON contract as
 * web-search.ts ({ results: [{ title, url, snippet }] }). Configure with
 * RTIE_SEARCH_PROVIDER_URL (+ optional bearer token) to plug in any
 * self-hosted SearXNG/Brave/Tavily-style bridge without code changes.
 */
export class GenericHttpProvider implements SearchProvider {
  readonly name = 'custom-bridge';
  isConfigured(): boolean { return Boolean(process.env.RTIE_SEARCH_PROVIDER_URL); }
  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResultItem[]> {
    const url = process.env.RTIE_SEARCH_PROVIDER_URL!;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.RTIE_SEARCH_PROVIDER_TOKEN) headers.Authorization = 'Bearer ' + process.env.RTIE_SEARCH_PROVIDER_TOKEN;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: query.slice(0, MAX_QUERY_CHARS), limit: Math.min(limit, 10) }),
      signal: signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('Custom search bridge HTTP ' + response.status);
    const payload: any = await response.json();
    const items: any[] = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
    return items
      .filter((item) => isValidUrl(item?.url) || isValidUrl(item?.link))
      .map((item) => ({
        title: clampText(item?.title, 300) || String(item?.url || item?.link),
        url: String(item?.url || item?.link),
        snippet: clampText(item?.description || item?.snippet || item?.content, 1000),
        provider: this.name,
        publishedAt: typeof item?.publishedAt === 'string' ? item.publishedAt : typeof item?.date === 'string' ? item.date : null,
        retrievedAt: new Date().toISOString(),
      }));
  }
}

export function getConfiguredProviders(): SearchProvider[] {
  return [new FirecrawlProvider(), new AgentReachProvider(), new GenericHttpProvider()].filter((p) => p.isConfigured());
}

/** Deduplicate results by normalized URL. */
export function dedupeResults(items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  const out: SearchResultItem[] = [];
  for (const item of items) {
    const key = item.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
