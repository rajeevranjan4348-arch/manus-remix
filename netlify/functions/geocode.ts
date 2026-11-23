/**
 * Netlify Serverless Function for server-side location geocoding & coordinate validation.
 * Public route mapped from /api/geocode.
 */
import { geocodeLocationServer } from '../../server/geocodingService';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import { verifyBearerToken } from '../../src/middleware/auth';

const jsonResponse = (
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) =>
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
    return jsonResponse(
      { ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      405
    );
  }

  const decodedToken = await verifyBearerToken(
    req.headers.get('authorization') || undefined
  );
  if (!decodedToken?.uid) {
    return jsonResponse(
      { ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' },
      401
    );
  }

  const rateLimit = await checkSharedRateLimit(`geocode:${decodedToken.uid}`, 60, 60);
  if (rateLimit.unavailable) {
    return jsonResponse(
      {
        ok: false,
        error: 'Geocoding is temporarily unavailable because the shared rate limiter is not configured.',
        code: 'RATE_LIMIT_UNAVAILABLE',
      },
      503
    );
  }
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        ok: false,
        error: 'Too many location requests. Please wait a moment before retrying.',
        code: 'RATE_LIMITED',
      },
      429,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) }
    );
  }

  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    const parsed = await parseJsonBodyLimited(req, 4 * 1024);
    if (!parsed.ok) {
      return jsonResponse(
        { ok: false, error: parsed.error, code: parsed.code },
        parsed.status
      );
    }
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return jsonResponse(
        { ok: false, error: 'Expected a JSON object.', code: 'INVALID_PAYLOAD' },
        400
      );
    }
    body = parsed.value as Record<string, unknown>;
  }

  const parsedUrl = new URL(req.url);
  const queryValue =
    body.query ??
    body.location ??
    parsedUrl.searchParams.get('q') ??
    parsedUrl.searchParams.get('query') ??
    parsedUrl.searchParams.get('address') ??
    '';

  if (typeof queryValue !== 'string') {
    return jsonResponse(
      { ok: false, error: 'Location query must be a string.', code: 'INVALID_INPUT' },
      400
    );
  }

  const query = queryValue.trim();
  if (!query || query.length > 200) {
    return jsonResponse(
      {
        ok: false,
        error: 'Provide a location query between 1 and 200 characters.',
        code: 'INVALID_INPUT',
      },
      400
    );
  }

  try {
    const result = await geocodeLocationServer(query);
    return jsonResponse(result, result.ok ? 200 : 404);
  } catch (err: unknown) {
    return jsonResponse(
      {
        ok: false,
        location: null,
        error: err instanceof Error ? err.message : 'Geocoding service unavailable',
        code: 'GEOCODE_ERROR',
      },
      500
    );
  }
};
