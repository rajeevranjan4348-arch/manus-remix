import React, { useEffect, useState, useMemo } from 'react';
import { 
  MessageSquarePlus, 
  Search, 
  Library, 
  Settings2,
  PanelLeft,
  MessageSquare,
  Clock,
  History as HistoryIcon,
  MoreHorizontal,
  Plus,
  Folder,
  Filter,
  Trash2,
  Copy,
  ExternalLink,
  X,
  Sparkles,
  Code,
  Globe,
  BarChart3,
  Database,
  Brain,
  Box,
  Zap,
  Layers,
  Edit3,
  FolderKanban,
  Check,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { useBlinkAuth } from '@blinkdotnew/react';
import { blink } from '@/lib/blink';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { renameConversation } from '@/lib/chatDatabase';
import { Project } from '@/types/project';
import { getProjects, deleteProject, addTaskToProject } from '@/lib/projectStore';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { ProjectViewModal } from '@/components/projects/ProjectViewModal';
import { SettingsModal } from '@/components/settings/SettingsModal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewTask?: () => void;
  activeTaskId?: string;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
}

interface TaskHistory {
  id: string;
  prompt: string;
  title?: string;
  created_at: string;
  status?: string;
  outputFormat?: string;
  projectId?: string;
}

const PROJECT_ICON_MAP: Record<string, any> = {
  folder: Folder,
  code: Code,
  sparkles: Sparkles,
  globe: Globe,
  'bar-chart': BarChart3,
  database: Database,
  brain: Brain,
  box: Box,
  zap: Zap,
  layers: Layers,
};

const PROJECT_COLOR_MAP: Record<string, { bg: string; text: string }> = {
  blue: { bg: 'bg-black/10 dark:bg-white/10 text-black dark:text-white', text: 'text-black dark:text-white' },
  indigo: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-500', text: 'text-indigo-500' },
  purple: { bg: 'bg-purple-500/10 dark:bg-purple-500/20 text-purple-500', text: 'text-purple-500' },
  emerald: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-500', text: 'text-emerald-500' },
  amber: { bg: 'bg-amber-500/10 dark:bg-amber-500/20 text-amber-500', text: 'text-amber-500' },
  rose: { bg: 'bg-rose-500/10 dark:bg-rose-500/20 text-rose-500', text: 'text-rose-500' },
  cyan: { bg: 'bg-cyan-500/10 dark:bg-cyan-500/20 text-cyan-500', text: 'text-cyan-500' },
};

function formatTaskTitle(task: TaskHistory): string {
  if (task.title && task.title.trim()) {
    return task.title.trim();
  }
  let text = task.prompt || 'Untitled session';
  text = text.replace(/^\[(?:Attached|Think Harder|MODE)[^\]]*\]\s*/gi, '');
  text = text.replace(/^#+\s*/, '');
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length > 46) {
    return firstLine.substring(0, 43) + '...';
  }
  return firstLine || 'Untitled session';
}

function getRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'Just now';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function groupTasksByTime(tasks: TaskHistory[]): { group: string; items: TaskHistory[] }[] {
  const groups: { [key: string]: TaskHistory[] } = {
    'Today': [],
    'Yesterday': [],
    'Previous 7 days': [],
    'Older': []
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysAgoStart = todayStart - 7 * 86400000;

  tasks.forEach((task) => {
    const time = new Date(task.created_at || Date.now()).getTime();
    if (time >= todayStart) {
      groups['Today'].push(task);
    } else if (time >= yesterdayStart) {
      groups['Yesterday'].push(task);
    } else if (time >= sevenDaysAgoStart) {
      groups['Previous 7 days'].push(task);
    } else {
      groups['Older'].push(task);
    }
  });

  return Object.entries(groups)
    .filter(([_, items]) => items.length > 0)
    .map(([group, items]) => ({ group, items }));
}

export function Sidebar({ isOpen, onToggle, onNewTask, activeTaskId, onOpenHistory, onOpenSettings }: SidebarProps) {
  const [activeTab, setActiveTab] = React.useState('new');
  const [tasks, setTasks] = useState<TaskHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<{ id: string; title: string } | null>(null);
  const [taskToRename, setTaskToRename] = useState<{ id: string; title: string } | null>(null);
  const [newChatTitle, setNewChatTitle] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [isRenamingTask, setIsRenamingTask] = useState(false);
  
  // Projects states
  const [projects, setProjects] = useState<Project[]>([]);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [selectedProjectView, setSelectedProjectView] = useState<Project | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);

  const { isAuthenticated, user } = useBlinkAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadTasks();
    loadProjects();
  }, [isAuthenticated, user, activeTaskId]);

  useEffect(() => {
    const handleProjectsUpdated = () => {
      loadProjects();
    };
    const handleOpenSettingsEvent = () => {
      setIsSettingsOpen(true);
    };
    const handleChatDbUpdated = () => {
      loadTasks();
    };
    window.addEventListener('manus_projects_updated', handleProjectsUpdated);
    window.addEventListener('manus_open_settings', handleOpenSettingsEvent);
    window.addEventListener('chat_db_updated', handleChatDbUpdated);
    window.addEventListener('manus_tasks_updated', handleChatDbUpdated);
    return () => {
      window.removeEventListener('manus_projects_updated', handleProjectsUpdated);
      window.removeEventListener('manus_open_settings', handleOpenSettingsEvent);
      window.removeEventListener('chat_db_updated', handleChatDbUpdated);
      window.removeEventListener('manus_tasks_updated', handleChatDbUpdated);
    };
  }, []);

  const loadProjects = () => {
    setProjects(getProjects());
  };

  const loadTasks = async () => {
    try {
      const result = await (blink.db as any).tasks.list({
        orderBy: { created_at: 'desc' },
        limit: 50
      });
      setTasks(result || []);
    } catch (error) {
      console.error('Failed to load tasks', error);
    }
  };

  const handleStartRename = (taskId: string, e: React.MouseEvent, currentTitle: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTaskToRename({ id: taskId, title: currentTitle });
    setNewChatTitle(currentTitle);
  };

  const confirmRenameTask = async () => {
    if (!taskToRename || !newChatTitle.trim()) return;
    setIsRenamingTask(true);
    try {
      await renameConversation(taskToRename.id, newChatTitle.trim());
      await (blink.db as any).tasks.update(taskToRename.id, { title: newChatTitle.trim() });
      setTasks(prev => prev.map(t => t.id === taskToRename.id ? { ...t, title: newChatTitle.trim() } : t));
      toast.success('Chat renamed successfully');
      setTaskToRename(null);
    } catch (error) {
      toast.error('Failed to rename chat');
    } finally {
      setIsRenamingTask(false);
    }
  };

  const handleDeleteTask = (taskId: string, e: React.MouseEvent, title?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const targetTask = tasks.find(t => t.id === taskId);
    setTaskToDelete({
      id: taskId,
      title: title || (targetTask ? formatTaskTitle(targetTask) : 'Chat session')
    });
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;

    setIsDeletingTask(true);
    try {
      await (blink.db as any).tasks.delete(taskToDelete.id);
      toast.success('Session deleted successfully');
      setTasks(prev => prev.filter(t => t.id !== taskToDelete.id));
      if (activeTaskId === taskToDelete.id) {
        navigate('/');
      }
      setTaskToDelete(null);
    } catch (error) {
      toast.error('Failed to delete session');
      console.error('Delete error:', error);
    } finally {
      setIsDeletingTask(false);
    }
  };

  const handleCopyTaskId = (taskId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(taskId);
    toast.success(`Task ID copied: ${taskId.slice(0, 10)}...`);
  };

  const handleAssignTaskToProject = async (taskId: string, projectId: string) => {
    try {
      await (blink.db as any).tasks.update(taskId, { projectId });
      addTaskToProject(projectId, taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, projectId } : t));
      toast.success('Task moved to project');
    } catch (err) {
      toast.error('Failed to assign task to project');
    }
  };

  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (activeProjectId) {
      const proj = projects.find(p => p.id === activeProjectId);
      list = list.filter(task => 
        task.projectId === activeProjectId || (proj?.taskIds && proj.taskIds.includes(task.id))
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(task => {
        const title = formatTaskTitle(task).toLowerCase();
        const prompt = (task.prompt || '').toLowerCase();
        const id = (task.id || '').toLowerCase();
        return title.includes(q) || prompt.includes(q) || id.includes(q);
      });
    }
    return list;
  }, [tasks, searchQuery, activeProjectId, projects]);

  const groupedTasks = useMemo(() => {
    return groupTasksByTime(filteredTasks);
  }, [filteredTasks]);

  const navItems = [
    { id: 'new', label: 'New Chat', icon: MessageSquarePlus, action: onNewTask },
    { 
      id: 'search', 
      label: 'Search', 
      icon: Search, 
      action: () => {
        if (!isOpen) onToggle();
        setIsSearchOpen(true);
      } 
    },
    { id: 'library', label: 'Library', icon: Library, action: onOpenHistory },
    { 
      id: 'settings', 
      label: 'Settings', 
      icon: Settings2,
      action: () => {
        if (onOpenSettings) onOpenSettings();
        else setIsSettingsOpen(true);
      }
    },
  ];

  const activeProject = useMemo(() => {
    return projects.find(p => p.id === activeProjectId);
  }, [projects, activeProjectId]);

  // Collapsed Sidebar (Icon Mode)
  if (!isOpen) {
    return (
      <aside className="w-16 h-screen border-r border-border/40 bg-manus-soft dark:bg-sidebar flex flex-col items-center py-6 hidden lg:flex shrink-0 transition-colors">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                onClick={onToggle}
                className="p-2 rounded-xl hover:bg-manus-cream dark:hover:bg-accent transition-all group relative mb-6 cursor-pointer"
                title="Open sidebar"
              >
                <div className="group-hover:opacity-0 transition-opacity">
                  <Logo size={24} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <PanelLeft size={24} />
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open sidebar</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Primary Navigation Icons */}
        <nav className="space-y-3 w-full flex flex-col items-center">
          {navItems.map((item) => (
            <TooltipProvider key={item.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => item.action ? item.action() : setActiveTab(item.id)}
                    className={cn(
                      "p-2.5 rounded-xl transition-all cursor-pointer",
                      activeTab === item.id && !item.action
                        ? "bg-white dark:bg-card border border-border text-foreground shadow-sm" 
                        : "text-muted-foreground hover:bg-manus-cream dark:hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <item.icon size={20} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </nav>

        {/* Quick Project Shortcuts in Collapsed View */}
        <div className="w-full pt-4 mt-4 border-t border-border/60 flex flex-col items-center space-y-2">
          {projects.slice(0, 4).map((proj) => {
            const IconComp = PROJECT_ICON_MAP[proj.icon] || Folder;
            const colorTheme = PROJECT_COLOR_MAP[proj.color] || PROJECT_COLOR_MAP.indigo;
            return (
              <TooltipProvider key={proj.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        onToggle();
                        setSelectedProjectView(proj);
                      }}
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105",
                        colorTheme.bg
                      )}
                    >
                      <IconComp size={16} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="font-bold text-xs">{proj.name}</p>
                    <p className="text-[10px] text-muted-foreground">{proj.description || 'Project'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>

        {/* Quick Recent Task Sessions in Collapsed View */}
        <div className="w-full flex-1 flex flex-col items-center pt-3 mt-2 border-t border-border/60 space-y-2 overflow-y-auto custom-scrollbar">
          {tasks.slice(0, 6).map((task) => {
            const title = formatTaskTitle(task);
            const isActive = activeTaskId === task.id;
            return (
              <TooltipProvider key={task.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(`/task/${task.id}`)}
                      className={cn(
                        "p-2.5 rounded-xl transition-all relative group cursor-pointer",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-manus-cream dark:hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <MessageSquare size={17} />
                      {isActive && (
                        <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-3.5 bg-primary rounded-r-full" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs p-2.5">
                    <p className="font-semibold text-xs text-foreground leading-tight">{title}</p>
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                      <span>{getRelativeTime(task.created_at)}</span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      </aside>
    );
  }

  // Expanded Sidebar
  return (
    <>
      {/* Mobile Backdrop */}
      <div 
        onClick={onToggle}
        className="fixed inset-0 bg-black/40 z-30 lg:hidden backdrop-blur-xs animate-in fade-in"
      />

      <aside className="w-64 h-screen border-r border-border/40 bg-manus-soft dark:bg-sidebar flex flex-col fixed inset-y-0 left-0 lg:static z-40 shrink-0 transition-colors shadow-xl lg:shadow-none">
        {/* Header with Logo and Close Toggle */}
        <div className="p-5 flex items-center justify-between">
          <button 
            onClick={() => {
              navigate('/');
              if (onNewTask) onNewTask();
            }}
            className="flex items-center gap-2 hover:opacity-75 transition-opacity cursor-pointer"
          >
            <Logo />
            <span className="font-serif text-xl font-bold tracking-tight text-foreground">Manus</span>
          </button>
          <button 
            onClick={onToggle}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-accent rounded-lg transition-colors cursor-pointer"
            title="Collapse sidebar"
          >
            <PanelLeft size={18} />
          </button>
        </div>

        {/* Primary Navigation */}
        <nav className="px-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => item.action ? item.action() : setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all font-medium text-sm cursor-pointer",
                activeTab === item.id && !item.action
                  ? "bg-white dark:bg-card border border-border text-foreground shadow-sm" 
                  : "text-muted-foreground hover:bg-manus-cream dark:hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* PROJECTS SECTION */}
        <div className="mt-5 px-3">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Projects ({projects.length})
            </h3>
            <button 
              onClick={() => {
                setProjectToEdit(null);
                setIsProjectModalOpen(true);
              }}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-accent transition-colors cursor-pointer"
              title="Create new project"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className={cn("space-y-1 overflow-y-auto pr-1 custom-scrollbar", showAllProjects ? "max-h-72" : "max-h-44")}>
            {projects.slice(0, showAllProjects ? projects.length : 4).map((proj) => {
              const IconComp = PROJECT_ICON_MAP[proj.icon] || Folder;
              const colorTheme = PROJECT_COLOR_MAP[proj.color] || PROJECT_COLOR_MAP.indigo;
              const isFiltered = activeProjectId === proj.id;
              const projTaskCount = tasks.filter(t => (t as any).projectId === proj.id || (proj.taskIds && proj.taskIds.includes(t.id))).length;

              return (
                <div key={proj.id} className="relative group">
                  <button
                    onClick={() => {
                      if (activeProjectId === proj.id) {
                        setActiveProjectId(null);
                      } else {
                        setActiveProjectId(proj.id);
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all text-left text-xs font-medium cursor-pointer",
                      isFiltered
                        ? "bg-primary/10 text-primary font-semibold border border-primary/30"
                        : "text-muted-foreground hover:bg-manus-cream dark:hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center shrink-0 font-semibold shadow-2xs", colorTheme.bg)}>
                      <IconComp size={13} />
                    </div>

                    <span className="truncate flex-1 pr-5">{proj.name}</span>

                    {projTaskCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-border/60 text-muted-foreground font-mono shrink-0">
                        {projTaskCount}
                      </span>
                    )}
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44 p-1">
                      <DropdownMenuItem
                        onClick={() => setSelectedProjectView(proj)}
                        className="flex items-center gap-2 cursor-pointer text-xs"
                      >
                        <FolderKanban size={13} />
                        <span>View Details</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setProjectToEdit(proj);
                          setIsProjectModalOpen(true);
                        }}
                        className="flex items-center gap-2 cursor-pointer text-xs"
                      >
                        <Edit3 size={13} />
                        <span>Edit Project</span>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={() => setProjectToDelete(proj)}
                        className="flex items-center gap-2 text-red-600 hover:text-red-700 cursor-pointer text-xs"
                      >
                        <Trash2 size={13} />
                        <span>Delete Project</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}

            <button
              onClick={() => {
                setProjectToEdit(null);
                setIsProjectModalOpen(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-xl hover:bg-manus-cream dark:hover:bg-accent font-medium"
            >
              <Plus size={14} className="text-primary" />
              <span>New project</span>
            </button>

            {projects.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllProjects((current) => !current)}
                className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-xl hover:bg-manus-cream dark:hover:bg-accent font-medium"
                aria-expanded={showAllProjects}
              >
                <span>{showAllProjects ? "Show less" : `Show more (${projects.length - 4})`}</span>
                <ChevronRight size={13} className={cn("transition-transform", showAllProjects && "rotate-90")} />
              </button>
            )}
          </div>
        </div>

        {/* All Tasks Section (Previous Sessions) */}
        <div className="mt-4 px-3 flex-1 overflow-hidden flex flex-col min-h-0 border-t border-border/50 pt-3">
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Previous Tasks
              </h3>
              {filteredTasks.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-border text-muted-foreground font-mono">
                  {filteredTasks.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {onOpenHistory && (
                <button 
                  onClick={onOpenHistory}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-accent transition-colors cursor-pointer"
                  title="Open full history panel"
                >
                  <HistoryIcon size={14} />
                </button>
              )}
              <button 
                onClick={() => setIsSearchOpen(!isSearchOpen)}
                className={cn(
                  "p-1 rounded-md transition-colors cursor-pointer",
                  isSearchOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-accent"
                )}
                title="Search task history"
              >
                <Search size={14} />
              </button>
            </div>
          </div>

          {/* Filter Banner if Project Filter is Active */}
          {activeProject && (
            <div className="px-2 mb-2">
              <div className="flex items-center justify-between px-2.5 py-1 rounded-xl bg-primary/10 border border-primary/20 text-xs font-medium text-primary">
                <span className="truncate">Filtered: {activeProject.name}</span>
                <button
                  onClick={() => setActiveProjectId(null)}
                  className="p-0.5 rounded-full hover:bg-primary/20 text-primary cursor-pointer"
                  title="Clear project filter"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}

          {/* Search Filter Input */}
          {isSearchOpen && (
            <div className="px-2 mb-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-card border border-border rounded-xl text-xs shadow-xs">
                <Search size={13} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter past tasks..."
                  className="w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/60 text-xs"
                  autoFocus
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="p-0.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full text-muted-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* Grouped Task List */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 pl-1 custom-scrollbar">
            {groupedTasks.map(({ group, items }) => (
              <div key={group} className="space-y-1">
                <div className="px-2 pt-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  {group}
                </div>
                
                {items.map((task) => {
                  const title = formatTaskTitle(task);
                  const isActive = activeTaskId === task.id;
                  const relTime = getRelativeTime(task.created_at);
                  const taskProj = projects.find(p => p.id === task.projectId);

                  return (
                    <div key={task.id} className="relative group">
                      <button
                        onClick={() => {
                          navigate(`/task/${task.id}`);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all text-left cursor-pointer",
                          isActive
                            ? "bg-white dark:bg-card border border-border text-foreground font-semibold shadow-xs" 
                            : "text-muted-foreground hover:bg-manus-cream dark:hover:bg-accent hover:text-foreground"
                        )}
                        title={task.prompt}
                      >
                        <MessageSquare size={15} className={cn(
                          "shrink-0 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )} />
                        
                        <div className="flex-1 min-w-0 pr-6">
                          <p className="truncate text-xs leading-snug">{title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-muted-foreground/70 leading-tight">
                              {relTime}
                            </span>
                            {taskProj && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/10 text-primary font-semibold truncate max-w-[90px]">
                                {taskProj.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      
                      {/* Action Dropdown Menu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              "absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 cursor-pointer",
                              isActive
                                ? "text-foreground hover:bg-slate-100 dark:hover:bg-white/10"
                                : "text-muted-foreground hover:bg-manus-cream dark:hover:bg-accent hover:text-foreground"
                            )}
                            title="Task options"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 p-1">
                          <DropdownMenuItem
                            onClick={() => navigate(`/task/${task.id}`)}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <ExternalLink size={13} />
                            <span>Open session</span>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={(e) => handleStartRename(task.id, e as any, formatTaskTitle(task))}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <Edit3 size={13} />
                            <span>Rename chat</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={(e) => handleCopyTaskId(task.id, e as any)}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <Copy size={13} />
                            <span>Copy Task ID</span>
                          </DropdownMenuItem>

                          {/* Move to Project Submenu */}
                          {projects.length > 0 && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger className="flex items-center gap-2 cursor-pointer text-xs">
                                <FolderKanban size={13} />
                                <span>Assign to Project</span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-44 p-1">
                                {projects.map((p) => (
                                  <DropdownMenuItem
                                    key={p.id}
                                    onClick={() => handleAssignTaskToProject(task.id, p.id)}
                                    className="flex items-center justify-between cursor-pointer text-xs"
                                  >
                                    <span className="truncate">{p.name}</span>
                                    {task.projectId === p.id && <Check size={12} className="text-primary" />}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )}

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={(e) => handleDeleteTask(task.id, e as any, formatTaskTitle(task))}
                            className="flex items-center gap-2 text-red-600 hover:text-red-700 cursor-pointer text-xs"
                          >
                            <Trash2 size={13} />
                            <span>Delete session</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            ))}
            
            {/* Empty States */}
            {tasks.length === 0 && (
              <div className="px-3 py-8 text-center space-y-2">
                <div className="w-9 h-9 rounded-full bg-border/50 text-muted-foreground flex items-center justify-center mx-auto">
                  <Clock size={16} />
                </div>
                <p className="text-xs text-muted-foreground font-medium">No past sessions yet</p>
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                  Start a chat or assign a task to build your history.
                </p>
              </div>
            )}

            {tasks.length > 0 && filteredTasks.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                No sessions match criteria
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Project Modal (Create / Edit) */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => {
          setIsProjectModalOpen(false);
          setProjectToEdit(null);
        }}
        projectToEdit={projectToEdit}
      />

      {/* Project View Modal */}
      <ProjectViewModal
        isOpen={!!selectedProjectView}
        onClose={() => setSelectedProjectView(null)}
        project={selectedProjectView}
        onEdit={(proj) => {
          setSelectedProjectView(null);
          setProjectToEdit(proj);
          setIsProjectModalOpen(true);
        }}
        onNewTaskInProject={(proj) => {
          setSelectedProjectView(null);
          if (onNewTask) onNewTask();
          navigate('/');
        }}
      />

      {/* Settings & Preferences Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Delete Session Confirmation Alert Dialog */}
      <AlertDialog 
        open={!!taskToDelete} 
        onOpenChange={(open) => {
          if (!open) {
            setTaskToDelete(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md rounded-2xl p-6 bg-card border border-border">
          <AlertDialogHeader>
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 mx-auto sm:mx-0 bg-destructive/10 text-destructive">
              <Trash2 size={22} />
            </div>
            <AlertDialogTitle className="text-base sm:text-lg font-bold text-foreground">
              Delete Chat Session?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-foreground">"{taskToDelete?.title}"</span>? This action cannot be undone and all data from this session will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
            <AlertDialogCancel 
              disabled={isDeletingTask}
              onClick={() => {
                setTaskToDelete(null);
              }}
              className="rounded-xl text-xs cursor-pointer border border-border hover:bg-muted"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingTask}
              onClick={confirmDeleteTask}
              className="rounded-xl text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer shadow-xs font-semibold"
            >
              {isDeletingTask ? 'Deleting...' : 'Delete Session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Project Confirmation Alert Dialog */}
      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent className="max-w-md rounded-2xl p-6 bg-card border border-border">
          <AlertDialogHeader>
            <div className="w-11 h-11 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mb-2 mx-auto sm:mx-0">
              <Trash2 size={22} />
            </div>
            <AlertDialogTitle className="text-base sm:text-lg font-bold text-foreground">
              Delete Project?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-foreground">"{projectToDelete?.name}"</span>? 
              This will remove the project configuration. Associated chat sessions will remain safe in your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
            <AlertDialogCancel 
              onClick={() => setProjectToDelete(null)}
              className="rounded-xl text-xs cursor-pointer border border-border hover:bg-muted"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (projectToDelete) {
                  deleteProject(projectToDelete.id);
                  toast.success('Project deleted');
                  if (activeProjectId === projectToDelete.id) setActiveProjectId(null);
                  setProjectToDelete(null);
                }
              }}
              className="rounded-xl text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer shadow-xs font-semibold"
            >
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
