import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const API = 'https://api.github.com';
const COOKIE = 'manus_github_session';
const STATE_COOKIE = 'manus_github_oauth_state';
const SESSION_SECONDS = 60 * 60 * 8;
const encoder = new TextEncoder();

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Server configuration missing: ${name}`);
  return value;
}
function parseCookies(header: string | null): Record<string, string> {
  return Object.fromEntries((header || '').split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }).filter(([k]) => Boolean(k)));
}
function cookie(name: string, value: string, maxAge: number, secure = true) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function key() {
  return Buffer.from(env('GITHUB_SESSION_ENCRYPTION_KEY'), 'base64');
}
function encryptSession(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
function decryptSession(value: string): any {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  } catch { return null; }
}
function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function validateRepo(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('Invalid repository name. Use owner/repository.');
  }
  return value;
}
async function github(token: string, path: string, init: RequestInit = {}) {
  if (!path.startsWith('/')) throw new Error('Invalid GitHub API path');
  const response = await fetch(API + path, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Manus-Remix-GitHub-Connector',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
      ? 'GitHub API rate limit reached. Please retry after the reset time.'
      : response.status === 401 ? 'GitHub authorization expired. Reconnect your account.'
      : response.status === 404 ? 'GitHub resource not found or not accessible to this account.'
      : response.status === 409 ? 'GitHub reports a conflict. Refresh repository state and retry.'
      : response.status === 422 ? 'GitHub rejected the requested change. Check branch names, paths, and permissions.'
      : 'GitHub request failed. Please retry later.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}
function getSession(req: Request) {
  const jar = parseCookies(req.headers.get('cookie'));
  const session = jar[COOKIE] ? decryptSession(jar[COOKIE]) : null;
  if (!session?.token || !session?.expiresAt || session.expiresAt < Date.now()) return null;
  return session;
}
async function hasWritePermission(token: string, repo: string) {
  const metadata = await github(token, `/repos/${repo}`);
  const permissions = metadata?.permissions || {};
  if (!(permissions.push || permissions.admin || permissions.maintain)) {
    throw Object.assign(new Error('This GitHub account does not have write permission for this repository.'), { status: 403 });
  }
  return metadata;
}
async function tool(token: string, input: any) {
  const action = String(input?.action || '');
  if (action === 'profile') return github(token, '/user');
  if (action === 'list_repositories') {
    const page = Math.max(1, Math.min(100, Number(input.page) || 1));
    return github(token, `/user/repos?sort=updated&per_page=100&page=${page}`);
  }
  const repo = validateRepo(input.repository);
  if (action === 'repository') return github(token, `/repos/${repo}`);
  if (action === 'list_files') {
    const path = typeof input.path === 'string' ? input.path.replace(/^\/+|\/+$/g, '') : '';
    const ref = typeof input.ref === 'string' ? `?ref=${encodeURIComponent(input.ref)}` : '';
    return github(token, `/repos/${repo}/contents${path ? '/' + path.split('/').map(encodeURIComponent).join('/') : ''}${ref}`);
  }
  if (action === 'read_file') {
    const path = String(input.path || '').replace(/^\/+/, '');
    if (!path || path.split('/').some((part: string) => part === '..')) throw new Error('Invalid file path.');
    const result = await github(token, `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${input.ref ? '?ref=' + encodeURIComponent(String(input.ref)) : ''}`);
    if (Array.isArray(result) || result.type !== 'file') throw new Error('The requested path is not a single file.');
    if (result.size > 500000) throw new Error('File is too large to return safely.');
    if (result.encoding === 'base64' && result.content) result.content = Buffer.from(result.content.replace(/\n/g, ''), 'base64').toString('utf8');
    return result;
  }
  if (action === 'search_code') {
    const q = String(input.query || '').trim();
    if (!q || q.length > 200) throw new Error('Provide a search query up to 200 characters.');
    return github(token, `/search/code?q=${encodeURIComponent(q + ' repo:' + repo)}&per_page=10`);
  }
  if (action === 'issues') return github(token, `/repos/${repo}/issues?state=${input.state === 'closed' ? 'closed' : 'open'}&per_page=30`);
  if (action === 'pull_requests') return github(token, `/repos/${repo}/pulls?state=${input.state === 'closed' ? 'closed' : 'open'}&per_page=30`);
  if (action === 'commits') return github(token, `/repos/${repo}/commits?per_page=30`);
  if (action === 'workflow_runs') return github(token, `/repos/${repo}/actions/runs?per_page=20`);
  if (action === 'create_branch') {
    if (input.confirm !== true) throw Object.assign(new Error('Confirmation required. Retry with confirm=true after the user approves creating this branch.'), { status: 428 });
    const branch = String(input.branch || '');
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.includes('//')) throw new Error('Invalid branch name.');
    const metadata = await hasWritePermission(token, repo);
    const base = String(input.base || metadata.default_branch);
    const ref = await github(token, `/repos/${repo}/git/ref/heads/${base.split('/').map(encodeURIComponent).join('/')}`);
    return github(token, `/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  }
  if (action === 'create_file') {
    if (input.confirm !== true) throw Object.assign(new Error('Confirmation required. Ask the user to approve this file commit first.'), { status: 428 });
    const metadata = await hasWritePermission(token, repo);
    const path = String(input.path || '').replace(/^\/+/, '');
    if (!path || path.split('/').some((part: string) => !part || part === '..')) throw new Error('Invalid file path.');
    if (typeof input.content !== 'string' || input.content.length > 500000) throw new Error('File content is missing or exceeds 500 KB.');
    const branch = String(input.branch || metadata.default_branch);
    return github(token, `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT', body: JSON.stringify({ message: String(input.message || `Add ${path}`).slice(0, 200), content: Buffer.from(input.content, 'utf8').toString('base64'), branch }),
    });
  }
  if (action === 'create_pull_request') {
    if (input.confirm !== true) throw Object.assign(new Error('Confirmation required. Ask the user to approve creating this pull request first.'), { status: 428 });
    await hasWritePermission(token, repo);
    const head = String(input.head || '');
    const base = String(input.base || '');
    const title = String(input.title || '').trim();
    if (!head || !base || !title) throw new Error('Pull request requires head, base, and title.');
    return github(token, `/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ head, base, title: title.slice(0, 256), body: String(input.body || '').slice(0, 60000), draft: Boolean(input.draft) }) });
  }
  throw new Error('Unsupported GitHub connector action.');
}
export default async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || '';
  const secure = url.protocol === 'https:' || process.env.NODE_ENV === 'production';
  try {
    if (action === 'connect') {
      const state = randomBytes(32).toString('base64url');
      const clientId = env('GITHUB_OAUTH_CLIENT_ID');
      const callback = env('GITHUB_OAUTH_CALLBACK_URL');
      const location = new URL('https://github.com/login/oauth/authorize');
      location.searchParams.set('client_id', clientId);
      location.searchParams.set('redirect_uri', callback);
      location.searchParams.set('state', state);
      location.searchParams.set('scope', 'repo read:user');
      return new Response(null, { status: 302, headers: { location: location.toString(), 'cache-control': 'no-store', 'set-cookie': cookie(STATE_COOKIE, state, 600, secure) } });
    }
    if (action === 'callback') {
      const jar = parseCookies(req.headers.get('cookie'));
      const state = url.searchParams.get('state') || '';
      const code = url.searchParams.get('code') || '';
      if (!state || !jar[STATE_COOKIE] || !safeEqual(state, jar[STATE_COOKIE]) || !code) {
        return new Response('GitHub authorization could not be validated. Restart connection from Manus Remix.', { status: 400, headers: { 'cache-control': 'no-store', 'set-cookie': cookie(STATE_COOKIE, '', 0, secure) } });
      }
      if (url.searchParams.has('error')) return new Response('GitHub authorization was declined. You can close this tab.', { status: 400, headers: { 'cache-control': 'no-store', 'set-cookie': cookie(STATE_COOKIE, '', 0, secure) } });
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: env('GITHUB_OAUTH_CLIENT_ID'), client_secret: env('GITHUB_OAUTH_CLIENT_SECRET'), code, redirect_uri: env('GITHUB_OAUTH_CALLBACK_URL') }),
      });
      const tokenData: any = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.access_token || tokenData.error) return json({ error: 'GitHub token exchange failed. Check OAuth configuration and try again.' }, 502, { 'set-cookie': cookie(STATE_COOKIE, '', 0, secure) });
      const profile = await github(tokenData.access_token, '/user');
      const encrypted = encryptSession({ token: tokenData.access_token, user: { login: profile.login, id: profile.id, avatar_url: profile.avatar_url }, expiresAt: Date.now() + SESSION_SECONDS * 1000 });
      const headers = new Headers({ location: '/', 'cache-control': 'no-store' });
      headers.append('set-cookie', cookie(COOKIE, encrypted, SESSION_SECONDS, secure));
      headers.append('set-cookie', cookie(STATE_COOKIE, '', 0, secure));
      return new Response(null, { status: 302, headers });
    }
    if (action === 'disconnect') {
      return json({ connected: false }, 200, { 'set-cookie': cookie(COOKIE, '', 0, secure) });
    }
    if (action === 'status' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return json({ connected: false });
      return json({ connected: true, user: session.user, expiresAt: session.expiresAt });
    }
    if (req.method !== 'POST') return json({ error: 'Use POST for GitHub tools.' }, 405, { allow: 'POST' });
    const session = getSession(req);
    if (!session) return json({ error: 'GitHub account is not connected or the session expired. Start with ?action=connect.' }, 401);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request body.' }, 400);
    const result = await tool(session.token, body);
    return json({ ok: true, result });
  } catch (error: any) {
    const status = Number.isInteger(error?.status) ? error.status : 400;
    return json({ error: status >= 500 ? 'GitHub connector temporarily unavailable.' : String(error?.message || 'GitHub request failed.') }, status);
  }
};
