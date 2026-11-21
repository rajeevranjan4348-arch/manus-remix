import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import {
  generateImages,
  ImageGenerationError,
  normalizeImageGenerationInput,
} from '../../server/imageGenerationService';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import { verifyBearerToken } from '../../src/middleware/auth';

const MAX_REQUEST_BYTES = 5_500_000;

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

export default async function imageGeneration(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const user = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!user?.uid) {
    return jsonResponse({ error: 'A valid Firebase session is required.', code: 'UNAUTHENTICATED' }, 401);
  }

  const rateLimit = await checkSharedRateLimit(`image-generation:${user.uid}`, 6, 60);
  if (rateLimit.unavailable) {
    return jsonResponse({ error: 'Image generation is temporarily unavailable because the shared rate limiter is not configured.', code: 'RATE_LIMIT_UNAVAILABLE' }, 503);
  }
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: 'Image generation is rate-limited. Please wait before trying again.', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    );
  }

  const parsedBody = await parseJsonBodyLimited(req, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.error, code: parsedBody.code }, parsedBody.status);
  }

  try {
    const input = normalizeImageGenerationInput(parsedBody.value);
    const result = await generateImages(input);
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    console.error('[Image Generation] Request failed unexpectedly.');
    return jsonResponse({ error: 'Image generation failed unexpectedly. Please retry.', code: 'IMAGE_GENERATION_FAILED' }, 500);
  }
}
