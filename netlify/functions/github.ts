import { createCipheriv, createDecipheriv, createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'manus_github_session';
const STATE_COOKIE = 'manus_github_oauth_state';
const MAX_BODY = 32_000;

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
function secret() {
  const value = process.env.GITHUB_OAUTH_SECRET;
  if (!value || value.length < 32) throw new Error('GITHUB_OAUTH_SECRET must be set to a random value of at least 32 characters');
  return createHash('sha256').update(value).digest();
}
function cookieValue(req: Request, name: string) {
  return (req.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1) || '';
}
function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
function encrypt(payload: object) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function decrypt<T>(value: string): T | null {
  try {
    const raw = Buffer.from(value, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', secret(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as T;
  } catch { return null; }
}
function stateSignature(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}
function validStateCookie(value: string, expected: string) {
  const [state, signature] = value.split('.');
  if (!state || !signature || state !== expected) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(stateSignature(state));
  return a.length === b.length && timingSafeEqual(a, b);
}
async function githubApi(token: string, path: string, init: RequestInit = {}) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('Invalid GitHub API path');
  const response = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: 'Unexpected GitHub response' }; }
  if (!response.ok) {
    const error = new Error(typeof data?.message === 'string' ? data.message : 'GitHub API request failed');
    (error as any).status = response.status;
    throw error;
  }
  return data;
}
async function readBody(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('Request body too large');
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error('Invalid JSON body'); }
}
function safeSegment(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
function requireSession(req: Request) {
  const session = decrypt<{ accessToken: string; expiresAt: number }>(cookieValue(req, COOKIE));
  if (!session?.accessToken || !session.expiresAt || session.expiresAt < Date.now()) return null;
  return session;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const pathAction = url.pathname.split('/').filter(Boolean).pop() || 'status';
  const action = url.searchParams.get('action') || pathAction;
  const clearAuth = clearCookie(COOKIE);

  try {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (action === 'connect') {
      if (!clientId) return json({ error: 'GITHUB_CLIENT_ID is not configured on the server' }, 500);
      const state = randomBytes(24).toString('base64url');
      const redirectUri = `${url.origin}/api/github/callback`;
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', 'repo read:user');
      authorize.searchParams.set('state', state);
      return new Response(null, { status: 302, headers: {
        Location: authorize.toString(),
        'Cache-Control': 'no-store',
        'Set-Cookie': cookie(STATE_COOKIE, `${state}.${stateSignature(state)}`, 600),
      }});
    }

    if (action === 'callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!clientId || !clientSecret) return json({ error: 'GitHub OAuth credentials are not configured' }, 500);
      if (!code || !state || !validStateCookie(cookieValue(req, STATE_COOKIE), state)) {
        return json({ error: 'Invalid or expired OAuth state. Please connect again.' }, 400, { 'Set-Cookie': clearCookie(STATE_COOKIE) });
      }
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${url.origin}/api/github/callback` }),
      });
      const tokenData: any = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) return json({ error: 'GitHub authorization failed' }, 401, { 'Set-Cookie': clearCookie(STATE_COOKIE) });
      const expiresIn = Number(tokenData.expires_in) || 8 * 60 * 60;
      const session = encrypt({ accessToken: tokenData.access_token, expiresAt: Date.now() + Math.min(expiresIn, 8 * 60 * 60) * 1000 });
      return new Response(null, { status: 302, headers: {
        Location: '/?github=connected',
        'Cache-Control': 'no-store',
        'Set-Cookie': cookie(COOKIE, session, Math.min(expiresIn, 8 * 60 * 60)),
      }});
    }

    if (action === 'disconnect') {
      return json({ connected: false }, 200, { 'Set-Cookie': clearAuth });
    }

    if (action === 'status') {
      const session = requireSession(req);
      if (!session) return json({ connected: false });
      const user = await githubApi(session.accessToken, '/user');
      return json({ connected: true, user: { login: user.login, avatar_url: user.avatar_url, html_url: user.html_url } });
    }

    const session = requireSession(req);
    if (!session) return json({ error: 'GitHub is not connected. Start at /api/github/connect.' }, 401);

    if (action === 'repos') {
      const page = Math.max(1, Math.min(100, Number(url.searchParams.get('page') || 1)));
      const data = await githubApi(session.accessToken, `/user/repos?per_page=100&page=${page}&sort=updated`);
      return json({ repositories: data.map((repo: any) => ({
        full_name: repo.full_name, name: repo.name, private: repo.private,
        default_branch: repo.default_branch, html_url: repo.html_url,
        permissions: { pull: !!repo.permissions?.pull, push: !!repo.permissions?.push, admin: !!repo.permissions?.admin },
      })) });
    }

    if (action === 'contents') {
      const owner = safeSegment(url.searchParams.get('owner'), 'owner');
      const repo = safeSegment(url.searchParams.get('repo'), 'repository');
      const filePath = url.searchParams.get('path') || '';
      if (filePath.split('/').some(part => part === '..')) return json({ error: 'Invalid file path' }, 400);
      const encoded = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
      const ref = url.searchParams.get('ref');
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return json(await githubApi(session.accessToken, `/repos/${owner}/${repo}/contents/${encoded}${query}`));
    }

    if (action === 'search') {
      const query = url.searchParams.get('q')?.trim();
      if (!query || query.length > 200) return json({ error: 'Provide a search query of up to 200 characters' }, 400);
      return json(await githubApi(session.accessToken, `/search/code?q=${encodeURIComponent(query)}&per_page=20`));
    }

    if (action === 'create-branch') {
      if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const body = await readBody(req);
      const owner = safeSegment(body.owner, 'owner');
      const repo = safeSegment(body.repo, 'repository');
      const branch = safeSegment(body.branch, 'branch');
      const base = safeSegment(body.base, 'base branch');
      const ref = await githubApi(session.accessToken, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
      const created = await githubApi(session.accessToken, `/repos/${owner}/${repo}/git/refs`, {
        method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }),
      });
      return json({ branch: created.ref, sha: created.object.sha }, 201);
    }

    if (action === 'create-pull-request') {
      if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const body = await readBody(req);
      const owner = safeSegment(body.owner, 'owner');
      const repo = safeSegment(body.repo, 'repository');
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
      const head = typeof body.head === 'string' ? body.head.trim() : '';
      const base = safeSegment(body.base, 'base branch');
      const draft = body.draft === true;
      if (!title || !/^[A-Za-z0-9_.\/-]{1,200}$/.test(head)) return json({ error: 'Valid title and head branch are required' }, 400);
      if (body.confirm !== true) return json({ error: 'Confirmation required. Set confirm=true after the user approves creating this pull request.' }, 409);
      const pr = await githubApi(session.accessToken, `/repos/${owner}/${repo}/pulls`, {
        method: 'POST', body: JSON.stringify({ title, head, base, body: typeof body.body === 'string' ? body.body.slice(0, 5000) : '', draft }),
      });
      return json({ number: pr.number, html_url: pr.html_url, state: pr.state }, 201);
    }

    return json({ error: 'Unknown GitHub action' }, 404);
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return json({ error: status >= 500 ? (error?.message || 'GitHub connector error') : error?.message || 'Request failed' }, status);
  }
};