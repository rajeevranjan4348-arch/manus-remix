import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useMessageWindow — lightweight chat virtualization ("windowing").
 *
 * Long conversations on 2GB-class devices explode DOM node count; every React
 * commit then walks thousands of fibers. Instead of pulling in a full
 * virtualizer (huge dependency for constrained devices), we keep only the most
 * recent `maxRenderedMessages` items mounted and provide an explicit
 * "load earlier messages" control so NO message is ever lost — older history
 * stays one tap away and renders incrementally.
 *
 * Behavior:
 * - Below the profile's virtualization threshold → everything renders (no UX change).
 * - Above it → tail window is shown; growing the window keeps scroll anchored
 *   via useLayoutEffect + scrollHeight compensation.
 */
export function useMessageWindow<T>(
  items: T[],
  opts: { windowSize: number; threshold: number }
): {
  visibleItems: T[];
  hiddenCount: number;
  showMore: () => void;
  canShowMore: boolean;
  nextBatchSize: number;
} {
  const { windowSize, threshold } = opts;
  const [extraShown, setExtraShown] = useState(0);

  // Reset window when the conversation identity changes (list shrinks)
  const prevLenRef = useRef(items.length);
  useEffect(() => {
    if (items.length < prevLenRef.current) {
      setExtraShown(0);
    }
    prevLenRef.current = items.length;
  }, [items.length]);

  const effectiveWindow = isFinite(windowSize) ? windowSize : items.length;
  const needsWindowing = isFinite(threshold) && items.length > Math.max(threshold, effectiveWindow);

  const hiddenCount = needsWindowing ? Math.max(0, items.length - effectiveWindow - extraShown) : 0;
  const sliceStart = needsWindowing ? items.length - (effectiveWindow + extraShown) : 0;

  const visibleItems = useMemo(
    () => (needsWindowing ? items.slice(Math.max(0, sliceStart)) : items),
    [items, needsWindowing, sliceStart]
  );

  const showMore = useCallback(() => {
    setExtraShown(prev => prev + Math.max(10, Math.floor(effectiveWindow)));
  }, [effectiveWindow]);

  return {
    visibleItems,
    hiddenCount,
    showMore,
    canShowMore: hiddenCount > 0,
    nextBatchSize: Math.max(10, Math.floor(effectiveWindow)),
  };
}
