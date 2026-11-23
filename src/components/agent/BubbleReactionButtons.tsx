import React, { useState, useEffect, useRef, memo } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  MessageReactionType,
  getMessageReaction,
  toggleMessageReaction,
} from '@/lib/messageReactions';

export interface BubbleReactionButtonsProps {
  messageId: string;
  groupScope?: 'user' | 'assistant';
  className?: string;
  onReactionChange?: (reaction: MessageReactionType | null) => void;
}

export const BubbleReactionButtons = memo(function BubbleReactionButtons({
  messageId,
  groupScope = 'user',
  className,
  onReactionChange,
}: BubbleReactionButtonsProps) {
  const [reaction, setReaction] = useState<MessageReactionType | null>(() =>
    getMessageReaction(messageId)
  );
  const [poppingReaction, setPoppingReaction] = useState<'up' | 'down' | null>(null);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf1Ref = useRef<number | null>(null);
  const raf2Ref = useRef<number | null>(null);

  useEffect(() => {
    setReaction(getMessageReaction(messageId));

    const handleReactionUpdate = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || detail.messageId === messageId) {
        setReaction(getMessageReaction(messageId));
      }
    };

    window.addEventListener('manus_message_reactions_updated', handleReactionUpdate);
    return () => {
      window.removeEventListener('manus_message_reactions_updated', handleReactionUpdate);
      if (popTimerRef.current) clearTimeout(popTimerRef.current);
      if (raf1Ref.current !== null) cancelAnimationFrame(raf1Ref.current);
      if (raf2Ref.current !== null) cancelAnimationFrame(raf2Ref.current);
    };
  }, [messageId]);

  const triggerSpringPop = (type: 'up' | 'down') => {
    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
      popTimerRef.current = null;
    }
    if (raf1Ref.current !== null) cancelAnimationFrame(raf1Ref.current);
    if (raf2Ref.current !== null) cancelAnimationFrame(raf2Ref.current);

    setPoppingReaction(null);
    // Double-rAF guarantees the browser paints the class removal so rapid clicks always replay the keyframe
    raf1Ref.current = requestAnimationFrame(() => {
      raf2Ref.current = requestAnimationFrame(() => {
        setPoppingReaction(type);
        popTimerRef.current = setTimeout(() => {
          setPoppingReaction((prev) => (prev === type ? null : prev));
          popTimerRef.current = null;
        }, 430);
      });
    });
  };

  const handleToggle = (type: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    triggerSpringPop(type);

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(12);
      } catch {
        // Ignore vibration errors on unsupported browsers
      }
    }

    const { nextReaction } = toggleMessageReaction(messageId, type);
    setReaction(nextReaction);
    onReactionChange?.(nextReaction);

    if (nextReaction === 'up') {
      toast.success('Reacted with thumbs up');
    } else if (nextReaction === 'down') {
      toast.info('Reacted with thumbs down');
    } else {
      toast.info('Reaction removed');
    }
  };

  const isUpActive = reaction === 'up';
  const isDownActive = reaction === 'down';
  const hasReaction = isUpActive || isDownActive;

  const hoverVisibilityClasses =
    groupScope === 'assistant'
      ? 'opacity-0 group-hover/ai-message:opacity-100 group-focus-within/ai-message:opacity-100 [@media(hover:none)]:opacity-70'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-70';

  return (
    <div
      data-testid="bubble-reaction-buttons"
      data-message-id={messageId}
      data-active-reaction={reaction || 'none'}
      role="group"
      aria-label="Message bubble reactions"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF]/95 dark:bg-[#171717]/95 backdrop-blur-sm px-1 py-0.5 shadow-xs transition-opacity duration-150 select-none shrink-0',
        hasReaction ? 'opacity-100' : hoverVisibilityClasses,
        className
      )}
    >
      <button
        type="button"
        data-testid="bubble-reaction-thumbs-up"
        data-reaction="up"
        data-active={isUpActive ? 'true' : 'false'}
        data-popping={poppingReaction === 'up' ? 'true' : 'false'}
        aria-pressed={isUpActive}
        aria-label="Thumbs up"
        title={isUpActive ? 'Remove thumbs up' : 'Thumbs up'}
        onClick={(e) => handleToggle('up', e)}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full p-1 transition-all duration-200 cursor-pointer active:scale-90',
          poppingReaction === 'up' && 'animate-reaction-spring-pop',
          isUpActive
            ? 'bg-[#F2F2F2] dark:bg-[#262626] text-[#000000] dark:text-[#FFFFFF] ring-1 ring-[#000000] dark:ring-[#FFFFFF]'
            : 'text-[#666666] dark:text-[#A3A3A3] hover:text-[#000000] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#262626]'
        )}
      >
        <ThumbsUp
          size={12}
          strokeWidth={isUpActive ? 2.25 : 1.85}
          className={cn(
            'transition-colors duration-200',
            poppingReaction === 'up' && 'animate-reaction-icon-pop',
            isUpActive
              ? 'text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20'
              : 'text-current'
          )}
        />
      </button>

      <button
        type="button"
        data-testid="bubble-reaction-thumbs-down"
        data-reaction="down"
        data-active={isDownActive ? 'true' : 'false'}
        data-popping={poppingReaction === 'down' ? 'true' : 'false'}
        aria-pressed={isDownActive}
        aria-label="Thumbs down"
        title={isDownActive ? 'Remove thumbs down' : 'Thumbs down'}
        onClick={(e) => handleToggle('down', e)}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full p-1 transition-all duration-200 cursor-pointer active:scale-90',
          poppingReaction === 'down' && 'animate-reaction-spring-pop',
          isDownActive
            ? 'bg-[#F2F2F2] dark:bg-[#262626] text-[#000000] dark:text-[#FFFFFF] ring-1 ring-[#000000] dark:ring-[#FFFFFF]'
            : 'text-[#666666] dark:text-[#A3A3A3] hover:text-[#000000] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#262626]'
        )}
      >
        <ThumbsDown
          size={12}
          strokeWidth={isDownActive ? 2.25 : 1.85}
          className={cn(
            'transition-colors duration-200',
            poppingReaction === 'down' && 'animate-reaction-icon-pop',
            isDownActive
              ? 'text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20'
              : 'text-current'
          )}
        />
      </button>
    </div>
  );
});
