import React from 'react';
import { ExternalLink, Globe, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SourceCitationItem {
  title: string;
  url: string;
  domain: string;
  favicon?: string;
}

interface SourceCitationsProps {
  sources: SourceCitationItem[];
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
 * Parses markdown source blocks (e.g., `**Sources**\n- [Title](url)`) into structured items
 */
export function parseSourcesFromMarkdown(content: string): { cleanedContent: string; sources: SourceCitationItem[] } {
  if (!content) return { cleanedContent: '', sources: [] };

  const sourcesRegex = /\*\*Sources\*\*\s*([\s\S]*?)(?=$|\n\n#|\n\n---)/i;
  const match = content.match(sourcesRegex);

  if (!match) {
    return { cleanedContent: content, sources: [] };
  }

  const rawList = match[1];
  const itemRegex = /-\s*\[(.*?)\]\((https?:\/\/.*?)\)/g;
  const sources: SourceCitationItem[] = [];
  let itemMatch;

  while ((itemMatch = itemRegex.exec(rawList)) !== null) {
    const title = itemMatch[1].trim();
    const url = itemMatch[2].trim();
    const domain = extractDomain(url);
    sources.push({
      title: title || domain,
      url,
      domain,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
    });
  }

  // Remove the raw sources section from the main content so we can render the dedicated interactive pills
  const cleanedContent = content.replace(sourcesRegex, '').trim();

  return { cleanedContent, sources };
}

export function SourceCitations({ sources, className }: SourceCitationsProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className={cn("pt-3 mt-2 border-t border-border/40", className)}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2">
        <CheckCircle2 size={13} className="text-emerald-500" />
        <span>Verified Sources & Citations ({sources.length})</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {sources.map((src, index) => (
          <a
            key={index}
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${src.title} (${src.url})`}
            className="group flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border/70 bg-white/60 dark:bg-card/60 hover:bg-white dark:hover:bg-card hover:border-primary/50 text-foreground transition-all text-xs shadow-2xs hover:shadow-xs cursor-pointer"
          >
            <div className="w-4 h-4 rounded-full overflow-hidden shrink-0 bg-muted flex items-center justify-center">
              {src.favicon ? (
                <img
                  src={src.favicon}
                  alt={src.domain}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    // Fallback to Globe icon
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <Globe size={11} className="text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex items-center gap-1.5">
              <span className="font-medium text-xs truncate max-w-[170px] group-hover:text-primary transition-colors">
                {src.title}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {src.domain}
              </span>
            </div>

            <ExternalLink size={11} className="text-muted-foreground group-hover:text-primary transition-colors ml-0.5 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}
