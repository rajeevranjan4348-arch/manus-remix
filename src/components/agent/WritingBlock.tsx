import React from 'react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { WritingBlockHeader } from './WritingBlockHeader';

export interface WritingBlockProps {
  content: string;
  label?: string;
  title?: string;
  animateTypewriter?: boolean;
  onTypewriterComplete?: () => void;
  onTypewriterTick?: () => void;
  className?: string;
}

/**
 * ChatGPT-inspired Writing Block card for standalone written artifacts
 * (emails, reports, proposals, letters, essays, social posts, and structured prompts).
 */
export const WritingBlock = React.memo(function WritingBlock({
  content,
  label = 'Writing',
  title,
  animateTypewriter = false,
  onTypewriterComplete,
  onTypewriterTick,
  className,
}: WritingBlockProps) {
  return (
    <section
      data-testid="writing-block"
      aria-label={title ? `${label}: ${title}` : label}
      className={cn(
        'my-2.5 w-full rounded-[1.35rem] border overflow-hidden transition-colors',
        'bg-[#F4F4F6] border-black/[0.08] text-[#111111]',
        'dark:bg-[#1E1E21] dark:border-white/[0.08] dark:text-[#F5F5F7]',
        'shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.28)]',
        className
      )}
    >
      <WritingBlockHeader label={label} content={content} title={title} />

      <div
        data-testid="writing-block-body"
        className={cn(
          'px-4 pb-5 pt-1 sm:px-5 sm:pb-6 min-w-0 break-words select-text',
          'prose prose-sm dark:prose-invert max-w-none',
          '[&_h1]:text-[1.25rem] [&_h1]:sm:text-[1.35rem] [&_h1]:font-bold [&_h1]:tracking-[-0.015em] [&_h1]:leading-snug [&_h1]:mt-1 [&_h1]:mb-3',
          '[&_h2]:text-[1.05rem] [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2',
          '[&_h3]:text-[0.95rem] [&_h3]:font-semibold [&_h3]:mt-3.5 [&_h3]:mb-1.5',
          '[&_p]:leading-[1.68] [&_p]:text-[14.5px] [&_p]:sm:text-[15px]',
          '[&_li]:leading-[1.65] [&_li]:text-[14.5px] [&_li]:sm:text-[15px]'
        )}
      >
        <MarkdownRenderer
          content={content}
          animateTypewriter={animateTypewriter}
          onTypewriterComplete={onTypewriterComplete}
          onTypewriterTick={onTypewriterTick}
        />
      </div>
    </section>
  );
});
