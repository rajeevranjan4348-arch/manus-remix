import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/ThemeContext';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  extractCodeBlockMetadata,
  highlightCodeInstantHtml,
  highlightCodeWithShiki,
} from '@/lib/codeBlockEngine';

export interface CodeBlockProps {
  code: string;
  className?: string;
  meta?: string;
  filename?: string | null;
  /** When true, skips async Shiki re-tokenization per typing frame and uses instant semantic highlighting */
  isStreaming?: boolean;
}

const INITIAL_MAX_RENDER_LINES = 320;

/**
 * Outlined overlapping-squares Copy icon matching the reference ChatGPT code block header.
 */
function ChatGptCopyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('w-[18px] h-[18px]', className)}
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

export const CodeBlock = memo(function CodeBlock({
  code,
  className,
  meta,
  filename: explicitFilename,
  isStreaming = false,
}: CodeBlockProps) {
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [shikiHtml, setShikiHtml] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  const metadata = useMemo(
    () =>
      extractCodeBlockMetadata({
        className,
        meta,
        code,
      }),
    [className, meta, code]
  );

  const displayFilename = explicitFilename !== undefined ? explicitFilename : metadata.filename;
  const fullCode = metadata.rawCode;
  const { language } = metadata;

  // Guard low-end Android DOM budget on extremely large code blocks (> 320 lines)
  const { visibleCode, totalLineCount, isTruncatedForDom } = useMemo(() => {
    const lines = fullCode.split('\n');
    const total = lines.length;
    if (!isExpanded && total > INITIAL_MAX_RENDER_LINES) {
      return {
        visibleCode: lines.slice(0, INITIAL_MAX_RENDER_LINES).join('\n'),
        totalLineCount: total,
        isTruncatedForDom: true,
      };
    }
    return {
      visibleCode: fullCode,
      totalLineCount: total,
      isTruncatedForDom: false,
    };
  }, [fullCode, isExpanded]);

  // Synchronous semantic syntax highlighting so code is colored on frame 0 with zero flash
  const instantHtml = useMemo(
    () => highlightCodeInstantHtml(visibleCode, language.id),
    [visibleCode, language.id]
  );

  // Lazy Shiki dual-theme enrichment once streaming settles
  useEffect(() => {
    let cancelled = false;
    if (isStreaming || !visibleCode || language.shikiLang === 'text') {
      setShikiHtml(null);
      return;
    }

    const timer = setTimeout(() => {
      void highlightCodeWithShiki(visibleCode, language.shikiLang).then((html) => {
        if (!cancelled) {
          setShikiHtml(html);
        }
      });
    }, 35);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visibleCode, language.shikiLang, isStreaming]);

  const handleCopyCode = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // Copy the complete original code, never the visually truncated preview
    const ok = await copyTextToClipboard(fullCode);
    if (!ok) return;

    setCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 2000);
  };

  return (
    <div
      data-testid="chatgpt-code-block"
      data-theme={resolvedTheme}
      data-language={language.id}
      className="manus-codeblock-wrapper w-full min-w-0 my-4 select-text"
    >
      {/* Standalone Filename Pill Above the Code Container (when filename is attached to fence/comment) */}
      {displayFilename && (
        <div
          data-testid="code-block-filename"
          className="mb-2.5 flex items-center"
        >
          <span className="manus-filename-pill inline-flex items-center px-2.5 py-1 rounded-[7px] font-mono text-[13.5px] sm:text-[14px] font-medium leading-snug">
            {displayFilename}
          </span>
        </div>
      )}

      {/* Full-Width Rounded Code Container Automatically Following Application Theme */}
      <div className="manus-codeblock-card w-full min-w-0 rounded-[22px] sm:rounded-[24px] border overflow-hidden transition-colors duration-150">
        {/* Top Bar: Language Label on Left, Copy Action on Right */}
        <div className="manus-codeblock-header flex items-center justify-between gap-3 px-4 sm:px-5 pt-3.5 pb-2 select-none">
          <span
            data-testid="code-block-language"
            className="manus-codeblock-lang text-[13px] sm:text-[14px] font-medium tracking-tight truncate"
          >
            {language.displayLabel}
          </span>

          <button
            type="button"
            data-testid="code-block-copy-button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCopyCode}
            aria-label={copied ? 'Copied code' : 'Copy code'}
            title={copied ? 'Copied' : 'Copy code'}
            className="manus-codeblock-copy inline-flex items-center gap-1.5 px-2 py-1 -mr-1 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check size={15} strokeWidth={2.3} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
                <span
                  data-testid="code-block-copied-label"
                  className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400"
                >
                  Copied
                </span>
              </>
            ) : (
              <ChatGptCopyIcon />
            )}
          </button>
        </div>

        {/* Scrollable Code Viewport (Horizontal for long lines, Vertical for large files) */}
        <div
          data-testid="code-block-scroll-viewport"
          className="manus-codeblock-scroll w-full overflow-x-auto overflow-y-auto max-h-[540px] px-4 sm:px-5 pb-4 sm:pb-5 pt-1.5 custom-scrollbar"
        >
          {shikiHtml ? (
            <div
              data-testid="code-block-shiki"
              className="manus-shiki-code font-mono text-[13.5px] sm:text-[14.5px] leading-[1.65] select-text"
              dangerouslySetInnerHTML={{ __html: shikiHtml }}
            />
          ) : (
            <pre className="manus-instant-pre m-0 p-0 bg-transparent font-mono text-[13.5px] sm:text-[14.5px] leading-[1.65] whitespace-pre select-text">
              <code
                data-testid="code-block-instant"
                className="manus-instant-code block font-mono"
                dangerouslySetInnerHTML={{ __html: instantHtml }}
              />
            </pre>
          )}
        </div>

        {/* Large File Expansion Bar (keeps DOM fast on low-end Android while Copy always copies 100%) */}
        {isTruncatedForDom && (
          <div className="px-4 sm:px-5 py-2.5 border-t border-black/[0.06] dark:border-white/[0.07] flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Showing {INITIAL_MAX_RENDER_LINES} of {totalLineCount} lines (Copy includes full file)
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(true);
              }}
              className="font-medium text-foreground hover:underline cursor-pointer"
            >
              Show all {totalLineCount} lines
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
