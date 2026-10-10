import { createCipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export default async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = req.headers.get('cookie') || '';
  const cookieState = cookies.match(/(?:^|;\s*)github_oauth_state=([^;]+)/)?.[1] || '';
  if (!code || !state || !cookieState || state.length !== cookieState.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
    return json({ error: 'GitHub OAuth state validation failed.' }, 400, { 'Set-Cookie': 'github_oauth_state=; HttpOnly; SameSite=Lax; Path=/.netlify/functions/github-oauth-callback; Max-Age=0' });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const sessionSecret = process.env.GITHUB_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) return json({ error: 'GitHub connector is not configured in Netlify environment variables.' }, 503);

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenResponse.ok || !tokenData.access_token) return json({ error: 'GitHub authorization failed.' }, 401);

    const key = createHash('sha256').update(sessionSecret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: tokenData.access_token, createdAt: Date.now() }), 'utf8'), cipher.final()]);
    const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    const secure = process.env.CONTEXT === 'dev' ? '' : '; Secure';
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/?github=connected',
        'Set-Cookie': [
          `github_session=${packed}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`,
          'github_oauth_state=; HttpOnly; SameSite=Lax; Path=/.netlify/functions/github-oauth-callback; Max-Age=0',
        ].join(', '),
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return json({ error: 'Unable to complete GitHub authorization.' }, 502);
  }
};
