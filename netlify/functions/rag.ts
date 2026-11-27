/**
 * Netlify Serverless Function: Semantic Vector Memory & Document RAG API
 * Routes: /api/rag/* and /.netlify/functions/rag/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import {
  defaultSemanticRagEngine,
  SemanticRagError,
  type SemanticRagEngine,
} from '../../server/rag/semanticRagEngine';
import type { DurableRequestContext } from '../../server/sandbox/durableStore';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
import { verifyBearerToken } from '../../src/middleware/auth';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return undefined;
  const token = auth.slice(7).trim();
  if (!token || token.startsWith('guest_')) return undefined;
  return token;
}

async function readJsonBody(req: Request, maxBytes = 2 * 1024 * 1024) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Document payload exceeds 2MB limit.' }, 413),
    };
  }
  if (!raw.trim()) return { ok: true as const, data: {} as Record<string, any> };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected JSON object body.' }, 400),
      };
    }
    return { ok: true as const, data: parsed as Record<string, any> };
  } catch {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

export async function handleRagRequest(
  req: Request,
  engine: SemanticRagEngine = defaultSemanticRagEngine,
): Promise<Response> {
  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/rag/, '')
      .replace(/^\/api\/rag/, '') || '/';

  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`rag:${decoded.uid}`, 90, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for RAG API.' }, 429);
  }

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && subPath === '/health') {
      return jsonResponse({ ok: true, ...engine.getHealth(ctx) });
    }

    if (req.method === 'GET' && (subPath === '/documents' || subPath === '/')) {
      const sourceType = url.searchParams.get('sourceType') as any;
      const limit = Number(url.searchParams.get('limit') || '100');
      const documents = await engine.listDocuments(ctx, {
        sourceType: sourceType || undefined,
        limit: Number.isFinite(limit) ? limit : 100,
      });
      return jsonResponse({ ok: true, documents });
    }

    if (req.method === 'POST' && subPath === '/index') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (body.userId !== undefined && body.userId !== ctx.userId) {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', error: 'Document owner does not match authenticated user.' }, 403);
      }
      const result = await engine.indexDocument(ctx, {
        documentId: typeof body.documentId === 'string' ? body.documentId : undefined,
        title: typeof body.title === 'string' ? body.title : typeof body.documentTitle === 'string' ? body.documentTitle : '',
        content: typeof body.content === 'string' ? body.content : '',
        sourceType: body.sourceType,
        format: body.format,
        maxChunkChars: typeof body.maxChunkChars === 'number' ? body.maxChunkChars : undefined,
        overlapChars: typeof body.overlapChars === 'number' ? body.overlapChars : undefined,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
      });
      return jsonResponse({ ok: true, ...result }, 201);
    }

    if (req.method === 'POST' && subPath === '/search') {
      const parsed = await readJsonBody(req, 64 * 1024);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const result = await engine.hybridSearch(ctx, {
        query: typeof body.query === 'string' ? body.query : '',
        limit: typeof body.limit === 'number' ? body.limit : 6,
        sourceTypes: Array.isArray(body.sourceTypes) ? body.sourceTypes : undefined,
        documentId: typeof body.documentId === 'string' ? body.documentId : undefined,
        minScore: typeof body.minScore === 'number' ? body.minScore : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (req.method === 'POST' && subPath === '/delete') {
      const parsed = await readJsonBody(req, 16 * 1024);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.documentId !== 'string' || !parsed.data.documentId.trim()) {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'documentId is required.' }, 400);
      }
      const result = await engine.deleteDocument(ctx, parsed.data.documentId.trim());
      return jsonResponse({ ok: true, ...result });
    }

    if (req.method === 'POST' && subPath === '/embed') {
      const parsed = await readJsonBody(req, 256 * 1024);
      if (!parsed.ok) return parsed.response;
      const result = await engine.embedTexts(Array.isArray(parsed.data.texts) ? parsed.data.texts : []);
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in RAG API.' }, 404);
  } catch (err) {
    if (err instanceof SemanticRagError) {
      return jsonResponse(
        { ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) },
        err.statusCode,
      );
    }
    const msg = err instanceof Error ? err.message : 'Unexpected RAG error.';
    return jsonResponse({ ok: false, code: 'RAG_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
  }
}

export default async (req: Request) => handleRagRequest(req);
