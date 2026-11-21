const jsonResponse = (data: unknown, status = 200, requestId = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Request-ID': requestId,
    },
  });

/** Minimal liveness probe only; does not claim that third-party providers or databases are healthy. */
export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  if (req.method !== 'GET') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', requestId }, 405, requestId);
  }
  return jsonResponse({
    ok: true,
    service: 'ai-app-function',
    generatedAt: new Date().toISOString(),
    requestId,
  }, 200, requestId);
};
