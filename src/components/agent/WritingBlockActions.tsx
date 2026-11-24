import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '@/lib/clipboard';
import { shareTextContent } from '@/lib/messageShare';
import { cn } from '@/lib/utils';

export interface WritingBlockActionsProps {
  content: string;
  title?: string;
  className?: string;
}

export const WritingBlockActions = React.memo(function WritingBlockActions({
  content,
  title = 'Writing',
  className,
}: WritingBlockActionsProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyTextToClipboard(content);
    if (ok) {
      setCopied(true);
      toast.success('Copied writing to clipboard');
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 2000);
    } else {
      toast.error('Unable to copy text');
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const outcome = await shareTextContent({
      title: title || 'Deku AI Writing',
      text: content,
    });
    if (outcome === 'copied') {
      toast.success('Copied writing for sharing');
    } else if (outcome === 'failed') {
      toast.error('Unable to share writing');
    }
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={handleCopy}
        data-testid="writing-block-copy"
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer"
        title={copied ? 'Copied' : 'Copy writing'}
        aria-label={copied ? 'Copied writing' : 'Copy writing'}
      >
        {copied ? (
          <Check size={16} strokeWidth={2.2} className="text-emerald-500" />
        ) : (
          <Copy size={16} strokeWidth={1.9} />
        )}
      </button>

      <button
        type="button"
        onClick={handleShare}
        data-testid="writing-block-share"
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer"
        title="Share writing"
        aria-label="Share writing"
      >
        <Share2 size={16} strokeWidth={1.9} />
      </button>
    </div>
  );
});
