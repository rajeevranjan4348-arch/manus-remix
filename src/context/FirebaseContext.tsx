import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  setPersistence,
  browserLocalPersistence,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  auth, 
  signInWithGoogle, 
  signInAnonymouslyUser,
  signOutUser 
} from '@/lib/firebase';
import { logoutWorkspace } from '@/lib/workspaceAuth';
import { syncUserProfile } from '@/lib/firestoreService';
import { syncUserToCloudSql } from '@/lib/cloudSqlClient';
import { toast } from 'sonner';

const AUTH_USER_CACHE_KEY = 'manus_auth_user_cache';

interface CachedUserSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

function getCachedUserSession(): CachedUserSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedUserSession(user: FirebaseUser | any | null) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (user) {
      const sess: CachedUserSession = {
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
      };
      localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(sess));
    } else {
      localStorage.removeItem(AUTH_USER_CACHE_KEY);
    }
  } catch (err) {
    console.warn('[Firebase Auth] Failed to update user session cache:', err);
  }
}

interface FirebaseContextType {
  user: FirebaseUser | any | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInAsGuest: async () => {},
  signOut: async () => {},
  getIdToken: async () => null,
});

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | any | null>(() => auth?.currentUser || getCachedUserSession());
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let isSubscribed = true;
    let unsubscribe: () => void = () => {};

    try {
      unsubscribe = onAuthStateChanged(
        auth, 
        (currentUser) => {
          if (!isSubscribed) return;
          setLoading(false);

          if (currentUser) {
            setUser(currentUser);
            setCachedUserSession(currentUser);
            // Non-blocking background sync so UI never waits on Firestore/Cloud SQL network round-trips
            syncUserProfile({
              id: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || 'Manus User',
              photoURL: currentUser.photoURL || '',
              createdAt: currentUser.metadata?.creationTime || new Date().toISOString()
            }).catch((e) => {
              console.warn('[Firebase] Profile sync notice:', e);
            });
            syncUserToCloudSql({
              email: currentUser.email,
              displayName: currentUser.displayName,
            }).catch(() => {});
          } else {
            if (typeof navigator !== 'undefined' && !navigator.onLine && (auth?.currentUser || getCachedUserSession())) {
              console.warn('[Firebase Auth] Offline state detected; retaining existing user session');
            } else {
              const cached = getCachedUserSession();
              if (cached && (cached.uid.startsWith('guest-') || !auth?.currentUser)) {
                setUser(cached as any);
              } else {
                setUser(null);
                setCachedUserSession(null);
              }
            }
          }
        },
        (error) => {
          console.warn('[Firebase Auth] Auth state listener notice:', error);
          if (typeof navigator !== 'undefined' && !navigator.onLine && (auth?.currentUser || getCachedUserSession())) {
            console.warn('[Firebase Auth] Offline network error; retaining cached user session');
          } else {
            setUser(null);
            setCachedUserSession(null);
          }
          setLoading(false);
        }
      );
    } catch (err) {
      console.warn('[Firebase Auth] Listener setup notice:', err);
      setLoading(false);
    }

    return () => {
      isSubscribed = false;
      try {
        unsubscribe();
      } catch {}
    };
  }, []);

  const handleSignInAsGuest = async () => {
    try {
      const anonUser = await signInAnonymouslyUser();
      if (anonUser) {
        setUser(anonUser);
        setCachedUserSession(anonUser);
        toast.success('Signed in as Guest');
      } else {
        const guestUser: any = {
          uid: 'guest-' + Date.now(),
          email: 'guest@app.local',
          displayName: 'Guest User',
          photoURL: '',
          isAnonymous: true,
          getIdToken: async () => 'guest-token',
        };
        setUser(guestUser);
        setCachedUserSession(guestUser);
        toast.success('Signed in as Guest');
      }
    } catch (e) {
      toast.error('Failed to sign in as Guest');
    }
  };

  const handleSignInWithGoogle = async () => {
    try {
      const loggedUser = await signInWithGoogle();
      if (loggedUser) {
        setUser(loggedUser);
        setCachedUserSession(loggedUser);
        toast.success(`Welcome, ${loggedUser.displayName || loggedUser.email || 'User'}!`);
      }
    } catch (error: any) {
      if (
        error?.code === 'auth/popup-closed-by-user' || 
        error?.code === 'auth/cancelled-popup-request'
      ) {
        return;
      }

      if (error?.code === 'auth/unauthorized-domain' || error?.message?.includes('unauthorized-domain')) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'current domain';
        console.warn(`[Firebase Auth] Domain "${currentHost}" is not listed in Firebase Auth Authorized Domains.`);

        try {
          const anonUser = await signInAnonymouslyUser();
          if (anonUser) {
            setUser(anonUser);
            setCachedUserSession(anonUser);
            toast.success('Signed in as Guest');
            toast.info(`Domain "${currentHost}" is not in Firebase Auth's Authorized Domains list. Signed in as Guest.`, {
              duration: 7000,
            });
            return;
          }
        } catch (anonErr) {
          console.warn('[Firebase Auth] Anonymous sign in fallback notice:', anonErr);
        }

        const guestUser: any = {
          uid: 'guest-' + Date.now(),
          email: 'guest@app.local',
          displayName: 'Guest User',
          photoURL: '',
          isAnonymous: true,
          getIdToken: async () => 'guest-token',
        };
        setUser(guestUser);
        setCachedUserSession(guestUser);
        toast.success('Signed in as Guest');
        toast.info(`Domain "${currentHost}" is not in Firebase Auth's Authorized Domains list. Signed in as Guest.`, {
          duration: 7000,
        });
      } else {
        toast.error(error?.message || 'Failed to sign in with Google');
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
      await logoutWorkspace();
      setUser(null);
      setCachedUserSession(null);
      toast.success('Signed out successfully');
    } catch (error) {
      toast.error('Failed to sign out');
    }
  };

  const getIdToken = async (forceRefresh = false): Promise<string | null> => {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch (err) {
      console.warn('[Firebase Auth] Token refresh error:', err);
      return null;
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        user,
        loading,
        signInWithGoogle: handleSignInWithGoogle,
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
