import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, PanelLeft, Plus, Check, Sparkles, Zap, Brain, Cpu, MessageSquare, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TopbarProps {
  onToggleSidebar?: () => void;
  onOpenHistory?: () => void;
  onNewTask?: () => void;
}

const MODELS = [
  { id: 'manus-1.6-lite', name: 'Manus 1.6 Lite', badge: 'Fast', desc: 'Optimized for speed and quick tasks', icon: Zap },
  { id: 'manus-1.6-max', name: 'Manus 1.6 Max', badge: 'Pro', desc: 'Complex reasoning & autonomous workflows', icon: Brain },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: 'Multimodal', desc: 'Ultra-fast vision & text processing', icon: Sparkles },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'Code', desc: 'Advanced coding & data synthesis', icon: Cpu },
];

export function Topbar({ onToggleSidebar, onNewTask }: TopbarProps) {
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('selected_manus_model') || 'manus-1.6-lite';
  });
  const [activeMode, setActiveMode] = useState<'chat' | 'work'>(() => {
    return localStorage.getItem('manus_chat_work_mode') === 'work' ? 'work' : 'chat';
  });
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentModel = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  const handleSelectModel = (id: string, name: string) => {
    setSelectedModel(id);
    localStorage.setItem('selected_manus_model', id);
    setIsOpen(false);
    toast.success(`Switched to ${name}`);
  };

  const handleToggleMode = (mode: 'chat' | 'work') => {
    setActiveMode(mode);
    localStorage.setItem('manus_chat_work_mode', mode);
    window.dispatchEvent(new CustomEvent('manus_mode_changed', { detail: mode }));
    toast.success(`Switched to ${mode === 'chat' ? 'Chat Mode 💬' : 'Work Mode 💼'}`);
  };

  return (
    <header className="h-16 border-b border-border bg-manus-cream dark:bg-background px-4 sm:px-6 flex items-center justify-between relative transition-colors z-30">
      {/* Left section: Sidebar toggle */}
      <div className="flex items-center gap-3 z-10">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent lg:hidden transition-colors cursor-pointer"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeft size={20} />
          </button>
        )}
      </div>

      {/* Middle section: Centered Model Selection */}
      <div className="absolute left-1/2 -translate-x-1/2 z-20" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 bg-white/80 dark:bg-card/90 backdrop-blur-md border border-border/80 hover:border-foreground/20 px-3.5 py-1.5 rounded-full shadow-xs transition-all cursor-pointer text-foreground group"
          title="Select AI Model"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="text-sm font-semibold tracking-tight">{currentModel.name}</span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 sm:w-80 bg-white dark:bg-[#18191c] border border-border rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-3 py-2 border-b border-border/60 mb-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Select Intelligence Model</p>
            </div>
            <div className="mb-2 p-1 rounded-xl border border-border/60 bg-muted/40">
              <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Mode</div>
              <div className="grid grid-cols-2 gap-1">
                {(['chat', 'work'] as const).map((mode) => {
                  const active = activeMode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => handleToggleMode(mode)}
                      className={cn(
                        "flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                        active
                          ? "bg-white dark:bg-card text-foreground shadow-sm border border-border/50"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/60 dark:hover:bg-accent/50"
                      )}
                      aria-pressed={active}
                    >
                      {mode === 'chat' ? <MessageSquare size={13} /> : <Briefcase size={13} />}
                      <span>{mode === 'chat' ? 'Chat' : 'Work'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              {MODELS.map((model) => {
                const Icon = model.icon;
                const isSelected = model.id === selectedModel;
                return (
                  <button
                    key={model.id}
                    onClick={() => handleSelectModel(model.id, model.name)}
                    className={`w-full flex items-start gap-3 p-2.5 rounded-xl transition-all cursor-pointer text-left ${
                      isSelected 
                        ? 'bg-primary/10 border border-primary/20 text-foreground' 
                        : 'hover:bg-manus-soft dark:hover:bg-accent/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-foreground truncate">{model.name}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {model.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{model.desc}</p>
                    </div>
                    {isSelected && (
                      <Check size={16} className="text-primary shrink-0 self-center ml-1" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right section: Plus button */}
      <div className="flex items-center gap-2.5 z-10">
        <button
          onClick={() => {
            if (onNewTask) {
              onNewTask();
              toast.success('Started new chat session');
            } else {
              window.location.href = '/';
            }
          }}
          className="p-2 rounded-full border border-border bg-white dark:bg-card text-foreground hover:bg-manus-soft dark:hover:bg-accent transition-all cursor-pointer shadow-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title="New Chat / New Task"
          aria-label="New Chat or Task"
        >
          <Plus size={16} className="text-foreground" />
        </button>
      </div>
    </header>
  );
}
