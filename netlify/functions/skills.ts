/**
 * Netlify Serverless Function: Feature 04 Server-Backed Skills Ecosystem API
 * Routes: /api/skills/* and /.netlify/functions/skills/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import type { DurableRequestContext } from '../../server/sandbox/durableStore';
import { SandboxEngineError } from '../../server/sandbox/sandboxEngine';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
import {
  defaultSkillsEngine,
  PLATFORM_VERSION,
  SkillsEngineError,
  type SkillsEcosystemEngine,
} from '../../server/skills/skillsEngine';
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

async function readJsonBody(req: Request, maxBytes = 128 * 1024) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds allowed limit.' }, 413),
    };
  }
  if (!raw.trim()) return { ok: true as const, data: {} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected JSON object body.' }, 400),
      };
    }
    return { ok: true as const, data: parsed };
  } catch {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

export async function handleSkillsRequest(
  req: Request,
  engine: SkillsEcosystemEngine = defaultSkillsEngine,
): Promise<Response> {
  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`skills:${decoded.uid}`, 60, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for skills API.' }, 429);
  }

  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/skills/, '')
      .replace(/^\/api\/skills/, '') || '/';

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && (subPath === '/catalog' || subPath === '/')) {
      const q = url.searchParams.get('q') || '';
      return jsonResponse({
        ok: true,
        platformVersion: PLATFORM_VERSION,
        catalog: engine.discoverCatalog(q),
      });
    }

    if (req.method === 'GET' && subPath === '/installed') {
      const skills = await engine.listInstalledSkills(ctx);
      return jsonResponse({ ok: true, skills });
    }

    if (req.method === 'GET' && subPath === '/history') {
      const skillId = url.searchParams.get('skillId') || undefined;
      const limit = Number(url.searchParams.get('limit') || '50');
      const history = await engine.listExecutionHistory(ctx, skillId, Number.isFinite(limit) ? limit : 50);
      return jsonResponse({ ok: true, history });
    }

    if (req.method === 'POST' && subPath === '/discover') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const query = typeof parsed.data.query === 'string' ? parsed.data.query : '';
      const selection = query ? await engine.selectBestSkillForTask(ctx, query) : null;
      return jsonResponse({
        ok: true,
        catalog: engine.discoverCatalog(query),
        recommendedInstalled: selection,
      });
    }

    if (req.method === 'POST' && (subPath === '/install' || subPath === '/update')) {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      const skill = await engine.installSkill(ctx, {
        catalogId: typeof body.catalogId === 'string' ? body.catalogId : undefined,
        manifest: body.manifest,
        config: body.config && typeof body.config === 'object' ? body.config : undefined,
        approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
      });
      return jsonResponse({ ok: true, skill }, 201);
    }

    if (req.method === 'POST' && subPath === '/rollback') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const { skillId, targetVersion } = parsed.data;
      if (typeof skillId !== 'string' || typeof targetVersion !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'skillId and targetVersion are required.' }, 400);
      }
      const skill = await engine.rollbackSkillVersion(ctx, skillId, targetVersion);
      return jsonResponse({ ok: true, skill });
    }

    if (req.method === 'POST' && subPath === '/toggle') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const { skillId, enabled } = parsed.data;
      if (typeof skillId !== 'string' || typeof enabled !== 'boolean') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'skillId and enabled boolean are required.' }, 400);
      }
      const skill = await engine.toggleSkill(ctx, skillId, enabled);
      return jsonResponse({ ok: true, skill });
    }

    if (req.method === 'POST' && subPath === '/configure') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const { skillId, config } = parsed.data;
      if (typeof skillId !== 'string' || !config || typeof config !== 'object' || Array.isArray(config)) {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'skillId and config object are required.' }, 400);
      }
      const skill = await engine.configureSkill(ctx, skillId, config);
      return jsonResponse({ ok: true, skill });
    }

    if (req.method === 'POST' && subPath === '/remove') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.skillId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'skillId is required.' }, 400);
      }
      const res = await engine.removeSkill(ctx, parsed.data.skillId);
      return jsonResponse({ ok: true, ...res });
    }

    if (req.method === 'POST' && subPath === '/execute') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (typeof body.skillId !== 'string' || typeof body.taskInput !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'skillId and taskInput strings are required.' }, 400);
      }
      const execution = await engine.executeSkill(ctx, {
        skillId: body.skillId,
        taskInput: body.taskInput,
        approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken : undefined,
        sandboxApprovalToken: typeof body.sandboxApprovalToken === 'string' ? body.sandboxApprovalToken : undefined,
        projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
      });
      return jsonResponse({ ok: true, execution });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in skills API.' }, 404);
  } catch (err) {
    if (err instanceof SkillsEngineError || err instanceof SandboxEngineError) {
      return jsonResponse(
        {
          ok: false,
          code: err.code,
          error: redactSensitiveExecutionText(err.message),
          ...(err.challenge ? { requiresApproval: true, challenge: err.challenge } : {}),
        },
        err.statusCode,
      );
    }
    const msg = err instanceof Error ? err.message : 'Unexpected skills error.';
    return jsonResponse({ ok: false, code: 'SKILLS_ENGINE_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
  }
}

export default async (req: Request) => handleSkillsRequest(req);
