import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User as FirebaseUser } from 'firebase/auth';
import { useFirebase } from '@/context/FirebaseContext';

const PUBLIC_AUTH_PATHS = new Set(['/login', '/signup', '/forgot-password']);

interface SavedRouteLocation {
  pathname?: string;
  search?: string;
  hash?: string;
}

export function isUserSessionAuthorized(user: FirebaseUser | null): boolean {
  if (!user) return false;
  return Boolean(user.isAnonymous || user.emailVerified !== false);
}

export function resolvePostAuthDestination(locationState: unknown): string {
  const from = (locationState as { from?: SavedRouteLocation } | null | undefined)?.from;
  if (!from || typeof from.pathname !== 'string') {
    return '/';
  }
  const pathname = from.pathname.startsWith('/') ? from.pathname : '/';
  if (PUBLIC_AUTH_PATHS.has(pathname)) {
    return '/';
  }
  const search = typeof from.search === 'string' ? from.search : '';
  const hash = typeof from.hash === 'string' ? from.hash : '';
  return `${pathname}${search}${hash}`;
}

export function AuthLoadingScreen() {
  return (
    <div
      data-testid="auth-loading-screen"
      role="status"
      aria-live="polite"
      aria-label="Restoring session"
      className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-background text-foreground"
    >
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground" />
      <p className="text-sm text-muted-foreground">Restoring your session…</p>
    </div>
  );
}

/**
 * Protects authenticated routes:
 * - Shows a loading screen while Firebase restores browserLocalPersistence state (never redirects prematurely).
 * - Preserves the current route after session restoration.
 * - Redirects to /login only after Firebase confirms the user is signed out, passing the original route in state.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useFirebase();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!isUserSessionAuthorized(user)) {
    return (
      <Navigate
        to="/login"
        state={{
          from: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
        }}
        replace
      />
    );
  }

  return <>{children}</>;
}

/**
 * Protects public authentication routes (/login, /forgot-password):
 * - Shows a loading screen while Firebase checks authentication so signed-in users never flash the login screen.
 * - Redirects authenticated users back to their preserved route (or '/').
 */
export function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useFirebase();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (isUserSessionAuthorized(user)) {
    const destination = resolvePostAuthDestination(location.state);
    return <Navigate to={destination} replace />;
  }

  return <>{children}</>;
}
