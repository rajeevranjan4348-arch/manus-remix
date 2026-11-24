import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, FileText, Pencil, Share2, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';
import { shareTextContent } from '@/lib/messageShare';

export interface ContextMenuAnchor {
  x: number;
  y: number;
  /** Optional bounding rect of the message bubble to position cleanly beneath or above it */
  rect?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  };
  align?: 'left' | 'right';
}

export interface MessageContextMenuProps {
  isOpen: boolean;
  anchor: ContextMenuAnchor | null;
  messageText: string;
  timestamp?: string | number | Date;
  role: 'user' | 'assistant';
  canEdit?: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onSelectText?: () => void;
}

/**
 * Formats a message timestamp into a ChatGPT-style contextual header
 * such as "Today, 7:46 PM", "Yesterday, 7:46 PM", or "Nov 23, 7:46 PM".
 */
export function formatMessageContextTimestamp(
  timestamp?: string | number | Date,
  nowDate: Date = new Date()
): string {
  if (!timestamp) {
    return `Today, ${nowDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return `Today, ${nowDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  const timeStr = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  const startOfNow = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfNow - startOfDate) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return `Today, ${timeStr}`;
  if (diffDays === 1) return `Yesterday, ${timeStr}`;

  const datePart = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  return `${datePart}, ${timeStr}`;
}

/**
 * Computes viewport-safe (x, y) coordinates so the floating contextual menu
 * is never clipped on mobile or desktop viewports.
 */
export function clampMenuPosition(
  anchor: ContextMenuAnchor,
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 12
): { left: number; top: number; placement: 'below' | 'above' } {
  const menuW = Math.min(menuSize.width, Math.max(180, viewport.width - padding * 2));
  const menuH = menuSize.height;

  // Preferred horizontal alignment: align right edge with user bubble, left edge with assistant message
  let rawLeft: number;
  if (anchor.rect) {
    rawLeft =
      anchor.align === 'right'
        ? anchor.rect.right - menuW
        : anchor.rect.left;
  } else {
    rawLeft = anchor.align === 'right' ? anchor.x - menuW : anchor.x;
  }

  const maxLeft = Math.max(padding, viewport.width - menuW - padding);
  const left = Math.max(padding, Math.min(rawLeft, maxLeft));

  // Preferred vertical placement: right below the bubble/anchor; flip above if insufficient room below
  const gap = 8;
  const preferredBelow = anchor.rect ? anchor.rect.bottom + gap : anchor.y + gap;
  const preferredAbove = anchor.rect ? anchor.rect.top - menuH - gap : anchor.y - menuH - gap;

  let top = preferredBelow;
  let placement: 'below' | 'above' = 'below';

  if (preferredBelow + menuH + padding > viewport.height) {
    if (preferredAbove >= padding) {
      top = preferredAbove;
      placement = 'above';
    } else {
      top = Math.max(padding, viewport.height - menuH - padding);
    }
  } else {
    top = Math.max(padding, preferredBelow);
  }

  return { left: Math.round(left), top: Math.round(top), placement };
}

export const DEFAULT_LONG_PRESS_DELAY_MS = 480;
export const DEFAULT_LONG_PRESS_MOVE_THRESHOLD_PX = 10;
export const LONG_PRESS_VISUAL_FEEDBACK_DELAY_MS = 90;

/**
 * Pure helper to determine whether pointer/touch movement exceeded the scroll threshold
 * and should cancel an active long-press timer.
 */
export function shouldCancelLongPressForMove(
  start: { x: number; y: number } | null,
  current: { x: number; y: number },
  thresholdPx: number = DEFAULT_LONG_PRESS_MOVE_THRESHOLD_PX
): boolean {
  if (!start) return false;
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  return dx > thresholdPx || dy > thresholdPx;
}

/**
 * Returns true if the event target is inside an interactive control (button, link, input)
 * so message long-press never conflicts with reaction buttons or the three-dot menu trigger.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
  return Boolean((target as HTMLElement).closest('button, a, input, textarea, [role="button"]'));
}

/**
 * Determines whether a backdrop click should dismiss the floating menu.
 * Prevents the synthetic click emitted when lifting a finger/mouse after a long-press
 * from immediately closing the newly opened menu, while always dismissing genuine outside taps/clicks.
 */
export function shouldDismissBackdropClick({
  now,
  openedAt,
  pressStartedOnBackdrop,
  suppressUntil,
  graceWindowMs = 260,
}: {
  now: number;
  openedAt: number;
  pressStartedOnBackdrop: boolean;
  suppressUntil: number;
  graceWindowMs?: number;
}): boolean {
  if (pressStartedOnBackdrop) return true;
  if (now < suppressUntil) return false;
  if (now - openedAt < graceWindowMs) return false;
  return true;
}

export interface UserMessageGestureInfo {
  messageId: string;
  messageText: string;
  timestamp?: string | number | Date;
}

/**
 * Central, zero-dependency long-press + right-click gesture controller for user-sent messages.
 * - Supports Android touch, iOS touch, desktop mouse press-and-hold, and desktop right-click.
 * - Cancels automatically when scrolling/moving past 10px.
 * - Suppresses duplicate triggers and native OS callout conflicts.
 * - Tracks a subtle pressed message ID while holding.
 */
export function useMessageLongPressController({
  isMenuOpen,
  onOpenMenu,
  delayMs = DEFAULT_LONG_PRESS_DELAY_MS,
  moveThresholdPx = DEFAULT_LONG_PRESS_MOVE_THRESHOLD_PX,
}: {
  isMenuOpen: boolean;
  onOpenMenu: (payload: {
    anchor: ContextMenuAnchor;
    messageId: string;
    messageText: string;
    timestamp?: string | number | Date;
    role: 'user';
  }) => void;
  delayMs?: number;
  moveThresholdPx?: number;
}) {
  const [pressedMessageId, setPressedMessageId] = useState<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const visualTimerRef = useRef<number | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);
  const lastTriggeredAtRef = useRef<number>(0);
  const lastTouchAtRef = useRef<number>(0);
  const suppressNextClickRef = useRef<boolean>(false);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  const detachScrollListener = React.useCallback(() => {
    if (scrollCleanupRef.current) {
      scrollCleanupRef.current();
      scrollCleanupRef.current = null;
    }
  }, []);

  const clearTimers = React.useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (visualTimerRef.current !== null) {
      window.clearTimeout(visualTimerRef.current);
      visualTimerRef.current = null;
    }
    detachScrollListener();
    startPointRef.current = null;
    activeMessageIdRef.current = null;
    setPressedMessageId(null);
  }, [detachScrollListener]);

  const attachScrollCancellation = React.useCallback(() => {
    detachScrollListener();
    if (typeof window === 'undefined') return;
    const onScroll = () => {
      clearTimers();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    scrollCleanupRef.current = () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [clearTimers, detachScrollListener]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // Clear pressed highlight whenever menu opens
  useEffect(() => {
    if (isMenuOpen) {
      clearTimers();
    }
  }, [isMenuOpen, clearTimers]);

  const buildRectSnapshot = (el: HTMLElement | null) => {
    const domRect = el?.getBoundingClientRect?.();
    if (!domRect) return undefined;
    return {
      top: domRect.top,
      bottom: domRect.bottom,
      left: domRect.left,
      right: domRect.right,
      width: domRect.width,
      height: domRect.height,
    };
  };

  const triggerMenuOpen = React.useCallback(
    (
      info: UserMessageGestureInfo,
      coords: { x: number; y: number },
      targetEl: HTMLElement | null,
      withHaptic: boolean
    ) => {
      const now = Date.now();
      // Prevent duplicate openings from overlapping touch/contextmenu events
      if (now - lastTriggeredAtRef.current < 350) return;
      lastTriggeredAtRef.current = now;
      clearTimers();

      if (withHaptic) {
        try {
          if (typeof window !== 'undefined') {
            window.getSelection?.()?.removeAllRanges?.();
          }
        } catch {}
        try {
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(14);
          }
        } catch {}
      }

      onOpenMenu({
        anchor: {
          x: coords.x,
          y: coords.y,
          rect: buildRectSnapshot(targetEl),
          align: 'right',
        },
        messageId: info.messageId,
        messageText: info.messageText,
        timestamp: info.timestamp,
        role: 'user',
      });
    },
    [clearTimers, onOpenMenu]
  );

  const getUserMessageGestureProps = React.useCallback(
    (info: UserMessageGestureInfo) => ({
      onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
        lastTouchAtRef.current = Date.now();
        if (isMenuOpen || e.touches.length !== 1 || isInteractiveTarget(e.target)) {
          clearTimers();
          return;
        }
        const touch = e.touches[0];
        const targetEl = e.currentTarget;
        const clientX = touch.clientX;
        const clientY = touch.clientY;
        startPointRef.current = { x: clientX, y: clientY };
        activeMessageIdRef.current = info.messageId;
        suppressNextClickRef.current = false;

        if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
        if (visualTimerRef.current !== null) window.clearTimeout(visualTimerRef.current);
        attachScrollCancellation();

        visualTimerRef.current = window.setTimeout(() => {
          if (activeMessageIdRef.current === info.messageId) {
            setPressedMessageId(info.messageId);
          }
        }, LONG_PRESS_VISUAL_FEEDBACK_DELAY_MS);

        holdTimerRef.current = window.setTimeout(() => {
          suppressNextClickRef.current = true;
          triggerMenuOpen(info, { x: clientX, y: clientY }, targetEl, true);
        }, delayMs);
      },

      onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
        if (!startPointRef.current || e.touches.length === 0) return;
        const touch = e.touches[0];
        if (
          shouldCancelLongPressForMove(
            startPointRef.current,
            { x: touch.clientX, y: touch.clientY },
            moveThresholdPx
          )
        ) {
          clearTimers();
        }
      },

      onTouchEnd: () => {
        lastTouchAtRef.current = Date.now();
        clearTimers();
      },

      onTouchCancel: () => {
        lastTouchAtRef.current = Date.now();
        clearTimers();
      },

      onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
        // Ignore emulated mouse events synthesized after touch interactions
        if (Date.now() - lastTouchAtRef.current < 800) {
          return;
        }
        // Left-button press-and-hold on desktop; ignores right-click and interactive controls
        if (isMenuOpen || e.button !== 0 || isInteractiveTarget(e.target)) {
          return;
        }
        const targetEl = e.currentTarget;
        const clientX = e.clientX;
        const clientY = e.clientY;
        startPointRef.current = { x: clientX, y: clientY };
        activeMessageIdRef.current = info.messageId;
        suppressNextClickRef.current = false;

        if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
        if (visualTimerRef.current !== null) window.clearTimeout(visualTimerRef.current);
        attachScrollCancellation();

        visualTimerRef.current = window.setTimeout(() => {
          if (activeMessageIdRef.current === info.messageId) {
            setPressedMessageId(info.messageId);
          }
        }, LONG_PRESS_VISUAL_FEEDBACK_DELAY_MS + 50);

        holdTimerRef.current = window.setTimeout(() => {
          // Do not open if the user has an active text selection
          const selection = typeof window !== 'undefined' ? window.getSelection?.()?.toString().trim() : '';
          if (selection) {
            clearTimers();
            return;
          }
          suppressNextClickRef.current = true;
          triggerMenuOpen(info, { x: clientX, y: clientY }, targetEl, false);
        }, delayMs + 40);
      },

      onMouseMove: (e: React.MouseEvent<HTMLElement>) => {
        if (!startPointRef.current) return;
        if (
          shouldCancelLongPressForMove(
            startPointRef.current,
            { x: e.clientX, y: e.clientY },
            moveThresholdPx
          )
        ) {
          clearTimers();
        }
      },

      onMouseUp: () => {
        clearTimers();
      },

      onMouseLeave: () => {
        clearTimers();
      },

      onClick: (e: React.MouseEvent<HTMLElement>) => {
        if (suppressNextClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressNextClickRef.current = false;
        }
      },

      onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
        if (isInteractiveTarget(e.target)) return;
        const now = Date.now();
        // Suppress native Android/iOS context menu right after our touch long-press fired
        if (now - lastTriggeredAtRef.current < 800) {
          e.preventDefault();
          return;
        }
        // If an Android OEM fires contextmenu slightly before our 480ms touch timer finishes,
        // intercept it cleanly and open our unified action menu without showing the OS menu.
        const isRecentTouch = now - lastTouchAtRef.current < 1000;
        if (isRecentTouch) {
          e.preventDefault();
          suppressNextClickRef.current = true;
          triggerMenuOpen(
            info,
            { x: e.clientX, y: e.clientY },
            e.currentTarget,
            true
          );
          return;
        }
        // Keep native browser copy menu if desktop user explicitly highlighted text
        const activeSelection =
          typeof window !== 'undefined' ? window.getSelection?.()?.toString().trim() : '';
        if (activeSelection) {
          return;
        }
        // Desktop right-click opens our unified action menu
        e.preventDefault();
        triggerMenuOpen(
          info,
          { x: e.clientX, y: e.clientY },
          e.currentTarget,
          false
        );
      },
    }),
    [attachScrollCancellation, clearTimers, delayMs, isMenuOpen, moveThresholdPx, triggerMenuOpen]
  );

  return {
    pressedMessageId,
    getUserMessageGestureProps,
    clearLongPressTimers: clearTimers,
  };
}

/**
 * Reusable mobile long-press hook with scroll-cancellation so normal scrolling
 * and taps are never disrupted.
 */
export function useLongPress(
  onLongPress: (anchor: ContextMenuAnchor) => void,
  options?: { delayMs?: number; moveThresholdPx?: number; align?: 'left' | 'right' }
) {
  const delayMs = options?.delayMs ?? DEFAULT_LONG_PRESS_DELAY_MS;
  const moveThresholdPx = options?.moveThresholdPx ?? DEFAULT_LONG_PRESS_MOVE_THRESHOLD_PX;
  const align = options?.align ?? 'right';

  const timerRef = useRef<number | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const triggeredRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length !== 1) {
      clearTimer();
      return;
    }
    const touch = e.touches[0];
    const targetEl = e.currentTarget;
    startPointRef.current = { x: touch.clientX, y: touch.clientY };
    triggeredRef.current = false;

    clearTimer();
    timerRef.current = window.setTimeout(() => {
      triggeredRef.current = true;
      const domRect = targetEl?.getBoundingClientRect?.();
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(14);
        }
      } catch {}
      onLongPress({
        x: touch.clientX,
        y: touch.clientY,
        rect: domRect
          ? {
              top: domRect.top,
              bottom: domRect.bottom,
              left: domRect.left,
              right: domRect.right,
              width: domRect.width,
              height: domRect.height,
            }
          : undefined,
        align,
      });
    }, delayMs);
  };

  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!startPointRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    if (
      shouldCancelLongPressForMove(
        startPointRef.current,
        { x: touch.clientX, y: touch.clientY },
        moveThresholdPx
      )
    ) {
      clearTimer();
      startPointRef.current = null;
    }
  };

  const onTouchEnd = () => {
    clearTimer();
    startPointRef.current = null;
  };

  const onTouchCancel = () => {
    clearTimer();
    startPointRef.current = null;
  };

  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (triggeredRef.current) {
      e.preventDefault();
      triggeredRef.current = false;
    }
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onContextMenu,
  };
}

/**
 * Clean Select Text modal allowing Android & desktop users to highlight and copy
 * any individual portion of a message effortlessly without triggering long-press menus.
 */
export function SelectTextModal({
  isOpen,
  text,
  onClose,
}: {
  isOpen: boolean;
  text: string;
  onClose: () => void;
}) {
  const [copiedSelection, setCopiedSelection] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
        onClose();
      }
    };
    const handlePopState = () => onClose();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleCopySelectedOrAll = async () => {
    const selection = window.getSelection?.()?.toString().trim();
    const targetText = selection || text;
    const ok = await copyTextToClipboard(targetText);
    if (ok) {
      setCopiedSelection(true);
      toast.success(selection ? 'Copied selected text' : 'Copied complete message');
      window.setTimeout(() => setCopiedSelection(false), 1800);
    } else {
      toast.error('Unable to copy text');
    }
  };

  return createPortal(
    <div
      data-testid="select-text-modal-backdrop"
      className="manus-select-text-backdrop fixed inset-0 z-[9995] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Select text"
    >
      <div
        data-testid="select-text-modal"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'manus-select-text-card w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden',
          'bg-white border-black/[0.08] text-[#111111]',
          'dark:bg-[#1A1A1D] dark:border-white/[0.1] dark:text-[#F5F5F7]'
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.07] dark:border-white/[0.08]">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold">Select text</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
            aria-label="Close select text view"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-1.5 text-[12px] text-muted-foreground bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/[0.05] dark:border-white/[0.06]">
          Tap and drag to highlight any portion of this message.
        </div>

        <div
          ref={contentRef}
          data-testid="select-text-content"
          className="flex-1 overflow-y-auto px-4 py-3.5 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words select-text custom-scrollbar"
          style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
        >
          {text}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-black/[0.07] dark:border-white/[0.08]">
          <button
            type="button"
            onClick={handleCopySelectedOrAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#111111] text-white dark:bg-white dark:text-[#111111] hover:opacity-90 active:scale-95 transition-all cursor-pointer"
          >
            {copiedSelection ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedSelection ? 'Copied' : 'Copy selection'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-medium bg-black/[0.06] dark:bg-white/[0.08] text-foreground hover:bg-black/[0.1] dark:hover:bg-white/[0.14] transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * ChatGPT-style floating contextual action menu for user messages.
 * Displays timestamp header + Copy, Select text, Edit message (editable user messages), and Share prompt.
 */
export function MessageContextMenu({
  isOpen,
  anchor,
  messageText,
  timestamp,
  role,
  canEdit = false,
  onClose,
  onEdit,
  onSelectText,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef<number>(0);
  const backdropPressStartedRef = useRef<boolean>(false);
  const suppressBackdropClickUntilRef = useRef<number>(0);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    placement: 'below' | 'above';
  } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !anchor) {
      setPosition(null);
      return;
    }

    openedAtRef.current = Date.now();
    backdropPressStartedRef.current = false;
    suppressBackdropClickUntilRef.current = 0;

    const compute = () => {
      const el = menuRef.current;
      const menuWidth = el?.offsetWidth || 236;
      const menuHeight = el?.offsetHeight || (canEdit && role === 'user' ? 244 : 196);
      const nextPos = clampMenuPosition(
        anchor,
        { width: menuWidth, height: menuHeight },
        { width: window.innerWidth, height: window.innerHeight },
        12
      );
      setPosition(nextPos);
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [isOpen, anchor, canEdit, role]);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      try {
        menuRef.current?.focus({ preventScroll: true });
      } catch {}
    });

    // When a user lifts their finger/mouse after long-pressing a message bubble,
    // the newly mounted backdrop sits underneath the finger and receives a synthetic click.
    // Capturing that orphan release suppresses accidental immediate dismissal.
    const handleOrphanRelease = () => {
      if (!backdropPressStartedRef.current) {
        suppressBackdropClickUntilRef.current = Date.now() + 450;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
        e.preventDefault();
        onClose();
        return;
      }

      const menuEl = menuRef.current;
      if (!menuEl) return;
      const items = Array.from(
        menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      );
      if (items.length === 0) return;

      const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = activeIdx < 0 ? 0 : (activeIdx + 1) % items.length;
        items[nextIdx]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIdx = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
        items[prevIdx]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    };

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('touchend', handleOrphanRelease, { capture: true, passive: true });
    window.addEventListener('mouseup', handleOrphanRelease, { capture: true, passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('touchend', handleOrphanRelease, { capture: true });
      window.removeEventListener('mouseup', handleOrphanRelease, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      const prevEl = previouslyFocusedRef.current;
      if (prevEl && document.contains(prevEl) && typeof prevEl.focus === 'function') {
        try {
          prevEl.focus({ preventScroll: true });
        } catch {}
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen || !anchor || typeof document === 'undefined') return null;

  const formattedTime = formatMessageContextTimestamp(timestamp);
  const showEditAction = role === 'user' && canEdit && typeof onEdit === 'function';

  const handleCopy = async () => {
    onClose();
    const ok = await copyTextToClipboard(messageText);
    if (ok) {
      toast.success('Copied to clipboard');
    } else {
      toast.error('Unable to copy message');
    }
  };

  const handleSelectText = () => {
    onClose();
    onSelectText?.();
  };

  const handleEdit = () => {
    onClose();
    onEdit?.();
  };

  const handleShare = async () => {
    onClose();
    const outcome = await shareTextContent({
      title: role === 'user' ? 'Deku AI Prompt' : 'Deku AI Response',
      text: messageText,
    });
    if (outcome === 'copied') {
      toast.success(role === 'user' ? 'Prompt copied for sharing' : 'Message copied for sharing');
    } else if (outcome === 'failed') {
      toast.error('Unable to share message');
    }
  };

  const initialPos = position || clampMenuPosition(
    anchor,
    { width: 236, height: showEditAction ? 244 : 196 },
    { width: window.innerWidth, height: window.innerHeight },
    12
  );

  const handleBackdropPressStart = (e: React.SyntheticEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      backdropPressStartedRef.current = true;
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const pressStartedOnBackdrop = backdropPressStartedRef.current;
    backdropPressStartedRef.current = false;
    if (
      shouldDismissBackdropClick({
        now: Date.now(),
        openedAt: openedAtRef.current,
        pressStartedOnBackdrop,
        suppressUntil: suppressBackdropClickUntilRef.current,
      })
    ) {
      onClose();
    }
  };

  return createPortal(
    <div
      data-testid="message-context-menu-backdrop"
      className="manus-context-menu-backdrop fixed inset-0 z-[9990] bg-black/20 dark:bg-black/50 transition-opacity"
      onPointerDown={handleBackdropPressStart}
      onTouchStart={handleBackdropPressStart}
      onMouseDown={handleBackdropPressStart}
      onClick={handleBackdropClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        tabIndex={-1}
        role="menu"
        aria-label="Message actions"
        data-testid="message-context-menu"
        data-placement={initialPos.placement}
        onClick={(e) => e.stopPropagation()}
        style={{
          left: `${initialPos.left}px`,
          top: `${initialPos.top}px`,
        }}
        className={cn(
          'manus-context-menu-card fixed z-[9991] w-[236px] max-w-[calc(100vw-24px)] rounded-[1.35rem] py-2.5 px-1.5 border shadow-2xl outline-none',
          'bg-white border-black/[0.08] text-[#111111]',
          'dark:bg-[#1A1A1D] dark:border-white/[0.1] dark:text-[#F5F5F7]',
          initialPos.placement === 'above' ? 'origin-bottom' : 'origin-top'
        )}
      >
        <div
          data-testid="message-context-menu-timestamp"
          className="px-3.5 pt-1 pb-2 text-[12.5px] font-medium text-muted-foreground select-none"
        >
          {formattedTime}
        </div>

        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            role="menuitem"
            data-testid="context-action-copy"
            onClick={handleCopy}
            className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[14.5px] font-medium text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 active:scale-[0.99] transition-all cursor-pointer"
          >
            <Copy size={17} strokeWidth={1.9} className="shrink-0 opacity-90" />
            <span>Copy</span>
          </button>

          <button
            type="button"
            role="menuitem"
            data-testid="context-action-select-text"
            onClick={handleSelectText}
            className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[14.5px] font-medium text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 active:scale-[0.99] transition-all cursor-pointer"
          >
            <FileText size={17} strokeWidth={1.9} className="shrink-0 opacity-90" />
            <span>Select text</span>
          </button>

          {showEditAction && (
            <button
              type="button"
              role="menuitem"
              data-testid="context-action-edit"
              onClick={handleEdit}
              className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[14.5px] font-medium text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 active:scale-[0.99] transition-all cursor-pointer"
            >
              <Pencil size={17} strokeWidth={1.9} className="shrink-0 opacity-90" />
              <span>Edit message</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            data-testid="context-action-share"
            onClick={handleShare}
            className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[14.5px] font-medium text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 active:scale-[0.99] transition-all cursor-pointer"
          >
            <Share2 size={17} strokeWidth={1.9} className="shrink-0 opacity-90" />
            <span>{role === 'user' ? 'Share prompt' : 'Share message'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
