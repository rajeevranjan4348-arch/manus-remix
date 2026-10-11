import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  animateTypewriter?: boolean;
  onTypewriterComplete?: () => void;
}

export function MarkdownRenderer({ 
  content, 
  className, 
  animateTypewriter = false,
  onTypewriterComplete 
}: MarkdownRendererProps) {
  // Pre-process content to remove internal chart data JSON blocks
  const processedContent = content.replace(/```json\n([\s\S]*?)\n```/g, (match, p1) => {
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

  const [displayedLength, setDisplayedLength] = useState(() => 
    animateTypewriter ? Math.min(6, processedContent.length) : processedContent.length
  );
  const [isTyping, setIsTyping] = useState(animateTypewriter && processedContent.length > 0);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const onCompleteRef = useRef(onTypewriterComplete);

  useEffect(() => {
    onCompleteRef.current = onTypewriterComplete;
  }, [onTypewriterComplete]);

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
      return;
    }

    setIsTyping(true);

    const animate = (timestamp: number) => {
      if (!lastTickRef.current) lastTickRef.current = timestamp;
      const elapsed = timestamp - lastTickRef.current;

      // Reveal ~3-6 characters per tick (~20ms) for a swift, natural reading pace
      if (elapsed >= 18) {
        lastTickRef.current = timestamp;
        setDisplayedLength((prev) => {
          const charsToAdd = Math.max(2, Math.floor(elapsed / 6));
          const next = prev + charsToAdd;
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
      className={cn("manus-markdown relative select-text transition-all duration-150", isTyping && "cursor-pointer", className)}
      onClick={handleSkip}
      title={isTyping ? "Click to reveal complete text" : undefined}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
}