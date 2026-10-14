import React, { useState, useEffect } from 'react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { MessageSquare, Sparkles, User, Clock, CheckCircle2, Loader2, AlertCircle, ChevronRight, Folder, Layers } from 'lucide-react';
import { getMessages, getConversation, StoredMessage, StoredConversation } from '@/lib/chatDatabase';
import { cn } from '@/lib/utils';

export interface QuickPreviewTask {
  id: string;
  prompt: string;
  title?: string;
  created_at: string;
  status?: string;
  outputFormat?: string;
  projectId?: string;
}

interface TaskQuickPreviewCardProps {
  task: QuickPreviewTask;
  projectName?: string;
  children: React.ReactNode;
  side?: 'right' | 'left' | 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}

// Global in-memory cache so hovering over previously fetched tasks is instantaneous
const previewCache = new Map<string, {
  userPrompt: string;
  latestResponse: string;
  messageCount: number;
  mode?: string;
  status?: string;
}>();

function cleanSnippetText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[(?:Attached File|Think Harder|MODE)[^\]]*\]\s*/gi, '')
    .replace(/```[\s\S]*?```/g, '[Code Block]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function getRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'Just now';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function TaskQuickPreviewCard({
  task,
  projectName,
  children,
  side = 'right',
  align = 'start'
}: TaskQuickPreviewCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    userPrompt: string;
    latestResponse: string;
    messageCount: number;
    mode?: string;
    status?: string;
  } | null>(previewCache.get(task.id) || null);

  useEffect(() => {
    if (!isOpen) return;

    if (previewCache.has(task.id)) {
      setPreviewData(previewCache.get(task.id)!);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    async function loadData() {
      try {
        const [messages, conv] = await Promise.all([
          getMessages(task.id),
          getConversation(task.id)
        ]);

        if (!isMounted) return;

        const userMsg = messages.find(m => m.role === 'user');
        const assistantMsg = [...messages].reverse().find(m => m.role === 'assistant');

        const initialPrompt = userMsg?.content || task.prompt || 'Untitled request';
        const responseText = assistantMsg?.content || '';

        const data = {
          userPrompt: cleanSnippetText(initialPrompt),
          latestResponse: cleanSnippetText(responseText),
          messageCount: messages.length,
          mode: conv?.mode || 'chat',
          status: conv?.status || task.status || 'idle'
        };

        previewCache.set(task.id, data);
        setPreviewData(data);
      } catch (err) {
        if (!isMounted) return;
        const fallbackData = {
          userPrompt: cleanSnippetText(task.prompt || 'Untitled request'),
          latestResponse: '',
          messageCount: 0,
          mode: 'chat',
          status: task.status || 'idle'
        };
        setPreviewData(fallbackData);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, task.id, task.prompt, task.status]);

  const displayTitle = task.title && task.title.trim() 
    ? task.title.trim() 
    : cleanSnippetText(task.prompt || 'Untitled Session');

  return (
    <HoverCard openDelay={250} closeDelay={150} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-80 sm:w-96 p-4 bg-popover/95 dark:bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-2xl text-popover-foreground text-xs space-y-3 z-50 animate-in fade-in-0 zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2.5">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="p-1 rounded-md bg-primary/10 text-primary shrink-0">
                <Sparkles size={13} className="stroke-[2.5]" />
              </span>
              <h4 className="font-bold text-xs text-foreground truncate leading-snug" title={displayTitle}>
                {displayTitle}
              </h4>
            </div>

            {/* Badges Bar */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {previewData?.mode && (
                <span className={cn(
                  "px-1.5 py-0.5 rounded-md text-[10px] font-semibold tracking-wide uppercase",
                  previewData.mode === 'work' 
                    ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20" 
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                )}>
                  {previewData.mode === 'work' ? 'Agent Work' : 'Chat Mode'}
                </span>
              )}

              {projectName && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold truncate max-w-[110px] border border-emerald-500/20">
                  <Folder size={10} className="shrink-0" />
                  <span className="truncate">{projectName}</span>
                </span>
              )}

              {previewData?.status === 'running' && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                  <Loader2 size={10} className="animate-spin shrink-0" />
                  <span>Processing</span>
                </span>
              )}

              {previewData?.status === 'completed' && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                  <CheckCircle2 size={10} className="shrink-0" />
                  <span>Completed</span>
                </span>
              )}

              {previewData?.status === 'error' && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-semibold border border-rose-500/20">
                  <AlertCircle size={10} className="shrink-0" />
                  <span>Failed</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 font-mono pt-0.5">
            <Clock size={11} className="shrink-0" />
            <span>{getRelativeTime(task.created_at)}</span>
          </div>
        </div>

        {/* Content Preview */}
        {isLoading && !previewData ? (
          <div className="py-4 flex items-center justify-center gap-2 text-muted-foreground text-xs">
            <Loader2 size={14} className="animate-spin text-primary" />
            <span>Loading quick summary...</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* User Query Snippet */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <User size={11} className="shrink-0 text-foreground/70" />
                <span>Initial Request</span>
              </div>
              <p className="text-[11px] text-foreground/90 bg-muted/50 dark:bg-muted/30 p-2 rounded-xl border border-border/40 line-clamp-2 leading-relaxed font-normal">
                {previewData?.userPrompt || task.prompt || 'No initial prompt text'}
              </p>
            </div>

            {/* AI Assistant Response Snippet */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-primary uppercase tracking-wider">
                <Sparkles size={11} className="shrink-0" />
                <span>AI Assistant Summary</span>
              </div>
              {previewData?.latestResponse ? (
                <p className="text-[11px] text-foreground/90 bg-primary/5 dark:bg-primary/10 p-2.5 rounded-xl border border-primary/20 line-clamp-3 leading-relaxed">
                  {previewData.latestResponse}
                </p>
              ) : previewData?.status === 'running' ? (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center gap-2 text-[11px]">
                  <Loader2 size={13} className="animate-spin shrink-0" />
                  <span>Manus AI is currently generating a response...</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/80 italic p-2 rounded-xl bg-muted/20 border border-border/30">
                  No AI assistant output saved for this session yet.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1 font-mono">
            <MessageSquare size={11} className="text-primary shrink-0" />
            <span>
              {previewData?.messageCount 
                ? `${previewData.messageCount} message${previewData.messageCount > 1 ? 's' : ''}` 
                : 'Quick preview'}
            </span>
          </div>

          <div className="flex items-center gap-0.5 text-primary font-semibold hover:underline cursor-pointer">
            <span>Click to open session</span>
            <ChevronRight size={11} />
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
