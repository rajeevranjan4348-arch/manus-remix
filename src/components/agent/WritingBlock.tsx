import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';

interface WritingBlockProps {
  content: string;
  messageId?: string;
  animateTypewriter?: boolean;
  onTypewriterComplete?: () => void;
  onTypewriterTick?: () => void;
  className?: string;
}

/** A focused document surface for an assistant's standalone writing output. */
export function WritingBlock({
  content,
  messageId,
  animateTypewriter = false,
  onTypewriterComplete,
  onTypewriterTick,
  className,
}: WritingBlockProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const handleCopy = async () => {
    const success = await copyTextToClipboard(content);
    if (!success) {
      toast.error('Could not copy writing');
      return;
    }
    setCopied(true);
    toast.success('Writing copied');
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1800);
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Writing', text: content });
        return;
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    }
    const success = await copyTextToClipboard(content);
    if (success) toast.success('Writing copied for sharing');
    else toast.error('Could not share writing');
  };

  return (
    <section
      data-testid="writing-block"
      data-message-id={messageId}
      aria-label="Generated writing"
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card text-card-foreground shadow-sm',
        'dark:bg-[#202020]',
        className,
      )}
    >
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-muted-foreground">
          <FileText size={18} className="shrink-0" aria-hidden="true" />
          <span>Writing</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void handleCopy()}
            aria-label={copied ? 'Writing copied' : 'Copy writing'}
            title={copied ? 'Copied' : 'Copy'}
            data-testid="writing-block-copy"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check size={19} aria-hidden="true" /> : <Copy size={19} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void handleShare()}
            aria-label="Share writing"
            title="Share"
            data-testid="writing-block-share"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Share2 size={19} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="min-w-0 px-4 py-4 sm:px-6 sm:py-5">
        <div className="manus-writing-markdown prose prose-sm dark:prose-invert max-w-none break-words text-foreground/95 [&_p]:leading-7 [&_li]:leading-7">
          <MarkdownRenderer
            content={content}
            animateTypewriter={animateTypewriter}
            onTypewriterComplete={onTypewriterComplete}
            onTypewriterTick={onTypewriterTick}
          />
        </div>
      </div>
    </section>
  );
}
