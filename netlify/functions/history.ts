import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  }});
}
function firebase() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin environment variables are not configured');
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return { auth: getAuth(), db: getFirestore() };
}
async function userId(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) return null;
  try { return (await firebase().auth.verifyIdToken(match[1])).uid; } catch { return null; }
}
export default async (req: Request) => {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
  try {
    const uid = await userId(req);
    if (!uid) return json({ error: 'Valid Firebase ID token required' }, 401);
    const { db } = firebase();
    const url = new URL(req.url);
    const collection = db.collection('users').doc(uid).collection('manusHistory');
    if (req.method === 'GET') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
      const snapshot = await collection.orderBy('updatedAt', 'desc').limit(limit).get();
      return json({ items: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return json({ error: 'Valid history id required' }, 400);
      await collection.doc(id).delete();
      return json({ deleted: true });
    }
    const raw = await req.text();
    if (raw.length > 200_000) return json({ error: 'Payload too large' }, 413);
    let body: any;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON body' }, 400); }
    const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(body.id) ? body.id : collection.doc().id;
    const kind = body.kind === 'work' ? 'work' : 'chat';
    const title = typeof body.title === 'string' ? body.title.slice(0, 240) : 'Untitled';
    const payload = body.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'data object required' }, 400);
    await collection.doc(id).set({
      kind, title, data: payload, updatedAt: FieldValue.serverTimestamp(),
      createdAt: body.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });
    return json({ id, kind, title, saved: true }, 201);
  } catch (error: any) {
    return json({ error: error?.message || 'History operation failed' }, 500);
  }
};
