import React, { useState, useEffect } from 'react';
import { googleSignIn, initWorkspaceAuth, logoutWorkspace, getAccessToken } from '@/lib/workspaceAuth';
import { User } from 'firebase/auth';
import { toast } from 'sonner';
import { Check, LogOut, HardDrive, Calendar, Mail } from 'lucide-react';

export function WorkspaceConnectButton() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getAccessToken());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = initWorkspaceAuth(
      (u, t) => {
        setUser(u);
        setToken(t);
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        toast.success(`Connected as ${res.user.email}`);
      }
    } catch (err: any) {
      toast.error('Failed to sign in with Google Workspace');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await logoutWorkspace();
    setUser(null);
    setToken(null);
    toast.info('Signed out of Google Workspace');
  };

  if (user && token) {
    return (
      <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 rounded-xl text-xs">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-medium truncate max-w-[120px] sm:max-w-[180px]">{user.email || 'Google Connected'}</span>
        <button
          onClick={handleDisconnect}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
          title="Sign out"
        >
          <LogOut size={12} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={isLoading}
      className="gsi-material-button inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-border/80 text-foreground text-xs font-medium hover:bg-muted/60 transition-colors cursor-pointer shadow-2xs"
    >
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-3.5 h-3.5">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
      </svg>
      <span>Connect Google</span>
    </button>
  );
}
