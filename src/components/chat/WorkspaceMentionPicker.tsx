import React from 'react';
import { 
  Calendar, 
  Mail, 
  HardDrive, 
  FileText, 
  FileSpreadsheet, 
  Presentation,
  CheckSquare, 
  FileCheck,
  Contact,
  MessageCircle,
  Video,
  StickyNote,
  Sparkles, 
  Globe, 
  Terminal, 
  BarChart2, 
  Plug,
  Check,
  Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WorkspaceConnectorOption {
  id: string;
  tag: string;
  label: string;
  description: string;
  icon: React.ElementType;
  colorClass: string;
}

export const WORKSPACE_CONNECTOR_OPTIONS: WorkspaceConnectorOption[] = [
  {
    id: 'workspace',
    tag: '@workspace',
    label: 'Google Workspace (All)',
    description: 'Autonomous assistant across all Google Workspace apps',
    icon: Sparkles,
    colorClass: 'text-purple-500 bg-purple-500/10'
  },
  {
    id: 'gmail',
    tag: '@gmail',
    label: 'Gmail',
    description: 'Read, search, draft, reply to, and send emails directly',
    icon: Mail,
    colorClass: 'text-red-500 bg-red-500/10'
  },
  {
    id: 'calendar',
    tag: '@calendar',
    label: 'Google Calendar',
    description: 'Fetch upcoming events, schedule meetings & check availability',
    icon: Calendar,
    colorClass: 'text-blue-500 bg-blue-500/10'
  },
  {
    id: 'drive',
    tag: '@drive',
    label: 'Google Drive',
    description: 'Search files, create folders, upload and share documents',
    icon: HardDrive,
    colorClass: 'text-emerald-500 bg-emerald-500/10'
  },
  {
    id: 'docs',
    tag: '@docs',
    label: 'Google Docs',
    description: 'Create, read, write, append, and format documents',
    icon: FileText,
    colorClass: 'text-blue-600 bg-blue-600/10'
  },
  {
    id: 'sheets',
    tag: '@sheets',
    label: 'Google Sheets',
    description: 'Create sheets, read rows, update cells & formulas',
    icon: FileSpreadsheet,
    colorClass: 'text-emerald-600 bg-emerald-600/10'
  },
  {
    id: 'slides',
    tag: '@slides',
    label: 'Google Slides',
    description: 'Create slide decks, read slides text & append new slides',
    icon: Presentation,
    colorClass: 'text-amber-600 bg-amber-600/10'
  },
  {
    id: 'tasks',
    tag: '@tasks',
    label: 'Google Tasks',
    description: 'Fetch to-dos, create tasks, set due dates & mark complete',
    icon: CheckSquare,
    colorClass: 'text-amber-500 bg-amber-500/10'
  },
  {
    id: 'forms',
    tag: '@forms',
    label: 'Google Forms',
    description: 'Create forms/surveys, add questions & inspect respondent data',
    icon: FileCheck,
    colorClass: 'text-purple-600 bg-purple-600/10'
  },
  {
    id: 'contacts',
    tag: '@contacts',
    label: 'Google Contacts',
    description: 'Search address book, create contacts & view colleague info',
    icon: Contact,
    colorClass: 'text-cyan-600 bg-cyan-600/10'
  },
  {
    id: 'chat',
    tag: '@chat',
    label: 'Google Chat',
    description: 'List spaces, post messages & collaborate in Google Chat',
    icon: MessageCircle,
    colorClass: 'text-green-600 bg-green-600/10'
  },
  {
    id: 'meet',
    tag: '@meet',
    label: 'Google Meet',
    description: 'Schedule video calls & generate instant Google Meet links',
    icon: Video,
    colorClass: 'text-emerald-500 bg-emerald-500/10'
  },
  {
    id: 'keep',
    tag: '@keep',
    label: 'Google Keep',
    description: 'Capture quick notes, memos & notes synced with your account',
    icon: StickyNote,
    colorClass: 'text-yellow-500 bg-yellow-500/10'
  },
  {
    id: 'web_search',
    tag: '@web_search',
    label: 'Web Search',
    description: 'Real-time live internet search & fact verification',
    icon: Globe,
    colorClass: 'text-indigo-500 bg-indigo-500/10'
  },
  {
    id: 'code_sandbox',
    tag: '@code_sandbox',
    label: 'Python Sandbox',
    description: 'Execute code scripts, process datasets & output files',
    icon: Terminal,
    colorClass: 'text-cyan-500 bg-cyan-500/10'
  },
  {
    id: 'charts',
    tag: '@charts',
    label: 'Chart Visualizer',
    description: 'Render interactive graphs, charts & visualizers',
    icon: BarChart2,
    colorClass: 'text-purple-500 bg-purple-500/10'
  }
];

interface WorkspaceMentionPickerProps {
  query: string;
  onSelect: (option: WorkspaceConnectorOption) => void;
  selectedIndex: number;
  activeConnectors?: string[];
}

export function WorkspaceMentionPicker({ query, onSelect, selectedIndex, activeConnectors }: WorkspaceMentionPickerProps) {
  const searchTerm = query.toLowerCase().replace('@', '');

  // Helper to check if connector is enabled in activeConnectors
  const isEnabled = (id: string) => {
    if (!activeConnectors || activeConnectors.length === 0) return true;
    const cleanId = id.toLowerCase();
    return activeConnectors.some(active => {
      const a = active.toLowerCase();
      return a === cleanId || a === `google_${cleanId}` || cleanId === `google_${a}` || a.includes(cleanId) || cleanId.includes(a);
    });
  };

  // Sort options: enabled ones first
  const sortedOptions = [...WORKSPACE_CONNECTOR_OPTIONS].sort((a, b) => {
    const aEnabled = isEnabled(a.id);
    const bEnabled = isEnabled(b.id);
    if (aEnabled && !bEnabled) return -1;
    if (!aEnabled && bEnabled) return 1;
    return 0;
  });

  // Filter by query
  const filteredOptions = sortedOptions.filter(opt => {
    if (!searchTerm) return true;
    return (
      opt.tag.toLowerCase().includes(searchTerm) || 
      opt.label.toLowerCase().includes(searchTerm) ||
      opt.id.toLowerCase().includes(searchTerm) ||
      opt.description.toLowerCase().includes(searchTerm)
    );
  });

  if (filteredOptions.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-3 left-2 sm:left-4 w-80 sm:w-96 bg-white dark:bg-[#202124] border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white rounded-2xl shadow-2xl overflow-hidden z-[100] p-1.5 backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="px-3 py-2 border-b border-slate-200/80 dark:border-white/10 flex items-center justify-between bg-slate-50/80 dark:bg-white/5 rounded-t-xl">
        <span className="flex items-center gap-1.5 text-xs font-bold text-foreground dark:text-white">
          <Plug size={14} className="text-primary" />
          Connectors ({filteredOptions.length})
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">Use ↑↓ and Enter or click to attach</span>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1 p-1 custom-scrollbar">
        {filteredOptions.map((opt, idx) => {
          const Icon = opt.icon;
          const isSelected = idx === selectedIndex % filteredOptions.length;
          const activeStatus = isEnabled(opt.id);
          
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt)}
              className={cn(
                "w-full flex items-center gap-3 p-2 rounded-xl text-left transition-all cursor-pointer group",
                isSelected 
                  ? "bg-primary/15 text-primary font-medium border border-primary/30" 
                  : "hover:bg-slate-100 dark:hover:bg-white/10 text-foreground dark:text-white"
              )}
            >
              <div className={cn("p-2 rounded-xl shrink-0 transition-transform group-hover:scale-105", opt.colorClass)}>
                <Icon size={16} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold text-xs text-foreground dark:text-white truncate">{opt.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {activeStatus && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                        <Check size={9} /> Enabled
                      </span>
                    )}
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/10 text-muted-foreground">{opt.tag}</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">{opt.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

