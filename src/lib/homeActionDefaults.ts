export interface HomeActionDefaults {
  format: string | null;
  chartType: string | null;
}

/** Each quick action starts with its own output settings, not a previous action's. */
export function getHomeActionDefaults(label: string): HomeActionDefaults {
  if (label === 'Build website') return { format: 'website', chartType: null };
  if (label === 'Data analysis') return { format: 'graph', chartType: 'bar' };
  if (label === 'Write for me') return { format: 'chat', chartType: null };
  return { format: null, chartType: null };
}
