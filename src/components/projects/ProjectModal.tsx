import React, { useState, useEffect } from 'react';
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
  Cpu, 
  Layers, 
  X, 
  Check, 
  Bot
} from 'lucide-react';
import { Project, ProjectIconType, ProjectColorType } from '@/types/project';
import { createProject, updateProject } from '@/lib/projectStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectToEdit?: Project | null;
  onSuccess?: (project: Project) => void;
}

const ICON_OPTIONS: { id: ProjectIconType; label: string; icon: any }[] = [
  { id: 'folder', label: 'Folder', icon: Folder },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'bar-chart', label: 'Analytics', icon: BarChart3 },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'brain', label: 'AI Agent', icon: Brain },
  { id: 'box', label: 'Product', icon: Box },
  { id: 'zap', label: 'Automation', icon: Zap },
  { id: 'layers', label: 'System', icon: Layers },
];

const COLOR_OPTIONS: { id: ProjectColorType; label: string; bg: string; border: string; ring: string; badgeText: string }[] = [
  { id: 'blue', label: 'Ocean Blue', bg: 'bg-blue-500', border: 'border-blue-500', ring: 'ring-blue-500', badgeText: 'text-blue-500' },
  { id: 'indigo', label: 'Deep Indigo', bg: 'bg-indigo-500', border: 'border-indigo-500', ring: 'ring-indigo-500', badgeText: 'text-indigo-500' },
  { id: 'purple', label: 'Royal Purple', bg: 'bg-purple-500', border: 'border-purple-500', ring: 'ring-purple-500', badgeText: 'text-purple-500' },
  { id: 'emerald', label: 'Emerald Green', bg: 'bg-emerald-500', border: 'border-emerald-500', ring: 'ring-emerald-500', badgeText: 'text-emerald-500' },
  { id: 'amber', label: 'Amber Gold', bg: 'bg-amber-500', border: 'border-amber-500', ring: 'ring-amber-500', badgeText: 'text-amber-500' },
  { id: 'rose', label: 'Rose Red', bg: 'bg-rose-500', border: 'border-rose-500', ring: 'ring-rose-500', badgeText: 'text-rose-500' },
  { id: 'cyan', label: 'Cyan Sky', bg: 'bg-cyan-500', border: 'border-cyan-500', ring: 'ring-cyan-500', badgeText: 'text-cyan-500' },
];

export function ProjectModal({ isOpen, onClose, projectToEdit, onSuccess }: ProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<ProjectIconType>('folder');
  const [color, setColor] = useState<ProjectColorType>('indigo');
  const [customInstructions, setCustomInstructions] = useState('');

  useEffect(() => {
    if (projectToEdit) {
      setName(projectToEdit.name || '');
      setDescription(projectToEdit.description || '');
      setIcon((projectToEdit.icon as ProjectIconType) || 'folder');
      setColor((projectToEdit.color as ProjectColorType) || 'indigo');
      setCustomInstructions(projectToEdit.customInstructions || '');
    } else {
      setName('');
      setDescription('');
      setIcon('folder');
      setColor('indigo');
      setCustomInstructions('');
    }
  }, [projectToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Please enter a project name');
      return;
    }

    try {
      if (projectToEdit) {
        const updated = updateProject(projectToEdit.id, {
          name: name.trim(),
          description: description.trim(),
          icon,
          color,
          customInstructions: customInstructions.trim()
        });
        if (updated) {
          toast.success(`Project "${updated.name}" updated`);
          if (onSuccess) onSuccess(updated);
        }
      } else {
        const created = createProject({
          name: name.trim(),
          description: description.trim(),
          icon,
          color,
          customInstructions: customInstructions.trim()
        });
        toast.success(`Project "${created.name}" created`);
        if (onSuccess) onSuccess(created);
      }

      onClose();
    } catch (err) {
      console.error('Project save error:', err);
      toast.error('Failed to save project');
    }
  };

  const SelectedIconComp = ICON_OPTIONS.find(i => i.id === icon)?.icon || Folder;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-[#18191c] rounded-3xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-border/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md transition-all", COLOR_OPTIONS.find(c => c.id === color)?.bg || 'bg-indigo-500')}>
              <SelectedIconComp size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">
                {projectToEdit ? 'Edit Project' : 'Create New Project'}
              </h2>
              <p className="text-xs text-muted-foreground">
                Group chat sessions, files, and custom AI agent instructions.
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {/* Name Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Next.js SaaS Platform, Q3 Revenue Analysis"
              className="w-full px-3.5 py-2.5 bg-manus-soft dark:bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs"
              autoFocus
              required
            />
          </div>

          {/* Description Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Description (Optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of tasks or goals in this project"
              className="w-full px-3.5 py-2.5 bg-manus-soft dark:bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs"
            />
          </div>

          {/* Icon Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
              Icon Symbol
            </label>
            <div className="grid grid-cols-5 gap-2">
              {ICON_OPTIONS.map((item) => {
                const IconComp = item.icon;
                const isSelected = icon === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setIcon(item.id)}
                    className={cn(
                      "flex flex-col items-center justify-center p-2.5 rounded-2xl border transition-all cursor-pointer gap-1",
                      isSelected 
                        ? "border-primary bg-primary/10 text-primary font-bold shadow-xs scale-105" 
                        : "border-border/60 hover:bg-manus-soft dark:hover:bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <IconComp size={18} />
                    <span className="text-[10px] truncate w-full text-center">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color Theme Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
              Theme Badge Color
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              {COLOR_OPTIONS.map((item) => {
                const isSelected = color === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setColor(item.id)}
                    className={cn(
                      "w-8 h-8 rounded-full transition-all cursor-pointer flex items-center justify-center text-white relative shadow-2xs",
                      item.bg,
                      isSelected ? "ring-4 ring-offset-2 ring-primary dark:ring-offset-[#18191c] scale-110" : "hover:scale-105 opacity-80 hover:opacity-100"
                    )}
                    title={item.label}
                  >
                    {isSelected && <Check size={14} className="stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Agent Instructions */}
          <div className="space-y-1.5 pt-2 border-t border-border/60">
            <div className="flex items-center gap-1.5">
              <Bot size={15} className="text-primary" />
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Project Agent Instructions
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Custom instructions prepended to every task run under this project (e.g. tech stack, format guidelines).
            </p>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g. Always generate code using TypeScript & React with Tailwind CSS. Format responses with clear Markdown headings."
              rows={3}
              className="w-full p-3 bg-manus-soft dark:bg-card border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs leading-relaxed"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/60">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:opacity-90 transition-all cursor-pointer"
            >
              {projectToEdit ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
