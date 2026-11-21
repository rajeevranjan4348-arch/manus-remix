import { Capacitor } from '@capacitor/core';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signInAnonymously as fbSignInAnonymously,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  reload,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Firestore with specific database ID (CRITICAL: Required for named database if provided)
export const db = (firebaseConfig as any).firestoreDatabaseId
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
  : getFirestore(app);

// Firebase Auth owns credentials and refresh tokens; passwords are never persisted by the app.
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Firebase Auth] Persistence initialization notice:', err?.code || 'persistence-unavailable');
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

let nativeGoogleInitialization: Promise<void> | null = null;

function getAuthContinueUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}/login`;
}

export async function setRememberMePersistence(rememberMe: boolean): Promise<void> {
  await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
}

export async function createEmailAccount(
  email: string,
  password: string,
  displayName?: string,
  rememberMe = true,
): Promise<FirebaseUser> {
  if (password.length < 8) {
    throw Object.assign(new Error('Choose a password with at least 8 characters.'), { code: 'app/password-too-short' });
  }

  await setRememberMePersistence(rememberMe);
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const cleanName = displayName?.trim();
  if (cleanName) {
    await updateProfile(credential.user, { displayName: cleanName });
  }

  const url = getAuthContinueUrl();
  await sendEmailVerification(credential.user, url ? { url } : undefined);
  return credential.user;
}

export async function signInWithEmail(
  email: string,
  password: string,
  rememberMe = true,
): Promise<FirebaseUser> {
  await setRememberMePersistence(rememberMe);
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export async function resendEmailVerification(user: FirebaseUser): Promise<void> {
  const url = getAuthContinueUrl();
  await sendEmailVerification(user, url ? { url } : undefined);
}

export async function refreshCurrentUser(): Promise<FirebaseUser | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  await reload(currentUser);
  return auth.currentUser;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const url = getAuthContinueUrl();
  await sendPasswordResetEmail(auth, email.trim(), url ? { url } : undefined);
}

async function signInWithNativeGoogle(): Promise<FirebaseUser> {
  const webClientId = (firebaseConfig as any).oAuthClientId as string | undefined;
  if (!webClientId) {
    throw Object.assign(new Error('Google sign-in is not configured for this app.'), { code: 'app/google-client-not-configured' });
  }

  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!nativeGoogleInitialization) {
    nativeGoogleInitialization = SocialLogin.initialize({
      google: { webClientId, mode: 'online' },
    });
  }

  try {
    await nativeGoogleInitialization;
  } catch (error) {
    nativeGoogleInitialization = null;
    throw error;
  }

  // Android uses Google's native Credential Manager. The returned Google ID token is
  // exchanged for a Firebase credential so the rest of the app keeps one auth session.
  const response = await SocialLogin.login({
    provider: 'google',
    options: { scopes: ['profile', 'email'] },
  });
  if (response.result.responseType !== 'online' || !response.result.idToken) {
    throw Object.assign(new Error('Google did not return a sign-in token. Check the Android OAuth setup.'), {
      code: 'app/google-token-missing',
    });
  }

  const credential = GoogleAuthProvider.credential(
    response.result.idToken,
    response.result.accessToken?.token ?? undefined,
  );
  return (await signInWithCredential(auth, credential)).user;
}

export async function signInWithGoogle(): Promise<FirebaseUser | null> {
  try {
    if (Capacitor.getPlatform() === 'android') {
      return await signInWithNativeGoogle();
    }

    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    if (
      error?.code !== 'auth/popup-closed-by-user' &&
      error?.code !== 'auth/cancelled-popup-request'
    ) {
      console.warn('[Firebase Auth] Google Sign-In notice:', error?.code || 'provider-error');
    }
    throw error;
  }
}

export async function signInAnonymouslyUser(): Promise<FirebaseUser | null> {
  try {
    const result = await fbSignInAnonymously(auth);
    return result.user;
  } catch (error) {
    console.warn('[Firebase Auth] Anonymous sign-in notice:', (error as any)?.code || 'provider-error');
    return null;
  }
}

export async function signOutUser(): Promise<void> {
  try {
    if (Capacitor.getPlatform() === 'android') {
      try {
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        await SocialLogin.logout({ provider: 'google' });
      } catch {
        // The native Google account may not be signed in (e.g. this was an email login).
      }
    }
    await fbSignOut(auth);
  } catch (error) {
    console.error('[Firebase Auth] Sign-out failed:', (error as any)?.code || 'sign-out-error');
    throw error;
  }
}

// Structured Firestore error handling as mandated by Firebase Integration Skill
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Initial connection test as mandated by Firebase Integration Skill
export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

// Test connection on boot
if (typeof window !== 'undefined') {
  testConnection();
}
