import { auth } from './firebase';

/** Return the current Firebase ID token as a Bearer header, or null when signed out. */
export async function getFirebaseAuthorizationHeader(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const token = forceRefresh ? await user.getIdToken(true) : await user.getIdToken();
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}
