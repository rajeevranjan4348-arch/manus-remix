import React, { useState, useEffect, useRef, memo } from 'react';
import { ThumbsUp, ThumbsDown, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  MessageReactionType,
  getMessageReaction,
  toggleMessageReaction,
} from '@/lib/messageReactions';

export interface MessageHoverReactionsProps {
  messageId: string;
  content?: string;
  className?: string;
  onReactionChange?: (reaction: MessageReactionType | null) => void;
}

export const MessageHoverReactions = memo(function MessageHoverReactions({
  messageId,
  content,
  className,
  onReactionChange,
}: MessageHoverReactionsProps) {
  const [reaction, setReaction] = useState<MessageReactionType | null>(() =>
    getMessageReaction(messageId)
  );
  const [poppingReaction, setPoppingReaction] = useState<MessageReactionType | null>(null);
  const [copied, setCopied] = useState(false);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (popTimerRef.current) {
        clearTimeout(popTimerRef.current);
      }
    };
  }, [messageId]);

  const triggerSpringPop = (type: MessageReactionType) => {
    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
    }
    setPoppingReaction(null);
    // Schedule on next microtask/frame so rapid clicks re-trigger the CSS spring animation
    requestAnimationFrame(() => {
      setPoppingReaction(type);
      popTimerRef.current = setTimeout(() => {
        setPoppingReaction((prev) => (prev === type ? null : prev));
      }, 430);
    });
  };

  const handleToggleReaction = (type: MessageReactionType, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    triggerSpringPop(type);
    const { nextReaction } = toggleMessageReaction(messageId, type);
    setReaction(nextReaction);
    onReactionChange?.(nextReaction);

    if (nextReaction === 'up') {
      toast.success('Marked response as helpful');
    } else if (nextReaction === 'down') {
      toast.info('Feedback recorded — we will work to improve');
    } else {
      toast.info('Reaction removed');
    }
  };

  const handleQuickCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copied response');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Failed to copy response');
    }
  };

  const isUpActive = reaction === 'up';
  const isDownActive = reaction === 'down';

  return (
    <div
      data-testid="ai-message-hover-reactions"
      data-message-id={messageId}
      data-active-reaction={reaction || 'none'}
      role="toolbar"
      aria-label="Message reactions"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF] dark:bg-[#171717] backdrop-blur-md px-1 py-0.5 shadow-sm transition-all duration-150 select-none',
        reaction
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-0.5 pointer-events-none group-hover/ai-message:opacity-100 group-hover/ai-message:translate-y-0 group-hover/ai-message:pointer-events-auto group-focus-within/ai-message:opacity-100 group-focus-within/ai-message:translate-y-0 group-focus-within/ai-message:pointer-events-auto',
        className
      )}
    >
      <button
        type="button"
        data-testid="hover-reaction-thumbs-up"
        data-reaction="up"
        data-active={isUpActive ? 'true' : 'false'}
        data-popping={poppingReaction === 'up' ? 'true' : 'false'}
        aria-pressed={isUpActive}
        aria-label="Thumbs up"
        title={isUpActive ? 'Remove helpful reaction' : 'Helpful response (Thumbs up)'}
        onClick={(e) => handleToggleReaction('up', e)}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-all duration-200 cursor-pointer active:scale-90',
          poppingReaction === 'up' && 'animate-reaction-spring-pop',
          isUpActive
            ? 'bg-[#F2F2F2] dark:bg-[#111111] text-[#000000] dark:text-[#FFFFFF] ring-1 ring-[#000000] dark:ring-[#FFFFFF]'
            : 'text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111]'
        )}
      >
        <ThumbsUp
          size={13}
          strokeWidth={isUpActive ? 2.25 : 1.85}
          data-testid="hover-reaction-thumbs-up-icon"
          className={cn(
            'transition-colors duration-200',
            poppingReaction === 'up' && 'animate-reaction-icon-pop',
            isUpActive
              ? 'text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20 stroke-[#000000] dark:stroke-[#FFFFFF]'
              : 'text-[#000000] dark:text-[#FFFFFF]'
          )}
        />
        {isUpActive && <span className="text-[10px] leading-none font-semibold">Helpful</span>}
      </button>

      <button
        type="button"
        data-testid="hover-reaction-thumbs-down"
        data-reaction="down"
        data-active={isDownActive ? 'true' : 'false'}
        data-popping={poppingReaction === 'down' ? 'true' : 'false'}
        aria-pressed={isDownActive}
        aria-label="Thumbs down"
        title={isDownActive ? 'Remove not helpful reaction' : 'Not helpful (Thumbs down)'}
        onClick={(e) => handleToggleReaction('down', e)}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-all duration-200 cursor-pointer active:scale-90',
          poppingReaction === 'down' && 'animate-reaction-spring-pop',
          isDownActive
            ? 'bg-[#F2F2F2] dark:bg-[#111111] text-[#000000] dark:text-[#FFFFFF] ring-1 ring-[#000000] dark:ring-[#FFFFFF]'
            : 'text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111]'
        )}
      >
        <ThumbsDown
          size={13}
          strokeWidth={isDownActive ? 2.25 : 1.85}
          data-testid="hover-reaction-thumbs-down-icon"
          className={cn(
            'transition-colors duration-200',
            poppingReaction === 'down' && 'animate-reaction-icon-pop',
            isDownActive
              ? 'text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20 stroke-[#000000] dark:stroke-[#FFFFFF]'
              : 'text-[#000000] dark:text-[#FFFFFF]'
          )}
        />
        {isDownActive && <span className="text-[10px] leading-none font-semibold">Disliked</span>}
      </button>

      {content && (
        <>
          <span className="h-3 w-px bg-[#E0E0E0] dark:bg-[#333333] mx-0.5" aria-hidden="true" />
          <button
            type="button"
            data-testid="hover-reaction-copy"
            aria-label="Copy response"
            title={copied ? 'Copied' : 'Copy response'}
            onClick={handleQuickCopy}
            className="inline-flex items-center justify-center rounded-md p-1 text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111] transition-colors cursor-pointer"
          >
            {copied ? (
              <Check size={13} className="text-[#000000] dark:text-[#FFFFFF]" strokeWidth={2} />
            ) : (
              <Copy size={13} strokeWidth={1.85} />
            )}
          </button>
        </>
      )}
    </div>
  );
});
