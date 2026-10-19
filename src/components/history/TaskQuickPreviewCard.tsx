import React from 'react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Sparkles, Calendar, ArrowUpRight, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classifyTaskTags, getTagStyle } from '@/lib/taskTaggingService';

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
  if (!task) return <>{children}</>;

  const promptText = task.prompt || task.title || 'Untitled Task';
  const status = task.status || 'completed';
  const taskTags = Array.isArray(task.tags) && task.tags.length > 0
    ? task.tags
    : typeof task.tags === 'string'
      ? JSON.parse(task.tags)
      : classifyTaskTags(promptText, task.result);
  const createdAtFormatted = task.createdAt 
    ? new Date(task.createdAt).toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    : 'Recent';

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-72 p-3.5 rounded-2xl bg-popover/95 backdrop-blur-md border border-border/80 shadow-xl z-50 text-xs"
      >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
              <Sparkles size={11} />
              <span>Quick Preview</span>
            </span>
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
              status === 'completed' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
              status === 'running' ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" :
              status === 'error' ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" :
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
            {task.summary && (
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3 leading-relaxed">
                {task.summary}
              </p>
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
