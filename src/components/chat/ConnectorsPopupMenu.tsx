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
      {children ? (
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger asChild>
          <span className="inline-block w-0 h-0 opacity-0 pointer-events-none" aria-hidden="true" />
        </PopoverTrigger>
      )}
      <PopoverContent 
        side="top" 
        align="start" 
        sideOffset={12}
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] p-2 rounded-[28px] border border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF] shadow-2xl overflow-hidden backdrop-blur-xl z-50"
      >
        <div className="px-3 py-2 border-b border-[#E0E0E0] dark:border-[#333333] flex items-center justify-between">
          <span className="font-bold text-sm text-[#000000] dark:text-[#FFFFFF] flex items-center gap-1.5">
            <Plug size={15} className="text-[#000000] dark:text-[#FFFFFF]" />
            <span>Connectors</span>
          </span>
          <button
            onClick={() => {
              onOpenChange(false);
              onOpenStore();
            }}
            className="text-[11px] font-semibold text-[#000000] dark:text-[#FFFFFF] hover:underline"
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
                    ? "bg-[#F2F2F2] dark:bg-[#111111] text-[#000000] dark:text-[#FFFFFF] font-semibold" 
                    : "hover:bg-[#F2F2F2] dark:hover:bg-[#111111] text-[#000000] dark:text-[#FFFFFF]"
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
                    <span className="text-[10px] text-[#777777] dark:text-[#AAAAAA] truncate leading-tight">{item.desc}</span>
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
                      className="p-1 text-[#777777] dark:text-[#AAAAAA] hover:text-[#000000] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111] rounded-lg transition-colors cursor-pointer"
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
                      isEnabled ? "border-[#000000] bg-[#000000] text-[#FFFFFF] dark:border-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000]" : "border-[#E0E0E0] dark:border-[#333333]"
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
        <div className="pt-2 mt-1 border-t border-[#E0E0E0] dark:border-[#333333]">
          <button
            onClick={() => {
              onOpenChange(false);
              onOpenStore();
            }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-[#F2F2F2] dark:bg-[#111111] hover:bg-[#E0E0E0] dark:hover:bg-[#333333] text-xs font-semibold text-[#000000] dark:text-[#FFFFFF] transition-colors cursor-pointer"
          >
            <Layers size={14} />
            <span>Open Connectors Store</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
