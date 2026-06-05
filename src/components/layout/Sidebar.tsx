import React from 'react';
import { 
  MessageSquarePlus, 
  Search, 
  Library, 
  Settings2,
  PanelLeft,
  MessageSquare,
  Clock,
  MoreHorizontal,
  Plus,
  Folder,
  Filter,
  Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useEffect, useState } from 'react';
import { useBlinkAuth } from '@blinkdotnew/react';
import { blink } from '@/lib/blink';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewTask?: () => void;
  activeTaskId?: string;
}

interface TaskHistory {
  id: string;
  prompt: string;
  created_at: string;
}

export function Sidebar({ isOpen, onToggle, onNewTask, activeTaskId }: SidebarProps) {
  const [activeTab, setActiveTab] = React.useState('new');
  const [tasks, setTasks] = useState<TaskHistory[]>([]);
  const { isAuthenticated, user } = useBlinkAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && user) {
      loadTasks();
    }
  }, [isAuthenticated, user, activeTaskId]); // Refetch when active task changes (e.g. new task created)

  const loadTasks = async () => {
    try {
      // Use blink.db.tasks to fetch history
      const result = await (blink.db as any).tasks.list({
        where: { userId: user?.id },
        orderBy: { created_at: 'desc' },
        limit: 20
      });
      setTasks(result);
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
      
      // Refresh task list
      setTasks(prev => prev.filter(t => t.id !== taskId));
      
      // If deleting the active task, navigate away
      if (activeTaskId === taskId) {
        navigate('/');
      }
    } catch (error) {
      toast.dismiss(toastId);
      toast.error('Failed to delete task');
      console.error('Delete error:', error);
    }
  };

  const navItems = [
    { id: 'new', label: 'New Chat', icon: MessageSquarePlus, action: onNewTask },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'library', label: 'Library', icon: Library },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  if (!isOpen) {
    return (
      <aside className="w-16 h-screen border-r border-border bg-manus-soft flex flex-col items-center py-6 hidden lg:flex">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                onClick={onToggle}
                className="p-2 rounded-xl hover:bg-manus-cream transition-all group relative mb-6"
                title="Click to open sidebar, or navigate to home"
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

        <nav className="flex-1 space-y-4 w-full flex flex-col items-center">
          {navItems.map((item) => (
            <TooltipProvider key={item.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => item.action ? item.action() : setActiveTab(item.id)}
                    className={cn(
                      "p-2.5 rounded-xl transition-all",
                      activeTab === item.id && !item.action
                        ? "bg-white border border-border text-foreground shadow-sm" 
                        : "text-muted-foreground hover:bg-manus-cream hover:text-foreground"
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
      </aside>
    );
  }

  return (
    <aside className="w-64 h-screen border-r border-border bg-manus-soft flex flex-col hidden lg:flex">
      <div className="p-6 flex items-center justify-between">
        <button 
          onClick={() => navigate('/')}
          className="flex items-center gap-2 hover:opacity-75 transition-opacity cursor-pointer"
        >
          <Logo />
          <span className="font-serif text-xl font-bold tracking-tight">Manus</span>
        </button>
        <button 
          onClick={onToggle}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-manus-cream rounded-lg transition-colors"
        >
          <PanelLeft size={20} />
        </button>
      </div>

      <div className="px-4 mb-2"></div>

      <nav className="px-3 mt-2 space-y-1">
        {navItems.map((item) => (
          <div key={item.id} className="space-y-1">
            <button
              onClick={() => item.action ? item.action() : setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all font-medium",
                activeTab === item.id && !item.action
                  ? "bg-white border border-border text-foreground shadow-sm" 
                  : "text-muted-foreground hover:bg-manus-cream hover:text-foreground"
              )}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          </div>
        ))}
      </nav>

      {/* Projects Section */}
      <div className="mt-8 px-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Projects</h3>
          <button className="text-muted-foreground hover:text-foreground">
            <Plus size={16} />
          </button>
        </div>
        <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground py-2 text-sm">
          <Folder size={16} />
          <span>New project</span>
        </button>
      </div>

      {/* All Tasks Section */}
      <div className="mt-6 px-4 flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-2 mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">All tasks</h3>
          <button className="text-muted-foreground hover:text-foreground">
            <Filter size={14} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-1 pr-2">
          {tasks.map((task) => (
            <div key={task.id} className="relative group">
              <button
                onClick={() => navigate(`/task/${task.id}`)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                  activeTaskId === task.id
                    ? "bg-black/5 text-foreground font-medium" 
                    : "text-muted-foreground hover:bg-manus-cream hover:text-foreground"
                )}
              >
                <MessageSquare size={16} className={cn(
                  "shrink-0",
                  activeTaskId === task.id ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                )} />
                <span className="truncate text-sm">{task.prompt}</span>
              </button>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100",
                      activeTaskId === task.id
                        ? "bg-black/5 text-foreground hover:bg-black/10"
                        : "text-muted-foreground hover:bg-manus-cream hover:text-foreground"
                    )}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={(e) => handleDeleteTask(task.id, e as any)}
                    className="flex items-center gap-2 text-red-600 cursor-pointer"
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          
          {tasks.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center italic">
              No tasks yet
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
