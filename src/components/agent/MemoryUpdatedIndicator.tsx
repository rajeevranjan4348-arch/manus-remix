import React, { useEffect, useState, memo, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageMemoryUpdate } from '@/lib/longTermMemory';

export interface MemoryUpdatedIndicatorProps {
  memoryUpdate: MessageMemoryUpdate;
  /** Duration in ms before a fresh confirmation settles into a subtle low-emphasis state (default: 4500ms) */
  settleAfterMs?: number;
  className?: string;
}

export interface FormattedMemoryHighlight {
  key?: string;
  value: string;
}

const MAX_HIGHLIGHT_VALUE_LEN = 76;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncateText(value: string, maxLen: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Extracts and cleans the specific memory entry added to the user's Deku AI profile
 * so the confirmation row can subtly highlight what was remembered without verbose clutter.
 */
export function formatMemoryHighlight(
  memoryUpdate: MessageMemoryUpdate
): FormattedMemoryHighlight | null {
  if (!memoryUpdate || memoryUpdate.status !== 'saved') return null;

  if (memoryUpdate.action === 'clear') {
    return { value: 'Profile memories cleared' };
  }

  let rawKey = memoryUpdate.memoryKey?.trim() || '';
  let rawValue = memoryUpdate.memoryValue?.trim() || '';

  if ((!rawKey || !rawValue) && memoryUpdate.summary) {
    const trimmedSummary = memoryUpdate.summary.trim();
    const colonIdx = trimmedSummary.indexOf(':');
    if (colonIdx > 0 && colonIdx < 48) {
      rawKey = rawKey || trimmedSummary.slice(0, colonIdx).trim();
      rawValue = rawValue || trimmedSummary.slice(colonIdx + 1).trim();
    } else if (!rawValue) {
      rawValue = trimmedSummary;
    }
  }

  if (!rawValue) return null;

  // Strip redundant phrasing when key already names the attribute
  // e.g., key="Favourite character", value="my favourite character is leon" -> "leon"
  let cleanedValue = rawValue.replace(/\s+/g, ' ').trim();
  if (rawKey) {
    const redundantAttrPattern = new RegExp(
      `^(?:my\\s+)?${escapeRegExp(rawKey)}\\s+(?:is|are)\\s+`,
      'i'
    );
    const stripped = cleanedValue.replace(redundantAttrPattern, '').trim();
    if (stripped.length >= 1) {
      cleanedValue = stripped;
    }
  }

  // Avoid duplicating key when generic fallback key equals the full value
  const isGenericKey = /^(saved memory|user preference|user instruction)$/i.test(rawKey);
  const isDuplicateKey =
    Boolean(rawKey) && cleanedValue.toLowerCase().startsWith(rawKey.toLowerCase());

  return {
    key: rawKey && !isGenericKey && !isDuplicateKey ? rawKey : undefined,
    value: truncateText(cleanedValue, MAX_HIGHLIGHT_VALUE_LEN),
  };
}

/**
 * Clean outlined open-book icon matching the minimal Deku AI "Memory updated" row.
 */
function OpenBookIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Left open page */}
      <path d="M12 6.25c-1.8-1.35-4.3-1.9-7-1.65a1 1 0 0 0-.9 1v11.6a1 1 0 0 0 1.08 1c2.55-.22 4.87.35 6.82 1.8" />
      {/* Right open page */}
      <path d="M12 6.25c1.8-1.35 4.3-1.9 7-1.65a1 1 0 0 1 .9 1v11.6a1 1 0 0 1-1.08 1c-2.55-.22 4.87.35-6.82 1.8" />
      {/* Center spine */}
      <path d="M12 6.25V20" />
      {/* Subtle layered page edge on the left for depth */}
      <path d="M7.2 4.55V16.6" strokeOpacity="0.65" strokeWidth="1.35" />
    </svg>
  );
}

/**
 * Minimal, distraction-free "Memory updated" confirmation row rendered directly
 * beneath the relevant user message ONLY after real memory persistence succeeds
 * (or displaying a clear failure state if persistence failed), with an entrance
 * animation that subtly highlights the specific memory added to the user's Deku AI profile.
 */
export const MemoryUpdatedIndicator = memo(function MemoryUpdatedIndicator({
  memoryUpdate,
  settleAfterMs = 4500,
  className,
}: MemoryUpdatedIndicatorProps) {
  const isFresh = memoryUpdate.isFresh !== false;
  const isSaved = memoryUpdate.status === 'saved';
  const [phase, setPhase] = useState<'active' | 'subtle'>(() =>
    isSaved && !isFresh ? 'subtle' : 'active'
  );

  useEffect(() => {
    if (!isSaved) {
      setPhase('active');
      return;
    }

    if (!isFresh) {
      setPhase('subtle');
      return;
    }

    setPhase('active');
    const timer = setTimeout(() => {
      setPhase('subtle');
    }, Math.max(1500, settleAfterMs));

    return () => clearTimeout(timer);
  }, [isSaved, isFresh, settleAfterMs, memoryUpdate.updatedAt]);

  const highlight = useMemo(() => formatMemoryHighlight(memoryUpdate), [memoryUpdate]);

  if (!memoryUpdate || (memoryUpdate.status !== 'saved' && memoryUpdate.status !== 'failed')) {
    return null;
  }

  const label = isSaved
    ? memoryUpdate.action === 'clear'
      ? 'Memory cleared'
      : 'Memory updated'
    : "Couldn't update memory";

  const tooltip = isSaved
    ? memoryUpdate.action === 'clear'
      ? 'Deku AI cleared your saved profile memories'
      : `Saved to Deku AI profile: ${memoryUpdate.summary || 'Long-term memory updated'}`
    : `Deku AI couldn't persist memory: ${memoryUpdate.error || 'Storage error'}`;

  const isActiveHighlight = isSaved && isFresh && phase === 'active';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={tooltip}
      data-testid="memory-updated-indicator"
      data-memory-status={memoryUpdate.status}
      data-memory-action={memoryUpdate.action}
      data-memory-phase={phase}
      title={tooltip}
      className={cn(
        'inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-1.5 select-none transition-opacity duration-700 ease-out max-w-full',
        isFresh && 'memory-updated-enter',
        isSaved && phase === 'subtle' && 'opacity-55 hover:opacity-95',
        className
      )}
    >
      <span className="inline-flex items-center gap-2 shrink-0">
        {isSaved ? (
          <OpenBookIcon
            className={cn(
              'w-[18px] h-[18px] shrink-0 text-[#171717] dark:text-[#FFFFFF]',
              isFresh && 'memory-book-icon-enter'
            )}
          />
        ) : (
          <AlertCircle
            size={17}
            strokeWidth={1.75}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-red-600 dark:text-red-400',
              isFresh && 'memory-book-icon-enter'
            )}
          />
        )}
        <span
          className={cn(
            'text-[14px] font-medium tracking-[-0.01em] leading-snug',
            isSaved
              ? 'text-[#525252] dark:text-[#B4B4B4]'
              : 'text-red-600/90 dark:text-red-400/90'
          )}
        >
          {label}
        </span>
      </span>

      {isSaved && highlight && (
        <span
          data-testid="memory-updated-highlight"
          data-highlight-state={isActiveHighlight ? 'highlighted' : 'settled'}
          className={cn(
            'relative inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[12.5px] leading-snug max-w-full overflow-hidden transition-colors duration-500',
            isActiveHighlight
              ? 'bg-[#F5F5F5] dark:bg-white/[0.08] border-[#D4D4D4] dark:border-white/[0.18] text-[#262626] dark:text-[#E5E5E5]'
              : 'bg-[#FAFAFA] dark:bg-white/[0.04] border-[#E5E5E5] dark:border-white/[0.10] text-[#525252] dark:text-[#B4B4B4]',
            isFresh && 'memory-highlight-enter'
          )}
        >
          {isActiveHighlight && (
            <span
              aria-hidden="true"
              data-testid="memory-updated-sheen"
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/2 memory-highlight-sheen"
            />
          )}
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[#737373] dark:text-[#9A9A9A] shrink-0">
            Deku AI
          </span>
          <span aria-hidden="true" className="text-[#A3A3A3] dark:text-[#737373] shrink-0">
            ·
          </span>
          <span className="truncate min-w-0">
            {highlight.key && (
              <>
                <span className="font-semibold text-[#171717] dark:text-[#FFFFFF]">
                  {highlight.key}
                </span>
                <span className="text-[#737373] dark:text-[#9A9A9A]">: </span>
              </>
            )}
            <span className="text-[#404040] dark:text-[#D4D4D4]">{highlight.value}</span>
          </span>
        </span>
      )}
    </div>
  );
});
