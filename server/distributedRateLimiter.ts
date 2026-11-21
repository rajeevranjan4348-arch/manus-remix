type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  unavailable?: boolean;
  distributed: boolean;
};

const developmentBuckets = new Map<string, { count: number; windowStartMs: number }>();
const RATE_LIMIT_SCRIPT = [
  "local current = redis.call('INCR', KEYS[1])",
  "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  'return current',
].join('\n');

function isProduction(): boolean {
  return process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production';
}

function checkDevelopmentBucket(key: string, limit: number, windowSeconds: number, now = Date.now()): RateLimitResult {
  const windowMs = windowSeconds * 1000;
  let bucket = developmentBuckets.get(key);
  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    bucket = { count: 0, windowStartMs: now };
  }
  bucket.count += 1;
  developmentBuckets.set(key, bucket);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - bucket.windowStartMs)) / 1000));
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds,
    distributed: false,
  };
}

/**
 * Apply an atomic per-key fixed-window limit using shared Redis in deployed environments.
 * Local memory is intentionally restricted to development/test; production fails closed
 * when the shared limiter is not configured or cannot be reached.
 */
export async function checkSharedRateLimit(key: string, limit = 45, windowSeconds = 60): Promise<RateLimitResult> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!redisUrl || !redisToken) {
    if (isProduction()) {
      return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds, unavailable: true, distributed: false };
    }
    return checkDevelopmentBucket(key, limit, windowSeconds);
  }

  try {
    const response = await fetch(redisUrl.replace(/\/+$/, ''), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['EVAL', RATE_LIMIT_SCRIPT, '1', `app-rate:${key}`, String(windowSeconds * 1000)]),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`Shared rate limiter returned HTTP ${response.status}`);
    const payload: any = await response.json();
    const count = Number(payload?.result);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Shared rate limiter returned an invalid count');
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: windowSeconds,
      distributed: true,
    };
  } catch (error) {
    console.error('[Rate Limit] Shared limiter unavailable:', error instanceof Error ? error.message : 'request failed');
    if (isProduction()) {
      return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds, unavailable: true, distributed: true };
    }
    return checkDevelopmentBucket(key, limit, windowSeconds);
  }
}

export function resetDevelopmentRateLimitsForTests(): void {
  developmentBuckets.clear();
}
