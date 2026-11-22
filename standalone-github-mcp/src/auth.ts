import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { RuntimeConfig } from './config.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
}

let firebaseApp: ReturnType<typeof initializeApp> | undefined;
export function isFirebaseUidAllowed(uid: string, config: RuntimeConfig): boolean {
  return Boolean(uid) && config.allowedFirebaseUids.has(uid);
}

function getFirebaseApp(config: RuntimeConfig) {
  if (firebaseApp) return firebaseApp;
  const existing = getApps().find((app) => app.name === 'cue-github-mcp');
  if (existing) {
    firebaseApp = existing;
    return existing;
  }
  const credential = config.firebaseServiceAccountJson
    ? cert(JSON.parse(config.firebaseServiceAccountJson))
    : undefined;
  firebaseApp = initializeApp({
    projectId: config.firebaseProjectId,
    ...(credential ? { credential } : {}),
  }, 'cue-github-mcp');
  return firebaseApp;
}

export async function authenticateBearer(
  authorization: string | undefined,
  config: RuntimeConfig,
): Promise<AuthenticatedUser | null> {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !config.firebaseProjectId) return null;
  try {
    const decoded = await getAuth(getFirebaseApp(config)).verifyIdToken(match[1]!, true);
    if (!decoded.uid || !isFirebaseUidAllowed(decoded.uid, config)) return null;
    return { uid: decoded.uid, ...(decoded.email ? { email: decoded.email } : {}) };
  } catch {
    return null;
  }
}

export function resetFirebaseAuthForTests() {
  firebaseApp = undefined;
}
