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

export default async (req: Request) => {
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401);
  }
  const authenticatedUserId = decodedToken.uid;
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/permissions/, '').replace(/^\/api\/permissions/, '');

  // GET /policies: authenticated callers may inspect the static policy catalog.
  if (req.method === 'GET' && (path === '/policies' || path === '' || path === '/')) {
    return jsonResponse({ success: true, policies: permissionsGateway.getAllPolicies() });
  }

  // GET /audit: return only the authenticated user's own audit records.
  if (req.method === 'GET' && path === '/audit') {
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
    return jsonResponse({ success: true, auditLog: permissionsGateway.getAuditLog(limit, authenticatedUserId) });
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
    const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};
    const target = typeof body.target === 'string' ? body.target.slice(0, 256) : undefined;
    const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 128) : undefined;
    const evaluation = permissionsGateway.evaluateAction({ toolName, args, userId: authenticatedUserId, target, approvalToken });
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
    const resolution = permissionsGateway.resolveChallenge({
      challengeId: body.challengeId.slice(0, 128),
      confirmed: body.confirmed,
      userId: authenticatedUserId,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : undefined,
    });
    return jsonResponse(resolution, resolution.success ? 200 : 400);
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
    const verification = permissionsGateway.verifyApprovalToken({
      approvalToken: body.approvalToken.slice(0, 128),
      toolName: body.toolName.slice(0, 100),
      args: (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {},
      userId: authenticatedUserId,
    });
    return jsonResponse(verification, verification.valid ? 200 : 403);
  }

  return jsonResponse({ error: 'Route not found in permissions gateway.', code: 'NOT_FOUND' }, 404);
};
