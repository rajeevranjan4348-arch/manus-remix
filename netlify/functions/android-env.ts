import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const MAX_BODY_BYTES = 8_000;
const MAX_TASK_CHARS = 2_000;

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function getAdminAuth() {
  const existing = getApps().find(app => app.name === '[DEFAULT]');
  if (existing) return getAuth(existing);
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    initializeApp({ credential: cert(JSON.parse(raw)) });
    return getAuth();
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  if (req.method !== 'POST') return respond({ error: 'Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405);
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return respond({ error: 'Request too large.', code: 'PAYLOAD_TOO_LARGE' }, 413);

  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return respond({ error: 'Sign-in is required.', code: 'UNAUTHORIZED' }, 401);

  const auth = getAdminAuth();
  if (!auth) return respond({ error: 'Firebase Admin verification is not configured.', code: 'AUTH_NOT_CONFIGURED' }, 503);

  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken, true);
    uid = decoded.uid;
  } catch {
    return respond({ error: 'Your session is invalid or expired. Sign in again.', code: 'UNAUTHORIZED' }, 401);
  }

  const allowedUid = process.env.ANDROID_ENV_ALLOWED_UID || process.env.ANDROID_CONTROL_ALLOWED_UID;
  if (!allowedUid || uid !== allowedUid) {
    return respond({ error: 'This account is not paired with the AndroidEnv worker.', code: 'DEVICE_ACCESS_DENIED' }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return respond({ error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return respond({ error: 'A JSON object is required.', code: 'BAD_REQUEST' }, 400);
  }

  const task = typeof body.task === 'string' ? body.task.trim() : '';
  if (!task || task.length > MAX_TASK_CHARS) {
    return respond({ error: 'Task must contain 1–2000 characters.', code: 'INVALID_ARGUMENT' }, 400);
  }
  if (body.confirmed !== true) {
    return respond({ error: 'Confirm the Android task before execution.', code: 'CONFIRMATION_REQUIRED' }, 403);
  }

  const workerUrl = process.env.ANDROID_ENV_WORKER_URL;
  const workerToken = process.env.ANDROID_ENV_WORKER_TOKEN;
  if (!workerUrl || !workerToken) {
    return respond({ error: 'AndroidEnv worker is not configured.', code: 'WORKER_NOT_CONFIGURED' }, 503);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(workerUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
      throw new Error('invalid');
    }
  } catch {
    return respond({ error: 'ANDROID_ENV_WORKER_URL must be a valid HTTPS base URL without credentials, query, or fragment.', code: 'WORKER_URL_INVALID' }, 503);
  }

  try {
    const workerResponse = await fetch(new URL('/v1/tasks', parsedUrl.origin), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workerToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ task, requestedBy: uid }),
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    });
    const payload = await workerResponse.json().catch(() => ({}));
    if (!workerResponse.ok) {
      return respond({ error: 'AndroidEnv worker rejected the task.', code: 'WORKER_REQUEST_FAILED' }, 502);
    }
    return respond({ ok: true, result: payload });
  } catch {
    return respond({ error: 'AndroidEnv worker is unreachable or timed out.', code: 'WORKER_UNREACHABLE' }, 502);
  }
};
