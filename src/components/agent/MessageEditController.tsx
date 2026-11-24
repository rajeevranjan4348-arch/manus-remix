import React from 'react';
import { Pencil, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MessageEditControllerProps {
  originalText: string;
  currentValue: string;
  isSubmitting?: boolean;
  onCancel: () => void;
  onSave: () => void;
  className?: string;
}

/**
 * Reusable composer edit-mode controller bar displayed inside the chat composer
 * when the user selects "Edit message" on a previous user turn.
 */
export const MessageEditController = React.memo(function MessageEditController({
  originalText,
  currentValue,
  isSubmitting = false,
  onCancel,
  onSave,
  className,
}: MessageEditControllerProps) {
  const trimmedCurrent = currentValue.trim();
  const canSave = Boolean(trimmedCurrent) && !isSubmitting;

  return (
    <div
      data-testid="message-edit-controller"
      role="region"
      aria-label="Editing message"
      className={cn(
        'flex items-center justify-between gap-2 pb-2 mb-0.5 border-b border-black/[0.08] dark:border-white/[0.1] animate-in fade-in slide-in-from-bottom-1 duration-150',
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/[0.06] dark:bg-white/[0.1] text-foreground shrink-0">
          <Pencil size={12} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex flex-col">
          <span className="text-[12px] font-semibold text-foreground leading-tight">
            Editing message
          </span>
          {originalText && (
            <span className="text-[11px] text-muted-foreground truncate max-w-[200px] sm:max-w-[360px]">
              {originalText}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          data-testid="edit-message-cancel"
          onClick={onCancel}
          disabled={isSubmitting}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium bg-black/[0.06] dark:bg-white/[0.08] text-foreground hover:bg-black/[0.1] dark:hover:bg-white/[0.14] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          <X size={13} strokeWidth={2.2} />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          data-testid="edit-message-save"
          onClick={onSave}
          disabled={!canSave}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-semibold active:scale-95 transition-all',
            canSave
              ? 'bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] hover:opacity-90 cursor-pointer shadow-xs'
              : 'bg-black/[0.08] dark:bg-white/[0.1] text-muted-foreground cursor-not-allowed opacity-60'
          )}
        >
          <Check size={13} strokeWidth={2.4} />
          <span>Save & Update</span>
        </button>
      </div>
    </div>
  );
});
