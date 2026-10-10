export type IrisCapability = {
  id: string;
  label: string;
  status: string;
  transport?: string;
  env?: string;
  note?: string;
};

export type IrisBridgeResponse = {
  action?: string;
  answer?: string;
  error?: string;
  capabilities?: IrisCapability[];
  sources?: Array<{ title: string; url: string }>;
  [key: string]: unknown;
};

/**
 * Calls the server-side IRIS feature bridge. API keys stay on Netlify and are never
 * passed through browser code. This client is intentionally UI-agnostic.
 */
export async function irisRequest(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<IrisBridgeResponse> {
  const response = await fetch('/api/iris', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `IRIS request failed (${response.status})`);
  }
  return data as IrisBridgeResponse;
}

export async function getIrisCapabilities(signal?: AbortSignal): Promise<IrisCapability[]> {
  const response = await fetch('/api/iris', { headers: { Accept: 'application/json' }, signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data?.capabilities)) {
    throw new Error('Unable to load IRIS capabilities.');
  }
  return data.capabilities as IrisCapability[];
}
