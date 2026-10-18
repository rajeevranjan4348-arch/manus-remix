import { runVaneResearch, classifyResearchQuery, type VaneResearchMode } from '../../server/research/vaneResearch';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  },
});

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed. Use POST.' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Expected a JSON object.' }, 400);

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 1000) return json({ error: 'Provide a query between 1 and 1000 characters.' }, 400);

  const validModes: VaneResearchMode[] = ['web', 'academic', 'discussion'];
  const mode: VaneResearchMode = validModes.includes(body.mode) ? body.mode : classifyResearchQuery(query);
  const limit = Number.isFinite(body.limit) ? Math.min(10, Math.max(1, Math.floor(body.limit))) : 5;

  try {
    const result = await runVaneResearch(query, { mode, limit });
    if (!result.configured) {
      return json({
        error: 'Research providers are not configured. Set FIRECRAWL_API_KEY and/or AGENT_REACH_BRIDGE_URL in Netlify environment variables.',
        code: 'RESEARCH_NOT_CONFIGURED',
        ...result,
      }, 503);
    }
    return json(result, result.sources.length ? 200 : 502);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Research failed.' }, 500);
  }
};
