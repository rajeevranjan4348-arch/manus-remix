/**
 * Agentic web search adapter for Deku AI.
 * Supports Firecrawl, Agent Reach HTTP bridge, Gemini Google Search Grounding,
 * and public real-time news/fact feeds (Spaceflight News, Hacker News, USGS, Wikipedia, DuckDuckGo).
 */
import { GoogleGenAI } from '@google/genai';
import { fetchLiveNewsAndFacts } from '../../server/realtimeDataService';
import { searchVerifiedEntityImages } from '../../server/visualSearchService';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { verifyBearerToken } from '../../src/middleware/auth';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: 'firecrawl' | 'agent-reach' | 'google-search-grounding' | 'realtime-feed';
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

function safeResult(value: any, source: SearchResult['source']): SearchResult | null {
  const url = typeof value?.url === 'string' ? value.url : typeof value?.link === 'string' ? value.link : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    title: String(value?.title || value?.name || url).slice(0, 300),
    url,
    snippet: String(value?.description || value?.snippet || value?.markdown || value?.content || '').slice(0, 1600),
    source,
  };
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) return json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401);
  const rateLimit = await checkSharedRateLimit(`web-search:${decodedToken.uid}`, 30, 60);
  if (rateLimit.unavailable) {
    return json({ error: 'Search is temporarily unavailable because the shared rate limiter is not configured.', code: 'RATE_LIMIT_UNAVAILABLE' }, 503);
  }
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Too many search requests. Please wait and try again.', code: 'RATE_LIMITED' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': String(rateLimit.retryAfterSeconds), 'X-Content-Type-Options': 'nosniff' },
    });
  }
  const parsedBody = await parseJsonBodyLimited(req, 16 * 1024);
  if (!parsedBody.ok) {
    return json({ error: parsedBody.error, code: parsedBody.code }, parsedBody.status);
  }
  const body: any = parsedBody.value;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Expected a JSON object.', code: 'INVALID_PAYLOAD' }, 400);
  }

  // Handle Visual Answer Engine image lookup requests (/api/visual-search)
  const reqUrl = new URL(req.url, 'https://deku.local');
  if (
    reqUrl.pathname.endsWith('/visual-search') ||
    body?.mode === 'images' ||
    Array.isArray(body?.queries)
  ) {
    try {
      const queries = Array.isArray(body?.queries)
        ? body.queries.map((q: any) => String(q || '').trim()).filter(Boolean)
        : typeof body?.query === 'string' && body.query.trim()
          ? [body.query.trim()]
          : [];
      const maxResults = Math.min(4, Math.max(1, Number(body?.limit || body?.maxResults) || 4));
      const isComparison = Boolean(body?.isComparison);
      if (queries.length === 0) {
        return json({ ok: true, images: [] });
      }
      const images = await searchVerifiedEntityImages({
        primarySubject: typeof body?.primarySubject === 'string' ? body.primarySubject : queries[0],
        subjects: Array.isArray(body?.subjects) ? body.subjects : undefined,
        queries,
        requiredTokens: Array.isArray(body?.requiredTokens) ? body.requiredTokens : undefined,
        disallowedTokens: Array.isArray(body?.disallowedTokens) ? body.disallowedTokens : undefined,
        isComparison,
        limit: maxResults,
      });
      return json({ ok: true, images });
    } catch (err: any) {
      return json({ ok: false, images: [], error: err?.message || 'Visual search failed' });
    }
  }

  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 1000) {
    return json({ error: 'Provide a query between 1 and 1000 characters.' }, 400);
  }
  const limit = Math.min(10, Math.max(1, Number.isFinite(body?.limit) ? Math.floor(body.limit) : 5));
  const tasks: Promise<SearchResult[]>[] = [];
  const errors: string[] = [];

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) {
    tasks.push((async () => {
      const response = await fetch('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit, sources: [{ type: 'web' }] }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`Firecrawl search returned HTTP ${response.status}`);
      const payload: any = await response.json();
      const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : [];
      return items.map((item: any) => safeResult(item, 'firecrawl')).filter(Boolean) as SearchResult[];
    })().catch((error) => {
      errors.push(error instanceof Error ? error.message : 'Firecrawl search failed');
      return [];
    }));
  }

  const bridgeUrl = process.env.AGENT_REACH_BRIDGE_URL;
  const bridgeToken = process.env.AGENT_REACH_BRIDGE_TOKEN;
  if (bridgeUrl) {
    tasks.push((async () => {
      const parsed = new URL(bridgeUrl);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        throw new Error('Agent Reach bridge must use HTTPS outside localhost.');
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (bridgeToken) headers.Authorization = `Bearer ${bridgeToken}`;
      const response = await fetch(parsed.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, limit }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`Agent Reach bridge returned HTTP ${response.status}`);
      const payload: any = await response.json();
      const items = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
      return items.map((item: any) => safeResult(item, 'agent-reach')).filter(Boolean) as SearchResult[];
    })().catch((error) => {
      errors.push(error instanceof Error ? error.message : 'Agent Reach bridge failed');
      return [];
    }));
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    tasks.push((async () => {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Find the most relevant, accurate, up-to-date facts and sources for: ${query}`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      const text = response.text || '';
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const grounded: SearchResult[] = [];
      for (const chunk of chunks) {
        const web = chunk?.web;
        if (typeof web?.uri === 'string' && /^https?:\/\//i.test(web.uri)) {
          grounded.push({
            title: String(web.title || web.uri).slice(0, 300),
            url: web.uri,
            snippet: text.slice(0, 600),
            source: 'google-search-grounding',
          });
        }
      }
      return grounded;
    })().catch((error) => {
      errors.push(error instanceof Error ? error.message : 'Gemini Google Search grounding failed');
      return [];
    }));
  }

  // Always include live public feed lookup as a resilient real-time source
  tasks.push((async () => {
    const items = await fetchLiveNewsAndFacts(query, limit);
    return items
      .map((item) =>
        safeResult(
          {
            title: item.title,
            url: item.url,
            snippet: item.snippet,
          },
          'realtime-feed'
        )
      )
      .filter(Boolean) as SearchResult[];
  })().catch((error) => {
    errors.push(error instanceof Error ? error.message : 'Realtime feed lookup failed');
    return [];
  }));

  const batches = await Promise.all(tasks);
  const unique = new Map<string, SearchResult>();
  for (const item of batches.flat()) {
    const key = item.url.replace(/#.*$/, '');
    if (!unique.has(key)) unique.set(key, item);
  }
  const results = [...unique.values()].slice(0, limit);
  return json(
    {
      query,
      results,
      providers: [...new Set(results.map((item) => item.source))],
      ...(results.length === 0 && errors.length ? { warnings: errors } : {}),
    },
    results.length ? 200 : 502
  );
};
