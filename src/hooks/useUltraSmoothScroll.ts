import React from 'react';
import { animateScrollTop, attachWheelSmoothing, type SmoothScrollOptions } from '@/lib/smoothScroll';

export interface UseUltraSmoothScrollResult<T extends HTMLElement> {
  /** Attach to the scrollable container element. */
  scrollRef: React.RefObject<T | null>;
  /** Animate to an absolute scrollTop (px). Interrupt-safe. */
  scrollTo: (top: number, options?: SmoothScrollOptions) => void;
  /** Animate to the bottom of the container (chat-follow pattern). */
  scrollToBottom: (options?: SmoothScrollOptions) => void;
  /** Animate until `child` is visible inside the container. */
  scrollIntoView: (child: Element, offset?: number, options?: SmoothScrollOptions) => void;
  /** True when the user is parked near the bottom (within `threshold` px). */
  isAtBottom: boolean;
}

/**
 * Ultra-smooth scrolling hook for any overflow container.
 *
 * - rAF spring physics (frame-rate independent) for programmatic scrolls
 * - optional wheel-tick smoothing for fine mouse-wheel gestures
 * - auto "stick to bottom" follow logic used by chat/log surfaces
 * - respects prefers-reduced-motion / touch devices via engine bypass
 *
 * Purely behavioral: adds no DOM nodes and no styling.
 */
export function useUltraSmoothScroll<T extends HTMLElement = HTMLDivElement>(options: {
  /** Enable wheel-step smoothing (default true; skipped on touch/reduced-motion). */
  smoothWheel?: boolean;
  wheelSensitivity?: number;
  /** Distance in px considered "at bottom" for auto-follow (default 120). */
  bottomThreshold?: number;
} = {}): UseUltraSmoothScrollResult<T> {
  const { smoothWheel = true, wheelSensitivity = 1, bottomThreshold = 120 } = options;

  const scrollRef = React.useRef<T | null>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  // Track whether the reader is at the end of the content (for auto-follow).
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distance <= bottomThreshold);
  }, [bottomThreshold]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !smoothWheel) return;
    return attachWheelSmoothing(el, wheelSensitivity);
  }, [smoothWheel, wheelSensitivity]);

  const scrollTo = React.useCallback((top: number, opts?: SmoothScrollOptions) => {
    if (scrollRef.current) animateScrollTop(scrollRef.current, top, opts);
  }, []);

  const scrollToBottom = React.useCallback((opts?: SmoothScrollOptions) => {
    const el = scrollRef.current;
    if (el) animateScrollTop(el, el.scrollHeight, opts);
  }, []);

  const scrollIntoView = React.useCallback(
    (child: Element, offset = 0, opts?: SmoothScrollOptions) => {
      const el = scrollRef.current;
      if (!el) return;
      const target =
        el.scrollTop + (child.getBoundingClientRect().top - el.getBoundingClientRect().top) + offset;
      animateScrollTop(el, target, opts);
    },
    [],
  );

  return { scrollRef, scrollTo, scrollToBottom, scrollIntoView, isAtBottom };
}

/**
 * Call inside effects that append content: keeps a chat/log pinned to the
 * bottom while the user is already there, without hijacking manual scroll-up.
 */
export function useAutoFollowBottom<T extends HTMLElement>(
  scrollRef: React.RefObject<T | null>,
  atBottom: boolean,
  deps: React.DependencyList,
) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom) {
      animateScrollTop(el, el.scrollHeight, { duration: 350 });
    }
    // Re-run whenever observed content changes (message count, streaming len…)
  }, deps);
}
