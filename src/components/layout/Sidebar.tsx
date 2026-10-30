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
  ChartBar as BarChart3,
  Database,
  Brain,
  Box,
  Zap,
  Layers,
  Edit3,
  FolderKanban,
  Check,
  ChevronRight,
  Plug,
  Cloud,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { ConnectorsStorePanel } from '../connectors/ConnectorsStorePanel';
import { cn } from '@/lib/utils';
import { Logo, ManusLogo } from './Logo';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { useBlinkAuth } from '@blinkdotnew/react';
import { useFirebase } from '@/context/FirebaseContext';
import { blink } from '@/lib/blink';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { renameConversation } from '@/lib/chatDatabase';
import { Project } from '@/types/project';
import { getProjects, deleteProject, addTaskToProject } from '@/lib/projectStore';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { ProjectViewModal } from '@/components/projects/ProjectViewModal';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { TagAnalyticsModal } from '@/components/analytics/TagAnalyticsModal';
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
  blue: { bg: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]', text: 'text-[#000000] dark:text-[#FFFFFF]' },
  indigo: { bg: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]', text: 'text-[#000000] dark:text-[#FFFFFF]' },
  purple: { bg: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]', text: 'text-[#000000] dark:text-[#FFFFFF]' },
  emerald: { bg: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]', text: 'text-[#000000] dark:text-[#FFFFFF]' },
  amber: { bg: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]', text: 'text-[#000000] dark:text-[#FFFFFF]' },
  rose: { bg: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]', text: 'text-[#000000] dark:text-[#FFFFFF]' },
  cyan: { bg: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]', text: 'text-[#000000] dark:text-[#FFFFFF]' },
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

export const Sidebar = React.memo(function Sidebar({ isOpen, onToggle, onNewTask, activeTaskId, onOpenHistory, onOpenSettings }: SidebarProps) {
  const [activeTab, setActiveTab] = React.useState('new');
  const [tasks, setTasks] = useState<TaskHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConnectorsOpen, setIsConnectorsOpen] = useState(false);
  const [isTagAnalyticsOpen, setIsTagAnalyticsOpen] = useState(false);
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
  const { user: fbUser, signInWithGoogle, signOut: fbSignOut } = useFirebase();
  const navigate = useNavigate();

  useEffect(() => {
    loadTasks();
    loadProjects();
  }, [isAuthenticated, user, fbUser, activeTaskId]);

  useEffect(() => {
    const handleProjectsUpdated = () => {
      loadProjects();
    };
    const handleChatDbUpdated = () => {
      loadTasks();
    };
    window.addEventListener('manus_projects_updated', handleProjectsUpdated);
    window.addEventListener('chat_db_updated', handleChatDbUpdated);
    window.addEventListener('manus_tasks_updated', handleChatDbUpdated);
    return () => {
      window.removeEventListener('manus_projects_updated', handleProjectsUpdated);
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
      id: 'my-ai', 
      label: 'My AI Chat', 
      icon: MessageSquare, 
      action: () => navigate('/chat') 
    },
    { 
      id: 'connectors', 
      label: 'Connectors & Plugins', 
      icon: Plug, 
      action: () => setIsConnectorsOpen(true) 
    },
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
      id: 'analytics',
      label: 'Tag Analytics',
      icon: BarChart3,
      action: () => setIsTagAnalyticsOpen(true)
    },
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

  const handleMobileSelect = (action?: () => void) => {
    if (action) action();
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onToggle();
    }
  };

  // Collapsed Sidebar (Icon Mode)
  if (!isOpen) {
    return (
      <aside className="w-16 h-screen border-r border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF] dark:bg-[#111111] flex flex-col items-center py-6 hidden lg:flex shrink-0 transition-colors">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                onClick={onToggle}
                className="p-2 rounded-xl hover:bg-[#F2F2F2] dark:hover:bg-[#171717] transition-all duration-200 group relative mb-6 cursor-pointer hover:scale-105 hover:shadow-xs active:scale-95 smooth-press"
                title="Open sidebar"
              >
                <div className="group-hover:opacity-0 transition-opacity">
                  <Logo size={26} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <PanelLeft size={26} strokeWidth={2.4} />
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
                      "p-2.5 rounded-xl transition-all duration-200 cursor-pointer hover:scale-105 hover:shadow-xs active:scale-95",
                      item.id === 'new'
                        ? "bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] shadow-sm"
                        : activeTab === item.id && !item.action
                          ? "bg-[#F2F2F2] dark:bg-[#171717] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF] shadow-sm" 
                          : "text-[#777777] dark:text-[#AAAAAA] hover:bg-[#F2F2F2] dark:hover:bg-[#171717] hover:text-[#000000] dark:hover:text-[#FFFFFF]"
                    )}
                  >
                    <item.icon size={23} strokeWidth={2.5} />
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
                      <IconComp size={18} strokeWidth={2.4} />
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
                      <MessageSquare size={19} strokeWidth={2.4} />
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

        {/* Firebase Cloud Sync Icon in Collapsed View */}
        <div className="mt-auto mb-2 flex flex-col items-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={fbUser ? () => fbSignOut() : () => signInWithGoogle()}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer bg-white/80 dark:bg-card border border-border/80 hover:border-foreground/30 shadow-xs"
                >
                  {fbUser ? (
                    fbUser.photoURL ? (
                      <img src={fbUser.photoURL} alt="" className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs">
                        {(fbUser.displayName || fbUser.email || 'U')[0].toUpperCase()}
                      </div>
                    )
                  ) : (
                    <Cloud size={18} className="text-muted-foreground hover:text-foreground" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {fbUser ? `${fbUser.displayName || fbUser.email} (Click to sign out)` : 'Sign in with Google (Firebase)'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <TagAnalyticsModal
          isOpen={isTagAnalyticsOpen}
          onClose={() => setIsTagAnalyticsOpen(false)}
        />
      </aside>
    );
  }

  // Expanded Sidebar
  return (
    <>
      {/* Mobile Backdrop */}
      <div 
        onClick={onToggle}
        className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-xs transition-opacity duration-250 ease-out animate-in fade-in"
      />

      <aside className="w-[82vw] max-w-[280px] sm:w-64 h-screen border-r border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF] dark:bg-[#111111] flex flex-col fixed inset-y-0 left-0 lg:static z-50 shrink-0 transition-[transform,width,colors] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-2xl lg:shadow-none animate-in slide-in-from-left gpu-accelerated">
        {/* Header with Logo and Close Toggle */}
        <div className="p-4 sm:p-5 flex items-center justify-between">
          <ManusLogo showBadge={true} />
          <button 
            onClick={onToggle}
            className="p-2 text-[#777777] dark:text-[#AAAAAA] hover:text-[#000000] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#171717] rounded-lg transition-all duration-200 cursor-pointer hover:scale-105 hover:shadow-xs active:scale-95 smooth-press"
            title="Collapse sidebar"
          >
            <PanelLeft size={21} strokeWidth={2.4} />
          </button>
        </div>

        {/* Primary Navigation */}
        <nav className="px-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleMobileSelect(() => item.action ? item.action() : setActiveTab(item.id))}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 font-medium text-sm cursor-pointer hover:scale-[1.02] hover:shadow-xs active:scale-[0.98]",
                item.id === 'new'
                  ? "bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] font-semibold shadow-sm"
                  : activeTab === item.id && !item.action
                    ? "bg-[#F2F2F2] dark:bg-[#171717] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF] shadow-sm" 
                    : "text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#171717]"
              )}
            >
              <item.icon
                size={21}
                strokeWidth={2.4}
                className={cn(
                  item.id === 'new'
                    ? "text-[#FFFFFF] dark:text-[#000000]"
                    : activeTab === item.id && !item.action
                      ? "text-[#000000] dark:text-[#FFFFFF]"
                      : "text-[#777777] dark:text-[#AAAAAA]"
                )}
              />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* PROJECTS SECTION */}
        <div className="mt-5 px-3">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <button
              type="button"
              onClick={() => setShowAllProjects((current) => !current)}
              aria-expanded={showAllProjects}
              aria-label={showAllProjects ? "Show less projects" : "Show all projects"}
              className="flex items-center gap-2 text-left rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Folder size={20} strokeWidth={2.4} />
              <h3 className="text-sm font-semibold tracking-wide">Projects</h3>
              <ChevronRight size={16} strokeWidth={2.4} className={cn("transition-transform", showAllProjects && "rotate-90")} />
            </button>
            <button 
              onClick={() => {
                setProjectToEdit(null);
                setIsProjectModalOpen(true);
              }}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-accent transition-all duration-200 cursor-pointer hover:scale-110 hover:shadow-2xs active:scale-95"
              title="Create new project"
            >
              <Plus size={16} strokeWidth={2.4} />
            </button>
          </div>

          {showAllProjects && (
          <div className="space-y-1 overflow-y-auto pr-1 custom-scrollbar max-h-72">
            {projects.map((proj) => {
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
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all duration-150 text-left text-xs font-medium cursor-pointer hover:scale-[1.01] hover:shadow-2xs active:scale-[0.99]",
                      isFiltered
                        ? "bg-primary/10 text-primary font-semibold border border-primary/30"
                        : "text-muted-foreground hover:bg-manus-cream dark:hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center shrink-0 font-semibold shadow-2xs", colorTheme.bg)}>
                      <IconComp size={15} strokeWidth={2.4} />
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
                        <MoreHorizontal size={15} strokeWidth={2.4} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44 p-1">
                      <DropdownMenuItem
                        onClick={() => setSelectedProjectView(proj)}
                        className="flex items-center gap-2 cursor-pointer text-xs"
                      >
                        <FolderKanban size={15} strokeWidth={2.4} />
                        <span>View Details</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setProjectToEdit(proj);
                          setIsProjectModalOpen(true);
                        }}
                        className="flex items-center gap-2 cursor-pointer text-xs"
                      >
                        <Edit3 size={15} strokeWidth={2.4} />
                        <span>Edit Project</span>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={() => setProjectToDelete(proj)}
                        className="flex items-center gap-2 text-red-600 hover:text-red-700 cursor-pointer text-xs"
                      >
                        <Trash2 size={15} strokeWidth={2.4} />
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
              <Plus size={16} strokeWidth={2.4} className="text-primary" />
              <span>New project</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAllProjects(false)}
              className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-xl hover:bg-manus-cream dark:hover:bg-accent font-medium"
            >
              <span>Show less</span>
              <ChevronRight size={15} strokeWidth={2.4} className="-rotate-90" />
            </button>
          </div>
          )}
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
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-accent transition-all duration-200 cursor-pointer hover:scale-110 hover:shadow-2xs active:scale-95"
                  title="Open full history panel"
                >
                  <HistoryIcon size={16} strokeWidth={2.4} />
                </button>
              )}
              <button 
                onClick={() => setIsSearchOpen(!isSearchOpen)}
                className={cn(
                  "p-1 rounded-md transition-all duration-200 cursor-pointer hover:scale-110 hover:shadow-2xs active:scale-95",
                  isSearchOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-accent"
                )}
                title="Search task history"
              >
                <Search size={16} strokeWidth={2.4} />
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
                  <X size={14} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          )}

          {/* Search Filter Input */}
          {isSearchOpen && (
            <div className="px-2 mb-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-card border border-border rounded-xl text-xs shadow-xs">
                <Search size={15} strokeWidth={2.4} className="text-muted-foreground shrink-0" />
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
                    <X size={14} strokeWidth={2.4} />
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
                          handleMobileSelect(() => navigate(`/task/${task.id}`));
                        }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all text-left cursor-pointer",
                          isActive
                            ? "bg-[#F2F2F2] dark:bg-[#171717] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF] font-semibold shadow-xs" 
                            : "text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#171717]"
                        )}
                        title={task.prompt}
                      >
                        <MessageSquare size={17} strokeWidth={2.3} className={cn(
                          "shrink-0 transition-colors",
                          isActive ? "text-[#000000] dark:text-[#FFFFFF]" : "text-[#777777] dark:text-[#AAAAAA] group-hover:text-[#000000] dark:group-hover:text-[#FFFFFF]"
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
                            <MoreHorizontal size={16} strokeWidth={2.4} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 p-1">
                          <DropdownMenuItem
                            onClick={() => navigate(`/task/${task.id}`)}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <ExternalLink size={15} strokeWidth={2.4} />
                            <span>Open session</span>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={(e) => handleStartRename(task.id, e as any, formatTaskTitle(task))}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <Edit3 size={15} strokeWidth={2.4} />
                            <span>Rename chat</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={(e) => handleCopyTaskId(task.id, e as any)}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <Copy size={15} strokeWidth={2.4} />
                            <span>Copy Task ID</span>
                          </DropdownMenuItem>

                          {/* Move to Project Submenu */}
                          {projects.length > 0 && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger className="flex items-center gap-2 cursor-pointer text-xs">
                                <FolderKanban size={15} strokeWidth={2.4} />
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
                                    {task.projectId === p.id && <Check size={14} strokeWidth={2.5} className="text-primary" />}
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
                            <Trash2 size={15} strokeWidth={2.4} />
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

        {/* Firebase Cloud Sync & User Profile Footer */}
        <div className="p-3 border-t border-border/40 bg-card/30 mt-auto">
          {fbUser ? (
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-card border border-border/60 shadow-2xs">
              <div className="flex items-center gap-2 min-w-0">
                {fbUser.photoURL ? (
                  <img src={fbUser.photoURL} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-border" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                    {(fbUser.displayName || fbUser.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{fbUser.displayName || 'Firebase User'}</p>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    <Cloud size={11} className="shrink-0 animate-pulse" />
                    <span className="truncate">Cloud Synced</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => fbSignOut()}
                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer shrink-0"
                title="Sign out of Firebase"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => signInWithGoogle()}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-foreground text-background font-medium text-xs shadow-xs hover:opacity-90 transition-all cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Sign in with Google</span>
            </button>
          )}
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

      {/* Settings & Preferences Modal (fallback when onOpenSettings prop is not used) */}
      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Rename Session Alert Dialog */}
      <AlertDialog
        open={!!taskToRename}
        onOpenChange={(open) => {
          if (!open) {
            setTaskToRename(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md rounded-2xl p-6 bg-card border border-border">
          <AlertDialogHeader>
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 mx-auto sm:mx-0 bg-primary/10 text-primary">
              <Edit3 size={20} />
            </div>
            <AlertDialogTitle className="text-base sm:text-lg font-bold text-foreground">
              Rename Chat Session
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Enter a new title for this conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-2">
            <input
              type="text"
              value={newChatTitle}
              onChange={(e) => setNewChatTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmRenameTask();
                }
              }}
              placeholder="Conversation title..."
              autoFocus
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary/40"
            />
          </div>
          <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
            <AlertDialogCancel
              disabled={isRenamingTask}
              onClick={() => setTaskToRename(null)}
              className="rounded-xl text-xs cursor-pointer border border-border hover:bg-muted"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRenamingTask || !newChatTitle.trim()}
              onClick={confirmRenameTask}
              className="rounded-xl text-xs bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-xs font-semibold"
            >
              {isRenamingTask ? 'Saving...' : 'Save'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
      {/* Connectors & Plugins Store Panel */}
      <ConnectorsStorePanel
        isOpen={isConnectorsOpen}
        onClose={() => setIsConnectorsOpen(false)}
      />
      {/* D3 Tag Analytics Dashboard Modal */}
      <TagAnalyticsModal
        isOpen={isTagAnalyticsOpen}
        onClose={() => setIsTagAnalyticsOpen(false)}
      />
    </>
  );
});
