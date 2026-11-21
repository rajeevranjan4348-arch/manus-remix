import { describe, expect, it } from 'vitest';
import { parseJsonBodyLimited } from '../server/limitedJsonBody';

function post(body: string, headers?: HeadersInit): Request {
  return new Request('https://app.test/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(headers).entries()) },
    body,
  });
}

describe('bounded JSON body parsing', () => {
  it('accepts valid JSON within the byte limit', async () => {
    const request = post(JSON.stringify({ query: 'hello' }));
    const result = await parseJsonBodyLimited(request, 64);
    expect(result).toEqual({ ok: true, value: { query: 'hello' } });
  });

  it('rejects an oversized body even when the request has no Content-Length header', async () => {
    const request = post(JSON.stringify({ value: 'x'.repeat(200) }));
    expect(request.headers.has('content-length')).toBe(false);
    const result = await parseJsonBodyLimited(request, 64);
    expect(result).toMatchObject({ ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects an oversized declared length before consuming the body', async () => {
    const request = new Request('https://app.test/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' },
    });
    const result = await parseJsonBodyLimited(request, 64);
    expect(result).toMatchObject({ ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects malformed JSON with a client error', async () => {
    const result = await parseJsonBodyLimited(post('{not json'), 64);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'BAD_REQUEST' });
  });

  it('rejects non-integer Content-Length values', async () => {
    const request = new Request('https://app.test/api/test', {
      method: 'POST',
      headers: { 'Content-Length': '12junk' },
    });
    const result = await parseJsonBodyLimited(request, 64);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_CONTENT_LENGTH' });
  });
});
