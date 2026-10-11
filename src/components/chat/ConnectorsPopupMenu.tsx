import React from 'react';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { 
  Image as ImageIcon, 
  PenTool, 
  Brain, 
  Sparkles, 
  BookOpen, 
  Mail, 
  Calendar, 
  HardDrive, 
  FileSpreadsheet, 
  FileText, 
  CheckSquare, 
  Plug, 
  Plus, 
  Check, 
  Layers,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONNECTOR_CATALOG } from '../connectors/ConnectorsStorePanel';

interface ConnectorsPopupMenuProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  activeConnectors: string[];
  onToggleConnector: (id: string) => void;
  onOpenStore: () => void;
  onOpenConfigModal?: (connectorId: string) => void;
  children?: React.ReactNode;
}

export function ConnectorsPopupMenu({
  isOpen,
  onOpenChange,
  activeConnectors,
  onToggleConnector,
  onOpenStore,
  onOpenConfigModal,
  children
}: ConnectorsPopupMenuProps) {
  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent 
        side="top" 
        align="start" 
        sideOffset={12}
        className="w-72 p-2 rounded-[28px] border border-border dark:border-white/10 bg-white dark:bg-[#202124] text-foreground dark:text-white shadow-2xl overflow-hidden backdrop-blur-xl"
      >
        <div className="px-3 py-2 border-b border-border/40 dark:border-white/10 flex items-center justify-between">
          <span className="font-bold text-sm text-foreground dark:text-white flex items-center gap-1.5">
            <Plug size={15} className="text-primary" />
            <span>Connectors & Plugins</span>
          </span>
          <button
            onClick={() => {
              onOpenChange(false);
              onOpenStore();
            }}
            className="text-[11px] font-semibold text-primary hover:underline"
          >
            Manage +
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1 p-1 custom-scrollbar">
          {CONNECTOR_CATALOG.map((item) => {
            const isEnabled = activeConnectors.includes(item.id);
            const Icon = item.icon;

            return (
              <div
                key={item.id}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-2xl transition-all text-left group",
                  isEnabled 
                    ? "bg-primary/10 dark:bg-primary/20 text-primary font-semibold" 
                    : "hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-white"
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    onToggleConnector(item.id);
                  }}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform", item.iconBg)}>
                    <Icon size={16} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-xs tracking-tight truncate">{item.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate leading-tight">{item.desc}</span>
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0 ml-1">
                  {onOpenConfigModal && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenChange(false);
                        onOpenConfigModal(item.id);
                      }}
                      className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors cursor-pointer"
                      title={`Configure ${item.name}`}
                    >
                      <Settings size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleConnector(item.id)}
                    className={cn(
                      "w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors cursor-pointer",
                      isEnabled ? "border-primary bg-primary text-primary-foreground" : "border-slate-300 dark:border-white/20"
                    )}
                  >
                    {isEnabled && <Check size={11} strokeWidth={3} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Link */}
        <div className="pt-2 mt-1 border-t border-border/40 dark:border-white/10">
          <button
            onClick={() => {
              onOpenChange(false);
              onOpenStore();
            }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-xs font-semibold text-foreground dark:text-white transition-colors cursor-pointer"
          >
            <Layers size={14} />
            <span>Open Connectors Store</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
