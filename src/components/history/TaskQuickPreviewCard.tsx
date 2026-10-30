import React, { useState, useEffect } from 'react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Sparkles, Calendar, ArrowUpRight, Copy, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classifyTaskTags, getTagStyle } from '@/lib/taskTaggingService';
import { getStoredSessionSummaries, generateSessionSummary } from '@/lib/sessionSummaryService';
import { getMessages } from '@/lib/chatDatabase';
import { toast } from 'sonner';

export interface TaskQuickPreviewCardProps {
  task: any;
  children: React.ReactNode;
  side?: 'left' | 'right' | 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}

export function TaskQuickPreviewCard({
  task,
  children,
  side = 'left',
  align = 'start',
}: TaskQuickPreviewCardProps) {
  const [storedSummary, setStoredSummary] = useState<string | undefined>(() => {
    if (!task?.id) return undefined;
    return getStoredSessionSummaries()[task.id];
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!task?.id) return;
    setStoredSummary(getStoredSessionSummaries()[task.id]);

    const handleSummaryUpdate = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || detail.sessionId === task.id) {
        setStoredSummary(getStoredSessionSummaries()[task.id]);
      }
    };

    window.addEventListener('manus_session_summaries_updated', handleSummaryUpdate);
    return () => {
      window.removeEventListener('manus_session_summaries_updated', handleSummaryUpdate);
    };
  }, [task?.id]);

  if (!task) return <>{children}</>;

  const promptText = task.prompt || task.title || 'Untitled Task';
  const status = task.status || 'completed';
  const activeSummary = storedSummary || task.summary;
  const taskTags = Array.isArray(task.tags) && task.tags.length > 0
    ? task.tags
    : typeof task.tags === 'string'
      ? JSON.parse(task.tags)
      : classifyTaskTags(promptText, task.result);
  const createdAtFormatted = (task.createdAt || task.created_at)
    ? new Date(task.createdAt || task.created_at).toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    : 'Recent';

  const handleQuickSummarize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!task?.id || isGenerating) return;
    setIsGenerating(true);
    try {
      let messages: Array<{ role: string; content: string }> = [];
      try {
        const storedMsgs = await getMessages(task.id);
        if (Array.isArray(storedMsgs) && storedMsgs.length > 0) {
          messages = storedMsgs.map((m) => ({ role: m.role, content: m.content }));
        }
      } catch {}

      const summary = await generateSessionSummary({
        id: task.id,
        title: task.title || promptText,
        prompt: task.prompt,
        content: task.content,
        messages,
      });
      setStoredSummary(summary);
      toast.success('Generated session summary');
    } catch {
      toast.error('Failed to generate summary');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopySummary = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!activeSummary) return;
    navigator.clipboard.writeText(activeSummary);
    setCopied(true);
    toast.success('Summary copied to clipboard');
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] p-3.5 rounded-2xl bg-popover/95 backdrop-blur-md border border-border/80 shadow-xl z-50 text-xs"
      >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
              <Sparkles size={11} />
              <span>Quick Preview</span>
            </span>
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
              status === 'completed' ? "bg-secondary text-foreground border border-border" :
              status === 'running' ? "bg-primary/10 text-primary border border-primary/20" :
              status === 'error' ? "bg-muted text-foreground border border-border" :
              "bg-muted text-muted-foreground"
            )}>
              {status}
            </span>
          </div>

          <div>
            <h4 className="font-semibold text-xs text-foreground line-clamp-2 leading-snug">
              {promptText}
            </h4>
            {/* Auto-assigned task tags */}
            {taskTags.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {taskTags.map((tag: string) => {
                  const style = getTagStyle(tag);
                  return (
                    <span
                      key={tag}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[9px] font-bold border tracking-wide",
                        style.badgeClass
                      )}
                    >
                      {tag}
                    </span>
                  );
                })}
              </div>
            )}
            {activeSummary ? (
              <div className="mt-2 p-2 rounded-xl bg-primary/5 border border-primary/20 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold text-primary">
                  <span className="inline-flex items-center gap-1">
                    <Sparkles size={10} />
                    <span>AI Summary</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleCopySummary}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Copy summary"
                  >
                    {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                  </button>
                </div>
                <p className="text-[11px] text-foreground/90 line-clamp-3 leading-relaxed">
                  {activeSummary}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleQuickSummarize}
                disabled={isGenerating}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-60"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    <span>Generating summary...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={11} />
                    <span>Generate Summary</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar size={11} />
              <span>{createdAtFormatted}</span>
            </span>
            <span className="flex items-center gap-0.5 text-primary font-medium">
              <span>View details</span>
              <ArrowUpRight size={11} />
            </span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

