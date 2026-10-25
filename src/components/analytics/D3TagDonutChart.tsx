import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { TagSummaryMetric } from '@/lib/tagAnalyticsService';
import { TaskTag } from '@/lib/taskTaggingService';

export interface D3TagDonutChartProps {
  summaries: TagSummaryMetric[];
  selectedTags?: TaskTag[];
  selectedTag?: TaskTag | null;
  onSelectTag?: (tag: TaskTag | null) => void;
  size?: number;
}

export function D3TagDonutChart({
  summaries,
  selectedTags = [],
  selectedTag = null,
  onSelectTag,
  size = 220,
}: D3TagDonutChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const prevAnglesRef = useRef<Record<string, { startAngle: number; endAngle: number }>>({});
  const [hoveredData, setHoveredData] = useState<TagSummaryMetric | null>(null);

  const visibleSummaries = (
    selectedTags.length > 0
      ? summaries.filter((s) => selectedTags.includes(s.tag))
      : summaries
  ).filter((s) => s.count > 0);

  const totalTasks = visibleSummaries.reduce((acc, s) => acc + s.count, 0);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const radius = size / 2;
    const innerRadius = radius * 0.58;
    const outerRadius = radius * 0.86;
    const hoverOuterRadius = radius * 0.94;

    svg
      .attr('width', size)
      .attr('height', size)
      .attr('viewBox', `0 0 ${size} ${size}`);

    let g = svg.select<SVGGElement>('g.donut-root');
    if (g.empty()) {
      g = svg.append('g').attr('class', 'donut-root');
    }
    g.attr('transform', `translate(${radius},${radius})`);

    const pie = d3
      .pie<TagSummaryMetric>()
      .value((d) => d.count)
      .sort((a, b) => b.count - a.count)
      .padAngle(0.03);

    const arc = d3
      .arc<d3.PieArcDatum<TagSummaryMetric>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .cornerRadius(4);

    const hoverArc = d3
      .arc<d3.PieArcDatum<TagSummaryMetric>>()
      .innerRadius(innerRadius)
      .outerRadius(hoverOuterRadius)
      .cornerRadius(4);

    const pieData = pie(visibleSummaries);
    const paths = g
      .selectAll<SVGPathElement, d3.PieArcDatum<TagSummaryMetric>>('path.donut-arc')
      .data(pieData, (d) => d.data.tag);

    paths
      .exit()
      .transition()
      .duration(450)
      .ease(d3.easeCubicInOut)
      .attr('opacity', 0)
      .remove();

    const pathsEnter = paths
      .enter()
      .append('path')
      .attr('class', 'donut-arc')
      .attr('fill', (d) => d.data.color)
      .attr('opacity', 0)
      .style('cursor', 'pointer');

    const pathsMerged = pathsEnter.merge(paths);

    pathsMerged
      .on('mouseover', function (_event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('d', hoverArc as any)
          .attr('opacity', 1);
        setHoveredData(d.data);
      })
      .on('mouseout', function (_event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('d', arc as any)
          .attr('opacity', selectedTag && selectedTag !== d.data.tag ? 0.35 : 0.92);
        setHoveredData(null);
      })
      .on('click', function (_event, d) {
        if (onSelectTag) {
          onSelectTag(selectedTag === d.data.tag ? null : d.data.tag);
        }
      });

    pathsMerged
      .transition()
      .duration(600)
      .ease(d3.easeCubicInOut)
      .attr('fill', (d) => d.data.color)
      .attr('opacity', (d) => (selectedTag && selectedTag !== d.data.tag ? 0.35 : 0.92))
      .attrTween('d', function (d) {
        const prev = prevAnglesRef.current[d.data.tag] || {
          startAngle: d.startAngle,
          endAngle: d.startAngle,
        };
        const interpolate = d3.interpolate(prev, {
          startAngle: d.startAngle,
          endAngle: d.endAngle,
        });
        prevAnglesRef.current[d.data.tag] = {
          startAngle: d.startAngle,
          endAngle: d.endAngle,
        };
        return function (t: number) {
          const angles = interpolate(t);
          return arc({ ...d, startAngle: angles.startAngle, endAngle: angles.endAngle }) || '';
        };
      });
  }, [visibleSummaries, selectedTag, size, onSelectTag]);

  const displayMetrics =
    hoveredData ||
    (selectedTag ? visibleSummaries.find((s) => s.tag === selectedTag) : null) ||
    visibleSummaries[0];

  const displayPct =
    displayMetrics && totalTasks > 0
      ? Math.round((displayMetrics.count / totalTasks) * 100)
      : displayMetrics?.percentage || 0;

  return (
    <div className="flex flex-col items-center justify-center relative select-none">
      <div className="relative" style={{ width: size, height: size }}>
        <svg ref={svgRef} className="overflow-visible" />

        {/* Center Callout Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-4">
          {displayMetrics ? (
            <div className="animate-in fade-in duration-200">
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
                {hoveredData ? 'Category' : selectedTag ? 'Selected' : 'Top Category'}
              </span>
              <span className="text-sm font-extrabold text-foreground block truncate max-w-[120px]">
                {displayMetrics.tag}
              </span>
              <span className="text-base font-black text-primary font-mono block">
                {displayPct}%
              </span>
              <span className="text-[10px] text-muted-foreground font-medium font-mono">
                {displayMetrics.count} tasks
              </span>
            </div>
          ) : (
            <div>
              <span className="text-xs font-bold text-foreground block">{totalTasks}</span>
              <span className="text-[10px] text-muted-foreground block">Total Tasks</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
