import type { IncomingMessage, ServerResponse } from 'http';
import { adminAuth } from '../lib/firebase-admin.ts';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { verifyGuestSessionToken } from '../../server/guestSessionAuth';

export interface AuthRequest extends IncomingMessage {
  user?: DecodedIdToken;
}

export async function verifyBearerToken(authHeader?: string): Promise<DecodedIdToken | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    return null;
  }

  // First check server-issued HMAC-signed guest session tokens (for no-login workspace sessions)
  if (token.startsWith('guest_v1.')) {
    return verifyGuestSessionToken(token);
  }

  try {
    return await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return null;
  }
}

export const requireAuth = async (
  req: AuthRequest,
  res: ServerResponse & { status?: (code: number) => any; json?: (body: any) => any },
  next: (err?: any) => void
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Unauthorized: Missing token' }));
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Unauthorized: Invalid token' }));
  }
};
