import React, { useState, memo } from 'react';
import { Brain, ChevronDown, ChevronUp, Copy, Check, Sparkles, Lightbulb, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ThoughtProcessProps {
  thoughtText: string;
  durationSeconds?: number;
  isLive?: boolean;
  className?: string;
  defaultExpanded?: boolean;
}

const PRIVATE_COT_PATTERNS: RegExp[] = [
  /\b(system\s+prompt|system\s+instruction|developer\s+instruction|hidden\s+instruction|internal\s+deliberation|private\s+chain[- ]of[- ]thought|secret\s+key|api[_-\s]?key)\b/i,
  /^(?:wait[,.\s]|hmm[,.\s]|let\s+me\s+think|actually[,.\s]+i\s+should|i\s+am\s+instructed\s+to|according\s+to\s+my\s+instructions|my\s+system\s+rules)/i,
];

/**
 * Sanitizes raw reasoning text to ensure private chain-of-thought, internal self-talk,
 * or system instructions are never exposed, returning only a brief, user-safe reasoning summary.
 */
export function sanitizeReasoningSummary(rawThought: string): string[] {
  if (!rawThought || typeof rawThought !== 'string') return [];

  const stripped = rawThought
    .replace(/<\/?think>/gi, '')
    .replace(/\[\/?THOUGHTS?\]/gi, '')
    .replace(/^\[MODE:[^\]]*\]\s*/gim, '')
    .trim();

  if (!stripped) return [];

  const candidateLines = stripped
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const safeLines: string[] = [];

  for (const line of candidateLines) {
    if (PRIVATE_COT_PATTERNS.some(pattern => pattern.test(line))) {
      continue;
    }

    // Condense overly long paragraphs into a brief user-safe summary line
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;

    const briefLine = normalized.length > 160
      ? `${normalized.slice(0, 157).trimEnd().replace(/[,;:\s]+$/, '')}...`
      : normalized;

    if (!safeLines.includes(briefLine)) {
      safeLines.push(briefLine);
    }

    if (safeLines.length >= 4) {
      break;
    }
  }

  return safeLines;
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

  const safeSummaryLines = React.useMemo(
    () => sanitizeReasoningSummary(thoughtText),
    [thoughtText]
  );

  if (safeSummaryLines.length === 0) return null;

  const summaryText = safeSummaryLines.join('\n');

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(summaryText);
    setCopied(true);
    toast.success('Reasoning summary copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-testid="thought-process-widget"
      className={cn(
        "w-full max-w-full min-w-0 rounded-2xl border transition-all duration-200 overflow-hidden my-2",
        isLive
          ? "border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900/60 shadow-2xs"
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
        className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer select-none group transition-colors hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
              isLive
                ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] shadow-xs"
                : "bg-[#F3F4F6] dark:bg-neutral-800 text-[#000000] dark:text-[#FFFFFF]"
            )}
          >
            {isLive ? (
              <Loader2 size={14} className="text-current animate-spin" />
            ) : (
              <Brain size={15} className="text-current" />
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-semibold tracking-tight text-[#000000] dark:text-[#FFFFFF] flex items-center gap-1.5">
              Thought Process
            </span>

            {isLive ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F3F4F6] dark:bg-neutral-800 text-[#000000] dark:text-[#FFFFFF]">
                Reasoning live
              </span>
            ) : durationSeconds ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F3F4F6] dark:bg-neutral-800 text-[#000000] dark:text-[#FFFFFF]">
                <Sparkles size={10} className="text-[#000000] dark:text-[#FFFFFF]" />
                Thought for {durationSeconds.toFixed(1)}s
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F3F4F6] dark:bg-neutral-800 text-[#000000] dark:text-[#FFFFFF]">
                Reasoning summary
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-[#000000] dark:text-[#FFFFFF]">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-md text-[#000000] dark:text-[#FFFFFF] hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
            title="Copy reasoning summary"
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
        <div
          data-testid="thought-process-summary-body"
          className="px-4 pb-4 pt-1 border-t border-[#E5E5E5] dark:border-neutral-800 text-xs text-[#000000]/85 dark:text-neutral-200 leading-relaxed font-mono space-y-2 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <div className="pl-2 border-l-2 border-neutral-300 dark:border-neutral-700 space-y-1.5 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
            {safeSummaryLines.map((line, idx) => {
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
