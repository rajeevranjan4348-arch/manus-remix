export type LimitedJsonBodyResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      status: 400 | 413;
      code: 'BAD_REQUEST' | 'INVALID_CONTENT_LENGTH' | 'PAYLOAD_TOO_LARGE';
      error: string;
    };

/**
 * Parse a JSON request while enforcing the limit against bytes actually received.
 * Content-Length is only an early-rejection optimization; chunked requests are
 * counted as they arrive so a missing or inaccurate header cannot bypass the cap.
 */
export async function parseJsonBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<LimitedJsonBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    if (!/^\d+$/.test(contentLengthHeader)) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_CONTENT_LENGTH',
        error: 'Content-Length must be a non-negative integer.',
      };
    }
    if (Number(contentLengthHeader) > maxBytes) {
      return {
        ok: false,
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Request payload exceeds the maximum allowed size.',
      };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Request body must contain valid JSON.' };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('Request payload exceeds the maximum allowed size.');
        } catch {
          // The size-limit response remains authoritative if cancellation races the stream.
        }
        return {
          ok: false,
          status: 413,
          code: 'PAYLOAD_TOO_LARGE',
          error: 'Request payload exceeds the maximum allowed size.',
        };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Unable to read request body.' };
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
    return { ok: true, value: JSON.parse(bodyText) as unknown };
  } catch {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Request body must contain valid UTF-8 JSON.' };
  }
}
