/**
 * Feature 04 API: server-backed skills ecosystem.
 */
import { verifyBearerToken } from '../../src/middleware/auth';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import {
  durableSkills,
  SkillManifestError,
  SKILL_MANIFEST_MAX_BYTES,
} from '../../server/skills/durableSkills';

const jsonResponse = (data: unknown, status = 200, requestId: string = crypto.randomUUID()) =>
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

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401, requestId);
  }
  const userId = decodedToken.uid;
  const rateCheck = await checkSharedRateLimit(`skills:${userId}`, 60, 60);
  if (!rateCheck.allowed) {
    return jsonResponse({ ok: false, error: 'Too many requests.', code: 'RATE_LIMITED' }, 429, requestId);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/skills/, '').replace(/^\/api\/skills/, '');

  try {
    if (req.method === 'GET' && (path === '' || path === '/catalog')) {
      const installed = await durableSkills.listInstalled(userId);
      return jsonResponse({ ok: true, installed, builtins: durableSkills.listBuiltins(), requestId }, 200, requestId);
    }
    if (req.method === 'GET' && path === '/search') {
      const term = (url.searchParams.get('q') || '').slice(0, 120);
      const results = await durableSkills.search(userId, term);
      return jsonResponse({ ok: true, results, requestId }, 200, requestId);
    }
    if (req.method === 'GET' && path === '/history') {
      const skillId = url.searchParams.get('skillId') || undefined;
      const history = await durableSkills.listExecutionHistory(userId, skillId);
      return jsonResponse({ ok: true, history, requestId }, 200, requestId);
    }

    if (req.method === 'POST') {
      const parsed = await parseJsonBodyLimited(req, Math.max(256 * 1024, SKILL_MANIFEST_MAX_BYTES));
      if (!parsed.ok) {
        return jsonResponse({ ok: false, error: parsed.error, code: parsed.code }, parsed.status, requestId);
      }
      const body: any = parsed.value;
      const action = typeof body.action === 'string' ? body.action : '';
      const skillId = typeof body.skillId === 'string' ? body.skillId.slice(0, 100) : '';

      switch (action) {
        case 'install': {
          try {
            const installed = await durableSkills.install(userId, body.manifest, typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined);
            return jsonResponse({ ok: true, installed, dependencyOk: installed.dependencyOk, requestId }, 201, requestId);
          } catch (error) {
            if (error instanceof SkillManifestError) {
              return jsonResponse({ ok: false, error: error.message, code: 'INVALID_MANIFEST' }, 400, requestId);
            }
            if (error instanceof Error && error.message.includes('already installed')) {
              return jsonResponse({ ok: false, error: error.message, code: 'ALREADY_INSTALLED' }, 409, requestId);
            }
            throw error;
          }
        }
        case 'update': {
          try {
            const updated = await durableSkills.update(userId, skillId, body.manifest);
            return jsonResponse({ ok: true, installed: updated, requestId }, 200, requestId);
          } catch (error) {
            if (error instanceof SkillManifestError) {
              return jsonResponse({ ok: false, error: error.message, code: 'INVALID_MANIFEST' }, 400, requestId);
            }
            throw error;
          }
        }
        case 'rollback': {
          if (!skillId || typeof body.toVersion !== 'string') {
            return jsonResponse({ ok: false, error: 'skillId and toVersion are required.', code: 'INVALID_REQUEST' }, 400, requestId);
          }
          const rolled = await durableSkills.rollback(userId, skillId, body.toVersion.slice(0, 32));
          return jsonResponse({ ok: true, installed: rolled, requestId }, 200, requestId);
        }
        case 'uninstall': {
          const removed = await durableSkills.uninstall(userId, skillId);
          return jsonResponse({ ok: removed, requestId }, removed ? 200 : 404, requestId);
        }
        case 'enable':
        case 'disable': {
          const updated = await durableSkills.setEnabled(userId, skillId, action === 'enable');
          return jsonResponse({ ok: updated, requestId }, updated ? 200 : 404, requestId);
        }
        case 'configure': {
          const configured = await durableSkills.configure(userId, skillId, body.configuration ?? {});
          return jsonResponse({ ok: configured, requestId }, configured ? 200 : 404, requestId);
        }
        case 'execute': {
          const record = await durableSkills.executeSkill({
            userId,
            skillId,
            input: body.input ?? {},
            approvalToken: typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 128) : undefined,
          });
          return jsonResponse({ ok: record.status === 'completed', execution: record, requestId }, 200, requestId);
        }
        default:
          return jsonResponse({ ok: false, error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, requestId);
      }
    }

    return jsonResponse({ ok: false, error: 'Route not found.', code: 'NOT_FOUND' }, 404, requestId);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: 'Skills storage unavailable.',
        detail: (error instanceof Error ? error.message : '').slice(0, 300),
        code: 'SKILLS_STORE_UNAVAILABLE',
      },
      503,
      requestId,
    );
  }
};
