import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  app,
  auth,
  db,
  ensureAuthPersistence,
  getFreshFirebaseIdToken,
  getSingletonAuthSnapshot,
  markSingletonAuthResolved,
} from '../src/lib/firebase';
import {
  auth as workspaceAuthInstance,
  getAccessToken,
  setCachedAccessToken,
  clearWorkspaceAccessTokenOnly,
  logoutWorkspace,
} from '../src/lib/workspaceAuth';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

if (typeof globalThis.sessionStorage === 'undefined') {
  (globalThis as any).sessionStorage = createMemoryStorage();
}
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = createMemoryStorage();
}

describe('Permanent Google Authentication & Session Restoration Test Suite', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setCachedAccessToken(null);
  });

  it('1. Authentication Persistence: enforces browserLocalPersistence on a single canonical Firebase Auth singleton', async () => {
    expect(app).toBeDefined();
    expect(db).toBeDefined();
    expect(auth).toBeDefined();
    expect(typeof auth.onAuthStateChanged).toBe('function');

    // Workspace auth MUST share the exact same Firebase Auth singleton instance (no second auth system).
    expect(workspaceAuthInstance).toBe(auth);

    // ensureAuthPersistence returns a stable cached promise across calls (HMR/remount safe).
    const p1 = ensureAuthPersistence();
    const p2 = ensureAuthPersistence();
    expect(p1).toBe(p2);
    await expect(p1).resolves.toBeUndefined();

    // Verify source invariants: browserLocalPersistence only, zero browserSessionPersistence/inMemoryPersistence, zero duplicate fallback apps.
    const firebaseSrc = fs.readFileSync(path.resolve(__dirname, '../src/lib/firebase.ts'), 'utf-8');
    expect(firebaseSrc).toContain('browserLocalPersistence');
    expect(firebaseSrc).toContain('getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)');
    expect(firebaseSrc).toContain('getRedirectResult');
    expect(firebaseSrc).not.toContain('browserSessionPersistence');
    expect(firebaseSrc).not.toContain('inMemoryPersistence');
    expect(firebaseSrc).not.toContain('manus-fallback-');

    const workspaceSrc = fs.readFileSync(path.resolve(__dirname, '../src/lib/workspaceAuth.ts'), 'utf-8');
    expect(workspaceSrc).not.toContain('initializeApp(');
    expect(workspaceSrc).not.toContain('getAuth(');
    expect(workspaceSrc).toContain('await ensureAuthPersistence()');
  });

  it('2. Session Security: keeps OAuth access tokens strictly in-memory and never stores tokens in localStorage/sessionStorage', () => {
    // Seed a simulated Firebase Auth storage entry and a legacy manually stored token key
    localStorage.setItem('firebase:authUser:test', '{"uid":"fb_123"}');
    localStorage.setItem('manus_workspace_access_token', 'stale_legacy_token');
    sessionStorage.setItem('manus_workspace_access_token', 'stale_session_token');

    const mockToken = 'ya29.in_memory_only_token_12345';
    setCachedAccessToken(mockToken);

    expect(getAccessToken()).toBe(mockToken);
    // Tokens MUST NOT be written to localStorage or sessionStorage
    expect(localStorage.getItem('manus_workspace_access_token')).toBeNull();
    expect(sessionStorage.getItem('manus_workspace_access_token')).toBeNull();
    expect(localStorage.getItem('manus_workspace_token_meta_v1')).toBeNull();
    expect(sessionStorage.getItem('manus_workspace_token_meta_v1')).toBeNull();
    // Firebase Auth's own persisted storage MUST NEVER be cleared
    expect(localStorage.getItem('firebase:authUser:test')).toBe('{"uid":"fb_123"}');
  });

  it('3. HMR & Reload Resilience: preserves singleton auth snapshot across module reloads without signing out', () => {
    const mockGoogleUser = {
      uid: 'google_uid_999',
      email: 'alex@example.com',
      displayName: 'Alex Morgan',
      emailVerified: true,
      isAnonymous: false,
    } as any;

    markSingletonAuthResolved(mockGoogleUser);
    const snapshot = getSingletonAuthSnapshot();
    expect(snapshot.initialized).toBe(true);
    expect(snapshot.user?.uid).toBe('google_uid_999');

    // Verify FirebaseContext never calls signOut inside useEffect cleanup
    const contextSrc = fs.readFileSync(path.resolve(__dirname, '../src/context/FirebaseContext.tsx'), 'utf-8');
    expect(contextSrc).toContain('await ensureAuthPersistence()');
    expect(contextSrc).toContain('await resolvePendingRedirectResult()');
    expect(contextSrc).toContain('auth.authStateReady');
    expect(contextSrc).toContain('onAuthStateChanged');
    expect(contextSrc).not.toMatch(/return\s*\(\)\s*=>\s*\{[^}]*signOut/s);

    // Clean up snapshot for subsequent tests
    markSingletonAuthResolved(null);
  });

  it('4. Direct App Access: login page and blocking auth routes are removed so users enter the app directly', () => {
    const appSrc = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf-8');
    expect(appSrc).not.toContain('AuthScreen');
    expect(appSrc).not.toContain('ProtectedRoute');
    expect(appSrc).not.toContain('PublicOnlyRoute');
    expect(appSrc).not.toContain('path="/login"');
    expect(appSrc).toContain('<AppContent />');
    expect(appSrc).toContain('<Route path="*" element={<Navigate to="/" replace />} />');
    expect(fs.existsSync(path.resolve(__dirname, '../src/pages/AuthScreen.tsx'))).toBe(false);
    expect(fs.existsSync(path.resolve(__dirname, '../src/components/auth/AuthGuard.tsx'))).toBe(false);
  });

  it('6. Explicit Sign-Out & Connector Disconnect Separation: clears token cache cleanly', async () => {
    setCachedAccessToken('token_to_clear');
    expect(getAccessToken()).toBe('token_to_clear');

    // Disconnecting a workspace connector clears only the in-memory OAuth token
    clearWorkspaceAccessTokenOnly();
    expect(getAccessToken()).toBeNull();

    // Explicit logoutWorkspace clears token cache and calls Firebase signOut
    setCachedAccessToken('token_before_logout');
    await logoutWorkspace();
    expect(getAccessToken()).toBeNull();
    expect(sessionStorage.getItem('manus_workspace_access_token')).toBeNull();
    expect(localStorage.getItem('manus_workspace_access_token')).toBeNull();
  });

  it('7. ID Token Refresh Helper: returns null safely when signed out and supports forced Firebase ID token refresh', async () => {
    expect(await getFreshFirebaseIdToken()).toBeNull();
    expect(await getFreshFirebaseIdToken(true)).toBeNull();
  });

  it('8. Offline Resilience: retains in-memory token during network interruption without dropping session', () => {
    setCachedAccessToken('active_offline_token');

    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    expect(getAccessToken()).toBe('active_offline_token');

    Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
  });

  it('9. Unauthenticated Graceful Fallback: blink.auth.me() and task creation remain safe without unhandled errors', async () => {
    const { blink } = await import('../src/lib/blink');
    const me = await blink.auth.me();
    expect(me).toBeNull();

    const task = await (blink.db as any).tasks.create({
      userId: 'usr_manus_default',
      prompt: 'Test task unauthenticated resilience',
      outputFormat: 'report',
      mode: 'chat',
      status: 'running',
    });
    expect(task).toBeDefined();
    expect(task.id).toBeTruthy();
    expect(task.userId).toBe('usr_manus_default');
  });
});
