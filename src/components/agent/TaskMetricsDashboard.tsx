import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Gauge,
  PieChart as PieChartIcon,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/ThemeContext';
import {
  buildTaskMetricsSummary,
  formatDurationLabel,
  formatTokenCount,
  taskMetricsStore,
  TurnChartPoint,
} from '@/lib/taskMetrics';

export interface TaskMetricsDashboardProps {
  taskId?: string | null;
  messages: Array<{
    id?: string;
    role: string;
    content: any;
    timestamp?: string;
    status?: string;
    isStreaming?: boolean;
    metadata?: any;
  }>;
  isRunning?: boolean;
  status?: 'idle' | 'running' | 'completed' | 'error';
  liveStreamText?: string;
  defaultExpanded?: boolean;
}

interface Palette {
  prompt: string;
  completion: string;
  thought: string;
  duration: string;
  durationFillTop: string;
  durationFillBottom: string;
  avgLine: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipMuted: string;
  cursorFill: string;
}

function getChartPalette(isDark: boolean): Palette {
  if (isDark) {
    return {
      prompt: '#E4E4E7',
      completion: '#60A5FA',
      thought: '#A78BFA',
      duration: '#34D399',
      durationFillTop: 'rgba(52, 211, 153, 0.32)',
      durationFillBottom: 'rgba(52, 211, 153, 0.02)',
      avgLine: '#A1A1AA',
      grid: '#27272A',
      axis: '#A1A1AA',
      tooltipBg: '#141416',
      tooltipBorder: '#2E2E33',
      tooltipText: '#FAFAFA',
      tooltipMuted: '#A1A1AA',
      cursorFill: 'rgba(255, 255, 255, 0.05)',
    };
  }
  return {
    prompt: '#18181B',
    completion: '#2563EB',
    thought: '#7C3AED',
    duration: '#059669',
    durationFillTop: 'rgba(5, 150, 105, 0.24)',
    durationFillBottom: 'rgba(5, 150, 105, 0.02)',
    avgLine: '#71717A',
    grid: '#E4E4E7',
    axis: '#71717A',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#E4E4E7',
    tooltipText: '#09090B',
    tooltipMuted: '#71717A',
    cursorFill: 'rgba(0, 0, 0, 0.04)',
  };
}

function TokenTooltip({
  active,
  payload,
  palette,
}: {
  active?: boolean;
  payload?: any[];
  palette: Palette;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as TurnChartPoint | undefined;
  if (!point) return null;

  return (
    <div
      style={{
        backgroundColor: palette.tooltipBg,
        borderColor: palette.tooltipBorder,
        color: palette.tooltipText,
      }}
      className="rounded-xl border px-3 py-2.5 shadow-lg text-xs min-w-[168px]"
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="font-semibold">{point.turn}</span>
        <span style={{ color: palette.tooltipMuted }} className="text-[10px] uppercase tracking-wider">
          {point.isLive ? 'Live' : point.source === 'exact' ? 'API Exact' : 'Est.'}
        </span>
      </div>
      {point.promptPreview && (
        <p
          style={{ color: palette.tooltipMuted }}
          className="text-[11px] truncate max-w-[210px] mb-2"
        >
          {point.promptPreview}
        </p>
      )}
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: palette.tooltipMuted }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette.prompt }} />
            Input
          </span>
          <span className="font-mono font-medium">{point.promptTokens.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: palette.tooltipMuted }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette.completion }} />
            Output
          </span>
          <span className="font-mono font-medium">{point.completionTokens.toLocaleString()}</span>
        </div>
        {point.thoughtTokens > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5" style={{ color: palette.tooltipMuted }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette.thought }} />
              Reasoning
            </span>
            <span className="font-mono font-medium">{point.thoughtTokens.toLocaleString()}</span>
          </div>
        )}
        <div
          style={{ borderColor: palette.tooltipBorder }}
          className="flex items-center justify-between gap-4 pt-1.5 mt-1 border-t font-semibold"
        >
          <span>Total</span>
          <span className="font-mono">{point.totalTokens.toLocaleString()} tok</span>
        </div>
      </div>
    </div>
  );
}

function DurationTooltip({
  active,
  payload,
  palette,
}: {
  active?: boolean;
  payload?: any[];
  palette: Palette;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as TurnChartPoint | undefined;
  if (!point) return null;

  return (
    <div
      style={{
        backgroundColor: palette.tooltipBg,
        borderColor: palette.tooltipBorder,
        color: palette.tooltipText,
      }}
      className="rounded-xl border px-3 py-2.5 shadow-lg text-xs min-w-[168px]"
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="font-semibold">{point.turn}</span>
        {point.isLive && (
          <span style={{ color: palette.duration }} className="text-[10px] font-semibold uppercase tracking-wider">
            Running
          </span>
        )}
      </div>
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: palette.tooltipMuted }}>Completion time</span>
          <span className="font-mono font-semibold" style={{ color: palette.duration }}>
            {formatDurationLabel(point.durationMs)}
          </span>
        </div>
        {typeof point.ttftMs === 'number' && point.ttftMs > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span style={{ color: palette.tooltipMuted }}>First token</span>
            <span className="font-mono">{formatDurationLabel(point.ttftMs)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: palette.tooltipMuted }}>Throughput</span>
          <span className="font-mono">{point.tokensPerSec > 0 ? `${point.tokensPerSec} tok/s` : '—'}</span>
        </div>
      </div>
    </div>
  );
}

export function TaskMetricsDashboard({
  taskId,
  messages,
  isRunning = false,
  status,
  liveStreamText,
  defaultExpanded = true,
}: TaskMetricsDashboardProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const palette = useMemo(() => getChartPalette(isDark), [isDark]);

  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [tokenChartView, setTokenChartView] = useState<'turns' | 'split'>('turns');
  const [storeVersion, setStoreVersion] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    return taskMetricsStore.subscribe(() => {
      setStoreVersion((v) => v + 1);
      setNowMs(Date.now());
    });
  }, []);

  useEffect(() => {
    if (!isRunning && status !== 'running') return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => clearInterval(interval);
  }, [isRunning, status]);

  const summary = useMemo(
    () =>
      buildTaskMetricsSummary({
        taskId,
        messages,
        isRunning: isRunning || status === 'running',
        liveStreamText,
        nowMs,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId, messages, isRunning, status, liveStreamText, nowMs, storeVersion]
  );

  if (summary.turnSeries.length === 0) {
    return null;
  }

  const avgDurationSec = Number((summary.avgTurnDurationMs / 1000).toFixed(2));
  const sliceColorByKey: Record<'prompt' | 'completion' | 'thought', string> = {
    prompt: palette.prompt,
    completion: palette.completion,
    thought: palette.thought,
  };
  const durationGradientId = `task-duration-fill-${(taskId || 'default').replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <section
      data-testid="task-metrics-dashboard"
      aria-label="Current task token usage and completion time dashboard"
      className="max-w-3xl mx-auto w-full rounded-2xl border border-border/70 bg-card/90 shadow-xs overflow-hidden transition-colors"
    >
      {/* Header / Compact Live Summary Strip */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-muted/70 border border-border/60 flex items-center justify-center shrink-0 text-foreground">
            <Activity size={14} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-foreground tracking-tight">
                Task Performance Dashboard
              </span>
              {summary.hasLiveTurn ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-border bg-muted/60 text-foreground">
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: palette.duration }}
                  />
                  Live
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border border-border/60 bg-muted/40 text-muted-foreground">
                  {summary.hasExactUsage ? 'API Exact' : 'Estimated'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {summary.turnSeries.length} {summary.turnSeries.length === 1 ? 'turn' : 'turns'} tracked in current task
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-xs tabular-nums">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Cpu size={12} />
              <strong className="font-mono text-foreground">{formatTokenCount(summary.totalTokens)}</strong>
              <span>tok</span>
            </span>
            <span className="text-border">•</span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Clock size={12} />
              <strong className="font-mono text-foreground">{formatDurationLabel(summary.totalDurationMs)}</strong>
            </span>
          </div>
          <span className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground">
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-3.5 border-t border-border/50">
          {/* 4-Card KPI Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2.5">
            <div
              data-testid="metric-total-tokens"
              className="rounded-xl border border-border/60 bg-background/70 px-3 py-2.5"
            >
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Total Tokens</span>
                <Cpu size={12} />
              </div>
              <div className="text-base sm:text-lg font-bold font-mono tracking-tight text-foreground tabular-nums">
                {formatTokenCount(summary.totalTokens)}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono tabular-nums mt-0.5 truncate">
                {formatTokenCount(summary.totalPromptTokens)} in / {formatTokenCount(summary.totalCompletionTokens)} out
              </div>
            </div>

            <div
              data-testid="metric-completion-time"
              className="rounded-xl border border-border/60 bg-background/70 px-3 py-2.5"
            >
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Completion Time</span>
                <Clock size={12} />
              </div>
              <div className="text-base sm:text-lg font-bold font-mono tracking-tight text-foreground tabular-nums">
                {formatDurationLabel(summary.totalDurationMs)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {summary.hasLiveTurn ? 'Updating live...' : 'Total task elapsed'}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Avg Turn Time</span>
                <Timer size={12} />
              </div>
              <div className="text-base sm:text-lg font-bold font-mono tracking-tight text-foreground tabular-nums">
                {formatDurationLabel(summary.avgTurnDurationMs)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                Across {summary.turnSeries.length} {summary.turnSeries.length === 1 ? 'turn' : 'turns'}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Throughput</span>
                <Gauge size={12} />
              </div>
              <div className="text-base sm:text-lg font-bold font-mono tracking-tight text-foreground tabular-nums">
                {summary.avgTokensPerSec > 0 ? `${summary.avgTokensPerSec}` : '—'}
                {summary.avgTokensPerSec > 0 && (
                  <span className="text-[11px] font-normal text-muted-foreground ml-1">tok/s</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                Output generation rate
              </div>
            </div>
          </div>

          {/* 2-Column Recharts Visualizations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Token Usage Chart Card */}
            <div className="rounded-xl border border-border/60 bg-background/70 p-3.5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-foreground truncate">Token Usage</h3>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {tokenChartView === 'turns' ? 'Input vs Output tokens per turn' : 'Task token composition'}
                  </p>
                </div>
                <div className="inline-flex items-center rounded-lg border border-border/70 bg-muted/40 p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setTokenChartView('turns')}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer',
                      tokenChartView === 'turns'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-label="Show token usage per turn bar chart"
                  >
                    <BarChart3 size={11} />
                    <span>Turns</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTokenChartView('split')}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer',
                      tokenChartView === 'split'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-label="Show token breakdown donut chart"
                  >
                    <PieChartIcon size={11} />
                    <span>Split</span>
                  </button>
                </div>
              </div>

              <div className="h-[190px] w-full min-w-0">
                {tokenChartView === 'turns' ? (
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart
                      data={summary.turnSeries}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                      barCategoryGap="28%"
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
                      <XAxis
                        dataKey="turn"
                        tick={{ fontSize: 11, fill: palette.axis }}
                        axisLine={{ stroke: palette.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: palette.axis }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(val) => formatTokenCount(Number(val))}
                      />
                      <Tooltip
                        cursor={{ fill: palette.cursorFill }}
                        content={<TokenTooltip palette={palette} />}
                      />
                      <Bar
                        dataKey="promptTokens"
                        name="Input"
                        stackId="tokens"
                        fill={palette.prompt}
                        maxBarSize={42}
                        radius={summary.totalCompletionTokens === 0 && summary.totalThoughtTokens === 0 ? [5, 5, 0, 0] : [0, 0, 0, 0]}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="completionTokens"
                        name="Output"
                        stackId="tokens"
                        fill={palette.completion}
                        maxBarSize={42}
                        radius={summary.totalThoughtTokens > 0 ? [0, 0, 0, 0] : [5, 5, 0, 0]}
                        isAnimationActive={false}
                      />
                      {summary.totalThoughtTokens > 0 && (
                        <Bar
                          dataKey="thoughtTokens"
                          name="Reasoning"
                          stackId="tokens"
                          fill={palette.thought}
                          maxBarSize={42}
                          radius={[5, 5, 0, 0]}
                          isAnimationActive={false}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center h-full gap-3">
                    <div className="relative w-[155px] h-[175px] shrink-0">
                      <ResponsiveContainer width="100%" height={175}>
                        <PieChart>
                          <Pie
                            data={summary.tokenBreakdown}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={44}
                            outerRadius={68}
                            paddingAngle={2}
                            strokeWidth={0}
                            isAnimationActive={false}
                          >
                            {summary.tokenBreakdown.map((slice) => (
                              <Cell key={slice.key} fill={sliceColorByKey[slice.key]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(val: any, name: any) => [
                              `${Number(val).toLocaleString()} tok`,
                              String(name),
                            ]}
                            contentStyle={{
                              backgroundColor: palette.tooltipBg,
                              borderColor: palette.tooltipBorder,
                              color: palette.tooltipText,
                              borderRadius: '10px',
                              fontSize: '11px',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xs font-bold font-mono text-foreground tabular-nums">
                          {formatTokenCount(summary.totalTokens)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">tokens</span>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      {summary.tokenBreakdown.map((slice) => (
                        <div key={slice.key} className="space-y-0.5">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <span className="flex items-center gap-1.5 text-muted-foreground truncate">
                              <span
                                className="w-2.5 h-2.5 rounded-sm shrink-0"
                                style={{ backgroundColor: sliceColorByKey[slice.key] }}
                              />
                              <span className="truncate">{slice.name}</span>
                            </span>
                            <span className="font-mono font-semibold text-foreground tabular-nums shrink-0">
                              {slice.percentage}%
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground tabular-nums pl-4">
                            {slice.value.toLocaleString()} tokens
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Compact Legend for Stacked Bar View */}
              {tokenChartView === 'turns' && (
                <div className="flex items-center gap-3.5 mt-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground flex-wrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: palette.prompt }} />
                    Input ({formatTokenCount(summary.totalPromptTokens)})
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: palette.completion }} />
                    Output ({formatTokenCount(summary.totalCompletionTokens)})
                  </span>
                  {summary.totalThoughtTokens > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: palette.thought }} />
                      Reasoning ({formatTokenCount(summary.totalThoughtTokens)})
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Completion Time Chart Card */}
            <div className="rounded-xl border border-border/60 bg-background/70 p-3.5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-foreground truncate">Completion Time</h3>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Response latency in seconds per turn
                  </p>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
                  Avg {formatDurationLabel(summary.avgTurnDurationMs)}
                </span>
              </div>

              <div className="h-[190px] w-full min-w-0">
                {summary.turnSeries.length > 1 ? (
                  <ResponsiveContainer width="100%" height={190}>
                    <AreaChart
                      data={summary.turnSeries}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id={durationGradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={palette.duration} stopOpacity={isDark ? 0.34 : 0.25} />
                          <stop offset="95%" stopColor={palette.duration} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
                      <XAxis
                        dataKey="turn"
                        tick={{ fontSize: 11, fill: palette.axis }}
                        axisLine={{ stroke: palette.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: palette.axis }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(val) => `${Number(val).toFixed(val >= 10 ? 0 : 1)}s`}
                      />
                      <Tooltip content={<DurationTooltip palette={palette} />} />
                      <ReferenceLine
                        y={avgDurationSec}
                        stroke={palette.avgLine}
                        strokeDasharray="4 4"
                        strokeWidth={1}
                      />
                      <Area
                        type="monotone"
                        dataKey="durationSec"
                        name="Completion Time"
                        stroke={palette.duration}
                        strokeWidth={2.2}
                        fill={`url(#${durationGradientId})`}
                        dot={{ r: 3.5, fill: palette.duration, strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: palette.duration, strokeWidth: 2, stroke: palette.tooltipBg }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart
                      data={summary.turnSeries}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
                      <XAxis
                        dataKey="turn"
                        tick={{ fontSize: 11, fill: palette.axis }}
                        axisLine={{ stroke: palette.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: palette.axis }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(val) => `${Number(val).toFixed(val >= 10 ? 0 : 1)}s`}
                      />
                      <Tooltip
                        cursor={{ fill: palette.cursorFill }}
                        content={<DurationTooltip palette={palette} />}
                      />
                      <Bar
                        dataKey="durationSec"
                        name="Completion Time"
                        fill={palette.duration}
                        maxBarSize={48}
                        radius={[6, 6, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: palette.duration }} />
                  Total {formatDurationLabel(summary.totalDurationMs)}
                </span>
                {summary.turnSeries[summary.turnSeries.length - 1]?.ttftMs ? (
                  <span className="font-mono">
                    Last TTFT {formatDurationLabel(summary.turnSeries[summary.turnSeries.length - 1].ttftMs!)}
                  </span>
                ) : (
                  <span className="font-mono">
                    Peak {formatDurationLabel(Math.max(...summary.turnSeries.map((t) => t.durationMs)))}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
