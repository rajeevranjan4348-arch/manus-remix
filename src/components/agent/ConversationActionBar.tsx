import React, { useState, useEffect, useRef } from 'react';
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

interface ConversationActionBarProps {
  content: string;
  onRegenerate?: () => void;
  className?: string;
}

export function ConversationActionBar({
  content,
  onRegenerate,
  className
}: ConversationActionBarProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleThumbsUp = () => {
    if (feedback === 'up') {
      setFeedback(null);
      toast.info('Feedback removed');
    } else {
      setFeedback('up');
      toast.success('Thanks for your feedback!');
    }
  };

  const handleThumbsDown = () => {
    if (feedback === 'down') {
      setFeedback(null);
      toast.info('Feedback removed');
    } else {
      setFeedback('down');
      toast.info('Thanks for your feedback. We will work to improve!');
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
        "flex items-center gap-2.5 sm:gap-3 py-1.5 text-muted-foreground/80 select-none relative animate-in fade-in duration-200",
        className
      )}
    >
      {/* 1. Copy button */}
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy to clipboard"}
        aria-label="Copy to clipboard"
        className="p-1.5 rounded-lg hover:text-foreground hover:bg-muted/70 active:scale-95 transition-all text-muted-foreground/80 hover:text-foreground cursor-pointer"
      >
        {copied ? (
          <Check size={18} className="text-emerald-500 animate-in zoom-in-75 duration-150" strokeWidth={2} />
        ) : (
          <Copy size={18} strokeWidth={1.75} />
        )}
      </button>

      {/* 2. Thumbs up button */}
      <button
        type="button"
        onClick={handleThumbsUp}
        title="Good response"
        aria-label="Good response"
        className={cn(
          "p-1.5 rounded-lg hover:text-foreground hover:bg-muted/70 active:scale-95 transition-all cursor-pointer",
          feedback === 'up' 
            ? "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20" 
            : "text-muted-foreground/80 hover:text-foreground"
        )}
      >
        <ThumbsUp 
          size={18} 
          strokeWidth={1.75} 
          className={cn(feedback === 'up' && "fill-emerald-500/20")}
        />
      </button>

      {/* 3. Thumbs down button */}
      <button
        type="button"
        onClick={handleThumbsDown}
        title="Bad response"
        aria-label="Bad response"
        className={cn(
          "p-1.5 rounded-lg hover:text-foreground hover:bg-muted/70 active:scale-95 transition-all cursor-pointer",
          feedback === 'down' 
            ? "text-rose-500 bg-rose-500/10 hover:bg-rose-500/20" 
            : "text-muted-foreground/80 hover:text-foreground"
        )}
      >
        <ThumbsDown 
          size={18} 
          strokeWidth={1.75} 
          className={cn(feedback === 'down' && "fill-rose-500/20")}
        />
      </button>

      {/* 4. Audio Speaker button (Read Aloud) */}
      <button
        type="button"
        onClick={handleToggleSpeech}
        title={isSpeaking ? "Stop reading" : "Read aloud"}
        aria-label={isSpeaking ? "Stop reading" : "Read aloud"}
        className={cn(
          "p-1.5 rounded-lg hover:text-foreground hover:bg-muted/70 active:scale-95 transition-all cursor-pointer",
          isSpeaking 
            ? "text-primary bg-primary/10 animate-pulse" 
            : "text-muted-foreground/80 hover:text-foreground"
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
        className="p-1.5 rounded-lg hover:text-foreground hover:bg-muted/70 active:scale-95 transition-all text-muted-foreground/80 hover:text-foreground cursor-pointer"
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
            "p-1.5 rounded-lg hover:text-foreground hover:bg-muted/70 active:scale-95 transition-all text-muted-foreground/80 hover:text-foreground cursor-pointer",
            showMenu && "text-foreground bg-muted/80"
          )}
        >
          <MoreVertical size={18} strokeWidth={1.75} />
        </button>

        {/* Dropdown Menu */}
        {showMenu && (
          <div className="absolute left-0 bottom-full mb-1.5 sm:left-auto sm:right-0 w-48 rounded-xl bg-popover/95 backdrop-blur-md border border-border shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100 text-xs">
            {onRegenerate && (
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  onRegenerate();
                }}
                className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              >
                <RotateCcw size={14} className="text-muted-foreground" />
                <span>Regenerate response</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                void handleCopy();
              }}
              className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <FileText size={14} className="text-muted-foreground" />
              <span>Copy text</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadTxt}
              className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <Download size={14} className="text-muted-foreground" />
              <span>Export as text (.txt)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
