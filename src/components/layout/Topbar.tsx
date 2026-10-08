import React from 'react';
import { User, ChevronDown, Sun, Moon, PanelLeft, History } from 'lucide-react';
import { useBlinkAuth, useBlinkClient } from '@blinkdotnew/react';
import { useTheme } from '@/context/ThemeContext';

interface TopbarProps {
  onToggleSidebar?: () => void;
  onOpenHistory?: () => void;
}

export function Topbar({ onToggleSidebar, onOpenHistory }: TopbarProps) {
  const { user, isAuthenticated } = useBlinkAuth();
  const blink = useBlinkClient();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? (resolvedTheme === 'dark' || theme === 'dark') : false;

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <header className="h-16 border-b border-border bg-manus-cream dark:bg-background px-4 sm:px-6 flex items-center justify-between transition-colors">
      <div className="flex items-center gap-2">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent lg:hidden transition-colors cursor-pointer"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeft size={20} />
          </button>
        )}
        <div className="flex items-center gap-2 cursor-pointer hover:bg-manus-soft dark:hover:bg-accent px-3 py-1.5 rounded-lg transition-colors">
          <h2 className="text-sm font-medium text-foreground">Manus 1.6 Lite</h2>
          <ChevronDown size={14} className="text-muted-foreground" />
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* History Panel Button */}
        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-white dark:bg-card text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent transition-all cursor-pointer shadow-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-ring text-xs font-medium"
            title="Open Activity & History Panel (Ctrl+H)"
            aria-label="Open Activity & History Panel"
          >
            <History size={14} className="text-primary" />
            <span className="hidden sm:inline">History</span>
          </button>
        )}

        <button
          onClick={toggleTheme}
          className="p-2 rounded-full border border-border bg-white dark:bg-card text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent transition-all cursor-pointer shadow-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            <Sun size={15} className="text-amber-400 transition-transform hover:rotate-45" />
          ) : (
            <Moon size={15} className="text-slate-700 transition-transform hover:-rotate-12" />
          )}
        </button>

        <button 
          onClick={() => {
            if (!isAuthenticated && blink?.auth?.login) {
              try { blink.auth.login(window.location.href); } catch {}
            }
          }}
          className="flex items-center gap-2 p-1 pr-2 rounded-full hover:bg-manus-soft dark:hover:bg-accent transition-all"
        >
          <div className="w-7 h-7 bg-manus-soft dark:bg-muted rounded-full flex items-center justify-center overflow-hidden border border-border">
            {user?.avatar ? (
              <img src={user.avatar} alt={user?.displayName || 'User'} className="w-full h-full object-cover" />
            ) : (
              <User size={14} className="text-muted-foreground" />
            )}
          </div>
          <ChevronDown size={12} className="text-muted-foreground" />
        </button>
      </div>
    </header>
  );
}
