import React, { useEffect, useMemo, useState } from 'react';
import { Brain, Cpu, Check, ChevronDown, ChevronUp, Loader2, Search, Image as ImageIcon, Code2, BarChart3, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeReasoningSummary } from './ThoughtProcess';

export interface ThinkingStageItem {
  id: string;
  label: string;
  detail?: string;
  status: 'completed' | 'running' | 'pending' | 'error';
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
  deepMode: boolean | string = false,
  explicitSteps?: { id?: string; label: string; status?: string; trace?: string[] }[],
  isLiveOrActiveStageIndex: boolean | number = true
): ThinkingStageItem[] {
  const isDeep = deepMode === true || deepMode === 'work' || deepMode === 'deep';
  const isLive = typeof isLiveOrActiveStageIndex === 'boolean' ? isLiveOrActiveStageIndex : true;
  const activeStageIndex = typeof isLiveOrActiveStageIndex === 'number' ? isLiveOrActiveStageIndex : 0;

  if (explicitSteps && explicitSteps.length > 0) {
    return explicitSteps.map((s, idx) => {
      const sanitizedTraces = Array.isArray(s.trace)
        ? s.trace.flatMap(item => sanitizeReasoningSummary(String(item || ''))).slice(-2)
        : [];
      const rawStatus = (!isLive || activeStageIndex >= explicitSteps.length) && s.status !== 'error'
        ? 'completed'
        : s.status === 'completed'
        ? 'completed'
        : s.status === 'error'
        ? 'error'
        : s.status === 'running'
        ? 'running'
        : 'pending';
      return {
        id: s.id || `step-${idx}`,
        label: s.label,
        status: rawStatus,
        trace: sanitizedTraces,
      };
    });
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
  }

  if (isDeep) {
    stages.push({
      label: 'Structured reasoning & verification',
      detail: 'Evaluating key factors and verifying conclusions',
    });
  }

  stages.push({
    label: 'Synthesizing final response',
    detail: 'Formatting clear, structured output',
  });

  if (!isLive || activeStageIndex >= stages.length) {
    return stages.map((stage, idx) => ({
      id: `auto-stage-${idx}`,
      label: stage.label,
      detail: stage.detail,
      status: 'completed',
      trace: [],
    }));
  }

  const clampedActive = Math.min(Math.max(0, activeStageIndex), stages.length - 1);

  return stages.map((stage, idx) => ({
    id: `auto-stage-${idx}`,
    label: stage.label,
    detail: stage.detail,
    status: idx < clampedActive ? 'completed' : idx === clampedActive ? 'running' : 'pending',
    trace: [],
  }));
}

export function WorkModeThinkingAnimation({
  prompt = '',
  isLive = true,
  deepMode = false,
  steps = [],
  className,
}: WorkModeThinkingAnimationProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [elapsedTenths, setElapsedTenths] = useState(0);

  const stages = useMemo(
    () => deriveContextualThinkingStages(prompt, deepMode, steps, isLive),
    [prompt, deepMode, steps, isLive]
  );

  const hasError = stages.some(s => s.status === 'error');
  const allCompleted = stages.length > 0 && stages.every(s => s.status === 'completed');
  const isActivelyProcessing = isLive && !allCompleted && !hasError;

  useEffect(() => {
    setElapsedTenths(0);
  }, [prompt]);

  useEffect(() => {
    if (!isActivelyProcessing) return;
    const interval = window.setInterval(() => {
      setElapsedTenths(prev => prev + 1);
    }, 100);
    return () => window.clearInterval(interval);
  }, [isActivelyProcessing]);

  const runningIndex = stages.findIndex(s => s.status === 'running');
  const completedCount = stages.filter(s => s.status === 'completed').length;
  const currentStageNumber = runningIndex >= 0
    ? runningIndex + 1
    : Math.min(Math.max(completedCount, 1), Math.max(stages.length, 1));

  const headerTitle = hasError
    ? 'Processing interrupted'
    : allCompleted || !isLive
    ? 'Response completed'
    : deepMode
    ? 'Manus Deep Reasoning'
    : 'Manus AI is thinking';

  const getStageIcon = () => {
    if (hasError) {
      return <AlertCircle size={14} />;
    }
    if (allCompleted || !isLive) {
      return <Check size={14} strokeWidth={2.5} />;
    }
    if (!isExpanded && isActivelyProcessing) {
      return <Loader2 size={14} className="animate-spin" />;
    }
    const lower = String(prompt || '').toLowerCase();
    if (lower.includes('[image_data_url:') || lower.includes('[attached image')) return <ImageIcon size={14} />;
    if (/\b(search|news|latest|weather)\b/.test(lower)) return <Search size={14} />;
    if (/\b(code|react|typescript|python|bug)\b/.test(lower)) return <Code2 size={14} />;
    if (/\b(chart|graph|csv|data)\b/.test(lower)) return <BarChart3 size={14} />;
    return <Brain size={15} />;
  };

  return (
    <div
      data-testid="thinking-stage-card"
      className={cn(
        "w-full max-w-full min-w-0 overflow-hidden px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-2xl border border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF] dark:bg-[#171717] space-y-2 my-1.5 transition-colors duration-200 shadow-2xs",
        deepMode && "border-[#000000]/30 dark:border-[#FFFFFF]/30 bg-[#FAFAFA] dark:bg-[#111111]",
        className
      )}
    >
      <div
        onClick={() => setIsExpanded(prev => !prev)}
        className="flex items-center justify-between gap-2 cursor-pointer select-none min-w-0"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className={cn(
              "relative flex items-center justify-center w-6 h-6 rounded-full shrink-0",
              deepMode
                ? "bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000]"
                : "bg-[#F2F2F2] text-[#000000] dark:bg-[#111111] dark:text-[#FFFFFF]"
            )}
          >
            {getStageIcon()}
          </div>
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span className="text-xs font-semibold text-[#000000] dark:text-[#FFFFFF] truncate">
              {headerTitle}
            </span>
            <span
              data-testid="thinking-stage-badge"
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#F2F2F2] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF] shrink-0"
            >
              {allCompleted || !isLive
                ? 'Completed'
                : `Stage ${currentStageNumber}/${stages.length}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            data-testid="thinking-elapsed-timer"
            className="text-[11px] font-mono text-[#777777] dark:text-[#AAAAAA] tabular-nums"
          >
            {(elapsedTenths / 10).toFixed(1)}s
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(prev => !prev);
            }}
            className="p-1 rounded-md text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111] transition-colors"
            aria-label={isExpanded ? 'Collapse thinking stages' : 'Expand thinking stages'}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {isExpanded && stages.length > 0 && (
        <div className="pt-2 border-t border-[#E0E0E0] dark:border-[#333333] space-y-1.5 text-xs">
          {stages.map((stage, idx) => {
            const isDone = stage.status === 'completed';
            const isRunning = stage.status === 'running' && isActivelyProcessing;
            const isError = stage.status === 'error';

            return (
              <div
                key={stage.id || idx}
                data-testid={`thinking-stage-row-${idx}`}
                data-stage-status={stage.status}
                className={cn(
                  "flex items-start gap-2 px-2.5 py-1.5 rounded-xl transition-colors duration-150 min-w-0",
                  isRunning
                    ? "bg-[#FAFAFA] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#333333]"
                    : "opacity-85"
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <div className="w-4 h-4 rounded-full bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] border border-[#000000] dark:border-[#FFFFFF] flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  ) : isError ? (
                    <div className="w-4 h-4 rounded-full bg-[#F2F2F2] text-[#000000] dark:bg-[#111111] dark:text-[#FFFFFF] border border-[#000000] dark:border-[#FFFFFF] flex items-center justify-center">
                      <AlertCircle size={10} />
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
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span
                      className={cn(
                        "font-medium truncate text-[11.5px]",
                        isRunning
                          ? "text-[#000000] dark:text-[#FFFFFF] font-semibold"
                          : isDone
                          ? "text-[#333333] dark:text-[#CCCCCC]"
                          : "text-[#777777] dark:text-[#888888]"
                      )}
                    >
                      {stage.label}
                    </span>
                    <span className="text-[10px] font-mono text-[#777777] dark:text-[#AAAAAA] shrink-0">
                      {isDone ? 'Done' : isError ? 'Failed' : isRunning ? 'Active' : 'Queued'}
                    </span>
                  </div>

                  {stage.detail && isRunning && (!stage.trace || stage.trace.length === 0) && (
                    <p className="text-[10.5px] text-[#777777] dark:text-[#AAAAAA] truncate mt-0.5">
                      {stage.detail}
                    </p>
                  )}

                  {stage.trace && stage.trace.length > 0 && isRunning && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1 min-w-0">
                      {stage.trace.slice(-1).map((traceItem, tIdx) => (
                        <span
                          key={tIdx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F2F2F2] dark:bg-[#1A1A1A] border border-[#E0E0E0] dark:border-[#333333] text-[10px] font-mono text-[#333333] dark:text-[#CCCCCC] truncate max-w-full"
                        >
                          <Cpu size={10} className="text-[#000000] dark:text-[#FFFFFF] shrink-0" />
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

