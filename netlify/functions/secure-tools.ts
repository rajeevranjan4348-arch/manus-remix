import { createHmac, timingSafeEqual } from 'node:crypto';

type CommandId = 'open_app' | 'set_volume' | 'set_torch' | 'open_settings';
const allowedCommands = new Set<CommandId>(['open_app', 'set_volume', 'set_torch', 'open_settings']);
const approvalSecret = () => process.env.TOOL_APPROVAL_SECRET || '';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function verifyFirebaseIdToken(req: Request): Promise<{ uid: string; token: string } | null> {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!token || !apiKey) return null;
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const user = data.users?.[0];
    if (!user?.localId || user.disabled === true) return null;
    return { uid: String(user.localId), token };
  } catch {
    return null;
  }
}

function sign(payload: string): string {
  return createHmac('sha256', approvalSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function issueApproval(uid: string, command: CommandId, args: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify({
    uid, command, args, exp: Date.now() + 2 * 60 * 1000, nonce: crypto.randomUUID(),
  })).toString('base64url');
  return payload + '.' + sign(payload);
}

function verifyApproval(token: string, uid: string): { command: CommandId; args: Record<string, unknown> } | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (value.uid !== uid || value.exp < Date.now() || !allowedCommands.has(value.command)) return null;
    return { command: value.command, args: value.args || {} };
  } catch { return null; }
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = await verifyFirebaseIdToken(req);
  if (!auth) return json({ error: 'Sign in with a verified Firebase account. Device actions are disabled until server auth is configured.' }, 401);
  const { uid, token: firebaseIdToken } = auth;
  if (!approvalSecret()) return json({ error: 'TOOL_APPROVAL_SECRET is not configured on the server.' }, 503);

  try {
    const body: any = await req.json();
    if (body.action === 'request-approval') {
      const command = body.command as CommandId;
      const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
      if (!allowedCommands.has(command)) return json({ error: 'This device command is not allowlisted.' }, 400);
      if (JSON.stringify(args).length > 1000) return json({ error: 'Command arguments are too large.' }, 413);
      return json({
        approved: false,
        approvalToken: issueApproval(uid, command, args),
        command: { id: command, args },
        expiresInSeconds: 120,
        requiresUserConfirmation: true,
        requiresNativeCompanion: true,
        note: 'Show a confirmation to the user before submitting this token to execute-approved.',
      });
    }
    if (body.action === 'execute-approved') {
      if (body.approved !== true || typeof body.approvalToken !== 'string') {
        return json({ error: 'Explicit user approval and an approval token are required.' }, 403);
      }
      const approval = verifyApproval(body.approvalToken, uid);
      if (!approval) return json({ error: 'Approval token is invalid, expired, or belongs to another user.' }, 403);
      const projectId = process.env.FIREBASE_PROJECT_ID;
      if (!projectId) return json({ error: 'FIREBASE_PROJECT_ID is not configured; one-time approval consumption is disabled.' }, 503);
      const payloadPart = body.approvalToken.split('.')[0];
      const signedPayload: any = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      const documentId = (uid + '_' + String(signedPayload.nonce || '')).replace(/[^a-zA-Z0-9_-]/g, '_');
      const consumeUrl = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents/toolApprovals/' + encodeURIComponent(documentId) + '?currentDocument.exists=false';
      const consumed = await fetch(consumeUrl, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + firebaseIdToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          uid: { stringValue: uid },
          command: { stringValue: approval.command },
          expiresAt: { integerValue: String(signedPayload.exp) },
          consumedAt: { integerValue: String(Date.now()) }
        } })
      });
      if (!consumed.ok) return json({ error: consumed.status === 409 ? 'This approval token has already been used.' : 'Could not consume the approval token. Check Firestore rules and configuration.' }, 403);
      // This web endpoint never controls the phone directly. A signed plan is returned
      // only for a paired native companion to validate and execute with OS permissions.
      return json({
        approved: true,
        userId: uid,
        command: approval.command,
        args: approval.args,
        requiresNativeCompanion: true,
        execution: 'not-executed-on-server',
      });
    }
    return json({ error: 'Unsupported action.' }, 400);
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
};
