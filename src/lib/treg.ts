export type TregCallOptions = {
  endpointId: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean>;
  data?: unknown;
};

/** Search Treg's endpoint catalog through the server-side proxy. */
export async function searchTregCatalog(query: string) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`/api/treg?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Treg catalog search failed (${response.status})`);
  return payload;
}

/** Call a Treg catalog endpoint. TREG_TOKEN is never sent to the browser. */
export async function callTregEndpoint(options: TregCallOptions) {
  const response = await fetch('/api/treg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(payload?.error || `Treg call failed (${response.status})`);
  return payload;
}
