import React from 'react';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

interface HorizontalLoaderProps {
  label?: string;
  className?: string;
}

export function HorizontalLoader({
  label = "Generating...",
  className
}: HorizontalLoaderProps) {
  return (
    <div className={cn("inline-flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900/90 dark:bg-card text-white dark:text-foreground shadow-sm border border-slate-800 dark:border-border backdrop-blur-md animate-in fade-in duration-300", className)}>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '200ms' }} />
        <span className="w-2 h-2 rounded-full bg-blue-300 animate-pulse" style={{ animationDelay: '400ms' }} />
      </div>
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-200 dark:text-slate-300">
        <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-spin" style={{ animationDuration: '4s' }} />
        <span>{label.endsWith('...') ? label : `${label}...`}</span>
      </div>
    </div>
  );
}
