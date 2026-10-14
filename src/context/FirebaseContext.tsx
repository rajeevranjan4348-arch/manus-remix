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
  signOutUser 
} from '@/lib/firebase';
import { logoutWorkspace } from '@/lib/workspaceAuth';
import { syncUserProfile } from '@/lib/firestoreService';
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

function setCachedUserSession(user: FirebaseUser | null) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (user) {
      const sess: CachedUserSession = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
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
  user: FirebaseUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
  getIdToken: async () => null,
});

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isSubscribed = true;

    // Attach listener immediately (persistence is configured in firebase.ts on load)
    const unsubscribe = onAuthStateChanged(
      auth, 
      async (currentUser) => {
        if (!isSubscribed) return;

        if (currentUser) {
          setUser(currentUser);
          setCachedUserSession(currentUser);
          try {
            await syncUserProfile({
              id: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || 'Manus User',
              photoURL: currentUser.photoURL || '',
              createdAt: currentUser.metadata?.creationTime || new Date().toISOString()
            });
          } catch (e) {
            console.warn('[Firebase] Profile sync notice:', e);
          }
        } else {
          // Handle network failures gracefully without immediately signing out users whose valid session cannot temporarily be verified
          if (typeof navigator !== 'undefined' && !navigator.onLine && (auth.currentUser || getCachedUserSession())) {
            console.warn('[Firebase Auth] Offline state detected; retaining existing user session');
          } else {
            setUser(null);
            setCachedUserSession(null);
          }
        }
        setLoading(false);
      },
      (error) => {
        console.error('[Firebase Auth] Auth state listener error:', error);
        if (typeof navigator !== 'undefined' && !navigator.onLine && (auth.currentUser || getCachedUserSession())) {
          console.warn('[Firebase Auth] Offline network error; retaining cached user session');
        } else {
          setUser(null);
          setCachedUserSession(null);
        }
        setLoading(false);
      }
    );

    // Timeout fallback timer (5s) in case network is severely stalled
    const fallbackTimer = setTimeout(() => {
      if (isSubscribed && loading) {
        if (auth.currentUser) {
          setUser(auth.currentUser);
        }
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
    try {
      const loggedUser = await signInWithGoogle();
      if (loggedUser) {
        setUser(loggedUser);
        setCachedUserSession(loggedUser);
        toast.success(`Welcome, ${loggedUser.displayName || loggedUser.email || 'User'}!`);
      }
    } catch (error: any) {
      if (
        error?.code !== 'auth/popup-closed-by-user' && 
        error?.code !== 'auth/cancelled-popup-request'
      ) {
        toast.error('Failed to sign in with Google');
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
        signOut: handleSignOut,
        getIdToken,
      }}
    >
      {loading ? (
        <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xl shadow-md animate-pulse">
              M
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Restoring session...</span>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  return useContext(FirebaseContext);
}
