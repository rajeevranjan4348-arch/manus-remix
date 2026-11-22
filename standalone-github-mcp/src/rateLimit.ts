import type { RuntimeConfig } from './config.js';

const buckets = new Map<string, { start: number; count: number }>();
const RATE_LIMIT_SCRIPT = [
  "local current = redis.call('INCR', KEYS[1])",
  "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  'return current',
].join('\n');

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  distributed: boolean;
}

export async function consumeRateLimit(
  key: string,
  config: RuntimeConfig,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowMs = 60_000;
  if (config.redisRestUrl && config.redisRestToken) {
    try {
      const response = await fetch(config.redisRestUrl.replace(/\/+$/, ''), {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.redisRestToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', RATE_LIMIT_SCRIPT, '1', `cue-github-mcp:${key}`, String(windowMs)]),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { result?: unknown };
      const count = Number(data?.result);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid Redis response');
      return {
        allowed: count <= config.rateLimitPerMinute,
        retryAfterSeconds: 60,
        remaining: Math.max(0, config.rateLimitPerMinute - count),
        distributed: true,
      };
    } catch {
      if (config.nodeEnv === 'production') {
        return { allowed: false, retryAfterSeconds: 60, remaining: 0, distributed: true };
      }
    }
  } else if (config.nodeEnv === 'production' && config.transport === 'http') {
    return { allowed: false, retryAfterSeconds: 60, remaining: 0, distributed: false };
  }

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: bucket.count <= config.rateLimitPerMinute,
    retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - bucket.start)) / 1000)),
    remaining: Math.max(0, config.rateLimitPerMinute - bucket.count),
    distributed: false,
  };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
