import { createDecipheriv, createHash } from 'node:crypto';

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

function readSession(req: Request): { accessToken: string } | null {
  const packed = (req.headers.get('cookie') || '').match(/(?:^|;\s*)github_session=([^;]+)/)?.[1];
  const secret = process.env.GITHUB_SESSION_SECRET;
  if (!packed || !secret) return null;
  try {
    const bytes = Buffer.from(packed, 'base64url');
    if (bytes.length < 29) return null;
    const iv = bytes.subarray(0, 12), tag = bytes.subarray(12, 28), encrypted = bytes.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
    decipher.setAuthTag(tag);
    const data = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
    if (!data.accessToken || Date.now() - data.createdAt > 8 * 60 * 60 * 1000) return null;
    return { accessToken: data.accessToken };
  } catch { return null; }
}

export default async (req: Request) => {
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(req.method)) return respond({ error: 'Method not allowed' }, 405);
  const session = readSession(req);
  if (!session) return respond({ error: 'GitHub not connected. Connect GitHub first.' }, 401);

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'repos';
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  try {
    if (req.method === 'GET' && action === 'status') {
      const { response, data } = await api('/user');
      return response.ok ? respond({ connected: true, login: data.login, avatar_url: data.avatar_url }) : respond({ connected: false }, 401);
    }
    if (req.method === 'GET' && action === 'repos') {
      const { response, data } = await api('/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member');
      if (!response.ok) return respond({ error: 'Could not list repositories.' }, response.status);
      return respond((data as any[]).map((r: any) => ({ id: r.id, full_name: r.full_name, private: r.private, default_branch: r.default_branch, html_url: r.html_url, permissions: { push: Boolean(r.permissions?.push), pull: Boolean(r.permissions?.pull) } })));
    }
    if (req.method === 'GET' && action === 'contents') {
      const repo = url.searchParams.get('repo') || '';
      const path = url.searchParams.get('path') || '';
      const ref = url.searchParams.get('ref') || '';
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || path.split('/').some(p => p === '..')) return respond({ error: 'Invalid repository or path.' }, 400);
      const q = new URLSearchParams(); if (ref) q.set('ref', ref);
      const { response, data } = await api(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${q.size ? '?' + q : ''}`);
      return respond(data, response.status);
    }
    if (req.method === 'PUT' && action === 'file') {
      const body = await req.json() as { repo?: string; path?: string; content?: string; message?: string; branch?: string; sha?: string };
      const { repo, path, content, message, branch, sha } = body;
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !path || path.startsWith('/') || path.split('/').some(p => p === '..') ||
          typeof content !== 'string' || content.length > 800000 || !message?.trim()) return respond({ error: 'Invalid file update request.' }, 400);
      const { response, data } = await api(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), ...(branch ? { branch } : {}), ...(sha ? { sha } : {}) }),
      });
      return respond(response.ok ? { success: true, commit: data.commit?.sha, content: { path: data.content?.path, sha: data.content?.sha, html_url: data.content?.html_url } } : { error: data.message || 'GitHub rejected the file update.' }, response.status);
    }
    if (req.method === 'POST' && action === 'branch') {
      const body = await req.json() as { repo?: string; branch?: string; base?: string };
      if (!body.repo || !/^[\w.-]+\/[\w.-]+$/.test(body.repo) || !body.branch || !/^[A-Za-z0-9._/-]{1,200}$/.test(body.branch) || body.branch.includes('..')) return respond({ error: 'Invalid branch request.' }, 400);
      const base = body.base || 'main';
      const baseResult = await api(`/repos/${body.repo}/git/ref/heads/${encodeURIComponent(base)}`);
      if (!baseResult.response.ok) return respond({ error: 'Could not find base branch.' }, baseResult.response.status);
      const created = await api(`/repos/${body.repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${body.branch}`, sha: baseResult.data.object?.sha }) });
      return respond(created.response.ok ? { success: true, ref: created.data.ref } : { error: created.data.message || 'Branch creation failed.' }, created.response.status);
    }
    if (req.method === 'POST' && action === 'disconnect') {
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': 'github_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' } });
    }
    return respond({ error: 'Unsupported GitHub action.' }, 400);
  } catch {
    return respond({ error: 'GitHub API request failed.' }, 502);
  }
};
