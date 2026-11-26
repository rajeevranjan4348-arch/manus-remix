/**
 * Netlify function: persistent permissions gateway API (Feature 02 upgrade).
 * Challenge resolution, single-use token verification, audit history and
 * per-user policy overrides. Identity always comes from the verified bearer
 * token; ownership is enforced per record.
 */

import crypto from 'crypto';
import { permissionsGateway } from '../../server/permissionsGateway';
import { verifyBearerToken } from '../../src/middleware/auth';

const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  },
});

async function body(req: Request): Promise<any> {
  const len = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(len) && len > 100_000) throw Object.assign(new Error('Payload too large.'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  try {
    const b = await req.json();
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('x');
    return b;
  } catch {
    throw Object.assign(new Error('Malformed JSON payload.'), { code: 'BAD_REQUEST', status: 400 });
  }
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  try {
    const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
    if (!decodedToken?.uid) {
      return jsonResponse({ error: 'Authentication required.', code: 'UNAUTHENTICATED', requestId }, 401);
    }
    const authenticatedUserId = decodedToken.uid;
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/(\.netlify\/functions\/permissions|api\/permissions)/, '');

    if (req.method === 'GET' && (path === '/policies' || path === '' || path === '/')) {
      const storageMode = await permissionsGateway.storageMode();
      return jsonResponse({ success: true, policies: permissionsGateway.getAllPolicies(), durable: storageMode === 'firestore', storageMode });
    }

    if (req.method === 'GET' && path === '/policies/user') {
      const store = await (await import('../../server/security/permissionsStore')).resolvePermissionStore();
      const overrides = await store.getUserPolicies(authenticatedUserId);
      return jsonResponse({ success: true, overrides });
    }

    if (req.method === 'PUT' && path === '/policies/user') {
      const b = await body(req);
      const toolName = String(b.toolName || '').slice(0, 100).trim();
      const effect = b.effect === 'deny' ? 'deny' : b.effect === 'allow' ? 'allow' : null;
      if (!toolName || !effect) return jsonResponse({ error: 'toolName and effect (allow|deny) are required.', code: 'INVALID_POLICY' }, 400);
      // Destructive and privileged actions can never be pre-allowed from the client.
      const policy = permissionsGateway.getPolicy(toolName);
      if (effect === 'allow' && ['destructive', 'privileged'].includes(policy.riskLevel)) {
        return jsonResponse({ error: 'Destructive and privileged actions always require an interactive approval challenge.', code: 'POLICY_NOT_PERMITTED' }, 400);
      }
      await permissionsGateway.setUserPolicy({ userId: authenticatedUserId, toolName, effect });
      return jsonResponse({ success: true, toolName, effect });
    }

    if (req.method === 'GET' && path === '/audit') {
      const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
      const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
      const auditLog = await permissionsGateway.getAuditLog(limit, authenticatedUserId);
      const storageMode = await permissionsGateway.storageMode();
      return jsonResponse({ success: true, auditLog, durable: storageMode === 'firestore', storageMode });
    }

    if (req.method === 'POST' && path === '/evaluate') {
      const b = await body(req);
      if (typeof b.toolName !== 'string' || !b.toolName.trim()) return jsonResponse({ error: 'toolName string is required.', code: 'INVALID_TOOL_NAME' }, 400);
      if (b.userId !== undefined && b.userId !== authenticatedUserId) return jsonResponse({ error: 'Permission request owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      const evaluation = await permissionsGateway.evaluateAction({
        toolName: b.toolName.slice(0, 100).trim(),
        args: (b.args && typeof b.args === 'object' && !Array.isArray(b.args)) ? b.args : {},
        userId: authenticatedUserId,
        target: typeof b.target === 'string' ? b.target.slice(0, 256) : undefined,
        approvalToken: typeof b.approvalToken === 'string' ? b.approvalToken.slice(0, 2048) : undefined,
        requestId,
      });
      return jsonResponse({ success: true, ...evaluation });
    }

    if (req.method === 'POST' && path === '/approve') {
      const b = await body(req);
      if (typeof b.challengeId !== 'string' || typeof b.confirmed !== 'boolean') return jsonResponse({ error: 'challengeId string and confirmed boolean are required.', code: 'INVALID_APPROVAL_REQUEST' }, 400);
      if (b.userId !== undefined && b.userId !== authenticatedUserId) return jsonResponse({ error: 'Approval owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      const resolution = await permissionsGateway.resolveChallenge({
        challengeId: b.challengeId.slice(0, 128),
        confirmed: b.confirmed,
        userId: authenticatedUserId,
        reason: typeof b.reason === 'string' ? b.reason.slice(0, 300) : undefined,
      });
      return jsonResponse(resolution, resolution.success ? 200 : 400);
    }

    if (req.method === 'POST' && path === '/verify') {
      const b = await body(req);
      if (typeof b.approvalToken !== 'string' || typeof b.toolName !== 'string') return jsonResponse({ error: 'approvalToken and toolName are required.', code: 'INVALID_VERIFICATION_REQUEST' }, 400);
      if (b.userId !== undefined && b.userId !== authenticatedUserId) return jsonResponse({ error: 'Verification owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      const verification = await permissionsGateway.verifyApprovalToken({
        approvalToken: b.approvalToken.slice(0, 2048),
        toolName: b.toolName.slice(0, 100),
        args: (b.args && typeof b.args === 'object' && !Array.isArray(b.args)) ? b.args : {},
        userId: authenticatedUserId,
      });
      return jsonResponse(verification, verification.valid ? 200 : 403);
    }

    return jsonResponse({ error: 'Route not found in permissions gateway.', code: 'NOT_FOUND', requestId }, 404);
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status < 500) {
      return jsonResponse({ error: String(err?.message || 'Invalid request.'), code: String(err?.code || 'BAD_REQUEST'), requestId }, status);
    }
    return jsonResponse({ error: 'Unexpected error in permissions gateway.', code: 'INTERNAL_ERROR', requestId }, 500);
  }
};
