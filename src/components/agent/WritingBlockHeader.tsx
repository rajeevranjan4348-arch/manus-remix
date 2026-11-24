import React from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WritingBlockActions } from './WritingBlockActions';

export interface WritingBlockHeaderProps {
  label?: string;
  content: string;
  title?: string;
  className?: string;
}

export const WritingBlockHeader = React.memo(function WritingBlockHeader({
  label = 'Writing',
  content,
  title,
  className,
}: WritingBlockHeaderProps) {
  return (
    <div
      data-testid="writing-block-header"
      className={cn(
        'flex items-center justify-between gap-3 px-4 pt-3.5 pb-2 sm:px-5 sm:pt-4',
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0 text-muted-foreground select-none">
        <FileText size={15} strokeWidth={1.9} className="shrink-0 opacity-85" />
        <span className="text-[13px] font-medium tracking-[-0.01em] truncate">
          {label}
        </span>
      </div>

      <WritingBlockActions content={content} title={title || label} />
    </div>
  );
});
