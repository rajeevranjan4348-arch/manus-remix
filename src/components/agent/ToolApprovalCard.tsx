import React from 'react';
import { ShieldCheck, ShieldAlert, Check, X, ExternalLink, Phone, Camera, Smartphone, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceCommandResult } from '@/lib/voiceCommands';

interface ToolApprovalCardProps {
  command: VoiceCommandResult;
  onApprove: () => void;
  onReject: () => void;
  className?: string;
}

export function ToolApprovalCard({
  command,
  onApprove,
  onReject,
  className,
}: ToolApprovalCardProps) {
  const isSensitive = command.riskLevel === 'sensitive';
  const isModerate = command.riskLevel === 'moderate';

  const getIcon = () => {
    switch (command.action) {
      case 'phone_call':
        return <Phone size={18} className="text-emerald-500" />;
      case 'camera':
        return <Camera size={18} className="text-amber-500" />;
      case 'open_url':
      case 'search':
        return <ExternalLink size={18} className="text-blue-500" />;
      default:
        return <Smartphone size={18} className="text-primary" />;
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 my-3 backdrop-blur-md transition-all shadow-sm max-w-xl mx-auto",
        isSensitive
          ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-950/20"
          : "border-border/80 bg-white/90 dark:bg-card/90",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-muted/60 text-foreground shrink-0 mt-0.5">
          {getIcon()}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-500" />
              Tool Approval Required
            </span>

            <span
              className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                isSensitive
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                  : isModerate
                  ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                  : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              )}
            >
              {command.riskLevel}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Manus is requesting permission to execute:
          </p>

          <div className="p-2.5 rounded-xl bg-muted/40 text-foreground font-mono text-xs border border-border/40">
            <div className="font-semibold text-foreground flex items-center justify-between">
              <span>{command.targetName}</span>
              {command.url && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                  {command.url}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={onApprove}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 transition-all cursor-pointer shadow-xs"
            >
              <Check size={14} />
              Approve & Run
            </button>
            <button
              onClick={onReject}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted text-muted-foreground hover:text-foreground font-medium text-xs transition-colors cursor-pointer"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
