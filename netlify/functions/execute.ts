import { Sandbox } from '@e2b/code-interpreter';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function adminAuth() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin environment variables are not configured');
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getAuth();
}
export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Firebase authentication required' }, 401);
  try { await adminAuth().verifyIdToken(token); } catch { return json({ error: 'Invalid Firebase ID token' }, 401); }
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) return json({ error: 'E2B_API_KEY is not configured on the server' }, 500);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (typeof body.code !== 'string' || !body.code.trim()) return json({ error: 'code string required' }, 400);
  if (body.code.length > 40_000) return json({ error: 'Code exceeds the 40,000 character limit' }, 413);
  let sandbox: any;
  try {
    sandbox = await Sandbox.create({ apiKey, timeoutMs: 60_000 });
    const result = await sandbox.runCode(body.code, { timeoutMs: 60_000 });
    return json({
      success: !result.error,
      results: result.results?.map((item: any) => ({
        text: item.text ?? null,
        html: item.html ?? null,
        png: item.png ?? null,
        json: item.json ?? null,
      })) || [],
      logs: {
        stdout: result.logs?.stdout || [],
        stderr: result.logs?.stderr || [],
      },
      error: result.error ? { name: result.error.name, value: result.error.value } : null,
    });
  } catch (error: any) {
    return json({ error: error?.message || 'Sandbox execution failed' }, 502);
  } finally {
    if (sandbox) { try { await sandbox.kill(); } catch { /* cleanup best-effort */ } }
  }
};
