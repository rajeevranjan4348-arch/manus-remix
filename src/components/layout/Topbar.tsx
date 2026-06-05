import React from 'react';
import { Share2, Sparkles, User, ChevronDown } from 'lucide-react';
import { useBlinkAuth, useBlinkClient } from '@blinkdotnew/react';

export function Topbar() {
  const { user, isAuthenticated } = useBlinkAuth();
  const blink = useBlinkClient();

  return (
    <header className="h-16 border-b border-border bg-manus-cream px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 cursor-pointer hover:bg-manus-soft px-3 py-1.5 rounded-lg transition-colors">
        <h2 className="text-sm font-medium text-foreground">Manus 1.6 Lite</h2>
        <ChevronDown size={14} className="text-muted-foreground" />
      </div>

      <div className="flex items-center gap-3">
        <button className="flex items-center gap-1.5 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full hover:bg-blue-100 transition-all text-xs font-bold">
          <Sparkles size={12} />
          Upgrade
        </button>
        
        <button className="flex items-center gap-2 bg-white border border-border px-3 py-1.5 rounded-full hover:bg-manus-soft transition-all text-xs font-medium">
          <Share2 size={14} />
          Share
        </button>
        
        <div className="h-4 w-px bg-border mx-1" />
        
        <button 
          onClick={() => !isAuthenticated && blink.auth.login(window.location.href)}
          className="flex items-center gap-2 p-1 pr-2 rounded-full hover:bg-manus-soft transition-all"
        >
          <div className="w-7 h-7 bg-manus-soft rounded-full flex items-center justify-center overflow-hidden border border-border">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
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
