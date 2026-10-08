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
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useBlinkAuth } from '@blinkdotnew/react';
import { blink } from '@/lib/blink';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewTask?: () => void;
  activeTaskId?: string;
  onOpenHistory?: () => void;
}

interface TaskHistory {
  id: string;
  prompt: string;
  title?: string;
  created_at: string;
  status?: string;
  outputFormat?: string;
}

function formatTaskTitle(task: TaskHistory): string {
  if (task.title && task.title.trim()) {
    return task.title.trim();
  }
  let text = task.prompt || 'Untitled session';
  // Strip metadata tags like [Attached: ...] or [Think Harder ...]
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

export function Sidebar({ isOpen, onToggle, onNewTask, activeTaskId, onOpenHistory }: SidebarProps) {
  const [activeTab, setActiveTab] = React.useState('new');
  const [tasks, setTasks] = useState<TaskHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { isAuthenticated, user } = useBlinkAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadTasks();
  }, [isAuthenticated, user, activeTaskId]);

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

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const toastId = toast.loading('Deleting task...');
    
    try {
      await (blink.db as any).tasks.delete(taskId);
      toast.dismiss(toastId);
      toast.success('Task deleted');
      
      setTasks(prev => prev.filter(t => t.id !== taskId));
      
      if (activeTaskId === taskId) {
        navigate('/');
      }
    } catch (error) {
      toast.dismiss(toastId);
      toast.error('Failed to delete task');
      console.error('Delete error:', error);
    }
  };

  const handleCopyTaskId = (taskId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(taskId);
    toast.success(`Task ID copied: ${taskId.slice(0, 10)}...`);
  };

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase().trim();
    return tasks.filter(task => {
      const title = formatTaskTitle(task).toLowerCase();
      const prompt = (task.prompt || '').toLowerCase();
      const id = (task.id || '').toLowerCase();
      return title.includes(q) || prompt.includes(q) || id.includes(q);
    });
  }, [tasks, searchQuery]);

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
    { id: 'library', label: 'History & Library', icon: Library, action: onOpenHistory },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  // Collapsed Sidebar (Icon Mode)
  if (!isOpen) {
    return (
      <aside className="w-16 h-screen border-r border-border bg-manus-soft dark:bg-sidebar flex flex-col items-center py-6 hidden lg:flex shrink-0 transition-colors">
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

        {/* Quick Recent Task Sessions in Collapsed View */}
        <div className="w-full flex-1 flex flex-col items-center pt-5 mt-4 border-t border-border/60 space-y-2 overflow-y-auto custom-scrollbar">
          {tasks.slice(0, 8).map((task) => {
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
                      <span>•</span>
                      <span className="font-mono text-[9px] opacity-75">{task.id.slice(0, 8)}...</span>
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

      <aside className="w-64 h-screen border-r border-border bg-manus-soft dark:bg-sidebar flex flex-col fixed inset-y-0 left-0 lg:static z-40 shrink-0 transition-colors shadow-xl lg:shadow-none">
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

        {/* Projects Section */}
        <div className="mt-6 px-5">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Projects</h3>
            <button className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-manus-cream dark:hover:bg-accent transition-colors cursor-pointer">
              <Plus size={14} />
            </button>
          </div>
          <button className="w-full flex items-center gap-2.5 text-muted-foreground hover:text-foreground py-1.5 text-sm transition-colors cursor-pointer rounded-lg px-1 hover:bg-manus-cream dark:hover:bg-accent">
            <Folder size={15} />
            <span>New project</span>
          </button>
        </div>

        {/* All Tasks Section (Previous Sessions) */}
        <div className="mt-5 px-3 flex-1 overflow-hidden flex flex-col min-h-0 border-t border-border/50 pt-4">
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Previous Tasks
              </h3>
              {tasks.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-border text-muted-foreground font-mono">
                  {tasks.length}
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
                          <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">
                            {relTime}
                          </p>
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
                        <DropdownMenuContent align="end" className="w-44 p-1">
                          <DropdownMenuItem
                            onClick={() => navigate(`/task/${task.id}`)}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <ExternalLink size={13} />
                            <span>Open session</span>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={(e) => handleCopyTaskId(task.id, e as any)}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <Copy size={13} />
                            <span>Copy Task ID</span>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={(e) => handleDeleteTask(task.id, e as any)}
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
                No sessions match "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
