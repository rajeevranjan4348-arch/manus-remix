import { permissionsGateway } from '../../server/permissionsGateway';

const jsonResponse = (data: any, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  },
});

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/permissions/, '').replace(/^\/api\/permissions/, '');

  // 1. GET /policies: List all registered policies
  if (req.method === 'GET' && (path === '/policies' || path === '' || path === '/')) {
    return jsonResponse({
      success: true,
      policies: permissionsGateway.getAllPolicies(),
    });
  }

  // 2. GET /audit: Retrieve audit log
  if (req.method === 'GET' && path === '/audit') {
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
    return jsonResponse({
      success: true,
      auditLog: permissionsGateway.getAuditLog(limit),
    });
  }

  // 3. POST /evaluate: Check if tool action requires approval
  if (req.method === 'POST' && path === '/evaluate') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
    }

    if (!body || typeof body !== 'object' || typeof body.toolName !== 'string' || !body.toolName.trim()) {
      return jsonResponse({ error: 'toolName string is required.', code: 'INVALID_TOOL_NAME' }, 400);
    }

    const toolName = body.toolName.slice(0, 100).trim();
    const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};
    const userId = typeof body.userId === 'string' ? body.userId.slice(0, 128) : undefined;
    const target = typeof body.target === 'string' ? body.target.slice(0, 256) : undefined;
    const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 128) : undefined;

    const evaluation = permissionsGateway.evaluateAction({
      toolName,
      args,
      userId,
      target,
      approvalToken,
    });

    return jsonResponse({
      success: true,
      ...evaluation,
    });
  }

  // 4. POST /approve: User explicitly confirms or denies a challenge
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

    const challengeId = body.challengeId.slice(0, 128);
    const confirmed = Boolean(body.confirmed);
    const userId = typeof body.userId === 'string' ? body.userId.slice(0, 128) : undefined;
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 300) : undefined;

    const resolution = permissionsGateway.resolveChallenge({
      challengeId,
      confirmed,
      userId,
      reason,
    });

    return jsonResponse(resolution, resolution.success ? 200 : 400);
  }

  // 5. POST /verify: Pre-execution verification and token consumption
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

    const approvalToken = body.approvalToken.slice(0, 128);
    const toolName = body.toolName.slice(0, 100);
    const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};
    const userId = typeof body.userId === 'string' ? body.userId.slice(0, 128) : undefined;

    const verification = permissionsGateway.verifyApprovalToken({
      approvalToken,
      toolName,
      args,
      userId,
    });

    return jsonResponse(verification, verification.valid ? 200 : 403);
  }

  return jsonResponse({ error: 'Route not found in permissions gateway.', code: 'NOT_FOUND' }, 404);
};
