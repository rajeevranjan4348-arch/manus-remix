import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  MinusCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AgentActivityEvent,
  AgentActivityStatus,
  VerificationOutcome,
  redactSensitiveActivityText,
} from '@/lib/agentActivityTracker';

export interface AgentActivityFeedProps {
  taskId?: string | null;
  activities?: AgentActivityEvent[];
  isRunning?: boolean;
  className?: string;
}

const AgentTriangleMascot: React.FC<{ active: boolean; hasError: boolean }> = ({
  active,
  hasError,
}) => (
  <span
    aria-hidden="true"
    className={cn(
      'relative inline-flex h-5 w-5 shrink-0 items-center justify-center select-none',
      active && 'agent-activity-icon-active'
    )}
  >
    <svg
      viewBox="0 0 28 26"
      className="h-5 w-5 overflow-visible"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.65 2.45C12.7 0.62 15.3 0.62 16.35 2.45L26.25 19.65C27.28 21.45 25.98 23.7 23.9 23.7H4.1C2.02 23.7 0.72 21.45 1.75 19.65L11.65 2.45Z"
        fill={hasError ? '#E05252' : '#409CFF'}
      />
      <g className={active ? 'agent-activity-eyes-animated' : undefined}>
        <ellipse cx="11.1" cy="14.4" rx="2.55" ry="3.35" fill="#FFFFFF" />
        <ellipse cx="16.9" cy="14.4" rx="2.55" ry="3.35" fill="#FFFFFF" />
        <circle
          cx="11.35"
          cy="14.5"
          r="1.35"
          fill="#111111"
          className={active ? 'agent-activity-pupil' : undefined}
        />
        <circle
          cx="17.15"
          cy="14.5"
          r="1.35"
          fill="#111111"
          className={active ? 'agent-activity-pupil' : undefined}
        />
      </g>
    </svg>
  </span>
);

function formatDuration(durationMs?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function getStatusBadgeMeta(status: AgentActivityStatus, outcome?: VerificationOutcome): {
  label: string;
  toneClass: string;
} {
  if (outcome === 'SKIPPED') {
    return {
      label: 'SKIPPED',
      toneClass: 'text-neutral-400 border-neutral-700/80 bg-neutral-900/70',
    };
  }
  switch (status) {
    case 'RUNNING':
      return {
        label: 'RUNNING',
        toneClass: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
      };
    case 'QUEUED':
      return {
        label: 'QUEUED',
        toneClass: 'text-neutral-300 border-neutral-600/70 bg-neutral-800/70',
      };
    case 'COMPLETED':
      return {
        label: outcome === 'PASSED' ? 'PASSED' : 'COMPLETED',
        toneClass: 'text-emerald-300 border-emerald-500/35 bg-emerald-500/10',
      };
    case 'FAILED':
      return {
        label: 'FAILED',
        toneClass: 'text-red-300 border-red-500/40 bg-red-500/10',
      };
    case 'CANCELLED':
      return {
        label: 'CANCELLED',
        toneClass: 'text-amber-300 border-amber-500/35 bg-amber-500/10',
      };
  }
}

function renderStatusIcon(status: AgentActivityStatus, outcome?: VerificationOutcome) {
  if (outcome === 'SKIPPED') {
    return <MinusCircle className="h-3.5 w-3.5 text-neutral-400 shrink-0" />;
  }
  switch (status) {
    case 'RUNNING':
      return (
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-sky-400 border-t-transparent animate-spin"
          aria-hidden="true"
        />
      );
    case 'QUEUED':
      return <Clock className="h-3.5 w-3.5 text-neutral-400 shrink-0" />;
    case 'COMPLETED':
      return <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
    case 'FAILED':
      return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
    case 'CANCELLED':
      return <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  }
}

export const AgentActivityFeed: React.FC<AgentActivityFeedProps> = React.memo(
  ({ taskId, activities = [], isRunning = false, className }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});

    const visibleActivities = useMemo(() => {
      if (!Array.isArray(activities) || activities.length === 0) return [];
      if (!taskId) return activities;
      return activities.filter((ev) => !ev.taskId || ev.taskId === taskId);
    }, [activities, taskId]);

    const summary = useMemo(() => {
      if (visibleActivities.length === 0) return null;
      const running = [...visibleActivities].reverse().find((ev) => ev.status === 'RUNNING');
      const queued = visibleActivities.find((ev) => ev.status === 'QUEUED');
      const latestFailed = [...visibleActivities].reverse().find((ev) => ev.status === 'FAILED');
      const latest = visibleActivities[visibleActivities.length - 1];
      const activeEvent = running || (isRunning ? queued || latest : latest);

      const completedCount = visibleActivities.filter((ev) => ev.status === 'COMPLETED').length;
      const failedCount = visibleActivities.filter((ev) => ev.status === 'FAILED').length;
      const skippedCount = visibleActivities.filter((ev) => ev.verificationOutcome === 'SKIPPED').length;
      const verificationEvents = visibleActivities.filter((ev) => Boolean(ev.verificationStage));

      return {
        activeEvent,
        isLive: Boolean(running || (isRunning && activeEvent?.status !== 'COMPLETED' && activeEvent?.status !== 'CANCELLED')),
        hasError: Boolean(latestFailed && !running),
        completedCount,
        failedCount,
        skippedCount,
        totalCount: visibleActivities.length,
        verificationEvents,
      };
    }, [visibleActivities, isRunning]);

    if (!summary || !summary.activeEvent) {
      return null;
    }

    const toggleDetail = (eventId: string) => {
      setExpandedEventIds((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
    };

    const headline = redactSensitiveActivityText(summary.activeEvent.title, 110);

    return (
      <div
        data-testid="agent-activity-feed"
        data-task-id={taskId || undefined}
        data-status={summary.activeEvent.status}
        className={cn('max-w-3xl mx-auto w-full', className)}
      >
        <div className="rounded-xl border border-[#262626] bg-[#141414] text-[#EDEDED] shadow-sm overflow-hidden transition-colors">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            data-testid="agent-activity-toggle"
            className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <AgentTriangleMascot active={summary.isLive} hasError={summary.hasError} />
              <span
                data-testid="agent-activity-headline"
                className={cn(
                  'truncate text-[13.5px] font-normal tracking-[-0.01em] leading-snug',
                  summary.isLive ? 'agent-activity-shimmer-text' : 'text-[#E5E5E5]'
                )}
              >
                {headline}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0 text-[11px] text-[#9A9A9A]">
              {summary.verificationEvents.length > 0 && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[#A3A3A3]">
                  <ShieldCheck className="h-3 w-3 text-sky-400" />
                  {summary.verificationEvents.filter((e) => e.verificationOutcome === 'PASSED').length}/
                  {summary.verificationEvents.length}
                </span>
              )}
              <span className="tabular-nums">
                {summary.completedCount}/{summary.totalCount}
              </span>
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-[#8E8E8E]" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-[#8E8E8E]" />
              )}
            </div>
          </button>

          {isExpanded && (
            <div
              data-testid="agent-activity-timeline"
              className="border-t border-[#242424] bg-[#111111]/95 px-3.5 py-2.5 space-y-2 max-h-72 overflow-y-auto custom-scrollbar"
            >
              {visibleActivities.map((item) => {
                const badge = getStatusBadgeMeta(item.status, item.verificationOutcome);
                const durationLabel = formatDuration(item.durationMs);
                const detailOpen = Boolean(expandedEventIds[item.eventId]);
                const hasDetails = Boolean(
                  item.description || item.resultSummary || item.error || item.toolName
                );

                return (
                  <div
                    key={item.eventId}
                    data-testid="agent-activity-item"
                    data-activity-status={item.status}
                    className="rounded-lg border border-[#222222] bg-[#161616] px-2.5 py-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => hasDetails && toggleDetail(item.eventId)}
                        className="flex items-start gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <span className="mt-0.5">
                          {renderStatusIcon(item.status, item.verificationOutcome)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-[#EFEFEF] truncate">
                              {redactSensitiveActivityText(item.title, 120)}
                            </span>
                            {durationLabel && (
                              <span className="text-[10px] text-[#8A8A8A] tabular-nums">
                                {durationLabel}
                              </span>
                            )}
                          </div>
                          {item.resultSummary && !detailOpen && (
                            <p className="text-[11px] text-[#9A9A9A] truncate mt-0.5">
                              {redactSensitiveActivityText(item.resultSummary, 140)}
                            </p>
                          )}
                          {item.error && !detailOpen && (
                            <p className="text-[11px] text-red-300/90 truncate mt-0.5">
                              {redactSensitiveActivityText(item.error, 140)}
                            </p>
                          )}
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[9.5px] font-mono tracking-wide border',
                            badge.toneClass
                          )}
                        >
                          {badge.label}
                        </span>
                      </div>
                    </div>

                    {detailOpen && hasDetails && (
                      <div className="mt-2 pt-2 border-t border-[#252525] space-y-1 text-[11px] text-[#A8A8A8] font-mono">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-[#808080]">
                          <span>tool: {redactSensitiveActivityText(item.toolName, 60)}</span>
                          <span>{formatShortTime(item.timestamp)}</span>
                        </div>
                        {item.description && (
                          <p className="text-[#BDBDBD] font-sans">
                            {redactSensitiveActivityText(item.description, 220)}
                          </p>
                        )}
                        {item.resultSummary && (
                          <p className="text-emerald-300/90 font-sans">
                            Result: {redactSensitiveActivityText(item.resultSummary, 240)}
                          </p>
                        )}
                        {item.error && (
                          <p className="text-red-300 font-sans">
                            Error: {redactSensitiveActivityText(item.error, 220)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }
);

AgentActivityFeed.displayName = 'AgentActivityFeed';
