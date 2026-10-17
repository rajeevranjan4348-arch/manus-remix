import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  MessageSquare, 
  Hash, 
  Zap, 
  Cpu, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  Copy, 
  Check, 
  FileText,
  Clock
} from 'lucide-react';
import { 
  computeConversationDiagnostics, 
  getActiveTaskDiagnostics, 
  ConversationDiagnostics, 
  formatTokenCount 
} from '@/lib/diagnosticsService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DiagnosticPanelProps {
  activeTaskInfo?: {
    taskId?: string | null;
    prompt?: string;
    taskStatus?: 'idle' | 'running' | 'completed' | 'error';
    messages?: any[];
    steps?: any[];
    result?: any;
  };
  className?: string;
}

export function DiagnosticPanel({ activeTaskInfo, className }: DiagnosticPanelProps) {
  const [diagnostics, setDiagnostics] = useState<ConversationDiagnostics>(() => {
    if (activeTaskInfo && (activeTaskInfo.taskId || (activeTaskInfo.messages && activeTaskInfo.messages.length > 0))) {
      return computeConversationDiagnostics({
        taskId: activeTaskInfo.taskId,
        prompt: activeTaskInfo.prompt,
        messages: activeTaskInfo.messages,
        steps: activeTaskInfo.steps,
        status: activeTaskInfo.taskStatus,
      });
    }
    return getActiveTaskDiagnostics();
  });

  const [copiedTaskId, setCopiedTaskId] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync when activeTaskInfo updates or periodically every 2 seconds
  useEffect(() => {
    const update = () => {
      if (activeTaskInfo && (activeTaskInfo.taskId || (activeTaskInfo.messages && activeTaskInfo.messages.length > 0))) {
        setDiagnostics(computeConversationDiagnostics({
          taskId: activeTaskInfo.taskId,
          prompt: activeTaskInfo.prompt,
          messages: activeTaskInfo.messages,
          steps: activeTaskInfo.steps,
          status: activeTaskInfo.taskStatus,
        }));
      } else {
        setDiagnostics(getActiveTaskDiagnostics());
      }
    };

    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [activeTaskInfo]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    if (activeTaskInfo && (activeTaskInfo.taskId || (activeTaskInfo.messages && activeTaskInfo.messages.length > 0))) {
      setDiagnostics(computeConversationDiagnostics({
        taskId: activeTaskInfo.taskId,
        prompt: activeTaskInfo.prompt,
        messages: activeTaskInfo.messages,
        steps: activeTaskInfo.steps,
        status: activeTaskInfo.taskStatus,
      }));
    } else {
      setDiagnostics(getActiveTaskDiagnostics());
    }
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success('Diagnostics telemetry refreshed');
    }, 300);
  };

  const handleCopyTaskId = () => {
    if (diagnostics.taskId) {
      navigator.clipboard.writeText(diagnostics.taskId);
      setCopiedTaskId(true);
      toast.success('Task ID copied to clipboard');
      setTimeout(() => setCopiedTaskId(false), 2000);
    }
  };

  const statusColorMap = {
    running: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    error: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    idle: 'bg-muted text-muted-foreground border-border/50',
  };

  const progressPercent = Math.min(100, Math.max(0.5, diagnostics.metrics.contextUsagePercent));

  return (
    <div className={cn("space-y-4", className)}>
      {/* Title & Refresh Bar */}
      <div className="flex items-center justify-between pb-1 border-b border-border/40">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground tracking-tight">Active Task Diagnostics</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Real-time conversation turn tracking, token estimation, and context window telemetry.
          </p>
        </div>
        <button
          onClick={handleManualRefresh}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/50 cursor-pointer"
          title="Refresh telemetry"
        >
          <RefreshCw size={12} className={cn("transition-transform", isRefreshing && "animate-spin")} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Task Summary Banner */}
      <div className="p-3 rounded-xl border border-border/60 bg-card/60 backdrop-blur-xs space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize flex items-center gap-1",
              statusColorMap[diagnostics.taskStatus] || statusColorMap.idle
            )}>
              {diagnostics.taskStatus === 'running' && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
              )}
              {diagnostics.taskStatus === 'completed' && (
                <CheckCircle2 size={10} className="text-emerald-500" />
              )}
              {diagnostics.taskStatus === 'error' && (
                <AlertCircle size={10} className="text-rose-500" />
              )}
              {diagnostics.taskStatus}
            </span>

            {diagnostics.metrics.is2MContext && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                2M Context Window
              </span>
            )}

            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Cpu size={12} />
              {diagnostics.modelName}
            </span>
          </div>

          {diagnostics.taskId && (
            <button
              onClick={handleCopyTaskId}
              className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 px-2 py-0.5 rounded-md border border-border/40 transition-colors cursor-pointer"
              title="Click to copy Task ID"
            >
              <span>{diagnostics.taskId.slice(0, 16)}...</span>
              {copiedTaskId ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
            </button>
          )}
        </div>

        <div className="text-xs font-medium text-foreground line-clamp-2">
          {diagnostics.taskTitle}
        </div>
      </div>

      {/* Primary KPI Grid: Conversation Turns & Estimated Tokens */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* Total Turns */}
        <div className="p-3 rounded-xl border border-border/50 bg-card/40 flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Conversation Turns</span>
            <MessageSquare size={13} className="text-primary" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-foreground">
              {diagnostics.turns.total}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {diagnostics.turns.user} user · {diagnostics.turns.assistant} assistant
            </p>
          </div>
        </div>

        {/* Turn Cycles */}
        <div className="p-3 rounded-xl border border-border/50 bg-card/40 flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Dialogue Cycles</span>
            <Layers size={13} className="text-sky-500" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-foreground">
              {diagnostics.turns.cycles}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Completed exchanges
            </p>
          </div>
        </div>

        {/* Estimated Token Count */}
        <div className="p-3 rounded-xl border border-border/50 bg-card/40 flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Estimated Tokens</span>
            <Zap size={13} className="text-amber-500" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-foreground">
              {formatTokenCount(diagnostics.tokens.totalTokens)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              ~{diagnostics.tokens.totalTokens.toLocaleString()} tokens
            </p>
          </div>
        </div>

        {/* Average Tokens per Turn */}
        <div className="p-3 rounded-xl border border-border/50 bg-card/40 flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Avg Tokens / Turn</span>
            <Hash size={13} className="text-emerald-500" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-foreground">
              {diagnostics.metrics.averageTokensPerTurn.toLocaleString()}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              per message turn
            </p>
          </div>
        </div>
      </div>

      {/* Context Window Utilization Progress Bar */}
      <div className="p-3.5 rounded-xl border border-border/60 bg-card/50 space-y-2">
        <div className="flex items-center justify-between text-xs font-medium">
          <span className="text-foreground flex items-center gap-1.5">
            <Cpu size={14} className="text-primary" />
            Context Window Capacity
          </span>
          <span className="font-mono text-muted-foreground text-[11px]">
            {diagnostics.tokens.totalTokens.toLocaleString()} / {formatTokenCount(diagnostics.contextWindowMax)} ({diagnostics.metrics.contextUsagePercent}%)
          </span>
        </div>

        {/* Visual Bar */}
        <div className="w-full h-2 rounded-full bg-muted/60 overflow-hidden relative">
          <div 
            className="h-full bg-gradient-to-r from-emerald-500 via-sky-500 to-primary rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
          <span>{diagnostics.metrics.remainingTokens.toLocaleString()} tokens available</span>
          <span>Max: {diagnostics.contextWindowMax.toLocaleString()} tokens</span>
        </div>
      </div>

      {/* Detailed Token Breakdown */}
      <div className="p-3.5 rounded-xl border border-border/50 bg-card/30 space-y-2.5">
        <p className="text-xs font-semibold text-foreground">Token & Payload Distribution</p>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-[10px] text-muted-foreground block">User Inputs</span>
            <span className="font-semibold text-foreground">{diagnostics.tokens.userTokens.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground block">tokens</span>
          </div>

          <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-[10px] text-muted-foreground block">Assistant Responses</span>
            <span className="font-semibold text-foreground">{diagnostics.tokens.assistantTokens.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground block">tokens</span>
          </div>

          <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-[10px] text-muted-foreground block">Tool & Step Traces</span>
            <span className="font-semibold text-foreground">{diagnostics.tokens.toolTokens.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground block">tokens</span>
          </div>

          <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-[10px] text-muted-foreground block">Total Characters</span>
            <span className="font-semibold text-foreground">{diagnostics.metrics.totalCharacters.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground block">~{diagnostics.metrics.totalWords.toLocaleString()} words</span>
          </div>
        </div>

        {/* Step Progression Stats if available */}
        {diagnostics.steps.total > 0 && (
          <div className="pt-2 border-t border-border/30 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FileText size={12} className="text-primary" />
              Autonomous Execution Steps
            </span>
            <span className="font-medium text-foreground">
              {diagnostics.steps.completed} / {diagnostics.steps.total} completed
              {diagnostics.steps.running > 0 ? ` (${diagnostics.steps.running} running)` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Footer Timestamp */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
        <span className="flex items-center gap-1">
          <Clock size={11} />
          Telemetry synced: {diagnostics.lastUpdated}
        </span>
        <span>Estimation formula: heuristic BPE ~4 chars/tok</span>
      </div>
    </div>
  );
}
