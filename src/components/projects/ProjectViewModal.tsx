import React, { useState, useEffect, useMemo } from 'react';
import { 
  Folder, 
  Code, 
  Sparkles, 
  Globe, 
  BarChart3, 
  Database, 
  Brain, 
  Box, 
  Zap, 
  Layers, 
  X, 
  MessageSquare, 
  Plus, 
  Edit3, 
  Trash2, 
  ExternalLink, 
  Bot, 
  Calendar, 
  Library,
  Clock
} from 'lucide-react';
import { Project, ProjectIconType, ProjectColorType } from '@/types/project';
import { deleteProject } from '@/lib/projectStore';
import { useNavigate } from 'react-router-dom';
import { blink } from '@/lib/blink';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

interface ProjectViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onEdit: (project: Project) => void;
  onNewTaskInProject?: (project: Project) => void;
}

const ICON_MAP: Record<string, any> = {
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

const COLOR_MAP: Record<string, { bg: string; text: string; badgeBg: string }> = {
  blue: { bg: 'bg-blue-500', text: 'text-blue-500', badgeBg: 'bg-blue-500/10 dark:bg-blue-500/20' },
  indigo: { bg: 'bg-indigo-500', text: 'text-indigo-500', badgeBg: 'bg-indigo-500/10 dark:bg-indigo-500/20' },
  purple: { bg: 'bg-purple-500', text: 'text-purple-500', badgeBg: 'bg-purple-500/10 dark:bg-purple-500/20' },
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-500', badgeBg: 'bg-emerald-500/10 dark:bg-emerald-500/20' },
  amber: { bg: 'bg-amber-500', text: 'text-amber-500', badgeBg: 'bg-amber-500/10 dark:bg-amber-500/20' },
  rose: { bg: 'bg-rose-500', text: 'text-rose-500', badgeBg: 'bg-rose-500/10 dark:bg-rose-500/20' },
  cyan: { bg: 'bg-cyan-500', text: 'text-cyan-500', badgeBg: 'bg-cyan-500/10 dark:bg-cyan-500/20' },
};

export function ProjectViewModal({ isOpen, onClose, project, onEdit, onNewTaskInProject }: ProjectViewModalProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen && project) {
      loadProjectTasks();
    }
  }, [isOpen, project]);

  const loadProjectTasks = async () => {
    if (!project) return;
    setIsLoading(true);
    try {
      const allTasks = await (blink.db as any).tasks.list({
        orderBy: { created_at: 'desc' },
        limit: 100
      });

      // Filter tasks assigned to this project or match project taskIds
      const projTasks = (allTasks || []).filter((t: any) => 
        t.projectId === project.id || (project.taskIds && project.taskIds.includes(t.id))
      );

      setTasks(projTasks);
    } catch (e) {
      console.error('Failed to load project tasks:', e);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !project) return null;

  const IconComponent = ICON_MAP[project.icon] || Folder;
  const theme = COLOR_MAP[project.color] || COLOR_MAP.indigo;

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDeleteProject = () => {
    setIsDeleting(true);
    try {
      deleteProject(project.id);
      toast.success(`Project "${project.name}" deleted`);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      toast.error('Failed to delete project');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenTask = (taskId: string) => {
    navigate(`/task/${taskId}`);
    onClose();
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-[#18191c] rounded-3xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
      >
        {/* Banner / Header */}
        <div className="p-6 pb-5 border-b border-border/60 bg-manus-soft dark:bg-card/40 relative">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>

          <div className="flex items-start gap-4">
            <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0", theme.bg)}>
              <IconComponent size={28} />
            </div>

            <div className="space-y-1 flex-1 pr-8">
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider", theme.badgeBg, theme.text)}>
                  Project
                </span>
                <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                  <Calendar size={12} />
                  Created {new Date(project.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>

              <h2 className="text-xl font-bold text-foreground tracking-tight">
                {project.name}
              </h2>

              {project.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {project.description}
                </p>
              )}
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center justify-between mt-5 pt-3 border-t border-border/40 gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <MessageSquare size={14} className={theme.text} />
              <span>{tasks.length} Session(s)</span>
            </div>

            <div className="flex items-center gap-2">
              {onNewTaskInProject && (
                <button
                  onClick={() => {
                    onNewTaskInProject(project);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow-xs hover:opacity-90 transition-all cursor-pointer"
                >
                  <Plus size={14} />
                  <span>Start Task in Project</span>
                </button>
              )}

              <button
                onClick={() => onEdit(project)}
                className="p-1.5 rounded-xl border border-border bg-white dark:bg-card hover:bg-muted text-foreground transition-colors cursor-pointer text-xs flex items-center gap-1 font-medium"
                title="Edit Project"
              >
                <Edit3 size={14} />
                <span className="hidden sm:inline">Edit</span>
              </button>

              <button
                onClick={handleDelete}
                className="p-1.5 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                title="Delete Project"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-5 custom-scrollbar">
          {/* Custom Instructions Banner */}
          {project.customInstructions && (
            <div className="p-3.5 rounded-2xl bg-primary/5 border border-primary/20 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <Bot size={14} />
                <span>Project Agent System Prompt</span>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed font-mono">
                "{project.customInstructions}"
              </p>
            </div>
          )}

          {/* Associated Tasks Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Project Sessions ({tasks.length})
            </h3>

            {tasks.length === 0 ? (
              <div className="py-10 text-center space-y-3 bg-manus-soft dark:bg-card/20 rounded-2xl border border-dashed border-border p-6">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mx-auto opacity-75", theme.badgeBg, theme.text)}>
                  <MessageSquare size={20} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">No sessions in this project yet</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Start a chat task or assign an existing chat session to "{project.name}".
                  </p>
                </div>
                {onNewTaskInProject && (
                  <button
                    onClick={() => {
                      onNewTaskInProject(project);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-xs hover:opacity-90 transition-all cursor-pointer mt-2"
                  >
                    <Plus size={14} />
                    <span>Create First Task</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => handleOpenTask(task.id)}
                    className="group flex items-center justify-between p-3 rounded-2xl border border-border bg-white dark:bg-card hover:border-primary/50 hover:shadow-xs transition-all cursor-pointer gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-medium", theme.badgeBg, theme.text)}>
                        <MessageSquare size={16} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-xs text-foreground truncate">
                          {task.title || task.prompt.split('\n')[0]}
                        </h4>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {task.prompt}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(task.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                      <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Project Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-md rounded-2xl p-6 bg-card border border-border">
          <AlertDialogHeader>
            <div className="w-11 h-11 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mb-2 mx-auto sm:mx-0">
              <Trash2 size={22} />
            </div>
            <AlertDialogTitle className="text-base sm:text-lg font-bold text-foreground">
              Delete Project?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-foreground">"{project.name}"</span>? 
              This will remove the project configuration and system instructions. Past chat sessions will remain archived in your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
            <AlertDialogCancel 
              disabled={isDeleting}
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-xl text-xs cursor-pointer border border-border hover:bg-muted"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={confirmDeleteProject}
              className="rounded-xl text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer shadow-xs font-semibold"
            >
              {isDeleting ? 'Deleting...' : 'Delete Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
