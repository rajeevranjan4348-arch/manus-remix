/**
 * Vane-inspired research primitives adapted for Manus Remix.
 * Keeps Manus's Netlify runtime, model providers, UI, and conversation store.
 */
export type VaneResearchMode = 'web' | 'academic' | 'discussion';
export interface VaneResearchSource {
  title: string;
  url: string;
  snippet: string;
  provider: 'firecrawl' | 'agent-reach';
}
export interface VaneResearchResult {
  query: string;
  mode: VaneResearchMode;
  sources: VaneResearchSource[];
  providers: string[];
  warnings: string[];
  configured: boolean;
}
type ResearchOptions = { limit?: number; mode?: VaneResearchMode };

export function classifyResearchQuery(query: string): VaneResearchMode {
  if (/\b(paper|papers|academic|scholar|peer[- ]reviewed|journal|research study|arxiv|doi)\b/i.test(query)) return 'academic';
  if (/\b(reddit|forum|discussion|community opinion|user experiences|what do people think)\b/i.test(query)) return 'discussion';
  return 'web';
}

/** Keep casual chat on its fast path; research/current-information requests use search. */
export function shouldResearchQuery(text: string): boolean {
  return /\b(latest|today|current|currently|right now|breaking|live|real[\s-]?time|news|headlines|recent|this week|yesterday|weather|stock price|share price|exchange rate|world news|india news|tech news|latest updates|election results|box office|release date|latest version|price today|score|standings|forecast|who won|who is (the )?(prime minister|president|chief minister|ceo)|who are the (current|latest)|research|compare|sources|citations|academic|papers|journal|reddit|discussions|according to|find evidence)\b/i.test(text)
    || /\b(202[5-9]|203\d)\b/.test(text)
    || /\b(what happened|what's happening|whats happening|tell me about the latest|latest on)\b/i.test(text);
}

function normalizeSource(value: any, provider: VaneResearchSource['provider']): VaneResearchSource | null {
  const rawUrl = typeof value?.url === 'string' ? value.url : typeof value?.link === 'string' ? value.link : '';
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = '';
    const url = parsed.toString();
    return {
      title: String(value?.title || value?.name || url).trim().slice(0, 300),
      snippet: String(value?.description || value?.snippet || value?.markdown || value?.content || '').trim().slice(0, 1600),
      url,
      provider,
    };
  } catch {
    return null;
  }
}

function configuredBridgeUrl(raw: string): URL {
  const parsed = new URL(raw);
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) throw new Error('Agent Reach bridge must use HTTPS outside localhost.');
  if (parsed.username || parsed.password) throw new Error('Agent Reach bridge URL must not embed credentials.');
  return parsed;
}

export async function runVaneResearch(query: string, options: ResearchOptions = {}): Promise<VaneResearchResult> {
  const cleanQuery = query.trim().slice(0, 1000);
  const limit = Math.min(10, Math.max(1, Math.floor(options.limit ?? 5)));
  const mode = options.mode ?? classifyResearchQuery(cleanQuery);
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const bridgeUrl = process.env.AGENT_REACH_BRIDGE_URL;
  const configured = Boolean(firecrawlKey || bridgeUrl);
  const warnings: string[] = [];
  const tasks: Promise<VaneResearchSource[]>[] = [];

  if (firecrawlKey) {
    tasks.push((async () => {
      const response = await fetch('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + firecrawlKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cleanQuery, limit, sources: [{ type: 'web' }] }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Firecrawl search returned HTTP ' + response.status);
      const payload: any = await response.json();
      const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : [];
      return items.slice(0, limit).map((item: any) => normalizeSource(item, 'firecrawl')).filter(Boolean) as VaneResearchSource[];
    })().catch((error) => {
      warnings.push(error instanceof Error ? error.message : 'Firecrawl search failed');
      return [];
    }));
  }

  if (bridgeUrl) {
    tasks.push((async () => {
      const parsed = configuredBridgeUrl(bridgeUrl);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.AGENT_REACH_BRIDGE_TOKEN) headers.Authorization = 'Bearer ' + process.env.AGENT_REACH_BRIDGE_TOKEN;
      const response = await fetch(parsed.toString(), {
        method: 'POST', headers, body: JSON.stringify({ query: cleanQuery, limit, mode }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Agent Reach bridge returned HTTP ' + response.status);
      const payload: any = await response.json();
      const items = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
      return items.slice(0, limit).map((item: any) => normalizeSource(item, 'agent-reach')).filter(Boolean) as VaneResearchSource[];
    })().catch((error) => {
      warnings.push(error instanceof Error ? error.message : 'Agent Reach bridge failed');
      return [];
    }));
  }

  const batches = await Promise.all(tasks);
  const unique = new Map<string, VaneResearchSource>();
  for (const source of batches.flat()) {
    const key = source.url.toLowerCase();
    const previous = unique.get(key);
    if (!previous || (!previous.snippet && source.snippet)) unique.set(key, source);
  }

  return {
    query: cleanQuery,
    mode,
    sources: [...unique.values()].slice(0, limit),
    providers: [...new Set([...unique.values()].map((source) => source.provider))],
    warnings,
    configured,
  };
}
