import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useUltraLiteImage } from '@/hooks/useUltraLiteImage';
import { Check, Copy } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';



const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown',
  'c++': 'cpp', h: 'cpp', kt: 'kotlin', cs: 'csharp',
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: 'ts', tsx: 'tsx', javascript: 'js', jsx: 'jsx',
  python: 'py', html: 'html', css: 'css', json: 'json', java: 'java',
  kotlin: 'kt', bash: 'sh', shell: 'sh', sql: 'sql', cpp: 'cpp',
  c: 'c', csharp: 'cs', go: 'go', rust: 'rs', yaml: 'yml',
  markdown: 'md', xml: 'xml', toml: 'toml',
  plaintext: 'txt', text: 'txt',
};

function detectCodeLanguage(language: string, code: string): string {
  const requested = language.trim().toLowerCase().replace(/^language-/, '');
  if (requested) return LANGUAGE_ALIASES[requested] || requested;
  if (/^\s*<(!doctype|html|head|body|div|main|section)\b/i.test(code)) return 'html';
  if (/^\s*(import React|export (default |const |function)|interface |type )/m.test(code)) return /:\s*(React\.|JSX\.)/.test(code) || /<\w+[\s/>]/.test(code) ? 'tsx' : 'typescript';
  if (/^\s*(def |class |from \w+ import |import \w+)/m.test(code)) return 'python';
  if (/^\s*(SELECT|WITH|INSERT INTO|CREATE TABLE)\b/im.test(code)) return 'sql';
  if (/^\s*(\$ |npm |pnpm |yarn |git |curl )/m.test(code)) return 'bash';
  if (/^\s*\{[\s\S]*\}\s*$/.test(code)) {
    try { JSON.parse(code); return 'json'; } catch { /* keep detection generic */ }
  }
  if (/^\s*fun main\s*\(/m.test(code)) return 'kotlin';
  if (/^\s*public class |^\s*class \w+\s*\{/m.test(code)) return 'java';
  return 'text';
}

function getCodeFilename(language: string, meta?: string): string {
  const match = meta?.match(/(?:filename|file|title)\s*=\s*["']?([^"'\s]+)|["']([^"']+\.(?:tsx?|jsx?|py|html|css|json|java|kt|sh|sql|cpp|c|cs|go|rs|ya?ml|md|xml|toml))["']/i);
  const explicit = match?.[1] || match?.[2];
  if (explicit) return explicit.split('/').pop() || explicit;
  const extension = LANGUAGE_EXTENSIONS[language] || 'txt';
  const baseNames: Record<string, string> = {
    json: 'data', html: 'index', css: 'styles', python: 'main',
    java: 'Main', kotlin: 'Main', sql: 'query', bash: 'run',
    typescript: 'index', tsx: 'App', javascript: 'index', jsx: 'App',
  };
  return `${baseNames[language] || 'snippet'}.${extension}`;
}

interface PremiumCodeBlockProps {
  code: string;
  language: string;
  filename: string;
}

const PremiumCodeBlock = memo(function PremiumCodeBlock({
  code,
  language,
  filename,
}: PremiumCodeBlockProps) {
  const { resolvedTheme } = useTheme();
  const [highlightedHtml, setHighlightedHtml] = useState('');
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark = resolvedTheme === 'dark';
  const shouldHighlight = code.length <= 120_000 &&
    document.documentElement.dataset.perfMode !== 'ultra-lite' &&
    document.documentElement.dataset.perfMode !== 'saver';

  useEffect(() => {
    let cancelled = false;
    if (!shouldHighlight || language === 'text') {
      setHighlightedHtml('');
      return;
    }
    setHighlightedHtml('');
    void import('shiki')
      .then(({ codeToHtml }) => codeToHtml(code, {
        lang: language as never,
        theme: isDark ? 'github-dark' : 'github-light',
      }))
      .then((html) => {
        if (!cancelled) setHighlightedHtml(html);
      })
      .catch(() => {
        if (!cancelled) setHighlightedHtml('');
      });
    return () => { cancelled = true; };
  }, [code, language, isDark, shouldHighlight]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copiedSuccessfully = document.execCommand('copy');
        textarea.remove();
        if (!copiedSuccessfully) throw new Error('Clipboard copy failed');
      }
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="manus-code-block my-4 w-full max-w-full min-w-0" aria-label={`${language} code block`}>
      <div className="manus-code-filename flex min-w-0 items-center gap-2 px-1 pb-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{filename}</span>
      </div>
      <div className="manus-code-shell w-full min-w-0 overflow-hidden rounded-xl border border-border">
        <div className="manus-code-toolbar flex min-h-10 items-center justify-between gap-3 border-b border-border px-3">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {language === 'text' ? 'Code' : language}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="manus-code-copy inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={copied ? 'Code copied' : 'Copy code'}
            title={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <div className="manus-code-scroll custom-scrollbar max-w-full overflow-x-auto overflow-y-auto">
          {highlightedHtml ? (
            <div className="manus-code-highlight" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          ) : (
            <pre className="manus-code-plain"><code>{code}</code></pre>
          )}
        </div>
      </div>
    </section>
  );
});

const MarkdownCodeFence = memo(function MarkdownCodeFence({
  children,
}: {
  children?: React.ReactNode;
}) {
  const child = React.Children.toArray(children).find(React.isValidElement);
  if (!child) return <pre className="manus-code-plain">{children}</pre>;
  const childProps = child.props as { className?: string; children?: React.ReactNode; node?: { data?: { meta?: string } } };
  const rawCode = typeof childProps.children === 'string'
    ? childProps.children
    : React.Children.toArray(childProps.children).join('');
  const code = rawCode.replace(/\n$/, '');
  const language = detectCodeLanguage(childProps.className || '', code);
  const filename = getCodeFilename(language, childProps.node?.data?.meta);
  return <PremiumCodeBlock code={code} language={language} filename={filename} />;
});


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

const MARKDOWN_COMPONENTS = {
  img: UltraLiteMarkdownImage,
  pre: MarkdownCodeFence,
};

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
      <ReactMarkdown remarkPlugins={remarkPlugins} components={MARKDOWN_COMPONENTS}>
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