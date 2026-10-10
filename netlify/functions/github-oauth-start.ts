import { randomBytes } from 'node:crypto';

export default async () => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return new Response('GitHub connector is not configured. Set GITHUB_CLIENT_ID in Netlify.', { status: 503 });
  const state = randomBytes(32).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.URL || ''}/.netlify/functions/github-oauth-callback`,
    scope: 'repo',
    state,
    allow_signup: 'true',
  });
  const secure = process.env.CONTEXT === 'dev' ? '' : '; Secure';
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params.toString()}`,
      'Set-Cookie': `github_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/.netlify/functions/github-oauth-callback; Max-Age=600${secure}`,
      'Cache-Control': 'no-store',
    },
  });
};
