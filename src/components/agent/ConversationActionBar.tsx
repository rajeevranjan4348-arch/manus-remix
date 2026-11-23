import React, { useState, useEffect, useRef, memo } from 'react';
import { 
  Check, 
  Heart,
  Volume2, 
  VolumeX, 
  RotateCcw, 
  Download, 
  FileText 
} from 'lucide-react';
import { Copy, ThumbsUp, ThumbsDown, Share2, MoreVertical } from 'pulsoicon-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';
import {
  MessageReactionType,
  getMessageReaction,
  toggleMessageReaction,
} from '@/lib/messageReactions';

interface ConversationActionBarProps {
  content: string;
  messageId?: string;
  onRegenerate?: () => void;
  className?: string;
}

export const ConversationActionBar = memo(function ConversationActionBar({
  content,
  messageId,
  onRegenerate,
  className
}: ConversationActionBarProps) {
  const resolvedId = messageId || `msg_${content.slice(0, 32).replace(/\s+/g, '_')}`;
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<MessageReactionType | null>(() =>
    getMessageReaction(resolvedId)
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFeedback(getMessageReaction(resolvedId));

    const handleReactionUpdate = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || detail.messageId === resolvedId) {
        setFeedback(getMessageReaction(resolvedId));
      }
    };

    window.addEventListener('manus_message_reactions_updated', handleReactionUpdate);
    return () => {
      window.removeEventListener('manus_message_reactions_updated', handleReactionUpdate);
    };
  }, [resolvedId]);

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // Clean up speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (isSpeaking) {
        stopCleanSpeech();
      }
    };
  }, [isSpeaking]);

  const [poppingReaction, setPoppingReaction] = useState<MessageReactionType | 'copy' | null>(null);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popRaf1Ref = useRef<number | null>(null);
  const popRaf2Ref = useRef<number | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (popTimerRef.current) {
        clearTimeout(popTimerRef.current);
        popTimerRef.current = null;
      }
      if (popRaf1Ref.current !== null) {
        cancelAnimationFrame(popRaf1Ref.current);
        popRaf1Ref.current = null;
      }
      if (popRaf2Ref.current !== null) {
        cancelAnimationFrame(popRaf2Ref.current);
        popRaf2Ref.current = null;
      }
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  const triggerSpringPop = (type: MessageReactionType | 'copy') => {
    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
      popTimerRef.current = null;
    }
    if (popRaf1Ref.current !== null) cancelAnimationFrame(popRaf1Ref.current);
    if (popRaf2Ref.current !== null) cancelAnimationFrame(popRaf2Ref.current);

    setPoppingReaction(null);
    popRaf1Ref.current = requestAnimationFrame(() => {
      popRaf2Ref.current = requestAnimationFrame(() => {
        setPoppingReaction(type);
        popTimerRef.current = setTimeout(() => {
          setPoppingReaction((prev) => (prev === type ? null : prev));
          popTimerRef.current = null;
        }, 430);
      });
    });
  };

  const handleCopy = async () => {
    if (!content) return;
    triggerSpringPop('copy');
    const ok = await copyTextToClipboard(content);
    if (ok) {
      setCopied(true);
      toast.success('Copied to clipboard');
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } else {
      toast.error('Failed to copy text');
    }
  };

  const triggerHapticTap = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(12);
      } catch {}
    }
  };

  const handleThumbsUp = () => {
    triggerSpringPop('up');
    triggerHapticTap();
    const { nextReaction } = toggleMessageReaction(resolvedId, 'up');
    setFeedback(nextReaction);
    if (nextReaction === 'up') {
      toast.success('Thanks for your feedback!');
    } else {
      toast.info('Feedback removed');
    }
  };

  const handleHeart = () => {
    triggerSpringPop('heart');
    triggerHapticTap();
    const { nextReaction } = toggleMessageReaction(resolvedId, 'heart');
    setFeedback(nextReaction);
    if (nextReaction === 'heart') {
      toast.success('Loved this response!');
    } else {
      toast.info('Reaction removed');
    }
  };

  const handleThumbsDown = () => {
    triggerSpringPop('down');
    triggerHapticTap();
    const { nextReaction } = toggleMessageReaction(resolvedId, 'down');
    setFeedback(nextReaction);
    if (nextReaction === 'down') {
      toast.info('Thanks for your feedback. We will work to improve!');
    } else {
      toast.info('Feedback removed');
    }
  };

  const handleToggleSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.error('Speech synthesis is not supported in this browser');
      return;
    }

    if (isSpeaking) {
      stopCleanSpeech();
      setIsSpeaking(false);
      toast.info('Speech paused');
    } else {
      const started = speakCleanHumanVoice(content, {
        volume: 1.0, // Maximum loud & clear volume
        onStart: () => {
          setIsSpeaking(true);
          toast.info('Reading message aloud in clean human voice...');
        },
        onEnd: () => {
          setIsSpeaking(false);
        },
        onError: () => {
          setIsSpeaking(false);
        },
      });

      if (!started) {
        toast.error('No readable text available to speak');
      }
    }
  };

  const handleShare = async () => {
    if (!content) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Deku AI Response',
          text: content.slice(0, 300) + (content.length > 300 ? '...' : ''),
          url: window.location.href,
        });
        toast.success('Shared successfully');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    // Fallback: Copy formatted text to clipboard without disturbing selection or scroll
    const ok = await copyTextToClipboard(`${content}\n\n— Shared from Deku AI`);
    if (ok) {
      toast.success('Response copied to clipboard for sharing');
    } else {
      toast.error('Could not copy share content');
    }
  };

  const handleDownloadTxt = () => {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deku-response-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowMenu(false);
      toast.success('Downloaded response as text file');
    } catch {
      toast.error('Failed to download file');
    }
  };

  return (
    <div 
      data-testid="conversation-action-bar"
      className={cn(
        "flex items-center gap-2.5 sm:gap-3 py-1.5 text-[#000000] dark:text-[#FFFFFF] select-none relative animate-in fade-in duration-200",
        className
      )}
    >
      {/* 1. Copy button */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleCopy}
        data-testid="action-bar-copy"
        data-popping={poppingReaction === 'copy' ? 'true' : 'false'}
        title={copied ? "Copied" : "Copy to clipboard"}
        aria-label="Copy to clipboard"
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          "p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-90 transition-all duration-200 text-[#000000] dark:text-[#FFFFFF] cursor-pointer",
          poppingReaction === 'copy' && "animate-reaction-spring-pop"
        )}
      >
        {copied ? (
          <Check size={18} className={cn("text-[#000000] dark:text-[#FFFFFF] animate-in zoom-in-75 duration-150", poppingReaction === 'copy' && "animate-reaction-icon-pop")} strokeWidth={2} />
        ) : (
          <Copy animated={false} size={18} strokeWidth={1.75} className={cn(poppingReaction === 'copy' && "animate-reaction-icon-pop")} />
        )}
      </button>

      {/* 2. Thumbs up button */}
      <button
        type="button"
        onClick={handleThumbsUp}
        data-testid="action-bar-like"
        data-active={feedback === 'up' ? 'true' : 'false'}
        data-popping={poppingReaction === 'up' ? 'true' : 'false'}
        aria-pressed={feedback === 'up'}
        title="Good response"
        aria-label="Good response"
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          "p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-90 transition-all duration-200 cursor-pointer",
          poppingReaction === 'up' && "animate-reaction-spring-pop",
          feedback === 'up' 
            ? "text-[#000000] dark:text-[#FFFFFF] bg-[#F2F2F2] dark:bg-[#171717] ring-1 ring-[#000000] dark:ring-[#FFFFFF]" 
            : "text-[#000000] dark:text-[#FFFFFF]"
        )}
      >
        <ThumbsUp
          animated={false}
          size={18} 
          strokeWidth={feedback === 'up' ? 2.25 : 1.75} 
          className={cn(
            "transition-colors duration-200",
            poppingReaction === 'up' && "animate-reaction-icon-pop",
            feedback === 'up'
              ? "text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20 stroke-[#000000] dark:stroke-[#FFFFFF]"
              : "text-[#000000] dark:text-[#FFFFFF]"
          )}
        />
      </button>

      {/* 2b. Heart reaction button */}
      <button
        type="button"
        onClick={handleHeart}
        data-testid="action-bar-heart"
        data-active={feedback === 'heart' ? 'true' : 'false'}
        data-popping={poppingReaction === 'heart' ? 'true' : 'false'}
        aria-pressed={feedback === 'heart'}
        title="Love response"
        aria-label="Love response"
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          "p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-90 transition-all duration-200 cursor-pointer",
          poppingReaction === 'heart' && "animate-reaction-spring-pop",
          feedback === 'heart' 
            ? "text-[#000000] dark:text-[#FFFFFF] bg-[#F2F2F2] dark:bg-[#171717] ring-1 ring-[#000000] dark:ring-[#FFFFFF]" 
            : "text-[#000000] dark:text-[#FFFFFF]"
        )}
      >
        <Heart 
          size={18} 
          strokeWidth={feedback === 'heart' ? 2.25 : 1.75} 
          className={cn(
            "transition-colors duration-200",
            poppingReaction === 'heart' && "animate-reaction-icon-pop",
            feedback === 'heart'
              ? "text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20 stroke-[#000000] dark:stroke-[#FFFFFF]"
              : "text-[#000000] dark:text-[#FFFFFF]"
          )}
        />
      </button>

      {/* 3. Thumbs down button */}
      <button
        type="button"
        onClick={handleThumbsDown}
        data-testid="action-bar-dislike"
        data-active={feedback === 'down' ? 'true' : 'false'}
        data-popping={poppingReaction === 'down' ? 'true' : 'false'}
        aria-pressed={feedback === 'down'}
        title="Bad response"
        aria-label="Bad response"
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        className={cn(
          "p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-90 transition-all duration-200 cursor-pointer",
          poppingReaction === 'down' && "animate-reaction-spring-pop",
          feedback === 'down' 
            ? "text-[#000000] dark:text-[#FFFFFF] bg-[#F2F2F2] dark:bg-[#171717] ring-1 ring-[#000000] dark:ring-[#FFFFFF]" 
            : "text-[#000000] dark:text-[#FFFFFF]"
        )}
      >
        <ThumbsDown
          animated={false}
          size={18} 
          strokeWidth={feedback === 'down' ? 2.25 : 1.75} 
          className={cn(
            "transition-colors duration-200",
            poppingReaction === 'down' && "animate-reaction-icon-pop",
            feedback === 'down'
              ? "text-[#000000] dark:text-[#FFFFFF] fill-[#000000]/20 dark:fill-[#FFFFFF]/20 stroke-[#000000] dark:stroke-[#FFFFFF]"
              : "text-[#000000] dark:text-[#FFFFFF]"
          )}
        />
      </button>

      {/* 4. Audio Speaker button (Read Aloud) */}
      <button
        type="button"
        onClick={handleToggleSpeech}
        data-testid="action-bar-speaker"
        title={isSpeaking ? "Stop reading" : "Read aloud"}
        aria-label={isSpeaking ? "Stop reading" : "Read aloud"}
        className={cn(
          "p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-95 transition-all cursor-pointer",
          isSpeaking 
            ? "text-[#FFFFFF] bg-[#000000] dark:text-[#000000] dark:bg-[#FFFFFF] animate-pulse" 
            : "text-[#000000] dark:text-[#FFFFFF]"
        )}
      >
        {isSpeaking ? (
          <VolumeX size={18} strokeWidth={1.75} />
        ) : (
          <Volume2 size={18} strokeWidth={1.75} />
        )}
      </button>

      {/* 5. Share button */}
      <button
        type="button"
        onClick={handleShare}
        data-testid="action-bar-share"
        title="Share response"
        aria-label="Share response"
        className="p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-95 transition-all text-[#000000] dark:text-[#FFFFFF] cursor-pointer"
      >
        <Share2 animated={false} size={18} strokeWidth={1.75} />
      </button>

      {/* 6. More options button */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setShowMenu(prev => !prev)}
          data-testid="action-bar-more"
          title="More options"
          aria-label="More options"
          className={cn(
            "p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-95 transition-all text-[#000000] dark:text-[#FFFFFF] cursor-pointer",
            showMenu && "bg-[#F2F2F2] dark:bg-[#171717]"
          )}
        >
          <MoreVertical animated={false} size={18} strokeWidth={1.75} />
        </button>

        {/* Dropdown Menu */}
        {showMenu && (
          <div className="absolute left-0 bottom-full mb-1.5 sm:left-auto sm:right-0 w-48 rounded-xl bg-[#FFFFFF] dark:bg-[#171717] border border-[#E0E0E0] dark:border-[#333333] shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100 text-xs">
            {onRegenerate && (
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  onRegenerate();
                }}
                className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111] transition-colors cursor-pointer"
              >
                <RotateCcw size={14} className="text-[#000000] dark:text-[#FFFFFF]" />
                <span>Regenerate response</span>
              </button>
            )}

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowMenu(false);
                void handleCopy();
              }}
              className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111] transition-colors cursor-pointer"
            >
              <FileText size={14} className="text-[#000000] dark:text-[#FFFFFF]" />
              <span>Copy text</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadTxt}
              className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111] transition-colors cursor-pointer"
            >
              <Download size={14} className="text-[#000000] dark:text-[#FFFFFF]" />
              <span>Export as text (.txt)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
