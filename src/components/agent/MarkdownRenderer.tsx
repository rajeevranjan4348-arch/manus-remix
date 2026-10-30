import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Stable plugin array reference so ReactMarkdown can memoize effectively.
const REMARK_PLUGINS = [remarkGfm];

// Cache pre-processed content keyed by the raw string. Streaming responses
// append deltas to the same message, so the raw content is referentially
// stable between renders only when unchanged — this avoids re-running the
// regex + JSON.parse preprocessing on every render during high-frequency updates.
const preprocessCache = new Map<string, string>();
const PREPROCESS_CACHE_LIMIT = 50;

function preprocessContent(content: string): string {
  const cached = preprocessCache.get(content);
  if (cached !== undefined) return cached;

  // Pre-process content to remove internal chart data JSON blocks
  const processed = content.replace(/```json\n([\s\S]*?)\n```/g, (match, p1) => {
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

  if (preprocessCache.size >= PREPROCESS_CACHE_LIMIT) {
    // Drop oldest entry to keep memory bounded.
    const oldestKey = preprocessCache.keys().next().value;
    if (oldestKey !== undefined) preprocessCache.delete(oldestKey);
  }
  preprocessCache.set(content, processed);
  return processed;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const processedContent = preprocessContent(content);

  return (
    <div className={cn("manus-markdown", className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});