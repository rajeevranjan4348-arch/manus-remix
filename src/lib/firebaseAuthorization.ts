import { auth, signInAnonymouslyUser } from './firebase';

interface InMemoryGuestSession {
  token: string;
  uid: string;
  expiresAt: number;
}

// Held strictly in JS memory (never localStorage/sessionStorage)
let inMemoryGuestSession: InMemoryGuestSession | null = null;
let pendingGuestSessionPromise: Promise<InMemoryGuestSession | null> | null = null;
let attemptedAnonymousSignIn = false;
let pendingAnonymousSignInPromise: Promise<void> | null = null;

export function clearInMemoryGuestSessionToken(): void {
  inMemoryGuestSession = null;
  pendingGuestSessionPromise = null;
}

export function resetAuthorizationAttemptStateForTests(): void {
  inMemoryGuestSession = null;
  pendingGuestSessionPromise = null;
  attemptedAnonymousSignIn = false;
  pendingAnonymousSignInPromise = null;
}

async function waitForFirebaseAuthReady(timeoutMs = 1500): Promise<void> {
  if (typeof auth?.authStateReady !== 'function') return;
  try {
    await Promise.race([
      auth.authStateReady(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Non-fatal: continue to fallback session flow
  }
}

async function requestServerGuestSession(): Promise<InMemoryGuestSession | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;

  const tryMintEndpoint = async (url: string): Promise<InMemoryGuestSession | null> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res || !res.ok) return null;
      const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) return null;
      const data = await res.json().catch(() => null);
      if (
        data &&
        typeof data.token === 'string' &&
        data.token.startsWith('guest_v1.') &&
        typeof data.uid === 'string' &&
        typeof data.expiresAt === 'number'
      ) {
        return {
          token: data.token,
          uid: data.uid,
          expiresAt: data.expiresAt,
        };
      }
    } catch {
      // Try next endpoint
    }
    return null;
  };

  const session =
    (await tryMintEndpoint('/api/auth/session')) ||
    (await tryMintEndpoint('/.netlify/functions/auth-session'));

  if (session) {
    inMemoryGuestSession = session;
  }
  return session;
}

async function ensureInMemoryGuestSession(forceRefresh = false): Promise<InMemoryGuestSession | null> {
  const now = Date.now();
  // Reuse cached guest session if valid for at least 2 more minutes
  if (
    !forceRefresh &&
    inMemoryGuestSession &&
    inMemoryGuestSession.expiresAt - now > 2 * 60 * 1000
  ) {
    return inMemoryGuestSession;
  }

  if (forceRefresh) {
    inMemoryGuestSession = null;
  }

  if (!pendingGuestSessionPromise) {
    pendingGuestSessionPromise = requestServerGuestSession().finally(() => {
      pendingGuestSessionPromise = null;
    });
  }
  return pendingGuestSessionPromise;
}

/**
 * Return a verified Bearer Authorization header for backend API routes:
 * 1. Uses the signed-in Firebase user's ID token when available (waiting for auth hydration first).
 * 2. Attempts quiet Firebase Anonymous sign-in once when no user is signed in.
 * 3. Falls back to a short-lived server-issued HMAC-signed guest session Bearer token held strictly in memory.
 */
export async function getFirebaseAuthorizationHeader(forceRefresh = false): Promise<string | null> {
  await waitForFirebaseAuthReady();

  let user = auth?.currentUser ?? null;

  // Attempt quiet Firebase Anonymous Auth once when login page is removed and no user is signed in
  if (!user && !attemptedAnonymousSignIn && typeof window !== 'undefined') {
    attemptedAnonymousSignIn = true;
    if (!pendingAnonymousSignInPromise) {
      pendingAnonymousSignInPromise = signInAnonymouslyUser()
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          pendingAnonymousSignInPromise = null;
        });
    }
    await pendingAnonymousSignInPromise;
    user = auth?.currentUser ?? null;
  }

  if (user) {
    clearInMemoryGuestSessionToken();
    try {
      const token = forceRefresh ? await user.getIdToken(true) : await user.getIdToken();
      if (token) return `Bearer ${token}`;
    } catch {
      if (!forceRefresh) {
        try {
          const refreshed = await user.getIdToken(true);
          if (refreshed) return `Bearer ${refreshed}`;
        } catch {
          // Fall through to guest session fallback
        }
      }
    }
  }

  // Fallback when Firebase Anonymous Auth is disabled or no user is signed in
  const guestSession = await ensureInMemoryGuestSession(forceRefresh);
  if (guestSession?.token) {
    return `Bearer ${guestSession.token}`;
  }

  return null;
}
