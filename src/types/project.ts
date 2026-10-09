export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  customInstructions?: string;
  created_at: string;
  updated_at: string;
  taskIds?: string[];
}

export type ProjectIconType = 'folder' | 'code' | 'sparkles' | 'globe' | 'bar-chart' | 'database' | 'brain' | 'box' | 'zap' | 'cpu' | 'layers';
export type ProjectColorType = 'blue' | 'emerald' | 'purple' | 'amber' | 'rose' | 'cyan' | 'indigo' | 'slate';
