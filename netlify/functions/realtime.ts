/**
 * Netlify Serverless Function for the Real-Time Intelligence Engine (RTIE) & live feeds.
 * Public routes are mapped from /api/realtime, /api/realtime-data, and /api/rtie/research.
 */
import {
  enrichQueryWithRealtimeData,
  fetchLiveCryptoPrices,
  fetchLiveExchangeRates,
  fetchLiveNewsAndFacts,
  fetchLiveWeatherSnapshot,
  getLiveTemporalContext,
} from '../../server/realtimeDataService';
import { orchestrateRealtimeResearch } from '../../server/rtie';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import { verifyBearerToken } from '../../src/middleware/auth';

const jsonResponse = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });

export default async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401);
  }

  const rateLimit = await checkSharedRateLimit(`realtime:${decodedToken.uid}`, 30, 60);
  if (rateLimit.unavailable) {
    return jsonResponse({ ok: false, error: 'Real-time data is temporarily unavailable because the shared rate limiter is not configured.', code: 'RATE_LIMIT_UNAVAILABLE' }, 503);
  }
  if (!rateLimit.allowed) {
    return jsonResponse(
      { ok: false, error: 'Rate limit exceeded. Please wait before retrying.', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    );
  }

  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    const parsed = await parseJsonBodyLimited(req, 16 * 1024);
    if (!parsed.ok) {
      return jsonResponse({ ok: false, error: parsed.error, code: parsed.code }, parsed.status);
    }
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return jsonResponse({ ok: false, error: 'Expected a JSON object.', code: 'INVALID_PAYLOAD' }, 400);
    }
    body = parsed.value as Record<string, unknown>;
  }

  const parsedUrl = new URL(req.url);
  const queryValue = body.query ?? parsedUrl.searchParams.get('q') ?? parsedUrl.searchParams.get('query') ?? '';
  const cityValue = body.city ?? parsedUrl.searchParams.get('city') ?? 'New Delhi';
  if (typeof queryValue !== 'string' || typeof cityValue !== 'string') {
    return jsonResponse({ ok: false, error: 'query and city must be strings.', code: 'INVALID_INPUT' }, 400);
  }
  const query = queryValue.trim();
  const city = cityValue.trim();
  if (query.length > 1000 || city.length > 120) {
    return jsonResponse({ ok: false, error: 'query must be at most 1000 characters and city at most 120 characters.', code: 'INVALID_INPUT' }, 400);
  }

  try {
    if (query) {
      const [rtie, enriched] = await Promise.all([
        orchestrateRealtimeResearch(query, {
          bypassCache: body.bypassCache === true,
          includeGoogleGroundingFetch: body.includeGoogleGroundingFetch === true,
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
  } catch (err: unknown) {
    return jsonResponse({
      ok: true,
      temporal: getLiveTemporalContext(),
      error: err instanceof Error ? err.message : 'Partial real-time feed unavailable',
      code: 'REALTIME_UNAVAILABLE',
    });
  }
};
