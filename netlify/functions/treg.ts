const TREG_BASE_URL = 'https://treg.to';
const TEAM_SLUG = process.env.TREG_ORG || 'dd-8';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

export default async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use GET for catalog search or POST to call an endpoint.' }, 405);
  }

  const token = process.env.TREG_TOKEN;
  if (!token) {
    return json({
      error: 'Treg is not configured. Add TREG_TOKEN to the server-side Netlify environment variables.',
      code: 'TREG_NOT_CONFIGURED',
    }, 503);
  }

  const url = new URL(req.url);
  const headers = {
    'X-Treg-Token': token,
    'X-Treg-Org': TEAM_SLUG,
    'Accept': 'application/json',
  };

  try {
    if (req.method === 'GET') {
      const query = (url.searchParams.get('q') || '').trim().slice(0, 200);
      if (!query) return json({ error: 'Missing required query parameter: q' }, 400);
      const upstream = new URL('/catalog/search', TREG_BASE_URL);
      upstream.searchParams.set('q', query);
      upstream.searchParams.set('limit', '10');
      const response = await fetch(upstream, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.text();
      return new Response(payload, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const body = await req.json().catch(() => null) as any;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Expected a JSON object.' }, 400);
    }
    const endpointId = typeof body.endpointId === 'string' ? body.endpointId : '';
    if (!/^[a-zA-Z0-9_.-]{1,180}$/.test(endpointId)) {
      return json({ error: 'Invalid Treg endpointId.' }, 400);
    }
    const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'POST';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return json({ error: 'Unsupported upstream method.' }, 400);
    }

    const upstream = new URL('/call/' + endpointId, TREG_BASE_URL);
    if (body.query && typeof body.query === 'object' && !Array.isArray(body.query)) {
      for (const [key, value] of Object.entries(body.query)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          upstream.searchParams.append(key, String(value));
        }
      }
    }

    const upstreamHeaders: Record<string, string> = { ...headers };
    let requestBody: string | undefined;
    if (body.data !== undefined && !['GET', 'DELETE'].includes(method)) {
      requestBody = JSON.stringify(body.data);
      upstreamHeaders['Content-Type'] = 'application/json';
    }
    const response = await fetch(upstream, {
      method,
      headers: upstreamHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.text();
    return new Response(payload, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[Treg proxy] Request failed:', error);
    return json({ error: 'Treg request failed or timed out.', code: 'TREG_UPSTREAM_ERROR' }, 502);
  }
};
