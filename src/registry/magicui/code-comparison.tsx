"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationHighlight,
} from "@shikijs/transformers";
import { FileIcon, Copy, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export interface CodeComparisonProps {
  beforeCode: string;
  afterCode: string;
  language: string;
  filename: string;
  lightTheme?: string;
  darkTheme?: string;
  highlightColor?: string;
  className?: string;
}

export const defaultBeforeCode = `import { NextRequest } from 'next/server';

export const middleware = async (req: NextRequest) => {
  let user = undefined;
  let team = undefined;
  const token = req.headers.get('token'); 

  if(req.nextUrl.pathname.startsWith('/auth')) {
    user = await getUserByToken(token);

    if(!user) {
      return NextResponse.redirect('/login');
    }
  }

  if(req.nextUrl.pathname.startsWith('/team')) {
    user = await getUserByToken(token);

    if(!user) {
      return NextResponse.redirect('/login');
    }

    const slug = req.nextUrl.query.slug;
    team = await getTeamBySlug(slug); // [!code highlight]

    if(!team) { // [!code highlight]
      return NextResponse.redirect('/'); // [!code highlight]
    } // [!code highlight]
  } // [!code highlight]

  return NextResponse.next(); // [!code highlight]
}

export const config = {
  matcher: ['/((?!_next/|_static|_vercel|[\\w-]+\\.\\w+).*)'], // [!code highlight]
};`;

export const defaultAfterCode = `import { createMiddleware, type MiddlewareFunctionProps } from '@app/(auth)/auth/_middleware';
import { auth } from '@/app/(auth)/auth/_middleware'; // [!code --]
import { auth } from '@/app/(auth)/auth/_middleware'; // [!code ++]
import { team } from '@/app/(team)/team/_middleware';

const middlewares = {
  '/auth{/:path?}': auth,
  '/team{/:slug?}': [ auth, team ],
};

export const middleware = createMiddleware(middlewares); // [!code focus]

export const config = {
  matcher: ['/((?!_next/|_static|_vercel|[\\w-]+\\.\\w+).*)'],
};`;

export function CodeComparison({
  beforeCode,
  afterCode,
  language,
  filename,
  lightTheme = "github-light",
  darkTheme = "github-dark",
  highlightColor = "rgba(101, 117, 133, 0.16)",
  className,
}: CodeComparisonProps) {
  let themeContext: { theme?: string; systemTheme?: string; resolvedTheme?: string } | undefined;
  try {
    themeContext = useTheme();
  } catch {
    // next-themes provider optional
  }

  const [domIsDark, setDomIsDark] = useState<boolean>(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return true;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setDomIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const [highlightedBefore, setHighlightedBefore] = useState("");
  const [highlightedAfter, setHighlightedAfter] = useState("");
  const [hasLeftFocus, setHasLeftFocus] = useState(false);
  const [hasRightFocus, setHasRightFocus] = useState(false);
  const [copiedSide, setCopiedSide] = useState<"before" | "after" | null>(null);

  const selectedTheme = useMemo(() => {
    if (themeContext?.theme) {
      const current =
        themeContext.theme === "system"
          ? themeContext.systemTheme
          : themeContext.theme;
      return current === "dark" ? darkTheme : lightTheme;
    }
    return domIsDark ? darkTheme : lightTheme;
  }, [themeContext?.theme, themeContext?.systemTheme, domIsDark, darkTheme, lightTheme]);

  useEffect(() => {
    if (highlightedBefore || highlightedAfter) {
      setHasLeftFocus(highlightedBefore.includes('class="line focused"') || highlightedBefore.includes("focused"));
      setHasRightFocus(highlightedAfter.includes('class="line focused"') || highlightedAfter.includes("focused"));
    }
  }, [highlightedBefore, highlightedAfter]);

  useEffect(() => {
    let isCancelled = false;

    async function highlight() {
      try {
        const { codeToHtml } = await import("shiki");

        const transformers = [
          transformerNotationHighlight({ matchAlgorithm: "v3" }),
          transformerNotationDiff({ matchAlgorithm: "v3" }),
          transformerNotationFocus({ matchAlgorithm: "v3" }),
        ];

        const [before, after] = await Promise.all([
          codeToHtml(beforeCode, {
            lang: language,
            theme: selectedTheme,
            transformers,
          }),
          codeToHtml(afterCode, {
            lang: language,
            theme: selectedTheme,
            transformers,
          }),
        ]);

        if (!isCancelled) {
          setHighlightedBefore(before);
          setHighlightedAfter(after);
        }
      } catch (error) {
        console.error("Error highlighting code comparison:", error);
        if (!isCancelled) {
          setHighlightedBefore(`<pre class="shiki"><code>${escapeHtml(beforeCode)}</code></pre>`);
          setHighlightedAfter(`<pre class="shiki"><code>${escapeHtml(afterCode)}</code></pre>`);
        }
      }
    }

    highlight();

    return () => {
      isCancelled = true;
    };
  }, [beforeCode, afterCode, language, selectedTheme]);

  const handleCopy = (code: string, side: "before" | "after") => {
    const cleanCode = code
      .replace(/\s*\/\/\s*\[!code\s+[^\]]+\]/g, "")
      .trim();
    navigator.clipboard?.writeText?.(cleanCode);
    setCopiedSide(side);
    setTimeout(() => setCopiedSide(null), 2000);
  };

  const renderCode = (code: string, highlighted: string) => {
    if (highlighted) {
      return (
        <div
          style={{ "--highlight-color": highlightColor } as React.CSSProperties}
          className={cn(
            "code-comparison-viewer bg-background h-full w-full overflow-auto font-mono text-xs",
            "[&>pre]:h-full [&>pre]:w-full [&>pre]:overflow-x-auto [&>pre]:py-3 [&>pre]:m-0 [&>pre]:bg-transparent!",
            "[&>pre>code]:inline-block [&>pre>code]:w-full [&>pre>code]:min-w-full",
            "[&>pre>code>span.line]:inline-block [&>pre>code>span.line]:w-full [&>pre>code>span.line]:px-4 [&>pre>code>span.line]:py-0.5",
            "[&>pre>code>.highlighted]:inline-block [&>pre>code>.highlighted]:w-full [&>pre>code>.highlighted]:bg-[var(--highlight-color,#ff33331a)]",
            "[&>pre>code>.diff.add]:bg-emerald-500/15 [&>pre>code>.diff.add]:border-l-2 [&>pre>code>.diff.add]:border-emerald-500",
            "[&>pre>code>.diff.remove]:bg-rose-500/15 [&>pre>code>.diff.remove]:border-l-2 [&>pre>code>.diff.remove]:border-rose-500",
            "[&>pre>code>.add]:bg-emerald-500/15 [&>pre>code>.add]:border-l-2 [&>pre>code>.add]:border-emerald-500",
            "[&>pre>code>.remove]:bg-rose-500/15 [&>pre>code>.remove]:border-l-2 [&>pre>code>.remove]:border-rose-500",
            "group-hover/left:[&>pre>code>:not(.focused)]:opacity-100! group-hover/left:[&>pre>code>:not(.focused)]:blur-none!",
            "group-hover/right:[&>pre>code>:not(.focused)]:opacity-100! group-hover/right:[&>pre>code>:not(.focused)]:blur-none!",
            "group-hover/left:[&>pre>code>:not(.focused)]:transition-all group-hover/left:[&>pre>code>:not(.focused)]:duration-300",
            "group-hover/right:[&>pre>code>:not(.focused)]:transition-all group-hover/right:[&>pre>code>:not(.focused)]:duration-300"
          )}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      );
    }

    return (
      <pre className="bg-background text-foreground h-full overflow-auto p-4 font-mono text-xs break-all">
        {code}
      </pre>
    );
  };

  return (
    <div className={cn("mx-auto w-full max-w-5xl", className)}>
      <div className="group border-border bg-card text-card-foreground relative w-full overflow-hidden rounded-xl border shadow-sm">
        <div className="relative grid md:grid-cols-2">
          {/* Before Column */}
          <div
            className={cn(
              "leftside group/left border-border flex flex-col md:border-r min-w-0",
              hasLeftFocus &&
                "[&>div>pre>code>:not(.focused)]:opacity-45 [&>div>pre>code>:not(.focused)]:blur-[0.08rem]",
              "[&>div>pre>code>:not(.focused)]:transition-all [&>div>pre>code>:not(.focused)]:duration-300"
            )}
          >
            <div className="border-border bg-muted/60 text-muted-foreground flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
              <div className="flex items-center min-w-0">
                <FileIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate text-foreground font-mono">{filename}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  before
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(beforeCode, "before")}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
                  title="Copy before code"
                  aria-label="Copy before code"
                >
                  {copiedSide === "before" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <div className="relative flex-1 min-h-[300px]">
              {renderCode(beforeCode, highlightedBefore)}
            </div>
          </div>

          {/* After Column */}
          <div
            className={cn(
              "rightside group/right border-border flex flex-col border-t md:border-t-0 min-w-0",
              hasRightFocus &&
                "[&>div>pre>code>:not(.focused)]:opacity-45 [&>div>pre>code>:not(.focused)]:blur-[0.08rem]",
              "[&>div>pre>code>:not(.focused)]:transition-all [&>div>pre>code>:not(.focused)]:duration-300"
            )}
          >
            <div className="border-border bg-muted/60 text-muted-foreground flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
              <div className="flex items-center min-w-0">
                <FileIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate text-foreground font-mono">{filename}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  after
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(afterCode, "after")}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
                  title="Copy after code"
                  aria-label="Copy after code"
                >
                  {copiedSide === "after" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <div className="relative flex-1 min-h-[300px]">
              {renderCode(afterCode, highlightedAfter)}
            </div>
          </div>
        </div>

        {/* Center VS Badge */}
        <div className="border-border bg-background text-foreground/80 absolute top-1/2 left-1/2 hidden h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-md text-[10px] font-bold tracking-wider md:flex pointer-events-none select-none">
          VS
        </div>
      </div>
    </div>
  );
}

export function CodeComparisonDemo() {
  return (
    <CodeComparison
      beforeCode={defaultBeforeCode}
      afterCode={defaultAfterCode}
      language="typescript"
      filename="middleware.ts"
      lightTheme="github-light"
      darkTheme="github-dark"
      highlightColor="rgba(101, 117, 133, 0.16)"
    />
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default CodeComparison;
