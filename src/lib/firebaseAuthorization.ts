import { auth } from './firebase';

/** Return the current Firebase ID token as a Bearer header, or null when signed out. */
export async function getFirebaseAuthorizationHeader(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const token = await user.getIdToken();
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}
