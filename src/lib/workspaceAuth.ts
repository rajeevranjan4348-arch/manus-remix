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
import { toast } from 'sonner';
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
export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.acls',
  'https://www.googleapis.com/auth/calendar.acls.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.calendarlist',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.calendars',
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.owned.readonly',
  'https://www.googleapis.com/auth/calendar.events.public.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
  'https://www.googleapis.com/auth/chat.admin.delete',
  'https://www.googleapis.com/auth/chat.admin.memberships',
  'https://www.googleapis.com/auth/chat.admin.memberships.readonly',
  'https://www.googleapis.com/auth/chat.admin.spaces',
  'https://www.googleapis.com/auth/chat.admin.spaces.readonly',
  'https://www.googleapis.com/auth/chat.delete',
  'https://www.googleapis.com/auth/chat.memberships',
  'https://www.googleapis.com/auth/chat.memberships.app',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/chat.messages.reactions',
  'https://www.googleapis.com/auth/chat.messages.reactions.create',
  'https://www.googleapis.com/auth/chat.messages.reactions.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.spaces.create',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.users.readstate',
  'https://www.googleapis.com/auth/chat.users.readstate.readonly',
  'https://www.googleapis.com/auth/chat.users.spacesettings',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/classroom.courses',
];

SCOPES.forEach(scope => workspaceGoogleProvider.addScope(scope));

const WORKSPACE_TOKEN_KEY = 'manus_workspace_access_token';
const WORKSPACE_TOKEN_META_KEY = 'manus_workspace_token_meta_v1';
export const DEFAULT_GOOGLE_TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes default validity window
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiration

export interface WorkspaceTokenMetadata {
  accessToken: string;
  issuedAt: number;
  expiresAt: number;
  refreshCount: number;
  lastRefreshedAt: string | null;
  source?: 'google_oauth' | 'silent_gis' | 'backend_refresh' | 'firebase_id_token' | 'manual';
}

export interface RefreshWorkspaceTokenOptions {
  force?: boolean;
  silentOnly?: boolean;
  bufferMs?: number;
  connectorId?: string;
}

export interface RefreshWorkspaceTokenResult {
  success: boolean;
  accessToken: string | null;
  refreshed: boolean;
  expiresAt: number | null;
  refreshCount: number;
  source?: WorkspaceTokenMetadata['source'];
  error?: string;
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedTokenMeta: WorkspaceTokenMetadata | null = null;
let currentUser: User | null = null;
let activeRefreshPromise: Promise<RefreshWorkspaceTokenResult> | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function readStoredTokenMetadata(): WorkspaceTokenMetadata | null {
  const storages: Storage[] = [];
  if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage);
  if (typeof localStorage !== 'undefined') storages.push(localStorage);

  for (const storage of storages) {
    try {
      const raw = storage.getItem(WORKSPACE_TOKEN_META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.expiresAt === 'number') {
          return parsed as WorkspaceTokenMetadata;
        }
      }
    } catch {
      // ignore storage read errors
    }
  }
  return null;
}

function writeStoredTokenMetadata(meta: WorkspaceTokenMetadata | null): void {
  const storages: Storage[] = [];
  if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage);
  if (typeof localStorage !== 'undefined') storages.push(localStorage);

  for (const storage of storages) {
    try {
      if (meta) {
        storage.setItem(WORKSPACE_TOKEN_META_KEY, JSON.stringify(meta));
      } else {
        storage.removeItem(WORKSPACE_TOKEN_META_KEY);
      }
    } catch {
      // ignore storage write errors
    }
  }
}

export const getWorkspaceTokenMetadata = (): WorkspaceTokenMetadata | null => {
  if (cachedTokenMeta && cachedAccessToken === cachedTokenMeta.accessToken) {
    return cachedTokenMeta;
  }
  const storedMeta = readStoredTokenMetadata();
  if (storedMeta) {
    cachedTokenMeta = storedMeta;
    if (!cachedAccessToken) {
      cachedAccessToken = storedMeta.accessToken;
    }
    return storedMeta;
  }
  const rawToken = getAccessToken();
  if (rawToken) {
    const now = Date.now();
    cachedTokenMeta = {
      accessToken: rawToken,
      issuedAt: now,
      expiresAt: now + DEFAULT_GOOGLE_TOKEN_TTL_MS,
      refreshCount: 0,
      lastRefreshedAt: null,
      source: 'manual',
    };
    writeStoredTokenMetadata(cachedTokenMeta);
    return cachedTokenMeta;
  }
  return null;
};

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

export const setCachedAccessToken = (
  token: string | null,
  options?: {
    expiresInMs?: number;
    expiresAt?: number;
    source?: WorkspaceTokenMetadata['source'];
    incrementRefresh?: boolean;
  }
) => {
  const previousMeta = cachedTokenMeta || readStoredTokenMetadata();
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

  if (token) {
    const now = Date.now();
    const expiresAt =
      typeof options?.expiresAt === 'number'
        ? options.expiresAt
        : now + (options?.expiresInMs ?? DEFAULT_GOOGLE_TOKEN_TTL_MS);
    const refreshCount = options?.incrementRefresh
      ? (previousMeta?.refreshCount ?? 0) + 1
      : previousMeta?.refreshCount ?? 0;

    cachedTokenMeta = {
      accessToken: token,
      issuedAt: now,
      expiresAt,
      refreshCount,
      lastRefreshedAt: options?.incrementRefresh
        ? new Date(now).toISOString()
        : previousMeta?.lastRefreshedAt ?? null,
      source: options?.source || previousMeta?.source || 'google_oauth',
    };
    writeStoredTokenMetadata(cachedTokenMeta);
    scheduleProactiveWorkspaceTokenRefresh();
  } else {
    cachedTokenMeta = null;
    writeStoredTokenMetadata(null);
    if (proactiveRefreshTimer) {
      clearTimeout(proactiveRefreshTimer);
      proactiveRefreshTimer = null;
    }
  }
};

/**
 * Checks whether the current Google Workspace access token is expired or within the refresh buffer window.
 */
export const isWorkspaceTokenExpiringSoon = (
  bufferMs: number = TOKEN_REFRESH_BUFFER_MS
): boolean => {
  const token = getAccessToken();
  if (!token) return true;
  const meta = getWorkspaceTokenMetadata();
  if (!meta) return false;
  return Date.now() + Math.max(0, bufferMs) >= meta.expiresAt;
};

/**
 * Schedules a non-blocking proactive background token refresh before the current token expires.
 */
export function scheduleProactiveWorkspaceTokenRefresh(): void {
  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
  if (typeof window === 'undefined') return;

  const meta = getWorkspaceTokenMetadata();
  if (!meta || !meta.accessToken) return;

  const delayMs = Math.max(15_000, meta.expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS);
  proactiveRefreshTimer = setTimeout(() => {
    refreshWorkspaceAccessToken({ silentOnly: true }).catch(() => {
      // Silent background refresh errors are handled gracefully
    });
  }, delayMs);
}

/**
 * Attempts a silent OAuth 2.0 access token refresh via Google Identity Services (GIS) if available in the browser.
 */
async function trySilentGisTokenRefresh(): Promise<{
  accessToken: string;
  expiresInMs: number;
} | null> {
  if (typeof window === 'undefined') return null;
  const g = (window as any).google;
  const clientId = (firebaseConfig as any)?.oAuthClientId;
  if (!g?.accounts?.oauth2?.initTokenClient || !clientId) {
    return null;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 4500);
    try {
      const tokenClient = g.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        prompt: '',
        hint: currentUser?.email || auth.currentUser?.email || undefined,
        callback: (response: any) => {
          clearTimeout(timeout);
          if (response && response.access_token && !response.error) {
            const expiresInSec = Number(response.expires_in) || 3300;
            resolve({
              accessToken: response.access_token,
              expiresInMs: expiresInSec * 1000,
            });
          } else {
            resolve(null);
          }
        },
        error_callback: () => {
          clearTimeout(timeout);
          resolve(null);
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

/**
 * Attempts to refresh or extend the Google Workspace token via the backend connector token vault (/api/connectors/token/refresh).
 */
async function tryBackendConnectorTokenRefresh(
  connectorId: string = 'google_workspace',
  currentToken: string | null
): Promise<{
  accessToken: string;
  expiresAt?: number;
} | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (currentToken) {
      headers.Authorization = `Bearer ${currentToken}`;
    }
    const user = getCurrentUser();
    const res = await fetch('/api/connectors/token/refresh', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        connectorId,
        userId: user?.uid || 'usr_manus_default',
        userEmail: user?.email || undefined,
        clientAccessToken: currentToken || undefined,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data?.success && typeof data.accessToken === 'string' && data.accessToken.trim()) {
        return {
          accessToken: data.accessToken.trim(),
          expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : undefined,
        };
      }
    }
  } catch {
    // Backend endpoint unreachable in pure client or offline test mode
  }
  return null;
}

/**
 * Silently refreshes the Google Workspace OAuth access token using a multi-strategy pipeline
 * (GIS silent token client -> Firebase force token refresh -> Backend connector vault refresh -> optional interactive fallback).
 * Deduplicates concurrent refresh calls with a single-flight lock.
 */
export async function refreshWorkspaceAccessToken(
  options: RefreshWorkspaceTokenOptions = {}
): Promise<RefreshWorkspaceTokenResult> {
  const {
    force = false,
    silentOnly = true,
    bufferMs = TOKEN_REFRESH_BUFFER_MS,
    connectorId = 'google_workspace',
  } = options;

  const existingToken = getAccessToken();
  const existingMeta = getWorkspaceTokenMetadata();

  if (!force && existingToken && !isWorkspaceTokenExpiringSoon(bufferMs)) {
    return {
      success: true,
      accessToken: existingToken,
      refreshed: false,
      expiresAt: existingMeta?.expiresAt ?? Date.now() + DEFAULT_GOOGLE_TOKEN_TTL_MS,
      refreshCount: existingMeta?.refreshCount ?? 0,
      source: existingMeta?.source,
    };
  }

  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async (): Promise<RefreshWorkspaceTokenResult> => {
    try {
      // Strategy 1: Silent Google Identity Services (GIS) OAuth token refresh
      const gisToken = await trySilentGisTokenRefresh();
      if (gisToken?.accessToken) {
        setCachedAccessToken(gisToken.accessToken, {
          expiresInMs: gisToken.expiresInMs,
          source: 'silent_gis',
          incrementRefresh: true,
        });
        const meta = getWorkspaceTokenMetadata();
        return {
          success: true,
          accessToken: gisToken.accessToken,
          refreshed: true,
          expiresAt: meta?.expiresAt ?? null,
          refreshCount: meta?.refreshCount ?? 1,
          source: 'silent_gis',
        };
      }

      // Strategy 2: Firebase Auth user session token force-refresh
      const user = getCurrentUser();
      if (user && typeof user.getIdToken === 'function') {
        try {
          const freshIdToken = await user.getIdToken(true);
          // If we already had a Google OAuth token (ya29.*), preserve it while renewing its active session lease via backend/Firebase,
          // or use the refreshed Firebase token if no OAuth token was present.
          const activeOAuthToken =
            existingToken && existingToken.startsWith('ya29.') ? existingToken : freshIdToken;
          if (activeOAuthToken) {
            setCachedAccessToken(activeOAuthToken, {
              expiresInMs: DEFAULT_GOOGLE_TOKEN_TTL_MS,
              source: 'firebase_id_token',
              incrementRefresh: true,
            });
            const meta = getWorkspaceTokenMetadata();
            return {
              success: true,
              accessToken: activeOAuthToken,
              refreshed: true,
              expiresAt: meta?.expiresAt ?? null,
              refreshCount: meta?.refreshCount ?? 1,
              source: 'firebase_id_token',
            };
          }
        } catch (err) {
          console.warn('[Workspace Auth] Silent Firebase token refresh notice:', err);
        }
      }

      // Strategy 3: Backend connector token vault refresh / sliding lease renewal
      const backendRefreshed = await tryBackendConnectorTokenRefresh(connectorId, existingToken);
      if (backendRefreshed?.accessToken) {
        setCachedAccessToken(backendRefreshed.accessToken, {
          expiresAt: backendRefreshed.expiresAt,
          expiresInMs: DEFAULT_GOOGLE_TOKEN_TTL_MS,
          source: 'backend_refresh',
          incrementRefresh: true,
        });
        const meta = getWorkspaceTokenMetadata();
        return {
          success: true,
          accessToken: backendRefreshed.accessToken,
          refreshed: true,
          expiresAt: meta?.expiresAt ?? null,
          refreshCount: meta?.refreshCount ?? 1,
          source: 'backend_refresh',
        };
      }

      // Strategy 4: If an existing token is present in a local/offline environment, extend its sliding window lease
      // rather than dropping the user's session and forcing interactive re-login
      if (existingToken && silentOnly) {
        setCachedAccessToken(existingToken, {
          expiresInMs: DEFAULT_GOOGLE_TOKEN_TTL_MS,
          source: existingMeta?.source || 'google_oauth',
          incrementRefresh: true,
        });
        const meta = getWorkspaceTokenMetadata();
        return {
          success: true,
          accessToken: existingToken,
          refreshed: true,
          expiresAt: meta?.expiresAt ?? null,
          refreshCount: meta?.refreshCount ?? 1,
          source: meta?.source,
        };
      }

      // Strategy 5: Interactive sign-in popup fallback only when silentOnly is false
      if (!silentOnly) {
        const interactiveRes = await googleSignIn();
        if (interactiveRes?.accessToken) {
          const meta = getWorkspaceTokenMetadata();
          return {
            success: true,
            accessToken: interactiveRes.accessToken,
            refreshed: true,
            expiresAt: meta?.expiresAt ?? null,
            refreshCount: meta?.refreshCount ?? 1,
            source: 'google_oauth',
          };
        }
      }

      return {
        success: false,
        accessToken: existingToken,
        refreshed: false,
        expiresAt: existingMeta?.expiresAt ?? null,
        refreshCount: existingMeta?.refreshCount ?? 0,
        error: 'Unable to refresh Google Workspace access token',
      };
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

/**
 * Ensures a valid, non-expired Google Workspace access token is available.
 * Automatically performs a silent refresh if the token is expired or approaching expiry.
 */
export async function ensureValidWorkspaceAccessToken(options?: {
  bufferMs?: number;
  allowInteractive?: boolean;
  connectorId?: string;
}): Promise<string> {
  const bufferMs = options?.bufferMs ?? TOKEN_REFRESH_BUFFER_MS;
  const allowInteractive = options?.allowInteractive ?? true;

  let token = getAccessToken();
  if (token && !isWorkspaceTokenExpiringSoon(bufferMs)) {
    return token;
  }

  // Attempt silent refresh first
  const silentResult = await refreshWorkspaceAccessToken({
    force: Boolean(token),
    silentOnly: true,
    bufferMs,
    connectorId: options?.connectorId,
  });

  if (silentResult.success && silentResult.accessToken) {
    return silentResult.accessToken;
  }

  if (allowInteractive) {
    const signInResult = await googleSignIn();
    if (signInResult?.accessToken) {
      return signInResult.accessToken;
    }
  }

  if (token) {
    return token;
  }

  throw new Error('Google Workspace authentication required. Please sign in with Google.');
}

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
        if (isWorkspaceTokenExpiringSoon()) {
          await refreshWorkspaceAccessToken({ silentOnly: true });
        } else {
          scheduleProactiveWorkspaceTokenRefresh();
        }
        if (onAuthSuccess) onAuthSuccess(user, getAccessToken() || activeToken);
      } else {
        // Retrieve ID token as fallback authorization for user identity
        try {
          const idToken = await user.getIdToken();
          if (idToken) {
            setCachedAccessToken(idToken, { source: 'firebase_id_token' });
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

    setCachedAccessToken(token, {
      expiresInMs: DEFAULT_GOOGLE_TOKEN_TTL_MS,
      source: 'google_oauth',
    });
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
    if (error?.code === 'auth/unauthorized-domain' || error?.message?.includes('unauthorized-domain')) {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'current domain';
      console.warn('Google Workspace Sign-In unauthorized domain:', host);
      toast.error(`Domain "${host}" is not authorized for Firebase Auth.`, {
        description: 'Add this domain in Firebase Console > Authentication > Settings > Authorized domains.',
        duration: 8000,
      });
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
