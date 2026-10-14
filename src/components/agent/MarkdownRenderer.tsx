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
  // Pre-process content to remove internal chart data JSON blocks
  const processedContent = useMemo(() => {
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
      setDisplayedLength(processedContent.length);
      setIsTyping(false);
      onCompleteRef.current?.();
    }
  };

  useEffect(() => {
    if (!animateTypewriter) {
      setDisplayedLength(processedContent.length);
      setIsTyping(false);
      return;
    }

    if (displayedLength >= processedContent.length) {
      setIsTyping(false);
      return;
    }

    setIsTyping(true);

    const animate = (timestamp: number) => {
      if (!lastTickRef.current) lastTickRef.current = timestamp;
      const elapsed = timestamp - lastTickRef.current;

      // Batch 6-12 characters every ~32ms for smooth 30-60fps reading cadence
      // Prevents thrashing the ReactMarkdown parser while maintaining natural flow
      if (elapsed >= 32) {
        lastTickRef.current = timestamp;
        setDisplayedLength((prev) => {
          const charsToAdd = Math.max(4, Math.floor(elapsed / 4));
          const next = prev + charsToAdd;
          onTickRef.current?.();
          return Math.min(next, processedContent.length);
        });
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
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
      className={cn("manus-markdown relative select-text transition-all duration-150 contain-content", isTyping && "cursor-pointer", className)}
      onClick={handleSkip}
      title={isTyping ? "Click to reveal complete text" : undefined}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins}>
        {visibleContent}
      </ReactMarkdown>
      {isTyping && (
        <span 
          className="inline-block w-1.5 h-4 ml-1 bg-primary/80 rounded-xs animate-pulse align-middle shadow-xs" 
          aria-hidden="true"
        />
      )}
    </div>
  );
});