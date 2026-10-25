import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Filter,
  Sparkles,
  TrendingUp,
  Layers,
  Activity,
  RefreshCw,
  PieChart,
  FileSpreadsheet,
  FileCode,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  getTagAnalyticsData,
  AnalyticsData,
  TimeRangeKey,
  getTagColorHex,
  TagSummaryMetric,
} from '@/lib/tagAnalyticsService';
import { TaskTag, getAvailableTags, getTagStyle } from '@/lib/taskTaggingService';
import { D3TagTimelineChart } from './D3TagTimelineChart';
import { D3TagDonutChart } from './D3TagDonutChart';
import { D3TagBarChart } from './D3TagBarChart';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface TagAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTimeRange?: TimeRangeKey;
}

export function TagAnalyticsModal({
  isOpen,
  onClose,
  initialTimeRange = '30d',
}: TagAnalyticsModalProps) {
  const [timeRange, setTimeRange] = useState<TimeRangeKey>(initialTimeRange);
  const [chartMode, setChartMode] = useState<'bar' | 'area' | 'line' | 'stream'>('bar');
  const [selectedTags, setSelectedTags] = useState<TaskTag[]>([]);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [spotlightTag, setSpotlightTag] = useState<TaskTag | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, timeRange]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await getTagAnalyticsData(timeRange);
      setData(res);
    } catch (err) {
      console.error('[TagAnalyticsModal] Load error:', err);
      toast.error('Failed to load analytics data');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTagSelection = (tag: TaskTag) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  };

  // Recompute relative percentages for visible tags so toggling tag visibility
  // smoothly resizes and reorders the D3 visualization bars
  const visibleSummaries: TagSummaryMetric[] = useMemo(() => {
    if (!data) return [];
    const filtered =
      selectedTags.length > 0
        ? data.tagSummaries.filter((s) => selectedTags.includes(s.tag))
        : data.tagSummaries;
    const visibleTotal = filtered.reduce((acc, s) => acc + s.count, 0);
    return filtered
      .map((s) => ({
        ...s,
        percentage: visibleTotal > 0 ? Math.round((s.count / visibleTotal) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [data, selectedTags]);

  const handleExportCSV = () => {
    if (!data) return;
    try {
      let csv = 'Date,Total Tasks,' + getAvailableTags().join(',') + '\n';
      data.timePoints.forEach((tp) => {
        const row = [
          tp.dateStr,
          tp.total,
          ...getAvailableTags().map((t) => tp.tags[t] || 0),
        ];
        csv += row.join(',') + '\n';
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manus-task-tags-analytics-${timeRange}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Exported analytics CSV');
    } catch {
      toast.error('Failed to export CSV');
    }
  };

  const handleExportJSON = () => {
    if (!data) return;
    try {
      const payload = JSON.stringify(data, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manus-tag-analytics-${timeRange}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Exported analytics JSON');
    } catch {
      toast.error('Failed to export JSON');
    }
  };

  const topCategorySummary = visibleSummaries[0] || data?.tagSummaries[0];
  const visibleTotalTasks = visibleSummaries.reduce((acc, s) => acc + s.count, 0);
  const activeCategoryCount = visibleSummaries.filter((s) => s.count > 0).length;
  const overallAvgPerDay = data?.daysInRange
    ? Number((visibleTotalTasks / data.daysInRange).toFixed(1))
    : 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] p-0 flex flex-col max-h-[90vh] bg-background border-border shadow-2xl overflow-hidden rounded-3xl z-50">
        {/* Modal Header */}
        <div className="p-5 pb-4 border-b border-border bg-manus-soft dark:bg-card/40 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shadow-xs">
                <BarChart3 size={22} />
              </div>
              <div>
                <DialogTitle className="text-xl font-extrabold text-foreground tracking-tight flex items-center gap-2">
                  <span>Productivity & Tag Analytics</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    D3.js
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Visualize category distribution and activity trends over time
                </DialogDescription>
              </div>
            </div>

            {/* Time Range Selector */}
            <div className="flex items-center gap-1 bg-white dark:bg-card border border-border p-1 rounded-2xl shadow-2xs">
              {[
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
                { id: '90d', label: '90 Days' },
                { id: 'ytd', label: 'YTD' },
                { id: 'all', label: 'All Time' },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setTimeRange(r.id as TimeRangeKey)}
                  className={cn(
                    'px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer',
                    timeRange === r.id
                      ? 'bg-primary text-primary-foreground shadow-2xs font-bold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Action Bar (Chart Mode + Export) */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40 flex-wrap">
            {/* Chart Mode Toggle */}
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <span className="text-[11px] font-semibold text-muted-foreground mr-1 hidden sm:inline">
                View:
              </span>
              {[
                { id: 'bar', label: 'Stacked Bars', icon: BarChart3 },
                { id: 'area', label: 'Stacked Area', icon: Layers },
                { id: 'stream', label: 'Streamgraph', icon: Activity },
                { id: 'line', label: 'Line Trend', icon: TrendingUp },
              ].map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setChartMode(m.id as any)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-medium transition-all cursor-pointer border text-[11px]',
                      chartMode === m.id
                        ? 'bg-primary/10 border-primary/40 text-primary font-bold shadow-2xs'
                        : 'bg-white dark:bg-card border-border/60 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon size={13} />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Export Actions */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white dark:bg-card border border-border text-foreground hover:border-primary/40 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
                title="Export analytics dataset to CSV"
              >
                <FileSpreadsheet size={13} className="text-emerald-500" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportJSON}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white dark:bg-card border border-border text-foreground hover:border-primary/40 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
                title="Export analytics payload to JSON"
              >
                <FileCode size={13} className="text-blue-500" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                onClick={loadData}
                className="p-1.5 rounded-xl border border-border bg-white dark:bg-card text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                title="Refresh analytics data"
              >
                <RefreshCw size={13} className={cn(isLoading && 'animate-spin')} />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {!data && isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-3">
              <RefreshCw size={28} className="animate-spin text-primary" />
              <p className="text-xs text-muted-foreground font-medium">
                Computing D3 time-series distributions...
              </p>
            </div>
          ) : data ? (
            <>
              {/* Top KPI Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* 1. Top Category */}
                <div className="p-3.5 rounded-2xl border border-border bg-white dark:bg-card shadow-2xs space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                    <span>Most Productive</span>
                    <Sparkles size={13} className="text-amber-500" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-black text-foreground truncate">
                      {topCategorySummary?.tag || data.topCategory}
                    </span>
                    <span className="text-xs font-mono font-bold text-primary">
                      {topCategorySummary?.percentage || 0}%
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {topCategorySummary?.count || 0} tasks completed
                  </p>
                </div>

                {/* 2. Total Tasks */}
                <div className="p-3.5 rounded-2xl border border-border bg-white dark:bg-card shadow-2xs space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                    <span>Total Tasks Logged</span>
                    <Zap size={13} className="text-blue-500" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-black text-foreground font-mono">
                      {visibleTotalTasks}
                    </span>
                    {topCategorySummary && topCategorySummary.trendPercent !== 0 && (
                      <span
                        className={cn(
                          'text-[10px] font-bold font-mono px-1.5 py-0.2 rounded-full',
                          topCategorySummary.trendPercent > 0
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        )}
                      >
                        {topCategorySummary.trendPercent > 0 ? '+' : ''}
                        {topCategorySummary.trendPercent}%
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Across {data.daysInRange} days window
                  </p>
                </div>

                {/* 3. Daily Velocity */}
                <div className="p-3.5 rounded-2xl border border-border bg-white dark:bg-card shadow-2xs space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                    <span>Daily Velocity</span>
                    <Activity size={13} className="text-emerald-500" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-black text-foreground font-mono">
                      {overallAvgPerDay}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">tasks/day</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Average throughput rate
                  </p>
                </div>

                {/* 4. Active Categories */}
                <div className="p-3.5 rounded-2xl border border-border bg-white dark:bg-card shadow-2xs space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                    <span>Visible Categories</span>
                    <Layers size={13} className="text-purple-500" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-black text-foreground font-mono">
                      {activeCategoryCount}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">/ 7 tags</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Active tag layers
                  </p>
                </div>
              </div>

              {/* Tag Selection Filter Pills */}
              <div className="p-3 rounded-2xl bg-muted/40 border border-border/60 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground px-0.5">
                  <span className="flex items-center gap-1.5">
                    <Filter size={13} className="text-primary" />
                    <span>Filter & Toggle Tag Visibility (D3 Live Transitions)</span>
                  </span>
                  {selectedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTags([])}
                      className="text-[11px] text-primary hover:underline font-normal cursor-pointer"
                    >
                      Show all tags ({selectedTags.length} selected)
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {getAvailableTags().map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    const isVisible = selectedTags.length === 0 || isSelected;
                    const style = getTagStyle(tag);
                    const count = data.tagSummaries.find((s) => s.tag === tag)?.count || 0;
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTagSelection(tag)}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer',
                          isSelected
                            ? `${style.badgeClass} ring-2 ring-primary/40 shadow-xs font-bold scale-105`
                            : isVisible
                              ? 'bg-white dark:bg-card border-border/80 text-foreground hover:border-primary/30'
                              : 'bg-muted/30 border-border/40 text-muted-foreground/50 opacity-60 hover:opacity-100'
                        )}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getTagColorHex(tag) }}
                        />
                        <span>{tag}</span>
                        <span className="text-[10px] font-mono opacity-70">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Main Visualization Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* D3 Timeline Chart (2 cols) */}
                <div className="lg:col-span-2 p-4 rounded-3xl border border-border bg-white dark:bg-card shadow-2xs space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-foreground tracking-tight flex items-center gap-1.5">
                        <TrendingUp size={16} className="text-primary" />
                        <span>Category Distribution Over Time</span>
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        D3 animated stacked bars & time-series breakdown
                      </p>
                    </div>

                    <span className="text-[11px] font-mono text-muted-foreground">
                      {data.startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} –{' '}
                      {data.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>

                  <D3TagTimelineChart
                    timePoints={data.timePoints}
                    selectedTags={selectedTags}
                    chartMode={chartMode}
                    height={310}
                  />
                </div>

                {/* Donut & D3 Category Ranking Bar Chart (1 col) */}
                <div className="p-4 rounded-3xl border border-border bg-white dark:bg-card shadow-2xs space-y-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-foreground tracking-tight flex items-center gap-1.5">
                        <PieChart size={16} className="text-primary" />
                        <span>Category Share</span>
                      </h3>
                      <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">
                        Overall Share
                      </span>
                    </div>

                    {/* D3 Donut Chart Component */}
                    <D3TagDonutChart
                      summaries={data.tagSummaries}
                      selectedTags={selectedTags}
                      selectedTag={spotlightTag}
                      onSelectTag={(t) => setSpotlightTag(t)}
                      size={185}
                    />
                  </div>

                  {/* D3 Animated Category Ranking Bars */}
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
                        Productivity Rankings (D3 Bars)
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        Auto-reorders
                      </span>
                    </div>

                    <D3TagBarChart
                      summaries={visibleSummaries}
                      selectedTags={selectedTags}
                      spotlightTag={spotlightTag}
                      onSelectTag={(t) => setSpotlightTag(t)}
                      height={225}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-xs text-muted-foreground">
              No analytics data available for this range.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
