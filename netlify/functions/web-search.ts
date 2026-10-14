import { GoogleGenAI } from '@google/genai';

/**
 * Agentic web search adapter for Manus Remix.
 * Powered by Google Search Grounding via Gemini API, with optional
 * Firecrawl and Agent Reach bridge fallbacks.
 */
type SearchResult = { title: string; url: string; snippet: string; source: 'google-search' | 'firecrawl' | 'agent-reach' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
function safeResult(value: any, source: SearchResult['source']): SearchResult | null {
  const url = typeof value?.url === 'string' ? value.url : typeof value?.link === 'string' ? value.link : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return { title: String(value?.title || value?.name || url).slice(0, 300), url,
    snippet: String(value?.description || value?.snippet || value?.markdown || value?.content || '').slice(0, 1600), source };
}
export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 1000) return json({ error: 'Provide a query between 1 and 1000 characters.' }, 400);
  const limit = Math.min(10, Math.max(1, Number.isFinite(body?.limit) ? Math.floor(body.limit) : 5));
  const tasks: Promise<SearchResult[]>[] = [];
  const errors: string[] = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) tasks.push((async () => {
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const searchRes = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Search Google for real-time information, current events, recent news, or fact-checking about: "${query}". Provide a concise factual summary citing the verified sources.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const chunks = searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const textSummary = searchRes.text?.trim() || '';
    const results: SearchResult[] = [];
    for (const chunk of chunks) {
      const web = chunk?.web;
      if (web?.uri && /^https?:\/\//i.test(web.uri)) {
        results.push({
          title: String(web.title || web.uri).slice(0, 300),
          url: web.uri,
          snippet: textSummary.slice(0, 600),
          source: 'google-search',
        });
      }
    }
    return results;
  })().catch((error) => { errors.push(error instanceof Error ? error.message : 'Google Search grounding failed'); return []; }));

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) tasks.push((async () => {
    const response = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST', headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, sources: [{ type: 'web' }] }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Firecrawl search returned HTTP ${response.status}`);
    const payload: any = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : [];
    return items.map((item: any) => safeResult(item, 'firecrawl')).filter(Boolean) as SearchResult[];
  })().catch((error) => { errors.push(error instanceof Error ? error.message : 'Firecrawl search failed'); return []; }));
  const bridgeUrl = process.env.AGENT_REACH_BRIDGE_URL;
  const bridgeToken = process.env.AGENT_REACH_BRIDGE_TOKEN;
  if (bridgeUrl) tasks.push((async () => {
    const parsed = new URL(bridgeUrl);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1')
      throw new Error('Agent Reach bridge must use HTTPS outside localhost.');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bridgeToken) headers.Authorization = `Bearer ${bridgeToken}`;
    const response = await fetch(parsed.toString(), { method: 'POST', headers, body: JSON.stringify({ query, limit }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Agent Reach bridge returned HTTP ${response.status}`);
    const payload: any = await response.json();
    const items = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
    return items.map((item: any) => safeResult(item, 'agent-reach')).filter(Boolean) as SearchResult[];
  })().catch((error) => { errors.push(error instanceof Error ? error.message : 'Agent Reach bridge failed'); return []; }));
  if (!tasks.length) return json({ error: 'Web search is not configured. Set GEMINI_API_KEY, FIRECRAWL_API_KEY, or AGENT_REACH_BRIDGE_URL in environment variables.', results: [] }, 503);
  const batches = await Promise.all(tasks);
  const unique = new Map<string, SearchResult>();
  for (const item of batches.flat()) { const key = item.url.replace(/#.*$/, ''); if (!unique.has(key)) unique.set(key, item); }
  const results = [...unique.values()].slice(0, limit);
  return json({ query, results, providers: [...new Set(results.map((item) => item.source))], ...(results.length === 0 && errors.length ? { warnings: errors } : {}) }, results.length ? 200 : 502);
};
