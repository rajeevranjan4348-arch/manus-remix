import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getHomeActionDefaults } from '../src/lib/homeActionDefaults';

describe('home quick action defaults', () => {
  it('selects website output without retaining a chart', () => {
    expect(getHomeActionDefaults('Build website')).toEqual({ format: 'website', chartType: null });
  });

  it('selects graph output and a default bar chart for analysis', () => {
    expect(getHomeActionDefaults('Data analysis')).toEqual({ format: 'graph', chartType: 'bar' });
  });

  it('clears previous output and chart settings for research and other actions', () => {
    expect(getHomeActionDefaults('Research link')).toEqual({ format: null, chartType: null });
    expect(getHomeActionDefaults('Other action')).toEqual({ format: null, chartType: null });
  });

  it('applies both defaults when the quick action is clicked', () => {
    const home = readFileSync(resolve(process.cwd(), 'src/pages/Home.tsx'), 'utf8');
    expect(home).toContain('const defaults = getHomeActionDefaults(chip.label)');
    expect(home).toContain('setSelectedFormat(defaults.format)');
    expect(home).toContain('setSelectedChart(defaults.chartType)');
  });
});
