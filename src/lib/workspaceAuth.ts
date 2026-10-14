import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  setPersistence,
  browserLocalPersistence,
  User, 
  signOut 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize or get Firebase App instance
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Explicitly set browserLocalPersistence to ensure workspace auth session persists
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Workspace Auth] Persistence initialization notice:', err);
});

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
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/classroom.courses'
];

SCOPES.forEach(scope => workspaceGoogleProvider.addScope(scope));

const WORKSPACE_TOKEN_KEY = 'manus_workspace_access_token';
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let currentUser: User | null = null;

export const getAccessToken = (): string | null => {
  if (cachedAccessToken) return cachedAccessToken;
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(WORKSPACE_TOKEN_KEY);
      if (stored) {
        cachedAccessToken = stored;
        return stored;
      }
    } catch {}
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(WORKSPACE_TOKEN_KEY);
      if (stored) {
        cachedAccessToken = stored;
        return stored;
      }
    } catch {}
  }
  return null;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  if (typeof sessionStorage !== 'undefined') {
    try {
      if (token) {
        sessionStorage.setItem(WORKSPACE_TOKEN_KEY, token);
      } else {
        sessionStorage.removeItem(WORKSPACE_TOKEN_KEY);
      }
    } catch {}
  }
  if (typeof localStorage !== 'undefined') {
    try {
      if (token) {
        localStorage.setItem(WORKSPACE_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(WORKSPACE_TOKEN_KEY);
      }
    } catch {}
  }
};

/**
 * Initialize auth state listener and restore session.
 */
export const initWorkspaceAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    currentUser = user;
    if (user) {
      const activeToken = getAccessToken();
      if (activeToken) {
        if (onAuthSuccess) onAuthSuccess(user, activeToken);
      } else {
        // Retrieve ID token as fallback authorization for user identity
        try {
          const idToken = await user.getIdToken();
          if (idToken) {
            setCachedAccessToken(idToken);
            if (onAuthSuccess) onAuthSuccess(user, idToken);
            return;
          }
        } catch (err) {
          console.warn('[Workspace Auth] Token retrieval notice:', err);
        }
        if (!isSigningIn && onAuthFailure) {
          onAuthFailure();
        }
      }
    } else {
      setCachedAccessToken(null);
      currentUser = null;
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
    
    const token = credential?.accessToken || await result.user.getIdToken();
    if (!token) {
      throw new Error('Failed to retrieve access token from Google authentication');
    }

    setCachedAccessToken(token);
    currentUser = result.user;
    return { user: result.user, accessToken: token };
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
 * Get current authenticated user.
 */
export const getCurrentUser = (): User | null => {
  return currentUser || auth.currentUser;
};

/**
 * Logout and clear token cache.
 */
export const logoutWorkspace = async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('[Workspace Auth] Logout notice:', e);
  }
  setCachedAccessToken(null);
  currentUser = null;
};
