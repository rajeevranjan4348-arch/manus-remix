import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Brain, Cpu, Check, ChevronDown, ChevronUp, Loader2, Search, Image as ImageIcon, Code2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import LatticeLoader from '../ui/LatticeLoader';

export interface ThinkingStageItem {
  id: string;
  label: string;
  detail?: string;
  status: 'completed' | 'running' | 'pending';
  trace?: string[];
}

export interface WorkModeThinkingAnimationProps {
  prompt?: string;
  activeStep?: string;
  isLive?: boolean;
  deepMode?: boolean;
  steps?: { id?: string; label: string; status?: string; trace?: string[] }[];
  className?: string;
}

export function deriveContextualThinkingStages(
  rawPrompt = '',
  deepMode = false,
  explicitSteps?: { id?: string; label: string; status?: string; trace?: string[] }[],
  activeStageIndex = 0
): ThinkingStageItem[] {
  if (explicitSteps && explicitSteps.length > 0) {
    return explicitSteps.map((s, idx) => ({
      id: s.id || `step-${idx}`,
      label: s.label,
      status:
        s.status === 'completed'
          ? 'completed'
          : s.status === 'running'
          ? 'running'
          : 'pending',
      trace: s.trace,
    }));
  }

  const text = String(rawPrompt || '').toLowerCase();
  const hasImage = text.includes('[image_data_url:') || text.includes('[attached image') || /\b(image|photo|picture|screenshot|diagram)\b/.test(text);
  const hasSearch = /\b(latest|news|today|current|weather|price|search|verify|live|202[5-9])\b/.test(text);
  const hasCode = /\b(code|typescript|react|python|function|bug|fix|implement|api|component|css|sql)\b/.test(text);
  const hasData = /\b(chart|graph|plot|csv|json|dataset|statistics|table|trend)\b/.test(text);

  const stages: { label: string; detail: string }[] = [
    {
      label: 'Understanding intent & context',
      detail: hasImage
        ? 'Parsing visual attachment and question context'
        : 'Analyzing prompt semantics and conversation context',
    },
  ];

  if (hasImage) {
    stages.push({
      label: 'Inspecting visual content',
      detail: 'Scanning objects, text, layout, and key visual details',
    });
  } else if (hasSearch) {
    stages.push({
      label: 'Searching & verifying sources',
      detail: 'Retrieving relevant facts and cross-checking context',
    });
  } else if (hasCode) {
    stages.push({
      label: 'Designing technical architecture',
      detail: 'Evaluating patterns, edge cases, and clean implementation',
    });
  } else if (hasData) {
    stages.push({
      label: 'Profiling data & metrics',
      detail: 'Extracting patterns, comparisons, and structured insights',
    });
  } else {
    stages.push({
      label: 'Analyzing key concepts',
      detail: 'Structuring core knowledge and relevant examples',
    });
  }

  if (deepMode) {
    stages.push({
      label: 'Multi-angle chain-of-thought reasoning',
      detail: 'Stress-testing assumptions and evaluating trade-offs',
    });
  }

  stages.push({
    label: 'Synthesizing final response',
    detail: 'Formatting clear, structured output',
  });

  const clampedActive = Math.min(Math.max(0, activeStageIndex), stages.length - 1);

  return stages.map((stage, idx) => ({
    id: `auto-stage-${idx}`,
    label: stage.label,
    detail: stage.detail,
    status: idx < clampedActive ? 'completed' : idx === clampedActive ? 'running' : 'pending',
  }));
}

export function WorkModeThinkingAnimation({
  prompt = '',
  activeStep,
  isLive = true,
  deepMode = false,
  steps = [],
  className,
}: WorkModeThinkingAnimationProps) {
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (!isLive) return;
    setActiveStageIdx(0);
    const t1 = setTimeout(() => setActiveStageIdx(1), 950);
    const t2 = setTimeout(() => setActiveStageIdx(2), 2200);
    const t3 = setTimeout(() => setActiveStageIdx(3), 3800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [prompt, isLive]);

  const stages = useMemo(
    () => deriveContextualThinkingStages(prompt, deepMode, steps, activeStageIdx),
    [prompt, deepMode, steps, activeStageIdx]
  );

  const runningStage = stages.find(s => s.status === 'running') || stages[stages.length - 1];
  const currentStatusText = activeStep || runningStage?.label || 'Thinking';

  const getStageIcon = () => {
    const lower = String(prompt || '').toLowerCase();
    if (lower.includes('[image_data_url:') || lower.includes('[attached image')) return <ImageIcon size={15} className="animate-pulse" />;
    if (/\b(search|news|latest|weather)\b/.test(lower)) return <Search size={15} className="animate-pulse" />;
    if (/\b(code|react|typescript|python|bug)\b/.test(lower)) return <Code2 size={15} className="animate-pulse" />;
    if (/\b(chart|graph|csv|data)\b/.test(lower)) return <BarChart3 size={15} className="animate-pulse" />;
    return <Brain size={16} className="animate-pulse" />;
  };

  return (
    <div
      data-testid="thinking-stage-card"
      className={cn(
        "p-3.5 sm:p-4 rounded-2xl border border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF] dark:bg-[#171717] backdrop-blur-xs space-y-3 my-2 animate-in fade-in duration-200 shadow-2xs",
        deepMode && "border-[#000000]/30 dark:border-[#FFFFFF]/30 bg-[#FAFAFA] dark:bg-[#111111]",
        className
      )}
    >
      <div
        onClick={() => setIsExpanded(prev => !prev)}
        className="flex items-center justify-between gap-3 flex-wrap cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "relative flex items-center justify-center w-7 h-7 rounded-full shrink-0",
              deepMode
                ? "bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000]"
                : "bg-[#F2F2F2] text-[#000000] dark:bg-[#111111] dark:text-[#FFFFFF]"
            )}
          >
            {getStageIcon()}
            <span
              className="absolute inset-0 rounded-full animate-ping opacity-40 bg-[#000000]/20 dark:bg-[#FFFFFF]/20"
            />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#000000] dark:text-[#FFFFFF] flex items-center gap-1.5">
              <span>{deepMode ? 'Manus Deep Thinking Stage' : 'Manus AI is thinking'}</span>
              <Sparkles size={13} className="text-[#000000] dark:text-[#FFFFFF] animate-spin" style={{ animationDuration: '3s' }} />
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#F2F2F2] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF]">
                Stage {Math.min((stages.findIndex(s => s.status === 'running') + 1) || stages.length, stages.length)}/{stages.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <LatticeLoader
            label={currentStatusText}
            doneLabel="Completed in"
            errorLabel="Failed after"
            status={isLive ? 'working' : 'done'}
            pattern="orbit"
            grid={3}
            shape="round"
            cellSize={5}
            gap={2}
            fontSize={12}
            glow={true}
            showTimer={true}
            className="shrink-0"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(prev => !prev);
            }}
            className="p-1 rounded-md text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111] transition-colors"
            aria-label={isExpanded ? 'Collapse thinking stages' : 'Expand thinking stages'}
          >
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {isExpanded && stages.length > 0 && (
        <div className="pt-2.5 border-t border-[#E0E0E0] dark:border-[#333333] space-y-2 text-xs">
          {stages.map((stage, idx) => {
            const isDone = stage.status === 'completed';
            const isRunning = stage.status === 'running';

            return (
              <div
                key={stage.id || idx}
                className={cn(
                  "flex items-start gap-2.5 px-2.5 py-1.5 rounded-xl transition-all duration-200",
                  isRunning
                    ? "bg-[#FAFAFA] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#333333] shadow-2xs"
                    : "opacity-80"
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <div className="w-4 h-4 rounded-full bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] border border-[#000000] dark:border-[#FFFFFF] flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  ) : isRunning ? (
                    <div className="w-4 h-4 rounded-full bg-[#F2F2F2] text-[#000000] dark:bg-[#111111] dark:text-[#FFFFFF] flex items-center justify-center">
                      <Loader2 size={11} className="animate-spin" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-[#E0E0E0] dark:border-[#333333] flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#777777] dark:bg-[#AAAAAA]" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "font-medium truncate text-[11.5px]",
                        isRunning
                          ? "text-foreground font-semibold"
                          : isDone
                          ? "text-foreground/80"
                          : "text-muted-foreground"
                      )}
                    >
                      {stage.label}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {isDone ? 'Done' : isRunning ? 'Active' : 'Queued'}
                    </span>
                  </div>

                  {stage.detail && isRunning && (
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {stage.detail}
                    </p>
                  )}

                  {stage.trace && stage.trace.length > 0 && (isRunning || isDone) && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {stage.trace.slice(-2).map((traceItem, tIdx) => (
                        <span
                          key={tIdx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 border border-border/40 text-[10px] font-mono text-muted-foreground truncate max-w-full"
                        >
                          <Cpu size={10} className="text-primary/70 shrink-0" />
                          <span className="truncate">{traceItem}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
