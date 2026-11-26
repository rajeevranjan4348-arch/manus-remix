import React, { useState, useEffect, useRef, useMemo, memo, createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { hasActiveTextSelection } from '@/lib/clipboard';
import { useUltraLiteImage } from '@/hooks/useUltraLiteImage';
import { CodeBlock } from './CodeBlock';
import { ThreeSceneViewer } from '@/components/three/ThreeSceneViewer';
import { parseProcedural3DSceneCodeFence } from '@/lib/threeSceneSpec';

interface MarkdownStreamingContextValue {
  isStreaming: boolean;
  isGeneratingCodeBlock: boolean;
  activeCodeText: string | null;
}

const MarkdownStreamingContext = createContext<MarkdownStreamingContextValue>({
  isStreaming: false,
  isGeneratingCodeBlock: false,
  activeCodeText: null,
});

function normalizeCodeTail(code: string): string {
  return String(code || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

export interface StreamingCodeBlockState {
  isGeneratingCodeBlock: boolean;
  language: string | null;
  lineCount: number;
  openFenceIndex: number;
  openFenceCode: string;
}

/**
 * Detects whether the visible/streamed markdown currently ends inside an unclosed fenced code block
 * (e.g., ```tsx ... while tokens are still streaming), identifying the exact active block.
 */
export function detectStreamingCodeBlockState(
  markdown: string,
  isActiveStream: boolean
): StreamingCodeBlockState {
  if (!isActiveStream || !markdown) {
    return {
      isGeneratingCodeBlock: false,
      language: null,
      lineCount: 0,
      openFenceIndex: -1,
      openFenceCode: '',
    };
  }

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let insideFence = false;
  let fenceChar: '`' | '~' = '`';
  let fenceLength = 3;
  let fenceCount = 0;
  let openFenceIndex = -1;
  let openLanguage: string | null = null;
  let openLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!insideFence) {
      const openMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
      if (openMatch) {
        insideFence = true;
        fenceChar = openMatch[1][0] as '`' | '~';
        fenceLength = openMatch[1].length;
        openFenceIndex = fenceCount;
        fenceCount += 1;
        const info = openMatch[2].trim();
        const langMatch = info.match(/^([a-zA-Z0-9_+#.-]+)/);
        openLanguage = langMatch ? langMatch[1].split(':')[0] : null;
        openLines = [];
      }
    } else {
      const closePattern = new RegExp(`^${fenceChar}{${fenceLength},}\\s*$`);
      if (closePattern.test(trimmed)) {
        insideFence = false;
        openFenceIndex = -1;
        openLanguage = null;
        openLines = [];
      } else {
        openLines.push(line);
      }
    }
  }

  if (!insideFence) {
    return {
      isGeneratingCodeBlock: false,
      language: null,
      lineCount: 0,
      openFenceIndex: -1,
      openFenceCode: '',
    };
  }

  return {
    isGeneratingCodeBlock: true,
    language: openLanguage,
    lineCount: openLines.length,
    openFenceIndex,
    openFenceCode: openLines.join('\n'),
  };
}

const UltraLiteMarkdownImage = memo(function UltraLiteMarkdownImage(
  props: React.ImgHTMLAttributes<HTMLImageElement>
) {
  const { src, alt, className, ...rest } = props;
  const {
    src: resolvedSrc,
    isOptimized,
    isPlaceholder,
    loadFullResolution,
    imgProps,
  } = useUltraLiteImage(typeof src === 'string' ? src : undefined, {
    label: alt || 'Image',
  });

  if (!resolvedSrc) return null;

  return (
    <span className="inline-block max-w-full my-2">
      <img
        {...rest}
        {...imgProps}
        src={resolvedSrc}
        alt={alt || 'Image'}
        referrerPolicy="no-referrer"
        onClick={(e) => {
          if (isOptimized) {
            e.stopPropagation();
            loadFullResolution();
          }
          rest.onClick?.(e);
        }}
        title={isOptimized ? 'Tap to load full-resolution image' : rest.title}
        className={cn(
          'max-w-full h-auto rounded-xl border border-border/60',
          isOptimized && 'cursor-pointer',
          className
        )}
      />
      {isPlaceholder && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            loadFullResolution();
          }}
          className="mt-1 block text-[11px] font-medium text-muted-foreground hover:text-foreground underline cursor-pointer"
        >
          Load full resolution image
        </button>
      )}
    </span>
  );
});

/**
 * Custom `<pre>` renderer for ReactMarkdown: unwraps the outer `<pre>` and renders
 * the full-width ChatGPT-style `<CodeBlock>` with automatic theme detection.
 */
function MarkdownPreBlock({ children }: React.HTMLAttributes<HTMLPreElement>) {
  const streamingCtx = useContext(MarkdownStreamingContext);
  const childArray = React.Children.toArray(children);
  const firstChild = childArray[0] as React.ReactElement<any> | undefined;

  if (firstChild && React.isValidElement(firstChild)) {
    const childProps = (firstChild.props || {}) as Record<string, any>;
    const className = typeof childProps.className === 'string' ? childProps.className : '';
    const rawText = Array.isArray(childProps.children)
      ? childProps.children.join('')
      : String(childProps.children ?? '');
    const meta =
      typeof childProps['data-meta'] === 'string'
        ? childProps['data-meta']
        : typeof childProps.node?.data?.meta === 'string'
          ? childProps.node.data.meta
          : undefined;

    const isThreeSceneFence = /(?:^|\s)language-(?:threejs-scene|3d-scene|three-pbr)\b/i.test(
      className
    );
    if (isThreeSceneFence) {
      const sceneSpec = parseProcedural3DSceneCodeFence(rawText);
      return <ThreeSceneViewer initialSpec={sceneSpec} />;
    }

    const isThisBlockGenerating =
      streamingCtx.isGeneratingCodeBlock &&
      streamingCtx.activeCodeText !== null &&
      normalizeCodeTail(rawText) === normalizeCodeTail(streamingCtx.activeCodeText);

    return (
      <CodeBlock
        code={rawText}
        className={className}
        meta={meta}
        isStreaming={streamingCtx.isStreaming}
        isGenerating={isThisBlockGenerating}
      />
    );
  }

  const fallbackText = typeof children === 'string' ? children : String(children ?? '');
  const isFallbackGenerating =
    streamingCtx.isGeneratingCodeBlock &&
    streamingCtx.activeCodeText !== null &&
    normalizeCodeTail(fallbackText) === normalizeCodeTail(streamingCtx.activeCodeText);

  return (
    <CodeBlock
      code={fallbackText}
      isStreaming={streamingCtx.isStreaming}
      isGenerating={isFallbackGenerating}
    />
  );
}

/**
 * Custom `<code>` renderer:
 * - When called inline (e.g., `LongMessage.tsx`), renders a clean monospace pill.
 * - When called directly as a block fence fallback, delegates to `<CodeBlock>`.
 */
function MarkdownCodeElement(
  props: React.HTMLAttributes<HTMLElement> & { node?: any }
) {
  const { className, children, node, ...rest } = props;
  const streamingCtx = useContext(MarkdownStreamingContext);
  const text = Array.isArray(children) ? children.join('') : String(children ?? '');
  const isBlockCode =
    Boolean(className && /language-/i.test(className)) || text.includes('\n');

  if (isBlockCode) {
    const isThreeSceneFence = /(?:^|\s)language-(?:threejs-scene|3d-scene|three-pbr)\b/i.test(
      className || ''
    );
    if (isThreeSceneFence) {
      const sceneSpec = parseProcedural3DSceneCodeFence(text);
      return <ThreeSceneViewer initialSpec={sceneSpec} />;
    }
    const meta = typeof node?.data?.meta === 'string' ? node.data.meta : undefined;
    const isThisBlockGenerating =
      streamingCtx.isGeneratingCodeBlock &&
      streamingCtx.activeCodeText !== null &&
      normalizeCodeTail(text) === normalizeCodeTail(streamingCtx.activeCodeText);
    return (
      <CodeBlock
        code={text}
        className={className}
        meta={meta}
        isStreaming={streamingCtx.isStreaming}
        isGenerating={isThisBlockGenerating}
      />
    );
  }

  return (
    <code
      className={cn('manus-inline-code-pill', className)}
      {...rest}
    >
      {children}
    </code>
  );
}

function MarkdownTable({
  children,
  node: _node,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { node?: unknown }) {
  return (
    <div
      className="manus-markdown-table-scroll w-full max-w-full min-w-0 overflow-x-auto"
      role="region"
      aria-label="Scrollable table"
      tabIndex={0}
    >
      <table {...props}>{children}</table>
    </div>
  );
}

const MARKDOWN_COMPONENTS = {
  img: UltraLiteMarkdownImage,
  pre: MarkdownPreBlock,
  code: MarkdownCodeElement,
  table: MarkdownTable,
};

/**
 * Safe URL transform for ReactMarkdown that preserves `data:image/*` URLs for AI-generated images
 * alongside standard web protocols (`http:`, `https:`, `mailto:`, `tel:`, and relative paths),
 * while blocking unsafe schemes (`javascript:`, `vbscript:`, `data:text/html`).
 */
export function safeMarkdownUrlTransform(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^data:image\/(?:png|jpe?g|webp|gif|bmp|avif|svg\+xml);(?:base64|utf8),/i.test(raw)) {
    return raw;
  }
  const colonIdx = raw.indexOf(':');
  const slashIdx = raw.indexOf('/');
  const questionIdx = raw.indexOf('?');
  const hashIdx = raw.indexOf('#');

  if (
    colonIdx === -1 ||
    (slashIdx !== -1 && colonIdx > slashIdx) ||
    (questionIdx !== -1 && colonIdx > questionIdx) ||
    (hashIdx !== -1 && colonIdx > hashIdx)
  ) {
    return raw;
  }

  const protocol = raw.slice(0, colonIdx).toLowerCase();
  if (protocol === 'http' || protocol === 'https' || protocol === 'mailto' || protocol === 'tel') {
    return raw;
  }
  return '';
}

/**
 * Ensures typewriter slicing never cuts through the middle of a multi-kilobyte
 * `![alt](data:image/...)` token (which would briefly display raw base64 text).
 */
export function snapVisibleLengthPastDataImages(text: string, targetLength: number): number {
  if (!text || targetLength <= 0 || !text.includes('data:image/')) {
    return targetLength;
  }
  const imgPattern = /!\[[^\]]*\]\(data:image\/[^)]+\)/g;
  let match: RegExpExecArray | null;
  let adjusted = targetLength;
  while ((match = imgPattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (adjusted > start && adjusted < end) {
      adjusted = end;
    }
  }
  return Math.min(text.length, adjusted);
}

/**
 * Normalizes fenced code block headers that include a filename on the fence line
 * (e.g. ```tsx LongMessage.tsx or ```tsx title="LongMessage.tsx") into `lang:filename`
 * so ReactMarkdown passes the filename reliably via `className="language-tsx:LongMessage.tsx"`.
 * Skips attaching the filename if the markdown line immediately above the fence already displays it.
 */
export function normalizeFenceFilenames(markdown: string): string {
  if (!markdown || !markdown.includes('```')) return markdown || '';

  const lines = markdown.split('\n');
  let insideFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('```')) continue;

    if (!insideFence) {
      insideFence = true;
      const info = trimmed.slice(3).trim();
      if (!info || info.includes(':')) continue;

      // Match e.g. `tsx LongMessage.tsx` or `tsx title="LongMessage.tsx"` or `tsx filename="LongMessage.tsx"`
      const attrMatch = info.match(
        /^([a-zA-Z0-9_+-]+)\s+(?:(?:title|filename|file|name)\s*=\s*["']([^"']+)["']|([a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.[a-zA-Z0-9]{1,10}))/i
      );
      if (attrMatch) {
        const lang = attrMatch[1];
        const file = (attrMatch[2] || attrMatch[3] || '').trim();
        if (file) {
          // Check if the preceding non-empty markdown line already mentions this filename
          let prevNonEmpty = '';
          for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
            if (lines[j].trim()) {
              prevNonEmpty = lines[j].trim();
              break;
            }
          }
          if (!prevNonEmpty.includes(file)) {
            const leadingIndent = lines[i].match(/^\s*/)?.[0] ?? '';
            lines[i] = `${leadingIndent}\`\`\`${lang}:${file}`;
          } else {
            const leadingIndent = lines[i].match(/^\s*/)?.[0] ?? '';
            lines[i] = `${leadingIndent}\`\`\`${lang}`;
          }
        }
      }
    } else {
      insideFence = false;
    }
  }

  return lines.join('\n');
}

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
  /** True while the assistant message is actively streaming tokens from the server */
  isStreaming?: boolean;
  onTypewriterComplete?: () => void;
  onTypewriterTick?: () => void;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className, 
  animateTypewriter = false,
  isStreaming = false,
  onTypewriterComplete,
  onTypewriterTick
}: MarkdownRendererProps) {
  // Pre-process content to remove internal chart data JSON blocks & normalize fence filenames
  const processedContent = useMemo(() => {
    if (!content) return '';
    let working = content;
    if (working.includes('```json')) {
      working = working.replace(/```json\n([\s\S]*?)\n```/g, (match, p1) => {
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
    }
    return normalizeFenceFilenames(working);
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

  // Allow user to click to immediately finish typing (never interrupt active text selection)
  const handleSkip = () => {
    if (hasActiveTextSelection()) {
      return;
    }
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
    const perfMode = typeof document !== 'undefined' ? document.documentElement.dataset.perfMode : undefined;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      ((typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
        perfMode === 'saver' ||
        perfMode === 'ultra-lite');

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

  const snappedVisibleLength = animateTypewriter
    ? snapVisibleLengthPastDataImages(processedContent, sequenceState.visibleLength)
    : processedContent.length;

  const visibleContent = animateTypewriter
    ? processedContent.slice(0, snappedVisibleLength)
    : processedContent;

  const isActivelyStreaming = isTyping || Boolean(isStreaming);
  const codeStreamState = useMemo(
    () => detectStreamingCodeBlockState(visibleContent, isActivelyStreaming),
    [visibleContent, isActivelyStreaming]
  );

  const streamingContextValue = useMemo<MarkdownStreamingContextValue>(
    () => ({
      isStreaming: isActivelyStreaming,
      isGeneratingCodeBlock: codeStreamState.isGeneratingCodeBlock,
      activeCodeText: codeStreamState.isGeneratingCodeBlock ? codeStreamState.openFenceCode : null,
    }),
    [isActivelyStreaming, codeStreamState.isGeneratingCodeBlock, codeStreamState.openFenceCode]
  );

  return (
    <MarkdownStreamingContext.Provider value={streamingContextValue}>
      <div 
        data-typing-phase={isActivelyStreaming && sequenceState.phase === 'settled' ? 'typing' : sequenceState.phase}
        data-code-streaming={codeStreamState.isGeneratingCodeBlock ? 'true' : 'false'}
        className={cn(
          "manus-markdown relative select-text w-full min-w-0",
          isActivelyStreaming ? "manus-markdown-typing" : "manus-markdown-settled",
          isTyping && "cursor-pointer",
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
            <span>Deku is typing</span>
          </div>
        )}
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          components={MARKDOWN_COMPONENTS}
          urlTransform={safeMarkdownUrlTransform}
        >
          {visibleContent}
        </ReactMarkdown>
        {isActivelyStreaming && !codeStreamState.isGeneratingCodeBlock && (
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
    </MarkdownStreamingContext.Provider>
  );
});
