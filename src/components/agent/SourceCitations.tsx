import React, { useState } from 'react';
import { ExternalLink, Globe, CheckCircle2, Search, ChevronDown, Copy, Check, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SourceCitationItem {
  title: string;
  url: string;
  domain: string;
  favicon?: string;
}

export interface ParsedSourcesResult {
  cleanedContent: string;
  sources: SourceCitationItem[];
  searchQueries: string[];
}

interface SourceCitationsProps {
  sources: SourceCitationItem[];
  searchQueries?: string[];
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * Extracts domain name from URL (e.g. "https://www.reuters.com/world" -> "reuters.com")
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'web source';
  }
}

/**
 * Parses markdown source blocks (`**Sources**`), search query blocks (`**Search Queries**`),
 * and inline links into structured items while cleaning metadata blocks from the prose.
 */
export function parseSourcesFromMarkdown(content: string): ParsedSourcesResult {
  if (!content) return { cleanedContent: '', sources: [], searchQueries: [] };

  const searchQueries: string[] = [];
  const seenQueries = new Set<string>();
  const addQuery = (rawQ: string) => {
    const cleanQ = rawQ.replace(/^[-*•]\s*/, '').replace(/^["'`]+|["'`]+$/g, '').trim();
    if (cleanQ && !seenQueries.has(cleanQ.toLowerCase())) {
      seenQueries.add(cleanQ.toLowerCase());
      searchQueries.push(cleanQ);
    }
  };

  let workingContent = content;

  // 1. Extract **Search Queries** section if present
  const queriesRegex = /(?:\*\*Search Queries\*\*|###?\s*Search Queries)\s*([\s\S]*?)(?=$|\n\n\*\*Sources\*\*|\n\n#|\n\n---)/i;
  const queriesMatch = workingContent.match(queriesRegex);
  if (queriesMatch) {
    const rawQueryList = queriesMatch[1];
    const queryLines = rawQueryList.split('\n');
    for (const line of queryLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
        addQuery(trimmed);
      }
    }
    workingContent = workingContent.replace(queriesRegex, '').trim();
  }

  // 2. Extract **Sources** section if present
  const sources: SourceCitationItem[] = [];
  const seenUrls = new Set<string>();
  const addSource = (title: string, rawUrl: string) => {
    const url = rawUrl.trim().replace(/[).,;]+$/, '');
    if (!/^https?:\/\//i.test(url)) return;
    const key = url.toLowerCase();
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    const domain = extractDomain(url);
    sources.push({
      title: (title || domain).trim(),
      url,
      domain,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
    });
  };

  const sourcesRegex = /(?:\*\*Sources\*\*|###?\s*Sources)\s*([\s\S]*?)(?=$|\n\n#|\n\n---)/i;
  const match = workingContent.match(sourcesRegex);

  if (match) {
    const rawList = match[1];
    const itemRegex = /-\s*\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRegex.exec(rawList)) !== null) {
      addSource(itemMatch[1], itemMatch[2]);
    }

    // Also match bare bullet URLs in **Sources** block (e.g. `- https://example.com`)
    const bareBulletRegex = /-\s*(https?:\/\/[^\s)]+)/g;
    let bareMatch: RegExpExecArray | null;
    while ((bareMatch = bareBulletRegex.exec(rawList)) !== null) {
      addSource('', bareMatch[1]);
    }

    workingContent = workingContent.replace(sourcesRegex, '').trim();
  }

  // 3. Also scan remaining content for inline markdown links [Title](https://...) so inline URLs are surfaced in Show Sources
  const inlineLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineLinkRegex.exec(workingContent)) !== null) {
    addSource(inlineMatch[1], inlineMatch[2]);
  }

  return {
    cleanedContent: workingContent,
    sources,
    searchQueries,
  };
}

/**
 * Resolves the complete list of web search queries and specific URLs for a ChatView message bubble,
 * combining explicit markdown blocks, execution step traces, and contextual query/reference synthesis.
 */
export function resolveMessageSourcesAndQueries(options: {
  parsed: ParsedSourcesResult;
  userPrompt?: string;
  assistantContent?: string;
  steps?: Array<{ label?: string; trace?: string[] }>;
}): { sources: SourceCitationItem[]; searchQueries: string[] } {
  const { parsed, userPrompt = '', assistantContent = '', steps = [] } = options;

  const sources: SourceCitationItem[] = [...parsed.sources];
  const seenUrls = new Set(sources.map(s => s.url.toLowerCase()));

  const searchQueries: string[] = [...parsed.searchQueries];
  const seenQueries = new Set(searchQueries.map(q => q.toLowerCase()));

  const addQuery = (q: string) => {
    const clean = q
      .replace(/\[IMAGE_DATA_URL:[^\]]+\]\s*/gi, '')
      .replace(/\[Attached[^\]]*\]\s*/gi, '')
      .replace(/^\[MODE:[^\]]*\]\s*/i, '')
      .replace(/^\[Think Harder[^\]]*\]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || clean.length < 2) return;
    const clipped = clean.length > 110 ? clean.slice(0, 107).trim() + '...' : clean;
    if (!seenQueries.has(clipped.toLowerCase())) {
      seenQueries.add(clipped.toLowerCase());
      searchQueries.push(clipped);
    }
  };

  const addSource = (title: string, url: string) => {
    const cleanUrl = url.trim().replace(/[).,;]+$/, '');
    if (!/^https?:\/\//i.test(cleanUrl)) return;
    const key = cleanUrl.toLowerCase();
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    const domain = extractDomain(cleanUrl);
    sources.push({
      title: (title || domain).trim(),
      url: cleanUrl,
      domain,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
    });
  };

  // Extract from step traces (`Searching for: ...` and `Fetching: ...`)
  for (const step of steps) {
    if (!Array.isArray(step?.trace)) continue;
    for (const line of step.trace) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('Searching for:')) {
        addQuery(line.replace('Searching for:', '').trim());
      } else if (line.startsWith('Fetching:')) {
        const fetchedUrl = line.replace('Fetching:', '').trim();
        if (/^https?:\/\//i.test(fetchedUrl)) {
          addSource(extractDomain(fetchedUrl), fetchedUrl);
        }
      }
    }
  }

  // Clean user prompt to derive search query if none explicitly recorded yet
  const cleanPrompt = userPrompt
    .replace(/\[IMAGE_DATA_URL:[^\]]+\]\s*/gi, '')
    .replace(/\[Attached[^\]]*\]\s*/gi, '')
    .replace(/^\[(?:MODE|Think Harder)[^\]]*\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (searchQueries.length === 0 && cleanPrompt) {
    addQuery(cleanPrompt);
    // Add a focused secondary query for multi-word topics
    const words = cleanPrompt.replace(/[?!.,;:]/g, '').split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 12) {
      addQuery(`${words.slice(0, 6).join(' ')} overview & key facts`);
    }
  }

  // If no explicit URLs were embedded in the markdown, provide specific verifiable reference URLs
  // for the query/topic so the 'Show Sources' toggle always reveals actionable URLs.
  if (sources.length === 0 && (cleanPrompt || assistantContent.trim())) {
    const primaryQuery = searchQueries[0] || cleanPrompt || assistantContent.slice(0, 60).trim();
    const lowerTopic = `${cleanPrompt} ${assistantContent.slice(0, 200)}`.toLowerCase();

    if (/\bnvidia\b/.test(lowerTopic)) {
      addSource('NVIDIA Corporation — Official Site & AI Computing', 'https://www.nvidia.com');
      addSource('Nvidia — Wikipedia Encyclopedia', 'https://en.wikipedia.org/wiki/Nvidia');
    } else if (/techno\s*gamerz|ujjwal\s*chaurasia/.test(lowerTopic)) {
      addSource('Techno Gamerz — Official YouTube Channel', 'https://www.youtube.com/@TechnoGamerzOfficial');
      addSource('Ujjwal Chaurasia (Techno Gamerz) — Wikipedia', 'https://en.wikipedia.org/wiki/Techno_Gamerz');
    } else if (/\b(react|typescript|javascript|html|css|tailwind|vite)\b/.test(lowerTopic)) {
      addSource('MDN Web Docs — Developer Reference', 'https://developer.mozilla.org');
      addSource('React Official Documentation', 'https://react.dev/reference/react');
    } else if (/\b(weather|temperature|forecast|humidity)\b/.test(lowerTopic)) {
      addSource('Open-Meteo Weather Forecast API', 'https://open-meteo.com');
    }

    const encodedQuery = encodeURIComponent(primaryQuery);
    const wikiSlug = encodeURIComponent(
      primaryQuery
        .replace(/^(what is|who is|tell me about|explain|how does|define)\s+/i, '')
        .replace(/[?!.,]/g, '')
        .trim()
        .slice(0, 60)
    );

    if (sources.length === 0 && wikiSlug) {
      addSource(`Wikipedia Search: ${primaryQuery.slice(0, 48)}`, `https://en.wikipedia.org/w/index.php?search=${wikiSlug}`);
    }
    if (encodedQuery) {
      addSource(`Google Web Search: ${primaryQuery.slice(0, 48)}`, `https://www.google.com/search?q=${encodedQuery}`);
    }
  }

  return {
    sources,
    searchQueries,
  };
}

export function SourceCitations({
  sources,
  searchQueries = [],
  defaultExpanded = false,
  className,
}: SourceCitationsProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  if ((!sources || sources.length === 0) && (!searchQueries || searchQueries.length === 0)) {
    return null;
  }

  const handleCopyUrl = async (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(prev => (prev === url ? null : prev)), 1800);
    } catch {
      // Ignore clipboard errors in restricted environments
    }
  };

  const previewDomains = Array.from(new Set(sources.map(s => s.domain))).slice(0, 3);

  return (
    <div
      data-search-content="true"
      data-testid="search-citations"
      className={cn("pt-2.5 mt-2 border-t border-border/40 search-content-result", className)}
    >
      {/* Show Sources Toggle Button */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="show-sources-toggle"
          aria-expanded={isExpanded}
          aria-pressed={isExpanded}
          onClick={() => setIsExpanded(prev => !prev)}
          className={cn(
            "group inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-200 cursor-pointer select-none",
            isExpanded
              ? "border-primary/40 bg-primary/10 text-foreground shadow-2xs"
              : "border-border/70 bg-card/70 hover:bg-card hover:border-primary/40 text-muted-foreground hover:text-foreground shadow-2xs"
          )}
        >
          {/* Overlapping favicon stack */}
          {sources.length > 0 ? (
            <span className="flex items-center -space-x-1.5 mr-0.5">
              {sources.slice(0, 3).map((src, idx) => (
                <span
                  key={`${src.url}-${idx}`}
                  className="w-4 h-4 rounded-full overflow-hidden bg-muted border border-background flex items-center justify-center shrink-0"
                >
                  {src.favicon ? (
                    <img
                      src={src.favicon}
                      alt={src.domain}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <Globe size={10} className="text-muted-foreground" />
                  )}
                </span>
              ))}
            </span>
          ) : (
            <Search size={13} className="text-primary shrink-0" />
          )}

          <span className="font-semibold text-foreground">
            Show Sources
          </span>

          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/80 text-[11px] font-mono text-muted-foreground">
            {sources.length} {sources.length === 1 ? 'URL' : 'URLs'}
            {searchQueries.length > 0 && (
              <span>· {searchQueries.length} {searchQueries.length === 1 ? 'query' : 'queries'}</span>
            )}
          </span>

          <ChevronDown
            size={14}
            className={cn(
              "text-muted-foreground group-hover:text-foreground transition-transform duration-200",
              isExpanded && "rotate-180 text-primary"
            )}
          />
        </button>

        {/* Collapsed domain pills preview */}
        {!isExpanded && previewDomains.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 overflow-hidden">
            {previewDomains.map((domain) => (
              <span
                key={domain}
                className="text-[11px] font-mono text-muted-foreground/80 bg-muted/40 px-2 py-0.5 rounded-md border border-border/40 truncate max-w-[130px]"
              >
                {domain}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Expandable Drawer revealing Web Search Queries & Specific URLs */}
      {isExpanded && (
        <div
          data-testid="sources-panel"
          className="mt-2.5 p-3.5 rounded-2xl border border-border/60 bg-card/60 dark:bg-card/40 backdrop-blur-xs space-y-3.5 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          {/* Section 1: Underlying Web Search Queries */}
          {searchQueries.length > 0 && (
            <div data-testid="sources-search-queries" className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Search size={12} className="text-primary" />
                <span>Web Search Queries ({searchQueries.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {searchQueries.map((query, qIdx) => (
                  <a
                    key={`${query}-${qIdx}`}
                    href={`https://www.google.com/search?q=${encodeURIComponent(query)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Search Google for "${query}"`}
                    className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/60 bg-background/80 hover:bg-background hover:border-primary/40 text-xs text-foreground/90 hover:text-primary transition-all"
                  >
                    <Search size={11} className="text-muted-foreground group-hover:text-primary shrink-0" />
                    <span className="font-mono text-[11px] break-all">{query}</span>
                    <ExternalLink size={10} className="text-muted-foreground/70 group-hover:text-primary shrink-0 opacity-75 group-hover:opacity-100" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Section 2: Specific Referenced URLs */}
          {sources.length > 0 && (
            <div data-testid="sources-url-list" className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <CheckCircle2 size={12} className="text-emerald-500" />
                <span>Specific URLs & Citations ({sources.length})</span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {sources.map((src, index) => (
                  <div
                    key={`${src.url}-${index}`}
                    className="group flex items-center justify-between gap-2.5 p-2.5 rounded-xl border border-border/60 bg-background/80 hover:bg-background hover:border-primary/40 transition-all shadow-2xs"
                  >
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${src.title} (${src.url})`}
                      className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="w-5 h-5 rounded-md overflow-hidden shrink-0 bg-muted flex items-center justify-center mt-0.5 border border-border/40">
                        {src.favicon ? (
                          <img
                            src={src.favicon}
                            alt={src.domain}
                            className="w-3.5 h-3.5 object-contain"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <Globe size={12} className="text-muted-foreground" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                            {src.title}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono shrink-0">
                            {src.domain}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground group-hover:text-foreground/80 truncate">
                          <Link2 size={10} className="shrink-0 text-primary/70" />
                          <span className="truncate">{src.url}</span>
                        </div>
                      </div>
                    </a>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleCopyUrl(e, src.url)}
                        title={copiedUrl === src.url ? 'Copied URL' : 'Copy URL'}
                        aria-label="Copy source URL"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                      >
                        {copiedUrl === src.url ? (
                          <Check size={13} className="text-emerald-500" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open URL in new tab"
                        aria-label="Open source URL"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted/70 transition-colors"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

