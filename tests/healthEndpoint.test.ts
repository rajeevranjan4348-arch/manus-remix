import { describe, expect, it } from 'vitest';
import health from '../netlify/functions/health';

describe('health liveness endpoint', () => {
  it('returns a minimal no-store success response without provider configuration', async () => {
    const response = await health(new Request('https://app.test/api/health'));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('ai-app-function');
    expect(payload).not.toHaveProperty('providers');
    expect(payload).not.toHaveProperty('environment');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('allows only GET', async () => {
    const response = await health(new Request('https://app.test/api/health', { method: 'POST' }));
    expect(response.status).toBe(405);
    expect((await response.json()).code).toBe('METHOD_NOT_ALLOWED');
  });
});
