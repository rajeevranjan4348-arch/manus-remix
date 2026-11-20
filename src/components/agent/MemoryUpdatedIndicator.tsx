import React, { useEffect, useState, memo } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageMemoryUpdate } from '@/lib/longTermMemory';

export interface MemoryUpdatedIndicatorProps {
  memoryUpdate: MessageMemoryUpdate;
  /** Duration in ms before a fresh confirmation settles into a subtle low-emphasis state (default: 4500ms) */
  settleAfterMs?: number;
  className?: string;
}

/**
 * Clean outlined open-book icon matching the minimal ChatGPT "Memory updated" row.
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
      <path d="M12 6.25c1.8-1.35 4.3-1.9 7-1.65a1 1 0 0 1 .9 1v11.6a1 1 0 0 1-1.08 1c-2.55-.22-4.87.35-6.82 1.8" />
      {/* Center spine */}
      <path d="M12 6.25V20" />
      {/* Subtle layered page edge on the left for depth matching the reference icon */}
      <path d="M7.2 4.55V16.6" strokeOpacity="0.65" strokeWidth="1.35" />
    </svg>
  );
}

/**
 * Minimal, distraction-free "Memory updated" confirmation row rendered directly
 * beneath the relevant user message ONLY after real memory persistence succeeds
 * (or displaying a clear failure state if persistence failed).
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

  if (!memoryUpdate || (memoryUpdate.status !== 'saved' && memoryUpdate.status !== 'failed')) {
    return null;
  }

  const label = isSaved
    ? memoryUpdate.action === 'clear'
      ? 'Memory cleared'
      : 'Memory updated'
    : "Couldn't update memory";

  const tooltip = isSaved
    ? memoryUpdate.summary || 'Saved to long-term memory'
    : memoryUpdate.error || 'Failed to persist memory';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="memory-updated-indicator"
      data-memory-status={memoryUpdate.status}
      data-memory-action={memoryUpdate.action}
      data-memory-phase={phase}
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-2.5 py-1.5 select-none transition-opacity duration-700 ease-out',
        isFresh && 'memory-updated-enter',
        isSaved && phase === 'subtle' && 'opacity-55 hover:opacity-95',
        className
      )}
    >
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
    </div>
  );
});
