import React, { useEffect, useRef } from 'react';
import { Copy, FileText, Pencil, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../ui/context-menu';

type OpenMenu = (event: React.MouseEvent<HTMLButtonElement>) => void;

export function shouldCancelMessageContextLongPress(
  start: { x: number; y: number } | null,
  current: { x: number; y: number },
  threshold = 10,
): boolean {
  return Boolean(start && Math.hypot(current.x - start.x, current.y - start.y) > threshold);
}

interface MessageContextMenuProps {
  content: string;
  children: React.ReactNode | ((openMenu: OpenMenu) => React.ReactNode);
  onEdit?: () => void;
  onSelectText?: () => void;
}

/** Shared right-click/long-press and explicit overflow menu for a user prompt. */
export function MessageContextMenu({ content, children, onEdit, onSelectText }: MessageContextMenuProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    pointerStartRef.current = null;
  };

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;

    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    const { x, y } = pointerStartRef.current;
    longPressTimerRef.current = setTimeout(() => {
      const target = triggerRef.current;
      if (!target) return;
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window,
      }));
      longPressTimerRef.current = null;
    }, 550);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (shouldCancelMessageContextLongPress(start, { x: event.clientX, y: event.clientY })) {
      clearLongPress();
    }
  };

  const openFromButton: OpenMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = triggerRef.current;
    if (!target) return;
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX || target.getBoundingClientRect().right,
      clientY: event.clientY || target.getBoundingClientRect().top,
      view: window,
    }));
  };

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(content);
    if (copied) toast.success('Message copied');
    else toast.error('Could not copy message');
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Shared prompt', text: content });
        return;
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    }
    const copied = await copyTextToClipboard(content);
    if (copied) toast.success('Prompt copied for sharing');
    else toast.error('Could not share prompt');
  };

  const menuChildren = typeof children === 'function' ? children(openFromButton) : children;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={triggerRef}
          data-testid="message-context-trigger"
          className="min-w-0"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
        >
          {menuChildren}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="message-context-menu"
        className="min-w-[13rem] rounded-2xl border border-border/70 bg-popover p-2 text-popover-foreground shadow-2xl dark:bg-[#2D2D2D] dark:text-white"
      >
        <ContextMenuItem onSelect={() => void handleCopy()} className="min-h-11 gap-3 rounded-xl px-3 text-sm font-medium">
          <Copy size={18} aria-hidden="true" />
          <span>Copy</span>
        </ContextMenuItem>
        <ContextMenuItem
            onSelect={() => {
              onSelectText?.();
              toast.info('Prompt text selected. Copy it or refine the selection.');
          }}
          className="min-h-11 gap-3 rounded-xl px-3 text-sm font-medium"
        >
          <FileText size={18} aria-hidden="true" />
          <span>Select text</span>
        </ContextMenuItem>
        {onEdit && (
          <ContextMenuItem onSelect={onEdit} className="min-h-11 gap-3 rounded-xl px-3 text-sm font-medium">
            <Pencil size={18} aria-hidden="true" />
            <span>Edit message</span>
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => void handleShare()} className="min-h-11 gap-3 rounded-xl px-3 text-sm font-medium">
          <Share2 size={18} aria-hidden="true" />
          <span>Share prompt</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
