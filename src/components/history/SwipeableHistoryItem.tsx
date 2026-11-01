import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SwipeableHistoryItemProps {
  id: string;
  onDelete: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  deleteLabel?: string;
  className?: string;
  confirmThreshold?: number; // swipe distance to auto-trigger deletion
  revealThreshold?: number;  // swipe distance to reveal the delete button
  revealedWidth?: number;    // open snap position in px
}

export function SwipeableHistoryItem({
  id,
  onDelete,
  children,
  disabled = false,
  deleteLabel = 'Delete',
  className,
  confirmThreshold = 140,
  revealThreshold = 55,
  revealedWidth = 84,
}: SwipeableHistoryItemProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [itemHeight, setItemHeight] = useState<number | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const startOffsetRef = useRef(0);
  const directionRef = useRef<'horizontal' | 'vertical' | null>(null);
  const hasMovedRef = useRef(false);

  // Measure initial height for smooth exit animation collapse
  useEffect(() => {
    if (containerRef.current) {
      setItemHeight(containerRef.current.offsetHeight);
    }
  }, [children]);

  const triggerDelete = useCallback(() => {
    if (isDeleting) return;
    setIsDeleting(true);
    setOffsetX(-400);
    // Haptic feedback if supported on mobile
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate?.(35);
      } catch {}
    }
    setTimeout(() => {
      onDelete();
    }, 280);
  }, [isDeleting, onDelete]);

  // Touch handlers: only enter dragging state when horizontal intent is confirmed
  // so vertical touch scrolling on Android/mobile is never interrupted.
  const isTouchActiveRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled || isDeleting || e.touches.length > 1) return;
    const touch = e.touches[0];
    startPosRef.current = { x: touch.clientX, y: touch.clientY };
    startOffsetRef.current = isOpen ? -revealedWidth : 0;
    directionRef.current = null;
    hasMovedRef.current = false;
    isTouchActiveRef.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTouchActiveRef.current || disabled || isDeleting) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startPosRef.current.x;
    const deltaY = touch.clientY - startPosRef.current.y;

    if (!directionRef.current) {
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5) {
        directionRef.current = 'vertical';
        isTouchActiveRef.current = false;
        return;
      }
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
        directionRef.current = 'horizontal';
        setIsDragging(true);
      }
    }

    if (directionRef.current === 'horizontal') {
      hasMovedRef.current = true;
      let targetOffset = startOffsetRef.current + deltaX;
      // Resistance on right swipe
      if (targetOffset > 0) {
        targetOffset = Math.min(18, targetOffset * 0.15);
      }
      setOffsetX(targetOffset);
    }
  };

  const handleTouchEnd = () => {
    if (!isTouchActiveRef.current && !isDragging) return;
    isTouchActiveRef.current = false;
    setIsDragging(false);

    if (directionRef.current === 'horizontal') {
      if (offsetX <= -confirmThreshold) {
        // Full swipe-to-delete
        triggerDelete();
      } else if (offsetX <= -revealThreshold) {
        // Snap open to revealed delete button
        setIsOpen(true);
        setOffsetX(-revealedWidth);
      } else {
        // Snap closed
        setIsOpen(false);
        setOffsetX(0);
      }
    }
    directionRef.current = null;
  };

  // Mouse handlers for desktop swipe gesture
  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled || isDeleting || e.button !== 0) return;
    // Don't drag if clicking buttons, links, or inputs directly
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('a') || target.closest('[data-no-swipe]')) {
      return;
    }

    startPosRef.current = { x: e.clientX, y: e.clientY };
    startOffsetRef.current = isOpen ? -revealedWidth : 0;
    directionRef.current = null;
    hasMovedRef.current = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startPosRef.current.x;
      const deltaY = moveEvent.clientY - startPosRef.current.y;

      if (!directionRef.current) {
        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 6) {
          directionRef.current = 'vertical';
          return;
        }
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
          directionRef.current = 'horizontal';
          setIsDragging(true);
        }
      }

      if (directionRef.current === 'horizontal') {
        hasMovedRef.current = true;
        let targetOffset = startOffsetRef.current + deltaX;
        if (targetOffset > 0) {
          targetOffset = Math.min(18, targetOffset * 0.15);
        }
        setOffsetX(targetOffset);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setIsDragging(false);

      if (directionRef.current === 'horizontal') {
        if (offsetX <= -confirmThreshold) {
          triggerDelete();
        } else if (offsetX <= -revealThreshold) {
          setIsOpen(true);
          setOffsetX(-revealedWidth);
        } else {
          setIsOpen(false);
          setOffsetX(0);
        }
      }
      directionRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const isPastConfirm = offsetX <= -confirmThreshold;

  return (
    <div
      ref={containerRef}
      style={{
        maxHeight: isDeleting ? '0px' : itemHeight ? `${itemHeight + 30}px` : undefined,
        opacity: isDeleting ? 0 : 1,
        marginBottom: isDeleting ? '0px' : undefined,
        transform: isDeleting ? 'scale(0.96)' : 'none',
      }}
      className={cn(
        "relative overflow-hidden transition-all duration-200 ease-out",
        isDeleting && "pointer-events-none",
        className
      )}
    >
      {/* Background action revealed on swipe */}
      {offsetX < 0 && (
        <div
          className={cn(
            "absolute inset-0 rounded-xl flex items-center justify-end px-4 text-[#FFFFFF] dark:text-[#000000] overflow-hidden transition-colors duration-150 z-0",
            isPastConfirm
              ? "bg-[#000000] dark:bg-[#FFFFFF]"
              : "bg-[#262626] dark:bg-[#E0E0E0]"
          )}
          style={{
            opacity: Math.min(1, Math.max(0.25, Math.abs(offsetX) / 50)),
          }}
        >
          <button
            type="button"
            data-size="icon"
            onClick={(e) => {
              e.stopPropagation();
              triggerDelete();
            }}
            className="flex items-center gap-1.5 font-semibold text-xs py-1.5 px-2.5 rounded-lg transition-all cursor-pointer"
            title={deleteLabel}
            aria-label={deleteLabel}
          >
            <Trash2 size={14} />
            <span className="text-[11px] uppercase tracking-wider font-bold">
              {isPastConfirm ? 'Release' : deleteLabel}
            </span>
          </button>
        </div>
      )}

      {/* Foreground sliding card content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onClickCapture={(e) => {
          if (hasMovedRef.current) {
            e.stopPropagation();
            e.preventDefault();
            hasMovedRef.current = false;
          } else if (isOpen) {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen(false);
            setOffsetX(0);
          }
        }}
        style={{
          transform: offsetX !== 0 ? `translateX(${offsetX}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
          touchAction: 'pan-y',
        }}
        className={cn(
          "relative z-10 w-full touch-pan-y",
          isDragging && "cursor-grabbing select-none"
        )}
      >
        {children}
      </div>
    </div>
  );
}
