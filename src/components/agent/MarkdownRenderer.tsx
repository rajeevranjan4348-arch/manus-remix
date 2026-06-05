import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
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

  return (
    <div className={cn("manus-markdown", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}