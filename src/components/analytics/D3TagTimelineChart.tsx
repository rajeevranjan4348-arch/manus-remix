import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { TagTimePoint, getTagColorHex } from '@/lib/tagAnalyticsService';
import { TaskTag, getAvailableTags } from '@/lib/taskTaggingService';

export interface D3TagTimelineChartProps {
  timePoints: TagTimePoint[];
  selectedTags: TaskTag[];
  chartMode?: 'bar' | 'area' | 'line' | 'stream';
  height?: number;
  onHoverTimePoint?: (point: TagTimePoint | null) => void;
}

export function D3TagTimelineChart({
  timePoints,
  selectedTags,
  chartMode = 'bar',
  height = 320,
  onHoverTimePoint,
}: D3TagTimelineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<TagTimePoint | null>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !timePoints || timePoints.length === 0) return;

    const svg = d3.select(svgRef.current);
    const containerWidth = containerRef.current.clientWidth || 600;
    const margin = { top: 20, right: 24, bottom: 35, left: 40 };
    const width = Math.max(120, containerWidth - margin.left - margin.right);
    const chartHeight = Math.max(120, height - margin.top - margin.bottom);

    const allTags = getAvailableTags();
    const baseActiveTags = selectedTags.length > 0 ? selectedTags : allTags;

    // Sort active tags by total count across the current time range so stacked bars/areas
    // dynamically reorder their vertical stacking order when time range or tag visibility changes
    const tagTotals = new Map<TaskTag, number>();
    baseActiveTags.forEach((tag) => {
      const sum = d3.sum(timePoints, (tp) => tp.tags[tag] || 0);
      tagTotals.set(tag, sum);
    });
    const activeTags = [...baseActiveTags].sort(
      (a, b) => (tagTotals.get(b) || 0) - (tagTotals.get(a) || 0)
    );

    svg
      .attr('width', containerWidth)
      .attr('height', height)
      .attr('viewBox', `0 0 ${containerWidth} ${height}`)
      .attr('style', 'max-width: 100%; height: auto;');

    // Persistent defs for SVG gradients
    let defs = svg.select<SVGDefsElement>('defs');
    if (defs.empty()) {
      defs = svg.append('defs');
      allTags.forEach((tag) => {
        const colorHex = getTagColorHex(tag);
        const gradientId = `tag-grad-${tag.toLowerCase()}`;
        const grad = defs
          .append('linearGradient')
          .attr('id', gradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '0%')
          .attr('y2', '100%');

        grad.append('stop').attr('offset', '0%').attr('stop-color', colorHex).attr('stop-opacity', 0.55);
        grad.append('stop').attr('offset', '100%').attr('stop-color', colorHex).attr('stop-opacity', 0.08);
      });
    }

    // Persistent root group for smooth D3 transitions across state updates
    let g = svg.select<SVGGElement>('g.timeline-root');
    if (g.empty()) {
      g = svg.append('g').attr('class', 'timeline-root');
      g.append('g').attr('class', 'grid-lines');
      g.append('g').attr('class', 'bars-layer');
      g.append('g').attr('class', 'areas-layer');
      g.append('g').attr('class', 'lines-layer');
      g.append('g').attr('class', 'x-axis');
      g.append('g').attr('class', 'y-axis');
      g.append('g').attr('class', 'interaction-layer');
    }
    g.attr('transform', `translate(${margin.left},${margin.top})`);

    const t = svg.transition().duration(600).ease(d3.easeCubicInOut) as any;

    // Scales
    const xExtent = d3.extent(timePoints, (d) => d.date) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, width]);

    const xBandScale = d3
      .scaleBand<string>()
      .domain(timePoints.map((d) => d.dateStr))
      .range([0, width])
      .paddingInner(timePoints.length > 45 ? 0.15 : 0.25)
      .paddingOuter(0.08);

    // Format data for D3 Stack
    const stackData = timePoints.map((tp) => {
      const row: Record<string, any> = { date: tp.date, dateStr: tp.dateStr, original: tp };
      allTags.forEach((tag) => {
        row[tag] = activeTags.includes(tag) ? tp.tags[tag] || 0 : 0;
      });
      return row;
    });

    let yMax = 10;
    if (chartMode === 'line') {
      const maxVal =
        d3.max(timePoints, (tp) => d3.max(activeTags, (tag) => tp.tags[tag] || 0)) || 5;
      yMax = Math.max(5, maxVal + 1);
    } else {
      const maxStack =
        d3.max(stackData, (d) => d3.sum(activeTags, (tag) => d[tag])) || 10;
      yMax = Math.max(5, maxStack + 2);
    }

    const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([chartHeight, 0]);

    // Grid lines with smooth transition
    const yGrid = d3
      .axisLeft(yScale)
      .ticks(5)
      .tickSize(-width)
      .tickFormat(() => '');

    const gridGroup = g.select<SVGGElement>('g.grid-lines');
    gridGroup.transition(t).call(yGrid as any);
    gridGroup
      .selectAll('line')
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.08)
      .attr('stroke-dasharray', '3,3');
    gridGroup.select('.domain').remove();

    const barsLayer = g.select<SVGGElement>('g.bars-layer');
    const areasLayer = g.select<SVGGElement>('g.areas-layer');
    const linesLayer = g.select<SVGGElement>('g.lines-layer');

    // 1. BAR MODE: Stacked Time-Series Tag Bars with smooth D3 resize & reorder transitions
    if (chartMode === 'bar') {
      areasLayer.selectAll('*').transition(t).attr('opacity', 0).remove();
      linesLayer.selectAll('*').transition(t).attr('opacity', 0).remove();

      const stack = d3
        .stack<any>()
        .keys(activeTags)
        .order(d3.stackOrderNone)
        .offset(d3.stackOffsetNone);

      const series = stack(stackData);

      // Join tag layer groups keyed by tag name
      const layerGroups = barsLayer
        .selectAll<SVGGElement, d3.Series<any, string>>('g.bar-series-layer')
        .data(series, (d) => d.key);

      // Exit hidden tag layers by shrinking their bars to height 0
      const layerExit = layerGroups.exit();
      layerExit
        .selectAll('rect.timeline-bar')
        .transition(t)
        .attr('y', chartHeight)
        .attr('height', 0)
        .attr('opacity', 0);
      layerExit.transition(t).remove();

      const layerEnter = layerGroups
        .enter()
        .append('g')
        .attr('class', 'bar-series-layer')
        .attr('data-tag', (d) => d.key)
        .attr('fill', (d) => getTagColorHex(d.key as TaskTag));

      const layerMerged = layerEnter
        .merge(layerGroups)
        .attr('fill', (d) => getTagColorHex(d.key as TaskTag));

      const barWidth = Math.max(2, xBandScale.bandwidth());

      // Join individual time-point bars inside each tag layer keyed by dateStr
      layerMerged.each(function (seriesData) {
        const layerSelection = d3.select(this);
        const rects = layerSelection
          .selectAll<SVGRectElement, d3.SeriesPoint<any>>('rect.timeline-bar')
          .data(seriesData, (d: any) => d.data.dateStr);

        rects
          .exit()
          .transition(t)
          .attr('width', 0)
          .attr('y', chartHeight)
          .attr('height', 0)
          .attr('opacity', 0)
          .remove();

        const rectsEnter = rects
          .enter()
          .append('rect')
          .attr('class', 'timeline-bar')
          .attr('x', (d) => xBandScale(d.data.dateStr) ?? 0)
          .attr('y', chartHeight)
          .attr('width', barWidth)
          .attr('height', 0)
          .attr('rx', Math.min(3, barWidth / 2))
          .attr('opacity', 0);

        rectsEnter
          .merge(rects)
          .transition(t)
          .attr('x', (d) => xBandScale(d.data.dateStr) ?? 0)
          .attr('width', barWidth)
          .attr('rx', Math.min(3, barWidth / 2))
          .attr('y', (d) => yScale(d[1]))
          .attr('height', (d) => Math.max(0, yScale(d[0]) - yScale(d[1])))
          .attr('opacity', 0.9);
      });
    } else if (chartMode === 'area' || chartMode === 'stream') {
      // 2. AREA / STREAM MODE with D3 transitions
      barsLayer
        .selectAll('rect.timeline-bar')
        .transition(t)
        .attr('y', chartHeight)
        .attr('height', 0)
        .attr('opacity', 0);
      barsLayer.selectAll('g.bar-series-layer').transition(t).remove();
      linesLayer.selectAll('*').transition(t).attr('opacity', 0).remove();

      const stack = d3
        .stack<any>()
        .keys(activeTags)
        .order(d3.stackOrderNone)
        .offset(chartMode === 'stream' ? d3.stackOffsetWiggle : d3.stackOffsetNone);

      const series = stack(stackData);

      if (chartMode === 'stream') {
        const yMinStream = d3.min(series, (layer) => d3.min(layer, (d) => d[0])) || 0;
        const yMaxStream = d3.max(series, (layer) => d3.max(layer, (d) => d[1])) || 10;
        yScale.domain([yMinStream, yMaxStream]);
      }

      const areaGenerator = d3
        .area<any>()
        .x((d) => xScale(d.data.date))
        .y0((d) => yScale(d[0]))
        .y1((d) => yScale(d[1]))
        .curve(d3.curveMonotoneX);

      const zeroAreaGenerator = d3
        .area<any>()
        .x((d) => xScale(d.data.date))
        .y0(chartHeight)
        .y1(chartHeight)
        .curve(d3.curveMonotoneX);

      const areas = areasLayer
        .selectAll<SVGPathElement, d3.Series<any, string>>('path.series-area')
        .data(series, (d) => d.key);

      areas
        .exit()
        .transition(t)
        .attr('d', (d: any) => zeroAreaGenerator(d))
        .attr('opacity', 0)
        .remove();

      const areasEnter = areas
        .enter()
        .append('path')
        .attr('class', 'series-area')
        .attr('fill', (d) => `url(#tag-grad-${d.key.toLowerCase()})`)
        .attr('stroke', (d) => getTagColorHex(d.key as TaskTag))
        .attr('stroke-width', 1.8)
        .attr('d', (d) => zeroAreaGenerator(d))
        .attr('opacity', 0);

      areasEnter
        .merge(areas)
        .transition(t)
        .attr('fill', (d) => `url(#tag-grad-${d.key.toLowerCase()})`)
        .attr('stroke', (d) => getTagColorHex(d.key as TaskTag))
        .attr('d', (d) => areaGenerator(d))
        .attr('opacity', 0.9);
    } else {
      // 3. MULTI-LINE MODE with D3 transitions
      barsLayer
        .selectAll('rect.timeline-bar')
        .transition(t)
        .attr('y', chartHeight)
        .attr('height', 0)
        .attr('opacity', 0);
      barsLayer.selectAll('g.bar-series-layer').transition(t).remove();
      areasLayer.selectAll('*').transition(t).attr('opacity', 0).remove();

      const lineSeries = activeTags.map((tag) => ({
        tag,
        points: timePoints,
      }));

      const lines = linesLayer
        .selectAll<SVGPathElement, { tag: TaskTag; points: TagTimePoint[] }>('path.tag-line')
        .data(lineSeries, (d) => d.tag);

      lines.exit().transition(t).attr('opacity', 0).remove();

      const lineGenerator = (tag: TaskTag) =>
        d3
          .line<TagTimePoint>()
          .x((d) => xScale(d.date))
          .y((d) => yScale(d.tags[tag] || 0))
          .curve(d3.curveMonotoneX);

      const linesEnter = lines
        .enter()
        .append('path')
        .attr('class', 'tag-line')
        .attr('fill', 'none')
        .attr('stroke', (d) => getTagColorHex(d.tag))
        .attr('stroke-width', 2.5)
        .attr('opacity', 0)
        .attr('d', (d) => lineGenerator(d.tag)(d.points));

      linesEnter
        .merge(lines)
        .transition(t)
        .attr('stroke', (d) => getTagColorHex(d.tag))
        .attr('d', (d) => lineGenerator(d.tag)(d.points))
        .attr('opacity', 0.95);
    }

    // Axes with smooth transitions
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.min(timePoints.length, 7))
      .tickFormat(d3.timeFormat('%b %d') as any);

    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('d'));

    const xAxisGroup = g
      .select<SVGGElement>('g.x-axis')
      .attr('transform', `translate(0,${chartHeight})`);
    xAxisGroup.transition(t).call(xAxis as any);
    xAxisGroup
      .selectAll('text')
      .attr('fill', 'currentColor')
      .attr('font-size', '10px')
      .attr('opacity', 0.7);

    const yAxisGroup = g.select<SVGGElement>('g.y-axis');
    if (chartMode !== 'stream') {
      yAxisGroup.transition(t).style('opacity', 1).call(yAxis as any);
      yAxisGroup
        .selectAll('text')
        .attr('fill', 'currentColor')
        .attr('font-size', '10px')
        .attr('opacity', 0.7);
    } else {
      yAxisGroup.transition(t).style('opacity', 0);
    }

    g.selectAll('.domain, .tick line').attr('stroke', 'currentColor').attr('opacity', 0.15);

    // Interactive Crosshair & Tooltip Overlay
    const interactionLayer = g.select<SVGGElement>('g.interaction-layer');
    interactionLayer.selectAll('*').remove();

    const crosshair = interactionLayer
      .append('line')
      .attr('class', 'crosshair')
      .attr('y1', 0)
      .attr('y2', chartHeight)
      .attr('stroke', 'currentColor')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')
      .attr('opacity', 0);

    const focusCircle = interactionLayer
      .append('circle')
      .attr('r', 5)
      .attr('fill', 'currentColor')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .attr('opacity', 0);

    const overlay = interactionLayer
      .append('rect')
      .attr('class', 'overlay')
      .attr('width', width)
      .attr('height', chartHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair');

    const bisectDate = d3.bisector<TagTimePoint, Date>((d) => d.date).left;

    overlay.on('mousemove touchmove', function (event) {
      const [mouseX] = d3.pointer(event);
      const x0 = xScale.invert(mouseX);
      const index = bisectDate(timePoints, x0, 1);
      const d0 = timePoints[index - 1];
      const d1 = timePoints[index];

      let d = d0;
      if (d0 && d1) {
        d = x0.getTime() - d0.date.getTime() > d1.date.getTime() - x0.getTime() ? d1 : d0;
      }

      if (d) {
        setHoveredPoint(d);
        if (onHoverTimePoint) onHoverTimePoint(d);

        const cx =
          chartMode === 'bar'
            ? (xBandScale(d.dateStr) ?? xScale(d.date)) + xBandScale.bandwidth() / 2
            : xScale(d.date);
        const visibleTotal = d3.sum(activeTags, (tag) => d.tags[tag] || 0);

        crosshair.attr('x1', cx).attr('x2', cx).attr('opacity', 0.6);
        focusCircle.attr('cx', cx).attr('cy', yScale(visibleTotal)).attr('opacity', 1);

        if (tooltipRef.current) {
          const tooltip = tooltipRef.current;
          tooltip.style.opacity = '1';
          const leftPos = Math.min(cx + margin.left + 15, containerWidth - 180);
          tooltip.style.left = `${leftPos}px`;
          tooltip.style.top = `${margin.top + 10}px`;
        }
      }
    });

    overlay.on('mouseleave touchend', function () {
      crosshair.attr('opacity', 0);
      focusCircle.attr('opacity', 0);
      setHoveredPoint(null);
      if (onHoverTimePoint) onHoverTimePoint(null);
      if (tooltipRef.current) {
        tooltipRef.current.style.opacity = '0';
      }
    });
  }, [timePoints, selectedTags, chartMode, height, onHoverTimePoint]);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden select-none">
      <svg ref={svgRef} className="w-full text-foreground/80 overflow-visible" />

      {/* Floating Interactive Tooltip Card */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none transition-opacity duration-150 p-2.5 rounded-xl bg-popover/95 backdrop-blur-md border border-border shadow-xl z-30 text-xs w-48 space-y-1.5 opacity-0"
      >
        {hoveredPoint && (
          <>
            <div className="flex items-center justify-between border-b border-border/50 pb-1">
              <span className="font-bold text-foreground">{hoveredPoint.dateStr}</span>
              <span className="font-mono text-[10px] font-semibold text-primary px-1.5 py-0.2 rounded bg-primary/10">
                {hoveredPoint.total} task{hoveredPoint.total === 1 ? '' : 's'}
              </span>
            </div>

            <div className="space-y-1 pt-0.5 max-h-36 overflow-y-auto custom-scrollbar">
              {(selectedTags.length > 0 ? selectedTags : getAvailableTags()).map((tag) => {
                const count = hoveredPoint.tags[tag] || 0;
                if (count === 0 && selectedTags.length === 0) return null;
                const percent =
                  hoveredPoint.total > 0 ? Math.round((count / hoveredPoint.total) * 100) : 0;
                return (
                  <div key={tag} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getTagColorHex(tag) }}
                      />
                      <span className="truncate text-muted-foreground">{tag}</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="font-semibold text-foreground">{count}</span>
                      <span className="text-[10px] text-muted-foreground font-normal">
                        ({percent}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
