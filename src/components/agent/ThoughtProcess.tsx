import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, Copy, Check, Sparkles, Lightbulb, Workflow, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ThoughtProcessProps {
  thoughtText: string;
  durationSeconds?: number;
  isLive?: boolean;
  className?: string;
  defaultExpanded?: boolean;
}

export function ThoughtProcess({
  thoughtText,
  durationSeconds,
  isLive = false,
  className,
  defaultExpanded = false,
}: ThoughtProcessProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || isLive);
  const [copied, setCopied] = useState(false);

  if (!thoughtText || !thoughtText.trim()) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(thoughtText.trim());
    setCopied(true);
    toast.success('Thought process copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  // Clean raw thought tags if any remain
  const cleanedText = thoughtText
    .replace(/^<\/?think>/gi, '')
    .replace(/\[\/?THOUGHTS?\]/gi, '')
    .trim();

  // Parse reasoning lines or steps
  const rawLines = cleanedText.split('\n').filter(l => l.trim().length > 0);

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-300 overflow-hidden my-3",
        isLive
          ? "border-purple-400/40 dark:border-purple-500/40 bg-purple-500/5 dark:bg-purple-950/20 shadow-[0_0_20px_rgba(168,85,247,0.12)]"
          : "border-purple-200/60 dark:border-purple-800/30 bg-purple-50/40 dark:bg-purple-950/10 hover:border-purple-300 dark:hover:border-purple-700/50",
        className
      )}
    >
      {/* Header Bar */}
      <div
        onClick={() => setIsExpanded(prev => !prev)}
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none group transition-colors hover:bg-purple-100/40 dark:hover:bg-purple-900/20"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
              isLive
                ? "bg-gradient-to-tr from-purple-600 to-indigo-500 text-white shadow-md animate-pulse"
                : "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300"
            )}
          >
            <Brain size={15} className={cn(isLive && "animate-spin-[duration:6s]")} />
          </div>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-semibold tracking-tight text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
              Thought Process
            </span>

            {isLive ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-400/30 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping" />
                Reasoning live...
              </span>
            ) : durationSeconds ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                <Sparkles size={10} />
                Thought for {durationSeconds.toFixed(1)}s
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100/80 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                Deep reasoning trail
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-purple-600/70 dark:text-purple-400/70">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-purple-200/50 dark:hover:bg-purple-800/40 transition-colors"
            title="Copy thought process"
          >
            {copied ? <Check size={13} className="text-green-600 dark:text-green-400" /> : <Copy size={13} />}
          </button>
          <div className="p-1 rounded-md">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>

      {/* Expanded Content Body */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-purple-200/40 dark:border-purple-800/20 text-xs text-purple-950/80 dark:text-purple-100/80 leading-relaxed font-mono space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="pl-2 border-l-2 border-purple-400/50 dark:border-purple-500/40 space-y-1.5 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
            {rawLines.map((line, idx) => {
              const trimmed = line.trim();
              const isHeader = /^#+|^Phase \d+|^Step \d+|^Hypothesis:|^Validation:|^Analysis:|^Reasoning:|\*\*.*?\*\*/i.test(trimmed);
              const isBullet = trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed);

              if (isHeader) {
                return (
                  <div key={idx} className="font-semibold text-purple-900 dark:text-purple-200 pt-1 flex items-center gap-1.5">
                    <Lightbulb size={12} className="text-purple-600 dark:text-purple-400 shrink-0" />
                    <span>{trimmed.replace(/^#+\s*/, '')}</span>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={cn(
                    "text-[11.5px] leading-normal font-sans",
                    isBullet ? "pl-2 text-purple-900/90 dark:text-purple-200/90" : "text-muted-foreground/90 dark:text-purple-300/80"
                  )}
                >
                  {trimmed}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
