import {
  PermissionsGatewayConfigError,
  permissionsGateway,
  type PermissionsGatewayService,
  type UserPolicyMode,
} from '../../server/permissionsGateway';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
} from '../../server/sandbox/durableStore';
import { verifyBearerToken } from '../../src/middleware/auth';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: SECURITY_HEADERS,
  });

const VALID_USER_POLICY_MODES = new Set<UserPolicyMode>([
  'default',
  'always_require_approval',
  'auto_allow_non_destructive',
  'deny',
]);

function mapGatewayError(err: unknown): Response {
  if (err instanceof PermissionsGatewayConfigError) {
    return jsonResponse(
      {
        success: false,
        error: err.message,
        code: err.code,
      },
      err.statusCode,
    );
  }
  const message = err instanceof Error ? err.message : 'Unexpected permissions gateway error.';
  return jsonResponse({ success: false, error: message, code: 'PERMISSIONS_ERROR' }, 500);
}

export async function handlePermissionsRequest(
  req: Request,
  gateway: PermissionsGatewayService = permissionsGateway,
  store: DurableExecutionStore = defaultDurableStore,
): Promise<Response> {
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401);
  }
  const authenticatedUserId = decodedToken.uid;
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/\.netlify\/functions\/permissions/, '')
    .replace(/^\/api\/permissions/, '');

  const rawAuth = req.headers.get('authorization') || '';
  const bearerToken = rawAuth.toLowerCase().startsWith('bearer ') ? rawAuth.slice(7).trim() : '';
  const durableCtx: DurableRequestContext = {
    userId: authenticatedUserId,
    authToken: bearerToken && !bearerToken.startsWith('guest_') ? bearerToken : undefined,
  };

  try {
    // GET /health: inspect cryptographic secret readiness without revealing secret material.
    if (req.method === 'GET' && path === '/health') {
      const readiness = gateway.validateSecretReadiness();
      return jsonResponse({
        success: true,
        ...readiness,
        persistenceMode: store.getMode(durableCtx),
      });
    }

    // GET /policies: authenticated callers may inspect the static policy catalog.
    if (req.method === 'GET' && (path === '/policies' || path === '' || path === '/')) {
      return jsonResponse({ success: true, policies: gateway.getAllPolicies() });
    }

    // GET /user-policies: list authenticated user's custom per-tool permission policies.
    if (req.method === 'GET' && path === '/user-policies') {
      const userPolicies = await gateway.listUserPoliciesDurable(durableCtx);
      return jsonResponse({ success: true, policies: userPolicies });
    }

    // POST /user-policies: create or update a user-specific permission policy.
    if (req.method === 'POST' && path === '/user-policies') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
      }
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        typeof body.toolName !== 'string' ||
        !body.toolName.trim() ||
        !VALID_USER_POLICY_MODES.has(body.mode)
      ) {
        return jsonResponse(
          {
            error: 'Valid toolName and mode (default | always_require_approval | auto_allow_non_destructive | deny) are required.',
            code: 'INVALID_USER_POLICY',
          },
          400,
        );
      }
      if (body.userId !== undefined && body.userId !== authenticatedUserId) {
        return jsonResponse({ error: 'Policy owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      }
      const saved = await gateway.setUserPolicyDurable(durableCtx, {
        toolName: body.toolName.slice(0, 100),
        mode: body.mode,
        note: typeof body.note === 'string' ? body.note.slice(0, 300) : undefined,
      });
      await gateway.recordSecurityAuditDurable(
        durableCtx,
        {
          action: 'set_user_policy',
          category: 'admin_action',
          resourceId: saved.policyId,
          status: 'succeeded',
          details: { toolName: saved.toolName, mode: saved.mode },
        },
        store,
      );
      return jsonResponse({ success: true, policy: saved });
    }

    // GET /history: return authenticated user's durable approval/rejection/revocation history.
    if (req.method === 'GET' && path === '/history') {
      const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
      const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
      const history = await gateway.listApprovalHistoryDurable(durableCtx, limit);
      return jsonResponse({ success: true, history });
    }

    // GET /audit: return only the authenticated user's own durable & in-memory audit records.
    if (req.method === 'GET' && path === '/audit') {
      const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
      const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
      const durableAudit = await gateway.listAuditDurable(durableCtx, limit, store);
      const memoryAudit = gateway.getAuditLog(limit, authenticatedUserId);
      return jsonResponse({
        success: true,
        auditLog: durableAudit.length > 0 ? durableAudit : memoryAudit,
        durableAuditLog: durableAudit,
      });
    }

    if (req.method === 'POST' && path === '/evaluate') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.toolName !== 'string' || !body.toolName.trim()) {
        return jsonResponse({ error: 'toolName string is required.', code: 'INVALID_TOOL_NAME' }, 400);
      }
      if (body.userId !== undefined && body.userId !== authenticatedUserId) {
        return jsonResponse({ error: 'Permission request owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      }
      const toolName = body.toolName.slice(0, 100).trim();
      const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
      const target = typeof body.target === 'string' ? body.target.slice(0, 256) : undefined;
      const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 128) : undefined;
      const evaluation = await gateway.evaluateActionDurable(
        { toolName, args, userId: authenticatedUserId, target, approvalToken },
        durableCtx,
        store,
      );
      return jsonResponse({ success: true, ...evaluation });
    }

    if (req.method === 'POST' && path === '/approve') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
      }
      if (!body || typeof body.challengeId !== 'string' || typeof body.confirmed !== 'boolean') {
        return jsonResponse({ error: 'challengeId string and confirmed boolean are required.', code: 'INVALID_APPROVAL_REQUEST' }, 400);
      }
      if (body.userId !== undefined && body.userId !== authenticatedUserId) {
        return jsonResponse({ error: 'Approval owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      }
      const resolution = await gateway.resolveChallengeDurable(
        {
          challengeId: body.challengeId.slice(0, 128),
          confirmed: body.confirmed,
          userId: authenticatedUserId,
          reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : undefined,
        },
        durableCtx,
        store,
      );
      return jsonResponse(resolution, resolution.success ? 200 : 400);
    }

    if (req.method === 'POST' && path === '/revoke') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
      }
      if (!body || typeof body.challengeId !== 'string' || !body.challengeId.trim()) {
        return jsonResponse({ error: 'challengeId string is required.', code: 'INVALID_REVOKE_REQUEST' }, 400);
      }
      if (body.userId !== undefined && body.userId !== authenticatedUserId) {
        return jsonResponse({ error: 'Revocation owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      }
      const revocation = await gateway.revokeChallengeDurable(
        {
          challengeId: body.challengeId.slice(0, 128),
          userId: authenticatedUserId,
          reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : undefined,
        },
        durableCtx,
        store,
      );
      return jsonResponse(revocation, revocation.success ? 200 : 400);
    }

    if (req.method === 'POST' && path === '/verify') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
      }
      if (!body || typeof body.approvalToken !== 'string' || typeof body.toolName !== 'string') {
        return jsonResponse({ error: 'approvalToken and toolName are required.', code: 'INVALID_VERIFICATION_REQUEST' }, 400);
      }
      if (body.userId !== undefined && body.userId !== authenticatedUserId) {
        return jsonResponse({ error: 'Verification owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
      }
      const verification = await gateway.verifyApprovalTokenDurable(
        {
          approvalToken: body.approvalToken.slice(0, 128),
          toolName: body.toolName.slice(0, 100),
          args: body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {},
          userId: authenticatedUserId,
        },
        durableCtx,
        store,
      );
      return jsonResponse(verification, verification.valid ? 200 : 403);
    }

    return jsonResponse({ error: 'Route not found in permissions gateway.', code: 'NOT_FOUND' }, 404);
  } catch (err) {
    return mapGatewayError(err);
  }
}

export default async (req: Request) => handlePermissionsRequest(req);
