import { issueGuestSessionToken, isSameOriginOrLocalRequest } from '../../server/guestSessionAuth';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';

const jsonResponse = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(extraHeaders || {}),
    },
  });

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!isSameOriginOrLocalRequest(origin, host)) {
    return jsonResponse({ error: 'Cross-origin session request rejected.', code: 'FORBIDDEN_ORIGIN' }, 403);
  }

  const forwardedFor = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  const clientIp = forwardedFor.split(',')[0].trim().slice(0, 64) || 'unknown';
  const rateCheck = await checkSharedRateLimit(`auth-session:${clientIp}`, 30, 60);
  if (rateCheck.unavailable) {
    return jsonResponse(
      { error: 'Session service temporarily unavailable.', code: 'RATE_LIMIT_UNAVAILABLE' },
      503,
      { 'Retry-After': String(rateCheck.retryAfterSeconds) }
    );
  }
  if (!rateCheck.allowed) {
    return jsonResponse(
      { error: 'Too many session requests. Please wait a moment.', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rateCheck.retryAfterSeconds) }
    );
  }

  const session = issueGuestSessionToken();
  return jsonResponse({
    ok: true,
    token: session.token,
    uid: session.uid,
    expiresAt: session.expiresAt,
  });
};
