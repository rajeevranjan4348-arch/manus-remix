/**
 * Netlify function: server-backed skills ecosystem (Feature 04).
 *
 * Authenticated router over the SkillsService. Every mutating action passes
 * the durable permission gateway (Feature 02); third-party manifests are
 * untrusted and strictly validated; code-bearing skills run only in the
 * Feature 06 sandbox or are refused with an honest unavailable status.
 */

import crypto from 'crypto';
import { verifyBearerToken } from '../../src/middleware/auth';
import { permissionsGateway } from '../../server/permissionsGateway';
import { SkillsService, BUILTIN_CATALOG } from '../../server/skills/skillsService';
import type { SkillManifest } from '../../server/skills/types';

const SKILL_POLICIES = [
  { toolName: 'skill_install', displayName: 'Install Skill', category: 'system' as const, riskLevel: 'sensitive' as const, description: 'Installs a skill with validated manifest.', consequences: ['Adds instructions and possibly sandbox code to the account.'] },
  { toolName: 'skill_manage', displayName: 'Manage Skill', category: 'system' as const, riskLevel: 'sensitive' as const, description: 'Updates, rolls back, enables or disables an installed skill.', consequences: ['Changes which instructions and tools the agent may use.'] },
  { toolName: 'skill_uninstall', displayName: 'Remove Skill', category: 'system' as const, riskLevel: 'destructive' as const, description: 'Removes an installed skill.', consequences: ['Skill configuration is removed for the account.'] },
  { toolName: 'skill_execute', displayName: 'Execute Skill', category: 'system' as const, riskLevel: 'sensitive' as const, description: 'Runs an installed skill through the approved tool framework.', consequences: ['May invoke the listed tools; sandbox skills run inside the isolated sandbox.'] },
];
for (const p of SKILL_POLICIES) {
  permissionsGateway.registerPolicy({ ...p, requiresConfirmation: true });
}

const jsonResponse = (data: unknown, status = 200, requestId = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': requestId,
    },
  });

const MAX_BODY_BYTES = 1024 * 1024;

async function parseBody(req: Request): Promise<{ body?: Record<string, unknown>; response?: Response }> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds the limit.' }, 413) };
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { response: jsonResponse({ ok: false, code: 'INVALID_PAYLOAD', error: 'Expected a JSON object.' }, 400) };
    }
    return { body: body as Record<string, unknown> };
  } catch {
    return { response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON payload.' }, 400) };
  }
}

function mapError(err: any): { status: number; body: Record<string, unknown> } {
  const status = Number(err?.status) || 500;
  const code = String(err?.code || 'INTERNAL_ERROR');
  if (status >= 400 && status < 500) {
    return { status, body: { ok: false, code, error: String(err?.message || 'Request failed.'), ...(err?.challenge ? { challenge: err.challenge } : {}) } };
  }
  return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', error: 'Unexpected error in the skills service.' } };
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Use GET for reads or POST with an action.' }, 405, requestId);
  }

  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401, requestId);
  }
  const userId = decoded.uid;

  try {
    const service = await SkillsService.create();

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action') || '';
      if (action === 'catalog') {
        return jsonResponse({ ok: true, catalog: service.catalog() }, 200, requestId);
      }
      if (action === 'search') {
        return jsonResponse({ ok: true, ...(await service.search(userId, url.searchParams.get('query') || '')) }, 200, requestId);
      }
      if (action === 'list') {
        const installed = await service.listExecutions ? null : null;
        const skills = await (service as unknown as { storeGet?: unknown }) && null;
        const listRes = await service.search(userId, '');
        return jsonResponse({ ok: true, installed: listRes.installed }, 200, requestId);
      }
      if (action === 'history') {
        const skillId = url.searchParams.get('skillId') || undefined;
        const records = await service.listExecutions(userId, skillId, Number(url.searchParams.get('limit') || 50));
        return jsonResponse({ ok: true, records }, 200, requestId);
      }
      return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
    }

    const parsed = await parseBody(req);
    if (parsed.response) return parsed.response;
    const body = parsed.body as Record<string, unknown>;
    const action = String(body.action || '');
    const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 2048) : undefined;
    const skillId = typeof body.skillId === 'string' ? body.skillId.trim() : '';
    const manifest = (body.manifest && typeof body.manifest === 'object' && !Array.isArray(body.manifest) ? body.manifest : null) as SkillManifest | null;

    const gate = async (toolName: string, args: Record<string, unknown>): Promise<Response | null> => {
      const decision = await permissionsGateway.evaluateAction({ toolName, args, userId, approvalToken });
      if (decision.allowed) return null;
      return jsonResponse({ ok: false, code: decision.requiresApproval ? 'APPROVAL_REQUIRED' : 'PERMISSION_DENIED', error: decision.reason, ...(decision.challenge ? { challenge: decision.challenge } : {}) }, 403, requestId);
    };

    if (action === 'install' || action === 'update') {
      if (!manifest) return jsonResponse({ ok: false, code: 'INVALID_ARGUMENTS', error: 'A skill manifest object is required.' }, 400, requestId);
      const deny = await gate(action === 'install' ? 'skill_install' : 'skill_manage', { skillId: manifest.id, version: manifest.version });
      if (deny) return deny;
      const source = body.source === 'builtin' ? 'builtin' : 'third-party';
      const state = action === 'install'
        ? await service.install(userId, manifest, { source })
        : await service.update(userId, manifest, { source });
      await permissionsGateway.recordAuditEvent({ userId, category: 'tool_execution', toolName: action, status: 'allowed', reason: 'Skill ' + action + ': ' + state.skillId + '@' + state.installedVersion, target: state.skillId }).catch(() => {});
      return jsonResponse({ ok: true, skill: { skillId: state.skillId, enabled: state.enabled, installedVersion: state.installedVersion, source: state.source, versionHistory: state.versionHistory.map((v) => v.version) } }, 200, requestId);
    }

    if (action === 'rollback') {
      const toVersion = typeof body.toVersion === 'string' ? body.toVersion.trim() : '';
      if (!skillId || !toVersion) return jsonResponse({ ok: false, code: 'INVALID_ARGUMENTS', error: 'skillId and toVersion are required.' }, 400, requestId);
      const deny = await gate('skill_manage', { skillId, rollbackTo: toVersion });
      if (deny) return deny;
      const state = await service.rollback(userId, skillId, toVersion);
      return jsonResponse({ ok: true, skill: { skillId: state.skillId, installedVersion: state.installedVersion } }, 200, requestId);
    }

    if (action === 'uninstall') {
      if (!skillId) return jsonResponse({ ok: false, code: 'INVALID_ARGUMENTS', error: 'skillId is required.' }, 400, requestId);
      const deny = await gate('skill_uninstall', { skillId });
      if (deny) return deny;
      await service.uninstall(userId, skillId);
      await permissionsGateway.recordAuditEvent({ userId, category: 'admin_action', toolName: 'skill_uninstall', status: 'allowed', reason: 'Skill removed: ' + skillId, target: skillId }).catch(() => {});
      return jsonResponse({ ok: true, removed: skillId }, 200, requestId);
    }

    if (action === 'enable' || action === 'disable') {
      if (!skillId) return jsonResponse({ ok: false, code: 'INVALID_ARGUMENTS', error: 'skillId is required.' }, 400, requestId);
      const deny = await gate('skill_manage', { skillId, effect: action });
      if (deny) return deny;
      const state = await service.setEnabled(userId, skillId, action === 'enable');
      return jsonResponse({ ok: true, skill: { skillId: state.skillId, enabled: state.enabled } }, 200, requestId);
    }

    if (action === 'execute') {
      if (!skillId) return jsonResponse({ ok: false, code: 'INVALID_ARGUMENTS', error: 'skillId is required.' }, 400, requestId);
      const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {}) as Record<string, unknown>;
      const deny = await gate('skill_execute', { skillId, args });
      if (deny) return deny;
      const execution = await service.execute(userId, skillId, args, { approvalToken });
      const refused = execution.record.status === 'refused';
      return jsonResponse({ ok: !refused, record: execution.record, ...(execution.result ? { result: execution.result } : {}) }, refused ? 409 : 200, requestId);
    }

    return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
  } catch (err: any) {
    const mapped = mapError(err);
    return jsonResponse(mapped.body, mapped.status, requestId);
  }
};
