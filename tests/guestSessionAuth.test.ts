import { describe, it, expect, beforeEach } from 'vitest';
import authSession from '../netlify/functions/auth-session';
import agent from '../netlify/functions/agent';
import {
  issueGuestSessionToken,
  verifyGuestSessionToken,
  isSameOriginOrLocalRequest,
} from '../server/guestSessionAuth';
import { verifyBearerToken } from '../src/middleware/auth';
import { resetDevelopmentRateLimitsForTests } from '../server/distributedRateLimiter';

describe('Server-Issued Guest Session Authentication', () => {
  beforeEach(() => {
    resetDevelopmentRateLimitsForTests();
  });

  it('issues and verifies HMAC-SHA256 signed guest_v1 Bearer tokens', async () => {
    const issued = issueGuestSessionToken(600);
    expect(issued.token.startsWith('guest_v1.')).toBe(true);
    expect(issued.uid.startsWith('guest_')).toBe(true);

    const verified = verifyGuestSessionToken(issued.token);
    expect(verified?.uid).toBe(issued.uid);

    const viaMiddleware = await verifyBearerToken(`Bearer ${issued.token}`);
    expect(viaMiddleware?.uid).toBe(issued.uid);
  });

  it('rejects tampered, malformed, or missing Bearer tokens', async () => {
    const issued = issueGuestSessionToken(600);
    const parts = issued.token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}XXXX`;

    expect(verifyGuestSessionToken(tampered)).toBeNull();
    expect(verifyGuestSessionToken('guest_v1.invalid')).toBeNull();
    expect(await verifyBearerToken(undefined)).toBeNull();
    expect(await verifyBearerToken(`Bearer ${tampered}`)).toBeNull();
  });

  it('validates same-origin check for guest session minting', () => {
    expect(isSameOriginOrLocalRequest(null, 'app.example.com')).toBe(true);
    expect(isSameOriginOrLocalRequest('https://app.example.com', 'app.example.com')).toBe(true);
    expect(isSameOriginOrLocalRequest('https://evil.attacker.test', 'app.example.com')).toBe(false);
  });

  it('mints a verified guest session via POST /api/auth/session and authenticates /api/agent without a login screen', async () => {
    // Rejects GET requests
    const getRes = await authSession(new Request('https://app.test/api/auth/session', { method: 'GET' }));
    expect(getRes.status).toBe(405);

    // Rejects cross-origin POST requests
    const crossOriginRes = await authSession(
      new Request('https://app.test/api/auth/session', {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example.com',
          Host: 'app.test',
        },
      })
    );
    expect(crossOriginRes.status).toBe(403);

    // Same-origin POST succeeds and mints a valid Bearer token
    const sessionRes = await authSession(
      new Request('https://app.test/api/auth/session', {
        method: 'POST',
        headers: {
          Origin: 'https://app.test',
          Host: 'app.test',
        },
      })
    );
    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.ok).toBe(true);
    expect(typeof sessionBody.token).toBe('string');

    // Sending that token to /api/agent passes authentication (does not return 401)
    const agentRes = await agent(
      new Request('https://app.test/api/gemini/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionBody.token}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Render an interactive 3D tourbillon watch' }],
        }),
      })
    );
    expect(agentRes.status).toBe(200);
    const sseText = await agentRes.text();
    expect(sseText).toContain('threejs-scene');
    expect(sseText).not.toContain('Authentication required');
  });
});
