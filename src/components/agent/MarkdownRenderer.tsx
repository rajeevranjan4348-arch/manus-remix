import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export type TypingSequencePhase = 'lead-in' | 'typing' | 'settled';

export interface TypingSequenceState {
  phase: TypingSequencePhase;
  visibleLength: number;
  progress: number;
  isComplete: boolean;
}

/**
 * Pure helper that computes the current typing animation phase and adaptive step progression.
 */
export function computeTypingSequenceState(options: {
  totalLength: number;
  displayedLength: number;
  animateTypewriter: boolean;
  inLeadIn?: boolean;
  prefersReducedMotion?: boolean;
}): TypingSequenceState {
  const {
    totalLength,
    displayedLength,
    animateTypewriter,
    inLeadIn = false,
    prefersReducedMotion = false,
  } = options;

  const safeTotal = Math.max(0, totalLength);
  if (!animateTypewriter || prefersReducedMotion || safeTotal === 0) {
    return {
      phase: 'settled',
      visibleLength: safeTotal,
      progress: 1,
      isComplete: true,
    };
  }

  const clampedDisplayed = Math.max(0, Math.min(displayedLength, safeTotal));
  if (inLeadIn && clampedDisplayed <= 16) {
    return {
      phase: 'lead-in',
      visibleLength: clampedDisplayed,
      progress: safeTotal > 0 ? clampedDisplayed / safeTotal : 0,
      isComplete: false,
    };
  }

  if (clampedDisplayed < safeTotal) {
    return {
      phase: 'typing',
      visibleLength: clampedDisplayed,
      progress: safeTotal > 0 ? clampedDisplayed / safeTotal : 0,
      isComplete: false,
    };
  }

  return {
    phase: 'settled',
    visibleLength: safeTotal,
    progress: 1,
    isComplete: true,
  };
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  animateTypewriter?: boolean;
  onTypewriterComplete?: () => void;
  onTypewriterTick?: () => void;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className, 
  animateTypewriter = false,
  onTypewriterComplete,
  onTypewriterTick
}: MarkdownRendererProps) {
  // Pre-process content to remove internal chart data JSON blocks (fast-path when no json fence exists)
  const processedContent = useMemo(() => {
    if (!content || !content.includes('```json')) return content || '';
    return content.replace(/```json\n([\s\S]*?)\n```/g, (match, p1) => {
      try {
        const parsed = JSON.parse(p1);
        const chartData = parsed.data || parsed;
        if (chartData.labels && chartData.datasets) {
          return ''; // Hide chart data JSON
        }
      } catch (e) {
        // Not valid JSON or not chart data, keep it
      }
      return match;
    });
  }, [content]);

  // Statically memoize plugins so remark unified pipeline is never rebuilt across frames
  const remarkPlugins = useMemo(() => [remarkGfm], []);

  const [displayedLength, setDisplayedLength] = useState(() => 
    animateTypewriter ? Math.min(8, processedContent.length) : processedContent.length
  );
  const displayedLengthRef = useRef(displayedLength);
  displayedLengthRef.current = displayedLength;

  const [isTyping, setIsTyping] = useState(animateTypewriter && processedContent.length > 0);
  const [inLeadIn, setInLeadIn] = useState(animateTypewriter && processedContent.length > 0);
  const animationRef = useRef<number | null>(null);
  const leadInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTickRef = useRef<number>(0);
  const onCompleteRef = useRef(onTypewriterComplete);
  const onTickRef = useRef(onTypewriterTick);

  useEffect(() => {
    onCompleteRef.current = onTypewriterComplete;
  }, [onTypewriterComplete]);

  useEffect(() => {
    onTickRef.current = onTypewriterTick;
  }, [onTypewriterTick]);

  // Brief subtle lead-in pulse (~150ms) when typewriter starts so responses morph from typing dots into text
  useEffect(() => {
    if (!animateTypewriter || processedContent.length === 0) {
      setInLeadIn(false);
      return;
    }
    setInLeadIn(true);
    leadInTimerRef.current = setTimeout(() => {
      setInLeadIn(false);
    }, 150);
    return () => {
      if (leadInTimerRef.current) {
        clearTimeout(leadInTimerRef.current);
        leadInTimerRef.current = null;
      }
    };
  }, [animateTypewriter]);

  // Allow user to click to immediately finish typing
  const handleSkip = () => {
    if (isTyping) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (leadInTimerRef.current) {
        clearTimeout(leadInTimerRef.current);
        leadInTimerRef.current = null;
      }
      setInLeadIn(false);
      displayedLengthRef.current = processedContent.length;
      setDisplayedLength(processedContent.length);
      setIsTyping(false);
      onCompleteRef.current?.();
    }
  };

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      ((typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
        document.documentElement.dataset.perfMode === 'saver');

    if (!animateTypewriter || prefersReducedMotion) {
      setInLeadIn(false);
      displayedLengthRef.current = processedContent.length;
      setDisplayedLength(processedContent.length);
      if (isTyping || animateTypewriter) {
        setIsTyping(false);
        onCompleteRef.current?.();
      }
      return;
    }

    if (displayedLengthRef.current > processedContent.length) {
      displayedLengthRef.current = processedContent.length;
      setDisplayedLength(processedContent.length);
    }

    if (displayedLengthRef.current >= processedContent.length) {
      setIsTyping(false);
      setInLeadIn(false);
      return;
    }

    setIsTyping(true);

    const animate = (timestamp: number) => {
      if (!lastTickRef.current) lastTickRef.current = timestamp;
      const elapsed = timestamp - lastTickRef.current;

      // Velocity-adaptive 60/120fps cadence: advances every ~16ms with proportional catch-up
      // so streamed text glides smoothly without choppy jumps or parser thrashing.
      if (elapsed >= 16) {
        lastTickRef.current = timestamp;
        const prev = displayedLengthRef.current;
        const remaining = processedContent.length - prev;
        if (remaining <= 0) {
          animationRef.current = null;
          setIsTyping(false);
          setInLeadIn(false);
          onCompleteRef.current?.();
          return;
        }
        const adaptiveStep = Math.max(3, Math.min(36, Math.ceil(remaining * 0.14) + Math.floor(elapsed / 5)));
        const next = Math.min(prev + adaptiveStep, processedContent.length);
        displayedLengthRef.current = next;
        setDisplayedLength(next);
        onTickRef.current?.();

        if (next >= processedContent.length) {
          animationRef.current = null;
          setIsTyping(false);
          setInLeadIn(false);
          onCompleteRef.current?.();
          return;
        }
      }

      if (displayedLengthRef.current < processedContent.length) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [processedContent, animateTypewriter]);

  // Trigger completion effect when typewriter animation completes
  useEffect(() => {
    if (animateTypewriter && displayedLength >= processedContent.length && isTyping) {
      setIsTyping(false);
      setInLeadIn(false);
      onCompleteRef.current?.();
    }
  }, [animateTypewriter, displayedLength, processedContent.length, isTyping]);

  const sequenceState = computeTypingSequenceState({
    totalLength: processedContent.length,
    displayedLength,
    animateTypewriter,
    inLeadIn,
  });

  const visibleContent = animateTypewriter
    ? processedContent.slice(0, sequenceState.visibleLength)
    : processedContent;

  return (
    <div 
      data-typing-phase={sequenceState.phase}
      className={cn(
        "manus-markdown relative select-text contain-content",
        isTyping ? "manus-markdown-typing cursor-pointer" : "manus-markdown-settled",
        className
      )}
      onClick={handleSkip}
      title={isTyping ? "Click to reveal complete text" : undefined}
    >
      {sequenceState.phase === 'lead-in' && (
        <div
          data-testid="typing-lead-in"
          className="manus-typing-sequence-lead mb-2"
          aria-live="polite"
        >
          <span className="manus-typing-dots-wave" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Manus is typing</span>
        </div>
      )}
      <ReactMarkdown remarkPlugins={remarkPlugins}>
        {visibleContent}
      </ReactMarkdown>
      {isTyping && (
        <span className="inline-flex items-center gap-1.5 align-baseline ml-1" aria-hidden="true">
          <span className="ultra-smooth-caret" />
          <span className="manus-typing-dots-wave opacity-75">
            <span />
            <span />
            <span />
          </span>
        </span>
      )}
    </div>
  );
});