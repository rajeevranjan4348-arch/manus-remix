import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { TagSummaryMetric } from '@/lib/tagAnalyticsService';
import { TaskTag } from '@/lib/taskTaggingService';

export interface D3TagBarChartProps {
  summaries: TagSummaryMetric[];
  selectedTags?: TaskTag[];
  spotlightTag?: TaskTag | null;
  onSelectTag?: (tag: TaskTag | null) => void;
  height?: number;
}

/**
 * D3TagBarChart
 *
 * Interactive D3 horizontal bar chart that visualizes tag category rankings and task counts.
 * Uses D3's keyed data join (.data(data, d => d.tag)) and cubic-in-out transitions so bars
 * smoothly resize (width) and reorder vertically (transform translateY) whenever the
 * time range filter or tag visibility selection changes.
 */
export function D3TagBarChart({
  summaries,
  selectedTags = [],
  spotlightTag = null,
  onSelectTag,
  height = 250,
}: D3TagBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const prevCountsRef = useRef<Record<string, { count: number; percentage: number }>>({});

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !summaries) return;

    const containerWidth = containerRef.current.clientWidth || 300;
    const margin = { top: 8, right: 78, bottom: 8, left: 92 };

    // Filter by visible tags if a filter is active, and sort descending by count
    // so D3 transitions smoothly reorder bars when rankings shift across time ranges
    const visibleSummaries = (
      selectedTags.length > 0
        ? summaries.filter((s) => selectedTags.includes(s.tag))
        : summaries
    )
      .slice()
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    const rowHeight = Math.max(32, Math.floor((height - margin.top - margin.bottom) / Math.max(1, visibleSummaries.length)));
    const dynamicHeight = Math.max(height, visibleSummaries.length * rowHeight + margin.top + margin.bottom);
    const innerWidth = Math.max(80, containerWidth - margin.left - margin.right);
    const innerHeight = dynamicHeight - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg
      .attr('width', containerWidth)
      .attr('height', dynamicHeight)
      .attr('viewBox', `0 0 ${containerWidth} ${dynamicHeight}`)
      .attr('style', 'max-width: 100%; height: auto; overflow: visible;');

    // Ensure persistent root group so updates animate in-place instead of recreating DOM
    let rootG = svg.select<SVGGElement>('g.bars-root');
    if (rootG.empty()) {
      rootG = svg
        .append('g')
        .attr('class', 'bars-root')
        .attr('transform', `translate(${margin.left},${margin.top})`);
    } else {
      rootG.attr('transform', `translate(${margin.left},${margin.top})`);
    }

    // Scales
    const maxCount = d3.max(visibleSummaries, (d) => d.count) || 1;
    const xScale = d3
      .scaleLinear()
      .domain([0, Math.max(1, maxCount)])
      .range([0, innerWidth]);

    const yScale = d3
      .scaleBand<string>()
      .domain(visibleSummaries.map((d) => d.tag))
      .range([0, innerHeight])
      .paddingInner(0.28)
      .paddingOuter(0.1);

    const barHeight = Math.min(20, Math.max(10, yScale.bandwidth()));

    // Shared D3 transition for smooth resizing and reordering
    const t = svg
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut) as any;

    // Keyed data join by tag name
    const rows = rootG
      .selectAll<SVGGElement, TagSummaryMetric>('g.tag-bar-row')
      .data(visibleSummaries, (d: TagSummaryMetric) => d.tag);

    // EXIT: smoothly collapse width and fade out hidden tags
    const rowsExit = rows.exit<TagSummaryMetric>();
    rowsExit
      .transition(t)
      .style('opacity', 0)
      .attr('transform', (d) => `translate(0,${innerHeight + 10})`)
      .remove();

    rowsExit
      .select('rect.bar-fill')
      .transition(t)
      .attr('width', 0);

    // ENTER: create new row groups
    const rowsEnter = rows
      .enter()
      .append('g')
      .attr('class', 'tag-bar-row')
      .attr('data-tag', (d) => d.tag)
      .attr('transform', (d) => `translate(0,${yScale(d.tag) ?? innerHeight})`)
      .style('opacity', 0)
      .style('cursor', 'pointer');

    // Background hover / spotlight pill
    rowsEnter
      .append('rect')
      .attr('class', 'row-highlight')
      .attr('x', -margin.left + 4)
      .attr('y', -4)
      .attr('width', containerWidth - 8)
      .attr('height', barHeight + 8)
      .attr('rx', 8)
      .attr('fill', 'currentColor')
      .attr('opacity', 0);

    // Category color dot
    rowsEnter
      .append('circle')
      .attr('class', 'tag-dot')
      .attr('cx', -margin.left + 14)
      .attr('cy', barHeight / 2)
      .attr('r', 4.5)
      .attr('fill', (d) => d.color);

    // Category label (left of bar)
    rowsEnter
      .append('text')
      .attr('class', 'tag-label')
      .attr('x', -margin.left + 25)
      .attr('y', barHeight / 2)
      .attr('dy', '0.35em')
      .attr('fill', 'currentColor')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text((d) => d.tag);

    // Track background bar
    rowsEnter
      .append('rect')
      .attr('class', 'bar-track')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', barHeight)
      .attr('rx', barHeight / 2)
      .attr('fill', 'currentColor')
      .attr('opacity', 0.08);

    // Animated foreground value bar (starts at width 0 on enter)
    rowsEnter
      .append('rect')
      .attr('class', 'bar-fill')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', 0)
      .attr('height', barHeight)
      .attr('rx', barHeight / 2)
      .attr('fill', (d) => d.color)
      .attr('opacity', 0.9);

    // Value & percentage text (right of bar)
    rowsEnter
      .append('text')
      .attr('class', 'bar-metric')
      .attr('x', innerWidth + 8)
      .attr('y', barHeight / 2)
      .attr('dy', '0.35em')
      .attr('fill', 'currentColor')
      .attr('font-size', '10.5px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace')
      .attr('font-weight', '700')
      .text((d) => `${d.count} (${d.percentage}%)`);

    // MERGE enter + update selections
    const rowsMerged = rowsEnter.merge(rows);

    // Interaction handlers
    rowsMerged
      .on('click', (_event, d) => {
        if (onSelectTag) {
          onSelectTag(spotlightTag === d.tag ? null : d.tag);
        }
      })
      .on('mouseenter', function (_event, d) {
        d3.select(this)
          .select('rect.row-highlight')
          .transition()
          .duration(150)
          .attr('opacity', spotlightTag === d.tag ? 0.1 : 0.05);
        d3.select(this)
          .select('rect.bar-fill')
          .transition()
          .duration(150)
          .attr('opacity', 1);
      })
      .on('mouseleave', function (_event, d) {
        const isDimmed = spotlightTag && spotlightTag !== d.tag;
        d3.select(this)
          .select('rect.row-highlight')
          .transition()
          .duration(150)
          .attr('opacity', spotlightTag === d.tag ? 0.08 : 0);
        d3.select(this)
          .select('rect.bar-fill')
          .transition()
          .duration(150)
          .attr('opacity', isDimmed ? 0.35 : 0.92);
      });

    // 1. Reorder transition: smoothly move each bar row to its new Y rank position
    rowsMerged
      .transition(t)
      .style('opacity', (d) => (spotlightTag && spotlightTag !== d.tag ? 0.45 : 1))
      .attr('transform', (d) => `translate(0,${yScale(d.tag) ?? 0})`);

    // Update row highlight geometry
    rowsMerged
      .select('rect.row-highlight')
      .attr('x', -margin.left + 4)
      .attr('width', containerWidth - 8)
      .attr('height', barHeight + 8)
      .attr('opacity', (d) => (spotlightTag === d.tag ? 0.08 : 0));

    // Update dot & label vertical centering
    rowsMerged
      .select('circle.tag-dot')
      .transition(t)
      .attr('cy', barHeight / 2)
      .attr('fill', (d) => d.color);

    rowsMerged
      .select('text.tag-label')
      .transition(t)
      .attr('y', barHeight / 2);

    // Update track bar geometry
    rowsMerged
      .select('rect.bar-track')
      .transition(t)
      .attr('width', innerWidth)
      .attr('height', barHeight)
      .attr('rx', barHeight / 2);

    // 2. Resize transition: smoothly animate bar width & height
    rowsMerged
      .select('rect.bar-fill')
      .transition(t)
      .attr('height', barHeight)
      .attr('rx', barHeight / 2)
      .attr('fill', (d) => d.color)
      .attr('opacity', (d) => (spotlightTag && spotlightTag !== d.tag ? 0.35 : 0.92))
      .attr('width', (d) => ( d.count > 0 ? Math.max(6, xScale(d.count)) : 0 ));

    // 3. Smoothly interpolate numeric count and percentage labels during transition
    rowsMerged
      .select<SVGTextElement>('text.bar-metric')
      .transition(t)
      .attr('x', innerWidth + 8)
      .attr('y', barHeight / 2)
      .tween('text', function (d) {
        const prev = prevCountsRef.current[d.tag] || { count: 0, percentage: 0 };
        const iCount = d3.interpolateNumber(prev.count, d.count);
        const iPct = d3.interpolateNumber(prev.percentage, d.percentage);
        prevCountsRef.current[d.tag] = { count: d.count, percentage: d.percentage };
        return function (progress: number) {
          this.textContent = `${Math.round(iCount(progress))} (${Math.round(iPct(progress))}%)`;
        };
      });
  }, [summaries, selectedTags, spotlightTag, height, onSelectTag]);

  return (
    <div ref={containerRef} className="w-full select-none overflow-hidden" data-testid="d3-tag-bar-chart">
      <svg ref={svgRef} className="w-full text-foreground overflow-visible" />
    </div>
  );
}
