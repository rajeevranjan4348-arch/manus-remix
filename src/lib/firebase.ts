import { Capacitor } from '@capacitor/core';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  getRedirectResult,
  signInAnonymously as fbSignInAnonymously,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  reload,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

interface FirebaseSingletonStore {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  persistencePromise: Promise<void> | null;
  redirectResultPromise: Promise<FirebaseUser | null> | null;
  lastOAuthAccessToken: string | null;
  lastResolvedUser: FirebaseUser | null;
  authStateInitialized: boolean;
}

const SINGLETON_KEY = '__MANUS_FIREBASE_SINGLETON_V1__';

function getOrCreateFirebaseSingleton(): FirebaseSingletonStore {
  const g = globalThis as Record<string, unknown>;
  const existing = g[SINGLETON_KEY] as FirebaseSingletonStore | undefined;
  if (existing?.app && existing?.auth && existing?.db) {
    return existing;
  }

  // Always reuse the canonical [DEFAULT] Firebase app if already initialized (critical for Vite HMR / reloads).
  const appInstance: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

  // Initialize Firestore once with configured named database and long-polling auto-detection for iframe previews.
  const databaseId = (firebaseConfig as any).firestoreDatabaseId as string | undefined;
  const dbInstance: Firestore = (() => {
    try {
      return databaseId
        ? initializeFirestore(appInstance, { experimentalAutoDetectLongPolling: true }, databaseId)
        : initializeFirestore(appInstance, { experimentalAutoDetectLongPolling: true });
    } catch {
      return databaseId ? getFirestore(appInstance, databaseId) : getFirestore(appInstance);
    }
  })();

  // Initialize Firebase Auth strictly once on the singleton app instance.
  const authInstance: Auth = getAuth(appInstance);

  const store: FirebaseSingletonStore = {
    app: appInstance,
    db: dbInstance,
    auth: authInstance,
    persistencePromise: null,
    redirectResultPromise: null,
    lastOAuthAccessToken: null,
    lastResolvedUser: authInstance.currentUser ?? null,
    authStateInitialized: false,
  };

  g[SINGLETON_KEY] = store;
  return store;
}

const firebaseSingleton = getOrCreateFirebaseSingleton();

export const app: FirebaseApp = firebaseSingleton.app;
export const db: Firestore = firebaseSingleton.db;
export const auth: Auth = firebaseSingleton.auth;

/**
 * Ensures Firebase Auth is configured with browserLocalPersistence before any login or session check.
 * Safe to call repeatedly; shares a single cached promise across the session and HMR cycles.
 */
export function ensureAuthPersistence(): Promise<void> {
  if (!firebaseSingleton.persistencePromise) {
    firebaseSingleton.persistencePromise = setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.warn('[Firebase Auth] browserLocalPersistence notice:', (err as any)?.code || err);
    });
  }
  return firebaseSingleton.persistencePromise;
}

// Kick off browserLocalPersistence immediately on singleton creation in browser environments.
if (typeof window !== 'undefined') {
  void ensureAuthPersistence();
}

/**
 * Returns the last Google OAuth access token obtained in-memory during sign-in/redirect (never persisted to localStorage).
 */
export function getInMemoryGoogleOAuthToken(): string | null {
  return firebaseSingleton.lastOAuthAccessToken;
}

export function setInMemoryGoogleOAuthToken(token: string | null): void {
  firebaseSingleton.lastOAuthAccessToken = token;
}

export function getSingletonAuthSnapshot(): { user: FirebaseUser | null; initialized: boolean } {
  return {
    user: auth.currentUser ?? firebaseSingleton.lastResolvedUser,
    initialized: firebaseSingleton.authStateInitialized,
  };
}

export function markSingletonAuthResolved(user: FirebaseUser | null): void {
  firebaseSingleton.lastResolvedUser = user;
  firebaseSingleton.authStateInitialized = true;
}

/**
 * Resolves any pending OAuth redirect sign-in result once per page load.
 * Captures both the authenticated Firebase user and any Google OAuth access token in memory.
 */
export function resolvePendingRedirectResult(): Promise<FirebaseUser | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  if (!firebaseSingleton.redirectResultPromise) {
    firebaseSingleton.redirectResultPromise = (async () => {
      await ensureAuthPersistence();
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          const credential = GoogleAuthProvider.credentialFromResult(result);
          if (credential?.accessToken) {
            firebaseSingleton.lastOAuthAccessToken = credential.accessToken;
          }
          firebaseSingleton.lastResolvedUser = result.user;
          return result.user;
        }
        return null;
      } catch (error: any) {
        if (
          error?.code !== 'auth/no-auth-event' &&
          error?.code !== 'auth/popup-closed-by-user' &&
          error?.code !== 'auth/cancelled-popup-request'
        ) {
          console.warn('[Firebase Auth] Redirect result notice:', error?.code || 'redirect-result-error');
        }
        return null;
      }
    })();
  }
  return firebaseSingleton.redirectResultPromise;
}

/**
 * Retrieves a valid Firebase ID token for backend authentication, refreshing via Firebase SDK if requested or expired.
 */
export async function getFreshFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  try {
    return await currentUser.getIdToken(forceRefresh);
  } catch (error) {
    if (!forceRefresh) {
      try {
        return await currentUser.getIdToken(true);
      } catch {
        return null;
      }
    }
    console.warn('[Firebase Auth] ID token refresh notice:', (error as any)?.code || 'id-token-error');
    return null;
  }
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

let nativeGoogleInitialization: Promise<void> | null = null;

function getAuthContinueUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}/login`;
}

/**
 * Normal user authentication always uses browserLocalPersistence so sessions survive browser restarts,
 * page refreshes, and preview reloads.
 */
export async function setRememberMePersistence(_rememberMe = true): Promise<void> {
  await ensureAuthPersistence();
}

export async function createEmailAccount(
  email: string,
  password: string,
  displayName?: string,
  _rememberMe = true,
): Promise<FirebaseUser> {
  if (password.length < 8) {
    throw Object.assign(new Error('Choose a password with at least 8 characters.'), { code: 'app/password-too-short' });
  }

  await ensureAuthPersistence();
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
  _rememberMe = true,
): Promise<FirebaseUser> {
  await ensureAuthPersistence();
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

  await ensureAuthPersistence();
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

  const accessToken = response.result.accessToken?.token ?? undefined;
  if (accessToken) {
    firebaseSingleton.lastOAuthAccessToken = accessToken;
  }
  const credential = GoogleAuthProvider.credential(response.result.idToken, accessToken);
  return (await signInWithCredential(auth, credential)).user;
}

export async function signInWithGoogle(): Promise<FirebaseUser | null> {
  try {
    // Always guarantee browserLocalPersistence is active BEFORE starting Google sign-in.
    await ensureAuthPersistence();

    if (Capacitor.getPlatform() === 'android') {
      return await signInWithNativeGoogle();
    }

    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      firebaseSingleton.lastOAuthAccessToken = credential.accessToken;
    }
    firebaseSingleton.lastResolvedUser = result.user;
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
    await ensureAuthPersistence();
    const result = await fbSignInAnonymously(auth);
    firebaseSingleton.lastResolvedUser = result.user;
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
    firebaseSingleton.lastOAuthAccessToken = null;
    firebaseSingleton.lastResolvedUser = null;
    await fbSignOut(auth);
  } catch (error) {
    console.error('[Firebase Auth] Sign-out failed:', (error as any)?.code || 'sign-out-error');
    throw error;
  }
}

export { onAuthStateChanged };

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
      const cfg = firebaseConfig as Record<string, unknown>;
      const hasCompleteConfig = Boolean(cfg?.projectId && cfg?.apiKey && cfg?.firestoreDatabaseId);
      if (!hasCompleteConfig) {
        console.error('Please check your Firebase configuration.');
      } else {
        console.warn('[Firebase] Firestore connection check deferred while client is offline.');
      }
    }
  }
}

// Test connection on boot
if (typeof window !== 'undefined') {
  testConnection();
}
