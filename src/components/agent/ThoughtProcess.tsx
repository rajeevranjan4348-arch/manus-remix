import React, { useState, memo } from 'react';
import { Brain, ChevronDown, ChevronUp, Copy, Check, Sparkles, Lightbulb, Workflow, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import LatticeLoader from '../ui/LatticeLoader';

interface ThoughtProcessProps {
  thoughtText: string;
  durationSeconds?: number;
  isLive?: boolean;
  className?: string;
  defaultExpanded?: boolean;
}

export const ThoughtProcess = memo(function ThoughtProcess({
  thoughtText,
  durationSeconds,
  isLive = false,
  className,
  defaultExpanded = false,
}: ThoughtProcessProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || isLive);
  const [userToggled, setUserToggled] = useState(false);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (userToggled) return;
    if (isLive) {
      setIsExpanded(true);
    } else if (!defaultExpanded) {
      setIsExpanded(false);
    }
  }, [isLive, defaultExpanded, userToggled]);

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
          ? "border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900/60 shadow-[0_0_20px_rgba(0,0,0,0.06)]"
          : "border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900/40 hover:border-neutral-300 dark:hover:border-neutral-700",
        className
      )}
    >
      {/* Header Bar */}
      <div
        onClick={() => {
          setUserToggled(true);
          setIsExpanded(prev => !prev);
        }}
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none group transition-colors hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
              isLive
                ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] shadow-xs animate-pulse"
                : "bg-[#F3F4F6] dark:bg-neutral-800 text-[#000000] dark:text-[#FFFFFF]"
            )}
          >
            <Brain size={15} className={cn("text-current", isLive && "animate-spin-[duration:6s]")} />
          </div>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-semibold tracking-tight text-[#000000] dark:text-[#FFFFFF] flex items-center gap-1.5">
              Thought Process
            </span>

            {isLive ? (
              <LatticeLoader
                label="Reasoning live"
                doneLabel="Thought for"
                status="working"
                pattern="spiral"
                grid={3}
                shape="round"
                cellSize={4}
                gap={1.5}
                fontSize={11}
                color="#000000"
                glow={false}
                showTimer={true}
                className="shrink-0"
              />
            ) : durationSeconds ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F3F4F6] dark:bg-neutral-800 text-[#000000] dark:text-[#FFFFFF]">
                <Sparkles size={10} className="text-[#000000] dark:text-[#FFFFFF]" />
                Thought for {durationSeconds.toFixed(1)}s
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F3F4F6] dark:bg-neutral-800 text-[#000000] dark:text-[#FFFFFF]">
                Deep reasoning trail
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-[#000000] dark:text-[#FFFFFF]">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-md text-[#000000] dark:text-[#FFFFFF] hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
            title="Copy thought process"
          >
            {copied ? <Check size={13} className="text-[#000000] dark:text-[#FFFFFF]" /> : <Copy size={13} className="text-[#000000] dark:text-[#FFFFFF]" />}
          </button>
          <div className="p-1 rounded-md text-[#000000] dark:text-[#FFFFFF]">
            {isExpanded ? <ChevronUp size={16} className="text-[#000000] dark:text-[#FFFFFF]" /> : <ChevronDown size={16} className="text-[#000000] dark:text-[#FFFFFF]" />}
          </div>
        </div>
      </div>

      {/* Expanded Content Body */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-[#E5E5E5] dark:border-neutral-800 text-xs text-[#000000]/85 dark:text-neutral-200 leading-relaxed font-mono space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="pl-2 border-l-2 border-neutral-300 dark:border-neutral-700 space-y-1.5 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
            {rawLines.map((line, idx) => {
              const trimmed = line.trim();
              const isHeader = /^#+|^Phase \d+|^Step \d+|^Hypothesis:|^Validation:|^Analysis:|^Reasoning:|\*\*.*?\*\*/i.test(trimmed);
              const isBullet = trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed);

              if (isHeader) {
                return (
                  <div
                    key={idx}
                    style={{ animationDelay: `${Math.min(idx * 35, 280)}ms` }}
                    className="manus-thought-step-enter font-semibold text-[#000000] dark:text-[#FFFFFF] pt-1 flex items-center gap-1.5"
                  >
                    <Lightbulb size={12} className="text-[#000000] dark:text-[#FFFFFF] shrink-0" />
                    <span>{trimmed.replace(/^#+\s*/, '')}</span>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  style={{ animationDelay: `${Math.min(idx * 35, 280)}ms` }}
                  className={cn(
                    "manus-thought-step-enter text-[11.5px] leading-normal font-sans",
                    isBullet ? "pl-2 text-[#000000]/90 dark:text-neutral-200" : "text-neutral-600 dark:text-neutral-400"
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
});
