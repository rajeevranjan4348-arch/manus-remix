import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const allowedActions = new Set([
  'status',
  'home',
  'flashlight_toggle',
  'volume_up',
  'volume_down',
  'open_settings',
  'launch_app',
]);

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getAdminAuth() {
  if (getApps().length) return getAuth();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const serviceAccount = JSON.parse(raw);
    initializeApp({ credential: cert(serviceAccount) });
    return getAuth();
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  if (req.method !== 'POST') return respond({ error: 'Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405);

  const length = Number(req.headers.get('content-length') || 0);
  if (length > 16_000) return respond({ error: 'Request too large.', code: 'PAYLOAD_TOO_LARGE' }, 413);

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return respond({ error: 'Sign-in is required.', code: 'UNAUTHORIZED' }, 401);

  const adminAuth = getAdminAuth();
  if (!adminAuth) return respond({ error: 'Firebase Admin verification is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON in Netlify.', code: 'AUTH_NOT_CONFIGURED' }, 503);

  try {
    await adminAuth.verifyIdToken(token, true);
  } catch {
    return respond({ error: 'Your session is invalid or expired. Sign in again.', code: 'UNAUTHORIZED' }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return respond({ error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, 400); }
  const action = typeof body?.action === 'string' ? body.action : '';
  const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};

  if (!allowedActions.has(action)) return respond({ error: 'This Android action is not allowed.', code: 'ACTION_NOT_ALLOWED' }, 400);
  if (action === 'launch_app') {
    const packageName = args.packageName;
    if (typeof packageName !== 'string' || packageName.length > 180 || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName)) {
      return respond({ error: 'A valid Android packageName is required.', code: 'INVALID_ARGUMENT' }, 400);
    }
  }

  const bridgeUrl = process.env.ANDROID_CONTROL_BRIDGE_URL;
  const bridgeToken = process.env.ANDROID_CONTROL_BRIDGE_TOKEN;
  if (!bridgeUrl || !bridgeToken) {
    return respond({ error: 'Android control bridge is not configured.', code: 'BRIDGE_NOT_CONFIGURED', message: 'Android control bridge is not configured.' }, 503);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(bridgeUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) throw new Error('invalid');
  } catch {
    return respond({ error: 'ANDROID_CONTROL_BRIDGE_URL must be a valid HTTPS URL.', code: 'BRIDGE_CONFIG_INVALID' }, 503);
  }

  const endpoint = action === 'status' ? '/health' : '/v1/control';
  try {
    const bridgeResponse = await fetch(new URL(endpoint, parsedUrl.origin), {
      method: action === 'status' ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        ...(action === 'status' ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(action === 'status' ? {} : { body: JSON.stringify({ action, args }) }),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const payload = await bridgeResponse.json().catch(() => ({}));
    if (!bridgeResponse.ok) return respond({ error: 'The Android bridge rejected the request.', code: 'BRIDGE_REQUEST_FAILED', details: payload?.message || payload?.error || undefined }, 502);
    return respond(payload);
  } catch {
    return respond({ error: 'Could not reach the Android bridge. Check that the paired device service is online.', code: 'BRIDGE_UNREACHABLE' }, 502);
  }
};
