import React, { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, FileText, FileCode, Braces, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ChatExportFormat,
  ChatExportSessionData,
  exportChatSession,
} from '@/lib/chatExport';

export interface ExportChatDropdownProps {
  onExport?: (format: ChatExportFormat) => void;
  sessionData?: ChatExportSessionData;
  className?: string;
  buttonClassName?: string;
  label?: string;
  align?: 'left' | 'right';
  disabled?: boolean;
}

export const EXPORT_FORMAT_OPTIONS: Array<{
  format: ChatExportFormat;
  label: string;
  extension: string;
  description: string;
  testId: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}> = [
  {
    format: 'pdf',
    label: 'PDF Document',
    extension: '.pdf',
    description: 'Formatted printable session report',
    testId: 'export-option-pdf',
    icon: FileText,
  },
  {
    format: 'markdown',
    label: 'Markdown',
    extension: '.md',
    description: 'Clean structured text & headings',
    testId: 'export-option-markdown',
    icon: FileCode,
  },
  {
    format: 'json',
    label: 'JSON Data',
    extension: '.json',
    description: 'Full session messages & metadata',
    testId: 'export-option-json',
    icon: Braces,
  },
];

export function ExportChatDropdown({
  onExport,
  sessionData,
  className,
  buttonClassName,
  label = 'Export',
  align = 'right',
  disabled = false,
}: ExportChatDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [lastSelectedFormat, setLastSelectedFormat] = useState<ChatExportFormat | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectFormat = (format: ChatExportFormat) => {
    setLastSelectedFormat(format);
    setIsOpen(false);

    if (onExport) {
      onExport(format);
      return;
    }

    if (sessionData) {
      const exported = exportChatSession(sessionData, format);
      const formatLabel = format === 'pdf' ? 'PDF' : format === 'markdown' ? 'Markdown' : 'JSON';
      toast.success(`Exported chat session as ${formatLabel} (${exported.filename})`);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        data-testid="topbar-export-button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Export chat session"
        title="Export chat session (PDF, Markdown, JSON)"
        className={cn(
          'flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-border/60 bg-white/90 dark:bg-[#292929]/95 backdrop-blur-sm text-xs font-semibold text-foreground hover:bg-slate-100 dark:hover:bg-white/10 transition-all duration-150 shadow-xs hover:shadow-md cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
          buttonClassName
        )}
      >
        <Download size={14} strokeWidth={2.3} className="shrink-0" />
        <span>{label}</span>
        <ChevronDown
          size={13}
          strokeWidth={2.4}
          className={cn(
            'text-muted-foreground transition-transform duration-200 shrink-0',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div
          data-testid="topbar-export-dropdown"
          role="menu"
          aria-label="Export format options"
          className={cn(
            'absolute top-full mt-2 w-64 rounded-2xl border border-border/80 bg-white/95 dark:bg-[#202124]/95 backdrop-blur-md p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          <div className="px-3 py-1.5 border-b border-border/50 mb-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Export Chat Session
            </p>
          </div>

          <div className="space-y-0.5">
            {EXPORT_FORMAT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isRecentlyPicked = lastSelectedFormat === option.format;
              return (
                <button
                  key={option.format}
                  type="button"
                  role="menuitem"
                  data-testid={option.testId}
                  data-export-format={option.format}
                  onClick={() => handleSelectFormat(option.format)}
                  className="w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer group"
                >
                  <div className="p-1.5 rounded-lg bg-muted/70 text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0 mt-0.5">
                    <Icon size={15} strokeWidth={2.2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {option.label}
                      </span>
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                        {option.extension}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {option.description}
                    </p>
                  </div>
                  {isRecentlyPicked && (
                    <Check size={14} className="text-emerald-500 shrink-0 self-center" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
