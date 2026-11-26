/**
 * Feature 02 API: persistent permissions & security audit.
 * All state changes go through the durable gateway backed by Firestore
 * transactions. Frontend decisions are never trusted: every sensitive action
 * is re-verified server-side with single-use token consumption.
 */
import {
  permissionsGateway,
  AuditRecord,
} from '../../server/permissionsGateway';
import { verifyBearerToken } from '../../src/middleware/auth';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';

const jsonResponse = (data: unknown, status = 200, requestId = crypto.randomUUID()) =>
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

function wrongUser(body: any, authenticatedUserId: string): boolean {
  return body.userId !== undefined && body.userId !== authenticatedUserId;
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401, requestId);
  }
  const authenticatedUserId = decodedToken.uid;
  const rateCheck = await checkSharedRateLimit(`permissions:${authenticatedUserId}`, 90, 60);
  if (!rateCheck.allowed) {
    return jsonResponse({ error: 'Too many requests.', code: 'RATE_LIMITED' }, 429, requestId);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/permissions/, '').replace(/^\/api\/permissions/, '');

  // GET /policies: authenticated callers may inspect the static policy catalog.
  if (req.method === 'GET' && (path === '/policies' || path === '' || path === '/')) {
    return jsonResponse({
      success: true,
      policies: permissionsGateway.getAllPolicies(),
      durability: {
        persistenceMode: permissionsGateway.getPersistenceMode(),
        secretConfigured: permissionsGateway.isSecretConfigured(),
        ready: permissionsGateway.durableReady(),
      },
    }, 200, requestId);
  }

  // GET /audit: only the authenticated user's own durable audit records.
  if (req.method === 'GET' && path === '/audit') {
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
    try {
      let auditLog: AuditRecord[] = await permissionsGateway.getDurableAuditLog(limit, authenticatedUserId);
      if (auditLog.length === 0) {
        auditLog = permissionsGateway.getAuditLog(limit, authenticatedUserId);
      }
      return jsonResponse({ success: true, auditLog }, 200, requestId);
    } catch {
      return jsonResponse({ error: 'Audit store unavailable.', code: 'AUDIT_UNAVAILABLE' }, 503, requestId);
    }
  }

  if (req.method === 'POST') {
    const parsed = await parseJsonBodyLimited(req, 256 * 1024);
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error, code: parsed.code }, parsed.status, requestId);
    }
    const body: any = parsed.value;

    if (path === '/evaluate') {
      if (!body || typeof body.toolName !== 'string' || !body.toolName.trim()) {
        return jsonResponse({ error: 'toolName string is required.', code: 'INVALID_TOOL_NAME' }, 400, requestId);
      }
      if (wrongUser(body, authenticatedUserId)) {
        return jsonResponse({ error: 'Permission request owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403, requestId);
      }
      const toolName = body.toolName.slice(0, 100).trim();
      const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};
      const target = typeof body.target === 'string' ? body.target.slice(0, 256) : undefined;
      const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 128) : undefined;

      if (approvalToken) {
        // Hydrate the durable token into this instance before the sync evaluation.
        await permissionsGateway.hydrateToken(approvalToken);
      }
      await permissionsGateway.hydrateUserContext(authenticatedUserId, [toolName]);

      const evaluation = permissionsGateway.evaluateAction({
        toolName,
        args,
        userId: authenticatedUserId,
        target,
        approvalToken,
        requestId,
      });
      return jsonResponse({ success: true, ...evaluation }, evaluation.unavailable ? 503 : 200, requestId);
    }

    if (path === '/approve') {
      if (!body || typeof body.challengeId !== 'string' || typeof body.confirmed !== 'boolean') {
        return jsonResponse({ error: 'challengeId string and confirmed boolean are required.', code: 'INVALID_APPROVAL_REQUEST' }, 400, requestId);
      }
      if (wrongUser(body, authenticatedUserId)) {
        return jsonResponse({ error: 'Approval owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403, requestId);
      }
      try {
        const resolution = await permissionsGateway.resolveChallenge({
          challengeId: body.challengeId.slice(0, 128),
          confirmed: body.confirmed,
          userId: authenticatedUserId,
          reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : undefined,
        });
        return jsonResponse(resolution, resolution.success ? 200 : 400, requestId);
      } catch (error) {
        return jsonResponse(
          { error: 'Durable challenge storage unavailable.', code: 'PERMISSIONS_STORE_UNAVAILABLE' },
          503,
          requestId,
        );
      }
    }

    if (path === '/verify') {
      if (!body || typeof body.approvalToken !== 'string' || typeof body.toolName !== 'string') {
        return jsonResponse({ error: 'approvalToken and toolName are required.', code: 'INVALID_VERIFICATION_REQUEST' }, 400, requestId);
      }
      if (wrongUser(body, authenticatedUserId)) {
        return jsonResponse({ error: 'Verification owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403, requestId);
      }
      try {
        const verification = await permissionsGateway.verifyApprovalToken({
          approvalToken: body.approvalToken.slice(0, 128),
          toolName: body.toolName.slice(0, 100),
          args: (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {},
          userId: authenticatedUserId,
          requestId,
        });
        return jsonResponse(verification, verification.valid ? 200 : 403, requestId);
      } catch (error) {
        return jsonResponse({ error: 'Durable token verification unavailable.', code: 'PERMISSIONS_STORE_UNAVAILABLE' }, 503, requestId);
      }
    }

    if (path === '/revoke') {
      if (!body || typeof body.toolName !== 'string' || !body.toolName.trim()) {
        return jsonResponse({ error: 'toolName string is required.', code: 'INVALID_TOOL_NAME' }, 400, requestId);
      }
      await permissionsGateway.hydrateUserContext(authenticatedUserId, [body.toolName.slice(0, 100)]);
      const result = await permissionsGateway.revokePermission({
        userId: authenticatedUserId,
        toolName: body.toolName.slice(0, 100),
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : undefined,
      });
      return jsonResponse({ success: result.success }, 200, requestId);
    }

    if (path === '/policy') {
      if (!body || typeof body.toolName !== 'string' || !['deny', 'allow-window'].includes(body.mode)) {
        return jsonResponse({ error: 'toolName and a valid mode (deny|allow-window) are required.', code: 'INVALID_POLICY_REQUEST' }, 400, requestId);
      }
      const result = await permissionsGateway.setUserPolicy({
        userId: authenticatedUserId,
        toolName: body.toolName.slice(0, 100),
        mode: body.mode,
        expiresAt: Number.isFinite(Number(body.expiresAt)) ? Number(body.expiresAt) : undefined,
        updatedBy: authenticatedUserId,
      });
      return jsonResponse({ success: result.success }, 200, requestId);
    }
  }

  return jsonResponse({ error: 'Route not found in permissions gateway.', code: 'NOT_FOUND' }, 404, requestId);
};
