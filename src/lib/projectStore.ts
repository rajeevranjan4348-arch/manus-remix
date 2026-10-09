import { Project } from '@/types/project';

const PROJECTS_STORAGE_KEY = 'manus_agent_projects';

// Default initial sample projects
const DEFAULT_PROJECTS: Project[] = [
  {
    id: 'proj_web_apps',
    name: 'Web Applications',
    description: 'Build, design, and deploy fullstack web apps and components.',
    icon: 'code',
    color: 'indigo',
    customInstructions: 'Focus on clean modular code structure, responsive UI, and production readiness.',
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    taskIds: []
  },
  {
    id: 'proj_data_analytics',
    name: 'Data Analytics & Insights',
    description: 'Analyze datasets, process financial reports, and build interactive charts.',
    icon: 'bar-chart',
    color: 'emerald',
    customInstructions: 'Provide key statistical summary, variance analysis, and clear recommendations.',
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    taskIds: []
  },
  {
    id: 'proj_ai_research',
    name: 'Market & AI Research',
    description: 'Deep web research, competitor benchmarks, and automated synthesis.',
    icon: 'sparkles',
    color: 'purple',
    customInstructions: 'Structure responses with Executive Summary, Key Takeaways, and Bullet Points.',
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    taskIds: []
  }
];

export function getProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(DEFAULT_PROJECTS));
      return DEFAULT_PROJECTS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PROJECTS;
  } catch (e) {
    console.error('Failed to load projects:', e);
    return DEFAULT_PROJECTS;
  }
}

export function saveProjects(projects: Project[]): void {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    window.dispatchEvent(new CustomEvent('manus_projects_updated'));
  } catch (e) {
    console.error('Failed to save projects:', e);
  }
}

export function getProject(id: string): Project | undefined {
  const projects = getProjects();
  return projects.find(p => p.id === id);
}

export function createProject(data: Partial<Project> & { name: string }): Project {
  const projects = getProjects();
  const newProject: Project = {
    id: 'proj_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
    name: data.name,
    description: data.description || '',
    icon: data.icon || 'folder',
    color: data.color || 'blue',
    customInstructions: data.customInstructions || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    taskIds: data.taskIds || []
  };

  projects.unshift(newProject);
  saveProjects(projects);
  return newProject;
}

export function updateProject(id: string, updates: Partial<Project>): Project | null {
  const projects = getProjects();
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) return null;

  projects[index] = {
    ...projects[index],
    ...updates,
    updated_at: new Date().toISOString()
  };

  saveProjects(projects);
  return projects[index];
}

export function deleteProject(id: string): boolean {
  let projects = getProjects();
  const initialLength = projects.length;
  projects = projects.filter(p => p.id !== id);
  
  if (projects.length !== initialLength) {
    saveProjects(projects);
    return true;
  }
  return false;
}

export function addTaskToProject(projectId: string, taskId: string): void {
  const projects = getProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return;

  if (!project.taskIds) project.taskIds = [];
  if (!project.taskIds.includes(taskId)) {
    project.taskIds.push(taskId);
    project.updated_at = new Date().toISOString();
    saveProjects(projects);
  }
}

export function removeTaskFromProject(projectId: string, taskId: string): void {
  const projects = getProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project || !project.taskIds) return;

  project.taskIds = project.taskIds.filter(id => id !== taskId);
  project.updated_at = new Date().toISOString();
  saveProjects(projects);
}
