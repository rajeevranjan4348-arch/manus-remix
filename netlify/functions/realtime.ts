/**
 * Netlify Serverless Function for Real-Time Intelligence Engine (RTIE) & Live Feeds
 * Endpoint: /.netlify/functions/realtime (mapped from /api/realtime, /api/realtime-data, /api/rtie/research)
 */

import {
  enrichQueryWithRealtimeData,
  fetchLiveCryptoPrices,
  fetchLiveExchangeRates,
  fetchLiveNewsAndFacts,
  fetchLiveWeatherSnapshot,
  getLiveTemporalContext,
} from '../../server/realtimeDataService';
import {
  knowledgeCacheService,
  orchestrateRealtimeResearch,
} from '../../server/rtie';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });

export default async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const clientIp =
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'netlify-client';
  const rateCheck = knowledgeCacheService.checkRateLimit(clientIp, 60);
  if (!rateCheck.allowed) {
    return jsonResponse(
      { ok: false, error: 'Rate limit exceeded. Please wait before retrying.' },
      429
    );
  }

  try {
    const parsedUrl = new URL(req.url);
    let body: any = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const query = String(
      body.query || parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query') || ''
    ).trim();
    const city = String(body.city || parsedUrl.searchParams.get('city') || 'New Delhi').trim();

    if (query) {
      const [rtie, enriched] = await Promise.all([
        orchestrateRealtimeResearch(query, {
          bypassCache: Boolean(body.bypassCache),
          includeGoogleGroundingFetch: Boolean(body.includeGoogleGroundingFetch),
        }),
        enrichQueryWithRealtimeData(query),
      ]);

      return jsonResponse({
        ok: true,
        ...enriched,
        rtie,
        route: rtie.route,
        verification: rtie.verification,
        freshness: rtie.freshness,
      });
    }

    const [weather, currency, crypto, news] = await Promise.all([
      fetchLiveWeatherSnapshot(city),
      fetchLiveExchangeRates('USD', 'INR', 1),
      fetchLiveCryptoPrices(),
      fetchLiveNewsAndFacts('latest technology and science news', 4),
    ]);

    return jsonResponse({
      ok: true,
      temporal: getLiveTemporalContext(),
      weather,
      currency,
      crypto,
      news,
    });
  } catch (err: any) {
    return jsonResponse({
      ok: true,
      temporal: getLiveTemporalContext(),
      error: err?.message || 'Partial real-time feed unavailable',
    });
  }
};
