import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize or get Firebase App instance
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Configure Google Auth Provider with all requested Google Workspace Scopes
export const workspaceGoogleProvider = new GoogleAuthProvider();

// Add Workspace scopes
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/classroom.courses'
];

SCOPES.forEach(scope => workspaceGoogleProvider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let currentUser: User | null = null;

/**
 * Initialize auth state listener.
 */
export const initWorkspaceAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    currentUser = user;
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Attempt silent token refresh or prompt sign in if needed
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Sign in with Google to obtain access token for Google Workspace APIs.
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    workspaceGoogleProvider.setCustomParameters({
      prompt: 'consent',
      access_type: 'offline'
    });
    
    const result = await signInWithPopup(auth, workspaceGoogleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve OAuth access token from Google authentication');
    }

    cachedAccessToken = credential.accessToken;
    currentUser = result.user;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request' ||
      error?.code === 'auth/popup-blocked' ||
      error?.message?.includes('popup-closed-by-user')
    ) {
      console.warn('Google Sign-In popup closed by user.');
      return null;
    }
    console.error('Google Workspace Sign-In Error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Get cached access token in memory.
 */
export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

/**
 * Set token manually if retrieved from credential.
 */
export const setCachedAccessToken = (token: string) => {
  cachedAccessToken = token;
};

/**
 * Get current authenticated user.
 */
export const getCurrentUser = (): User | null => {
  return currentUser || auth.currentUser;
};

/**
 * Logout and clear token cache.
 */
export const logoutWorkspace = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  currentUser = null;
};
