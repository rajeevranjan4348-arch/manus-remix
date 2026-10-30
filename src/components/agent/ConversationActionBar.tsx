import React, { useState, useEffect, useRef, memo } from 'react';
import { 
  Copy, 
  Check, 
  ThumbsUp, 
  ThumbsDown, 
  Volume2, 
  VolumeX, 
  Share2, 
  MoreVertical, 
  RotateCcw, 
  Download, 
  FileText 
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy text');
    }
  };

  const [poppingReaction, setPoppingReaction] = useState<MessageReactionType | null>(null);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSpringPop = (type: MessageReactionType) => {
    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
    }
    setPoppingReaction(null);
    requestAnimationFrame(() => {
      setPoppingReaction(type);
      popTimerRef.current = setTimeout(() => {
        setPoppingReaction((prev) => (prev === type ? null : prev));
      }, 430);
    });
  };

  const handleThumbsUp = () => {
    triggerSpringPop('up');
    const { nextReaction } = toggleMessageReaction(resolvedId, 'up');
    setFeedback(nextReaction);
    if (nextReaction === 'up') {
      toast.success('Thanks for your feedback!');
    } else {
      toast.info('Feedback removed');
    }
  };

  const handleThumbsDown = () => {
    triggerSpringPop('down');
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
          title: 'Manus AI Response',
          text: content.slice(0, 300) + (content.length > 300 ? '...' : ''),
          url: window.location.href,
        });
        toast.success('Shared successfully');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    // Fallback: Copy formatted text to clipboard
    try {
      await navigator.clipboard.writeText(`${content}\n\n— Shared from Manus AI`);
      toast.success('Response copied to clipboard for sharing');
    } catch {
      toast.error('Could not copy share content');
    }
  };

  const handleDownloadTxt = () => {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manus-response-${Date.now()}.txt`;
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
      className={cn(
        "flex items-center gap-2.5 sm:gap-3 py-1.5 text-[#000000] dark:text-[#FFFFFF] select-none relative animate-in fade-in duration-200",
        className
      )}
    >
      {/* 1. Copy button */}
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy to clipboard"}
        aria-label="Copy to clipboard"
        className="p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-95 transition-all text-[#000000] dark:text-[#FFFFFF] cursor-pointer"
      >
        {copied ? (
          <Check size={18} className="text-[#000000] dark:text-[#FFFFFF] animate-in zoom-in-75 duration-150" strokeWidth={2} />
        ) : (
          <Copy size={18} strokeWidth={1.75} />
        )}
      </button>

      {/* 2. Thumbs up button */}
      <button
        type="button"
        onClick={handleThumbsUp}
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

      {/* 3. Thumbs down button */}
      <button
        type="button"
        onClick={handleThumbsDown}
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
        title="Share response"
        aria-label="Share response"
        className="p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-95 transition-all text-[#000000] dark:text-[#FFFFFF] cursor-pointer"
      >
        <Share2 size={18} strokeWidth={1.75} />
      </button>

      {/* 6. More options button */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setShowMenu(prev => !prev)}
          title="More options"
          aria-label="More options"
          className={cn(
            "p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#171717] active:scale-95 transition-all text-[#000000] dark:text-[#FFFFFF] cursor-pointer",
            showMenu && "bg-[#F2F2F2] dark:bg-[#171717]"
          )}
        >
          <MoreVertical size={18} strokeWidth={1.75} />
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
