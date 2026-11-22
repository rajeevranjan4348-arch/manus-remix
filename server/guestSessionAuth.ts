import crypto from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';

const TOKEN_PREFIX = 'guest_v1';
const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // 12 hours

// In-memory process fallback secret when SESSION_SECRET / POLICY_GATEWAY_SECRET is not set.
let ephemeralProcessSecret: string | null = null;

function getSigningSecret(): string {
  const configured =
    process.env.SESSION_SECRET?.trim() ||
    process.env.POLICY_GATEWAY_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }
  if (!ephemeralProcessSecret) {
    ephemeralProcessSecret = crypto.randomBytes(32).toString('hex');
  }
  return ephemeralProcessSecret;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64').toString('utf8');
}

function signPayload(encodedPayload: string): string {
  const hmac = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${TOKEN_PREFIX}.${encodedPayload}`)
    .digest();
  return base64UrlEncode(hmac);
}

export interface IssuedGuestSession {
  token: string;
  uid: string;
  expiresAt: number;
}

/**
 * Issues a short-lived HMAC-SHA256 signed guest session Bearer token
 * for no-login public workspace sessions.
 */
export function issueGuestSessionToken(ttlSeconds = DEFAULT_TTL_SECONDS): IssuedGuestSession {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.max(60, Math.min(24 * 60 * 60, ttlSeconds));
  const uid = `guest_${crypto.randomBytes(12).toString('hex')}`;

  const payload = {
    uid,
    iat: nowSec,
    exp: expSec,
    isGuest: true,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return {
    token: `${TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    uid,
    expiresAt: expSec * 1000,
  };
}

/**
 * Verifies a server-issued `guest_v1.*` Bearer token using constant-time HMAC comparison.
 * Returns a DecodedIdToken-compatible principal on success, or null on any invalid/expired token.
 */
export function verifyGuestSessionToken(token: string): DecodedIdToken | null {
  if (!token || !token.startsWith(`${TOKEN_PREFIX}.`)) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return null;
  }

  const encodedPayload = parts[1];
  const providedSig = parts[2];
  if (!encodedPayload || !providedSig) {
    return null;
  }

  const expectedSig = signPayload(encodedPayload);
  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.uid !== 'string' ||
      !/^guest_[a-f0-9]{16,48}$/.test(parsed.uid) ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number'
    ) {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSec) {
      return null;
    }

    return {
      aud: 'manus-guest-session',
      auth_time: parsed.iat,
      exp: parsed.exp,
      iat: parsed.iat,
      iss: 'manus-guest-session',
      sub: parsed.uid,
      uid: parsed.uid,
      firebase: {
        identities: {},
        sign_in_provider: 'anonymous',
      },
    } as DecodedIdToken;
  } catch {
    return null;
  }
}

/**
 * Validates that an incoming Origin header (when present) matches the request Host/X-Forwarded-Host.
 */
export function isSameOriginOrLocalRequest(
  originHeader?: string | null,
  hostHeader?: string | null
): boolean {
  if (!originHeader) return true;
  try {
    const originUrl = new URL(originHeader);
    if (!hostHeader) return true;
    const normalizedHost = hostHeader.split(',')[0].trim().toLowerCase();
    return originUrl.host.toLowerCase() === normalizedHost;
  } catch {
    return false;
  }
}
