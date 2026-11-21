import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  auth,
  createEmailAccount,
  refreshCurrentUser,
  requestPasswordReset,
  resendEmailVerification,
  setRememberMePersistence,
  signInAnonymouslyUser,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
} from '@/lib/firebase';
import { logoutWorkspace } from '@/lib/workspaceAuth';
import { syncUserProfile } from '@/lib/firestoreService';
import { syncUserToCloudSql } from '@/lib/cloudSqlClient';
import { toast } from 'sonner';

interface FirebaseContextType {
  user: FirebaseUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  createAccount: (email: string, password: string, displayName: string, rememberMe: boolean) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshVerification: () => Promise<boolean>;
  signInAsGuest: () => Promise<boolean>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithEmail: async () => {},
  createAccount: async () => {},
  sendPasswordReset: async () => {},
  resendVerification: async () => {},
  refreshVerification: async () => false,
  signInAsGuest: async () => false,
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
  const [user, setUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [loading, setLoading] = useState(true);
  const automaticGuestSignInAttempted = useRef(false);

  useEffect(() => {
    let isSubscribed = true;
    let hasResolvedAuth = false;

    const unsubscribe = auth.onAuthStateChanged(
      (currentUser) => {
        if (!isSubscribed) return;
        hasResolvedAuth = true;
        if (!currentUser && !automaticGuestSignInAttempted.current) {
          automaticGuestSignInAttempted.current = true;
          void setRememberMePersistence(true)
            .then(() => signInAnonymouslyUser())
            .then((guestUser) => {
              if (!isSubscribed) return;
              if (!guestUser) {
                console.warn('[Firebase Auth] Automatic guest sign-in was unavailable.');
              }
              setUser(guestUser);
              setLoading(false);
            })
            .catch((error) => {
              if (!isSubscribed) return;
              console.warn('[Firebase Auth] Automatic guest sign-in notice:', (error as any)?.code || 'guest-sign-in-error');
              setUser(null);
              setLoading(false);
            });
          return;
        }
        setUser(currentUser);
        if (currentUser) syncVerifiedUser(currentUser);
        setLoading(false);
      },
      (error) => {
        if (!isSubscribed) return;
        console.warn('[Firebase Auth] State listener notice:', (error as any)?.code || 'state-listener-error');
        // Keep only the user Firebase itself has restored; never trust a local profile cache as a session.
        setUser(auth.currentUser);
        setLoading(false);
      },
    );

    const fallbackTimer = setTimeout(() => {
      if (isSubscribed && !hasResolvedAuth) {
        setUser(auth.currentUser);
        setLoading(false);
      }
    }, 5000);

    return () => {
      isSubscribed = false;
      unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, []);

  const handleSignInWithGoogle = async () => {
    const loggedUser = await signInWithGoogle();
    if (loggedUser) {
      setUser(loggedUser);
      syncVerifiedUser(loggedUser);
      toast.success(`Welcome${loggedUser.displayName ? `, ${loggedUser.displayName}` : ''}!`);
    }
  };

  const handleSignInWithEmail = async (email: string, password: string, rememberMe: boolean) => {
    const loggedUser = await signInWithEmail(email, password, rememberMe);
    setUser(loggedUser);
    syncVerifiedUser(loggedUser);
  };

  const handleCreateAccount = async (email: string, password: string, displayName: string, rememberMe: boolean) => {
    const newUser = await createEmailAccount(email, password, displayName, rememberMe);
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
    setUser(refreshedUser);
    if (refreshedUser?.emailVerified) {
      syncVerifiedUser(refreshedUser);
      return true;
    }
    return false;
  };

  const handleSignInAsGuest = async (): Promise<boolean> => {
    try {
      await setRememberMePersistence(true);
      const guestUser = await signInAnonymouslyUser();
      if (!guestUser) throw new Error('Firebase anonymous sign-in is unavailable.');
      setUser(guestUser);
      toast.success('Signed in as Guest');
      return true;
    } catch (error) {
      console.warn('[Firebase Auth] Guest sign-in notice:', (error as any)?.code || 'guest-sign-in-error');
      toast.error('Guest sign-in is unavailable. Please use an account.');
      return false;
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
      await logoutWorkspace();
      setUser(null);
      toast.success('Signed out successfully');
    } catch (error) {
      console.warn('[Firebase Auth] Sign-out notice:', (error as any)?.code || 'sign-out-error');
      toast.error('Failed to sign out. Please try again.');
    }
  };

  const getIdToken = async (forceRefresh = false): Promise<string | null> => {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch (error) {
      console.warn('[Firebase Auth] Token refresh notice:', (error as any)?.code || 'token-refresh-error');
      return null;
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        user,
        loading,
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
