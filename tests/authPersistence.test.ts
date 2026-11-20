import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import {
  isUserSessionAuthorized,
  resolvePostAuthDestination,
  AuthLoadingScreen,
} from '../src/components/auth/AuthGuard';

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

  it('4. Protected Routes & Route Preservation: shows loading screen during hydration, preserves deep routes, and redirects only when confirmed signed out', async () => {
    // Verify authorization helper handles Google verified users, anonymous guest users, unverified email users, and signed-out users
    expect(isUserSessionAuthorized(null)).toBe(false);
    expect(isUserSessionAuthorized({ uid: 'g1', emailVerified: true, isAnonymous: false } as any)).toBe(true);
    expect(isUserSessionAuthorized({ uid: 'anon1', emailVerified: false, isAnonymous: true } as any)).toBe(true);
    expect(isUserSessionAuthorized({ uid: 'unv1', emailVerified: false, isAnonymous: false } as any)).toBe(false);

    // Verify preserved route destination resolution
    expect(resolvePostAuthDestination(null)).toBe('/');
    expect(resolvePostAuthDestination({ from: { pathname: '/task/abc-123', search: '?tab=data', hash: '#top' } })).toBe(
      '/task/abc-123?tab=data#top',
    );
    // Never redirect back into /login or /forgot-password after signing in
    expect(resolvePostAuthDestination({ from: { pathname: '/login' } })).toBe('/');
    expect(resolvePostAuthDestination({ from: { pathname: '/forgot-password' } })).toBe('/');

    // Verify AuthLoadingScreen renders cleanly during startup/refresh restoration
    const loadingHtml = renderToString(React.createElement(AuthLoadingScreen));
    expect(loadingHtml).toContain('auth-loading-screen');
    expect(loadingHtml).toContain('Restoring your session');

    // Verify App.tsx wires ProtectedRoute and PublicOnlyRoute properly
    const appSrc = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf-8');
    expect(appSrc).toContain('<ProtectedRoute>');
    expect(appSrc).toContain('<PublicOnlyRoute>');
    expect(appSrc).toContain('path="/login"');
    expect(appSrc).toContain('AuthScreen');
  });

  it('5. Guard State Transitions: renders loading while initializing, renders preserved route when authenticated, and redirects to /login after explicit sign-out', async () => {
    vi.resetModules();
    const state = { user: null as any, loading: true };

    vi.doMock('../src/context/FirebaseContext', () => ({
      useFirebase: () => state,
    }));

    vi.doMock('react-router-dom', async () => {
      const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
      return {
        ...actual,
        Navigate: ({ to, state: navState, replace }: { to: string; state?: any; replace?: boolean }) =>
          React.createElement('div', {
            'data-testid': 'navigate-redirect',
            'data-to': to,
            'data-from': navState?.from?.pathname || '',
            'data-replace': String(Boolean(replace)),
          }),
      };
    });

    const { MemoryRouter: MockedMemoryRouter, Route: MockedRoute, Routes: MockedRoutes } = await import('react-router-dom');
    const { ProtectedRoute, PublicOnlyRoute } = await import('../src/components/auth/AuthGuard');

    function LoginProbe() {
      return React.createElement('div', null, 'LOGIN_SCREEN');
    }

    function TaskProbe() {
      return React.createElement('div', null, 'PROTECTED_TASK_VIEW:/task/42');
    }

    const renderAt = (initialEntry: any) =>
      renderToString(
        React.createElement(
          MockedMemoryRouter,
          { initialEntries: [initialEntry] },
          React.createElement(
            MockedRoutes,
            null,
            React.createElement(MockedRoute, {
              path: '/login',
              element: React.createElement(PublicOnlyRoute, null, React.createElement(LoginProbe)),
            }),
            React.createElement(MockedRoute, {
              path: '/task/:id',
              element: React.createElement(ProtectedRoute, null, React.createElement(TaskProbe)),
            }),
          ),
        ),
      );

    // Scenario A (Refresh / App Startup): loading = true -> MUST show loading screen and NOT redirect to /login
    state.loading = true;
    state.user = null;
    const loadingResult = renderAt('/task/42');
    expect(loadingResult).toContain('auth-loading-screen');
    expect(loadingResult).not.toContain('navigate-redirect');

    // Scenario B (Session Restored): loading = false, authenticated Google user -> preserves /task/42
    state.loading = false;
    state.user = { uid: 'google_u1', email: 'user@gmail.com', emailVerified: true, isAnonymous: false };
    const restoredResult = renderAt('/task/42');
    expect(restoredResult).toContain('PROTECTED_TASK_VIEW:/task/42');
    expect(restoredResult).not.toContain('navigate-redirect');

    // Scenario C (Signed-in user hitting /login with preserved state): redirects straight back to /task/42
    const redirectBackResult = renderAt({ pathname: '/login', state: { from: { pathname: '/task/42' } } });
    expect(redirectBackResult).toContain('data-to="/task/42"');
    expect(redirectBackResult).toContain('data-replace="true"');

    // Scenario D (Explicit Sign-Out): loading = false, user = null -> redirects to /login preserving original route
    state.loading = false;
    state.user = null;
    const signedOutResult = renderAt('/task/42');
    expect(signedOutResult).toContain('data-to="/login"');
    expect(signedOutResult).toContain('data-from="/task/42"');
    expect(signedOutResult).toContain('data-replace="true"');
    expect(signedOutResult).not.toContain('PROTECTED_TASK_VIEW');

    // Scenario E (Unauthenticated user visiting /login): renders login screen directly
    const loginPageResult = renderAt('/login');
    expect(loginPageResult).toContain('LOGIN_SCREEN');
    expect(loginPageResult).not.toContain('navigate-redirect');

    vi.doUnmock('../src/context/FirebaseContext');
    vi.doUnmock('react-router-dom');
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
