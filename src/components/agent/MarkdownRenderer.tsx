import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

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
    animateTypewriter ? Math.min(12, processedContent.length) : processedContent.length
  );
  const displayedLengthRef = useRef(displayedLength);
  displayedLengthRef.current = displayedLength;

  const [isTyping, setIsTyping] = useState(animateTypewriter && processedContent.length > 0);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const onCompleteRef = useRef(onTypewriterComplete);
  const onTickRef = useRef(onTypewriterTick);

  useEffect(() => {
    onCompleteRef.current = onTypewriterComplete;
  }, [onTypewriterComplete]);

  useEffect(() => {
    onTickRef.current = onTypewriterTick;
  }, [onTypewriterTick]);

  // Allow user to click to immediately finish typing
  const handleSkip = () => {
    if (isTyping) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
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
      onCompleteRef.current?.();
    }
  }, [animateTypewriter, displayedLength, processedContent.length, isTyping]);

  const visibleContent = animateTypewriter ? processedContent.slice(0, displayedLength) : processedContent;

  return (
    <div 
      className={cn("manus-markdown relative select-text transition-opacity duration-200 contain-content", isTyping && "cursor-pointer", className)}
      onClick={handleSkip}
      title={isTyping ? "Click to reveal complete text" : undefined}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins}>
        {visibleContent}
      </ReactMarkdown>
      {isTyping && (
        <span 
          className="ultra-smooth-caret" 
          aria-hidden="true"
        />
      )}
    </div>
  );
});