import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import { summarizeSessionHistory } from '../../server/geminiService';
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

const safeText = (value: unknown, maxLength: number): string | undefined =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined;

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401);
  }

  const rateLimit = await checkSharedRateLimit(`summarize-session:${decodedToken.uid}`, 20, 60);
  if (rateLimit.unavailable) {
    return jsonResponse({ error: 'Session summaries are temporarily unavailable because the shared rate limiter is not configured.', code: 'RATE_LIMIT_UNAVAILABLE' }, 503);
  }
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: 'Too many summary requests. Please wait and try again.', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    );
  }

  const parsed = await parseJsonBodyLimited(req, 16 * 1024);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error, code: parsed.code }, parsed.status);
  }
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return jsonResponse({ error: 'Expected a JSON object.', code: 'INVALID_PAYLOAD' }, 400);
  }

  const body = parsed.value as Record<string, unknown>;
  const title = safeText(body.title, 300);
  const prompt = safeText(body.prompt, 1200);
  const content = safeText(body.content, 4000);
  const messages = Array.isArray(body.messages)
    ? body.messages.slice(-12).map((message: any) => ({
        role: typeof message?.role === 'string' ? message.role.slice(0, 40) : 'user',
        content: safeText(message?.content, 500) || '',
      }))
    : undefined;

  if (!title && !prompt && !content && (!messages || messages.length === 0)) {
    return jsonResponse({ error: 'Session content is required.', code: 'INVALID_PAYLOAD' }, 400);
  }

  try {
    const summary = await summarizeSessionHistory({ title, prompt, content, messages });
    return jsonResponse({ summary });
  } catch {
    return jsonResponse({ error: 'Failed to generate session summary.' }, 500);
  }
};
