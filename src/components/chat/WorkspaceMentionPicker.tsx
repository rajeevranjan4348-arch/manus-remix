import React from 'react';
import { Calendar, Mail, HardDrive, FileText, FileSpreadsheet, CheckSquare, Sparkles, Layers } from 'lucide-react';
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
    id: 'calendar',
    tag: '@calendar',
    label: 'Google Calendar',
    description: 'Fetch upcoming events, today\'s schedule & meetings',
    icon: Calendar,
    colorClass: 'text-blue-500 bg-blue-500/10'
  },
  {
    id: 'gmail',
    tag: '@gmail',
    label: 'Gmail',
    description: 'Search & summarize recent emails, inbox threads & drafts',
    icon: Mail,
    colorClass: 'text-red-500 bg-red-500/10'
  },
  {
    id: 'drive',
    tag: '@drive',
    label: 'Google Drive',
    description: 'Access recent files, documents, and spreadsheets from Drive',
    icon: HardDrive,
    colorClass: 'text-emerald-500 bg-emerald-500/10'
  },
  {
    id: 'docs',
    tag: '@docs',
    label: 'Google Docs',
    description: 'Query Google Docs content and written documents',
    icon: FileText,
    colorClass: 'text-blue-600 bg-blue-600/10'
  },
  {
    id: 'sheets',
    tag: '@sheets',
    label: 'Google Sheets',
    description: 'Analyze spreadsheet rows, data tables & sheets',
    icon: FileSpreadsheet,
    colorClass: 'text-emerald-600 bg-emerald-600/10'
  },
  {
    id: 'tasks',
    tag: '@tasks',
    label: 'Google Tasks',
    description: 'Fetch active to-do items, reminders, and task lists',
    icon: CheckSquare,
    colorClass: 'text-amber-500 bg-amber-500/10'
  },
  {
    id: 'workspace',
    tag: '@workspace',
    label: 'Google Workspace (All)',
    description: 'Aggregate Calendar schedule, Gmail inbox & Drive files together',
    icon: Sparkles,
    colorClass: 'text-purple-500 bg-purple-500/10'
  }
];

interface WorkspaceMentionPickerProps {
  query: string;
  onSelect: (option: WorkspaceConnectorOption) => void;
  selectedIndex: number;
}

export function WorkspaceMentionPicker({ query, onSelect, selectedIndex }: WorkspaceMentionPickerProps) {
  const searchTerm = query.toLowerCase().replace('@', '');
  
  const filteredOptions = WORKSPACE_CONNECTOR_OPTIONS.filter(opt => 
    opt.tag.toLowerCase().includes(searchTerm) || 
    opt.label.toLowerCase().includes(searchTerm) ||
    opt.id.toLowerCase().includes(searchTerm)
  );

  if (filteredOptions.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-2 left-0 w-80 bg-popover border border-border/80 text-popover-foreground rounded-2xl shadow-2xl overflow-hidden z-50 p-1.5 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border/40 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Layers size={13} className="text-primary" />
          Google Workspace Connectors
        </span>
        <span className="text-[10px] text-muted-foreground">Type or click to select</span>
      </div>

      <div className="max-h-60 overflow-y-auto space-y-0.5 p-1">
        {filteredOptions.map((opt, idx) => {
          const Icon = opt.icon;
          const isSelected = idx === selectedIndex % filteredOptions.length;
          
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt)}
              className={cn(
                "w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors cursor-pointer group",
                isSelected 
                  ? "bg-primary/10 text-primary font-medium border border-primary/20" 
                  : "hover:bg-muted/70 text-foreground"
              )}
            >
              <div className={cn("p-2 rounded-xl shrink-0 transition-transform group-hover:scale-105", opt.colorClass)}>
                <Icon size={16} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-foreground truncate">{opt.label}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">{opt.tag}</span>
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
