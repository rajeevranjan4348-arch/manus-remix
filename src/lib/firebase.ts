import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInAnonymously as fbSignInAnonymously,
  signOut as fbSignOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDocFromServer 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App safely so restricted iframe environments never crash on import
export const app = (() => {
  try {
    return initializeApp(firebaseConfig);
  } catch (err) {
    console.warn('[Firebase] App initialization notice:', err);
    return initializeApp(firebaseConfig, 'manus-fallback-' + Date.now());
  }
})();

// Initialize Firestore with specific database ID (CRITICAL: Required for named database if provided)
export const db = (() => {
  try {
    return (firebaseConfig as any).firestoreDatabaseId
      ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
      : getFirestore(app);
  } catch (err) {
    console.warn('[Firebase] Firestore initialization notice:', err);
    return getFirestore(app);
  }
})();

// Initialize Firebase Authentication safely
export const auth: ReturnType<typeof getAuth> = (() => {
  try {
    const instance = getAuth(app);
    setPersistence(instance, browserLocalPersistence).catch((err) => {
      console.warn('[Firebase Auth] Persistence initialization notice:', err);
    });
    return instance;
  } catch (err) {
    console.warn('[Firebase Auth] Auth initialization fallback notice:', err);
    return {
      currentUser: null,
      onAuthStateChanged: (cb: any) => {
        if (typeof cb === 'function') {
          Promise.resolve().then(() => cb(null));
        }
        return () => {};
      },
    } as any;
  }
})();

// Authentication Provider (Google Login configured)
export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle(): Promise<FirebaseUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    if (
      error?.code !== 'auth/popup-closed-by-user' && 
      error?.code !== 'auth/cancelled-popup-request'
    ) {
      console.warn('[Firebase Auth] Google Sign-In notice:', error?.code || error?.message || error);
    }
    throw error;
  }
}

export async function signInAnonymouslyUser(): Promise<FirebaseUser | null> {
  try {
    const result = await fbSignInAnonymously(auth);
    return result.user;
  } catch (error) {
    console.warn('[Firebase Auth] Anonymous sign-in notice:', error);
    return null;
  }
}

export async function signOutUser(): Promise<void> {
  try {
    await fbSignOut(auth);
  } catch (error) {
    console.error('Failed to sign out:', error);
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
      providerId?: string | null;
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
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Initial connection test as mandated by skill
export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

// Test connection asynchronously after initial render
if (typeof window !== 'undefined') {
  setTimeout(() => {
    testConnection().catch(() => {});
  }, 2000);
}
