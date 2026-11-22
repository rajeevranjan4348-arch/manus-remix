import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  auth,
  createEmailAccount,
  ensureAuthPersistence,
  getFreshFirebaseIdToken,
  getInMemoryGoogleOAuthToken,
  getSingletonAuthSnapshot,
  markSingletonAuthResolved,
  onAuthStateChanged,
  refreshCurrentUser,
  requestPasswordReset,
  resendEmailVerification,
  resolvePendingRedirectResult,
  setRememberMePersistence,
  signInAnonymouslyUser,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
} from '@/lib/firebase';
import {
  clearWorkspaceAccessTokenOnly,
  setCachedAccessToken,
} from '@/lib/workspaceAuth';
import { clearInMemoryGuestSessionToken } from '@/lib/firebaseAuthorization';
import { syncUserProfile } from '@/lib/firestoreService';
import { syncUserToCloudSql } from '@/lib/cloudSqlClient';
import { toast } from 'sonner';

interface FirebaseContextType {
  user: FirebaseUser | null;
  loading: boolean;
  authReady: boolean;
  isAuthenticated: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  createAccount: (email: string, password: string, displayName: string, rememberMe: boolean) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshVerification: () => Promise<boolean>;
  signInAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  loading: true,
  authReady: false,
  isAuthenticated: false,
  signInWithGoogle: async () => {},
  signInWithEmail: async () => {},
  createAccount: async () => {},
  sendPasswordReset: async () => {},
  resendVerification: async () => {},
  refreshVerification: async () => false,
  signInAsGuest: async () => {},
  signOut: async () => {},
  getIdToken: async () => null,
});

function syncVerifiedUser(user: FirebaseUser): void {
  if (user.isAnonymous || !user.emailVerified) return;
  void syncUserProfile({
    id: user.uid,
    email: user.email || '',
    displayName: user.displayName || 'User',
    photoURL: user.photoURL || '',
    createdAt: user.metadata?.creationTime || new Date().toISOString(),
  }).catch((error) => {
    console.warn('[Firebase] Profile sync notice:', (error as any)?.code || 'profile-sync-error');
  });
  void syncUserToCloudSql({ email: user.email, displayName: user.displayName }).catch(() => {});
}

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  // Restore from in-memory singleton snapshot immediately on HMR/remounts to avoid auth flicker.
  // On a cold browser load or full page refresh, initialized is false and loading remains true
  // until Firebase finishes confirming authentication persistence & redirect state.
  const initialSnapshot = getSingletonAuthSnapshot();
  const [user, setUser] = useState<FirebaseUser | null>(initialSnapshot.user);
  const [loading, setLoading] = useState<boolean>(!initialSnapshot.initialized);

  useEffect(() => {
    let isSubscribed = true;
    let unsubscribeAuth: (() => void) | null = null;
    let hasReceivedAuthEvent = false;

    const initializeAuthSession = async () => {
      // 1. Guarantee browserLocalPersistence is configured before reading session state.
      await ensureAuthPersistence();

      // 2. Complete any pending OAuth redirect flow once per page load.
      const redirectUser = await resolvePendingRedirectResult();
      const redirectOAuthToken = getInMemoryGoogleOAuthToken();
      if (redirectOAuthToken) {
        setCachedAccessToken(redirectOAuthToken, { source: 'google_oauth' });
      }

      if (!isSubscribed) return;

      // 3. Wait for Firebase SDK to finish hydrating persisted credentials from IndexedDB/localStorage.
      if (typeof auth.authStateReady === 'function') {
        try {
          await auth.authStateReady();
        } catch (err) {
          console.warn('[Firebase Auth] authStateReady notice:', (err as any)?.code || 'auth-ready-error');
        }
      }

      if (!isSubscribed) return;

      // 4. Attach centralized onAuthStateChanged listener on the singleton Firebase Auth instance.
      unsubscribeAuth = onAuthStateChanged(
        auth,
        (currentUser) => {
          if (!isSubscribed) return;
          hasReceivedAuthEvent = true;
          markSingletonAuthResolved(currentUser);
          setUser(currentUser);
          if (currentUser) {
            clearInMemoryGuestSessionToken();
            syncVerifiedUser(currentUser);
          } else {
            // Only clear in-memory Workspace OAuth cache when Firebase confirms signed-out state.
            clearWorkspaceAccessTokenOnly();
          }
          setLoading(false);
        },
        (error) => {
          if (!isSubscribed) return;
          hasReceivedAuthEvent = true;
          console.warn('[Firebase Auth] State listener notice:', (error as any)?.code || 'state-listener-error');
          const confirmedUser = auth.currentUser ?? redirectUser ?? null;
          markSingletonAuthResolved(confirmedUser);
          setUser(confirmedUser);
          setLoading(false);
        },
      );

      // If authStateReady already resolved and onAuthStateChanged hasn't fired synchronously,
      // wait briefly for the initial onAuthStateChanged event, then settle using Firebase's own currentUser.
      if (!hasReceivedAuthEvent && typeof auth.authStateReady === 'function') {
        const confirmedUser = auth.currentUser ?? redirectUser ?? null;
        if (confirmedUser) {
          markSingletonAuthResolved(confirmedUser);
          setUser(confirmedUser);
          syncVerifiedUser(confirmedUser);
          setLoading(false);
        }
      }
    };

    void initializeAuthSession();

    // CRITICAL: Never call signOut() on unmount, cleanup, or Vite HMR!
    return () => {
      isSubscribed = false;
      if (unsubscribeAuth) {
        unsubscribeAuth();
      }
    };
  }, []);

  const handleSignInWithGoogle = async () => {
    const loggedUser = await signInWithGoogle();
    if (loggedUser) {
      markSingletonAuthResolved(loggedUser);
      setUser(loggedUser);
      const oauthToken = getInMemoryGoogleOAuthToken();
      if (oauthToken) {
        setCachedAccessToken(oauthToken, { source: 'google_oauth' });
      }
      syncVerifiedUser(loggedUser);
      toast.success(`Welcome${loggedUser.displayName ? `, ${loggedUser.displayName}` : ''}!`);
    }
  };

  const handleSignInWithEmail = async (email: string, password: string, rememberMe: boolean) => {
    const loggedUser = await signInWithEmail(email, password, rememberMe);
    markSingletonAuthResolved(loggedUser);
    setUser(loggedUser);
    syncVerifiedUser(loggedUser);
  };

  const handleCreateAccount = async (email: string, password: string, displayName: string, rememberMe: boolean) => {
    const newUser = await createEmailAccount(email, password, displayName, rememberMe);
    markSingletonAuthResolved(newUser);
    setUser(newUser);
  };

  const handleSendPasswordReset = async (email: string) => {
    await requestPasswordReset(email);
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) throw new Error('Sign in again to request a verification email.');
    await resendEmailVerification(auth.currentUser);
  };

  const handleRefreshVerification = async (): Promise<boolean> => {
    const refreshedUser = await refreshCurrentUser();
    markSingletonAuthResolved(refreshedUser);
    setUser(refreshedUser);
    if (refreshedUser?.emailVerified) {
      syncVerifiedUser(refreshedUser);
      return true;
    }
    return false;
  };

  const handleSignInAsGuest = async () => {
    try {
      await setRememberMePersistence(true);
      const guestUser = await signInAnonymouslyUser();
      if (!guestUser) throw new Error('Firebase anonymous sign-in is unavailable.');
      markSingletonAuthResolved(guestUser);
      setUser(guestUser);
      toast.success('Signed in as Guest');
    } catch (error) {
      console.warn('[Firebase Auth] Guest sign-in notice:', (error as any)?.code || 'guest-sign-in-error');
      toast.error('Guest sign-in is unavailable. Please use an account.');
    }
  };

  const handleSignOut = async () => {
    try {
      clearWorkspaceAccessTokenOnly();
      clearInMemoryGuestSessionToken();
      await signOutUser();
      markSingletonAuthResolved(null);
      setUser(null);
      toast.success('Signed out successfully');
    } catch (error) {
      console.warn('[Firebase Auth] Sign-out notice:', (error as any)?.code || 'sign-out-error');
      toast.error('Failed to sign out. Please try again.');
    }
  };

  const getIdToken = async (forceRefresh = false): Promise<string | null> => {
    return getFreshFirebaseIdToken(forceRefresh);
  };

  const isAuthenticated = Boolean(user && (user.isAnonymous || user.emailVerified !== false));

  return (
    <FirebaseContext.Provider
      value={{
        user,
        loading,
        authReady: !loading,
        isAuthenticated,
        signInWithGoogle: handleSignInWithGoogle,
        signInWithEmail: handleSignInWithEmail,
        createAccount: handleCreateAccount,
        sendPasswordReset: handleSendPasswordReset,
        resendVerification: handleResendVerification,
        refreshVerification: handleRefreshVerification,
        signInAsGuest: handleSignInAsGuest,
        signOut: handleSignOut,
        getIdToken,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  return useContext(FirebaseContext);
}
