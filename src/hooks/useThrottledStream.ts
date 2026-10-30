import { useCallback, useEffect, useRef, useState } from 'react';
import { getLimits } from '@/lib/perfProfile';

/**
 * useThrottledStream — SSE/streaming update batcher.
 *
 * AI providers (Blink useAgent) re-render on every token. On 2GB-class devices
 * a markdown re-parse per token saturates the main thread. This hook buffers a
 * fast-changing string (the streaming assistant message) and flushes it into
 * React state at most once per `streamFlushMs`, so rendering stays responsive
 * while text still appears to stream continuously.
 *
 * Guarantees:
 * - The final value is ALWAYS flushed when streaming ends → no truncation.
 * - Progressive drain: if the backlog exceeds `streamMaxCharsPerFlush` between
 *   ticks, we deliver a bounded slice and reschedule until caught up.
 * - On the 'full' profile the interval is ~one frame → effectively pass-through.
 */
export function useThrottledStream(
  liveValue: string,
  isStreaming: boolean
): { value: string; flushNow: () => void } {
  const limitsRef = useRef(getLimits());
  const bufferRef = useRef(liveValue);          // latest raw value (no render)
  const shownRef = useRef(liveValue);           // last string handed to React
  const shownLenRef = useRef(liveValue.length); // length currently displayed
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState(liveValue);

  const cancelTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const tick = useCallback(() => {
    timerRef.current = null;
    const target = bufferRef.current;
    const max = limitsRef.current.streamMaxCharsPerFlush;
    const prevLen = shownLenRef.current;

    if (target.length === prevLen && target === shownRef.current) {
      return; // nothing new to display
    }

    let deliveredLen = target.length;
    if (isFinite(max) && target.length - prevLen > max) {
      deliveredLen = prevLen + max; // bounded slice; keep draining next tick
    }

    shownLenRef.current = deliveredLen;
    shownRef.current = target.slice(0, deliveredLen);
    setShown(shownRef.current);

    if (deliveredLen < target.length && !timerRef.current) {
      // Backlog remains → continue progressive reveal on the next tick
      timerRef.current = setTimeout(tick, limitsRef.current.streamFlushMs);
    }
  }, []);

  const flushNow = useCallback(() => {
    cancelTimer();
    const target = bufferRef.current;
    if (shownRef.current !== target) {
      shownLenRef.current = target.length;
      shownRef.current = target;
      setShown(target);
    }
  }, []);

  // Keep the raw buffer current; schedule throttled renders only when needed
  useEffect(() => {
    bufferRef.current = liveValue;

    if (!isStreaming) {
      // Stream finished → guarantee the complete text is displayed immediately
      flushNow();
      return;
    }

    if (liveValue === shownRef.current) return; // already in sync

    // Throttle: only one pending flush at a time
    if (!timerRef.current) {
      timerRef.current = setTimeout(tick, limitsRef.current.streamFlushMs);
    }
  }, [liveValue, isStreaming, flushNow, tick]);

  // Cleanup on unmount — release timers, prevent leaks
  useEffect(() => cancelTimer, []);

  return { value: isStreaming ? shown : liveValue, flushNow };
}
