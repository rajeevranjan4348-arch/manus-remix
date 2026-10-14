import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, PanelLeft, Check, Sparkles, Zap, Brain, Cpu, MessageSquare, Briefcase, Settings2, SquarePen, MoreVertical, FileText, History } from 'lucide-react';
import { RobotHead } from 'robot-heads';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getSettings } from '@/lib/settingsStore';

interface TopbarProps {
  onToggleSidebar?: () => void;
  onOpenHistory?: () => void;
  onNewTask?: () => void;
  onOpenSettings?: () => void;
  onExport?: () => void;
  showNewTask?: boolean;
}

const MODELS = [
  { id: 'manus-1.6-lite', name: 'Manus 1.6 Lite', badge: 'Fast', desc: 'Optimized for speed and quick tasks', icon: Zap },
  { id: 'manus-1.6-max', name: 'Manus 1.6 Max', badge: 'Pro', desc: 'Complex reasoning & autonomous workflows', icon: Brain },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', badge: 'Multimodal', desc: 'Ultra-fast vision & text processing', icon: Sparkles },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'Code', desc: 'Advanced coding & data synthesis', icon: Cpu },
];

export function Topbar({ onToggleSidebar, onOpenHistory, onNewTask, onOpenSettings, onExport, showNewTask }: TopbarProps) {
  const location = useLocation();
  const isAtHome = location.pathname === '/';
  const shouldShowNewTask = showNewTask !== undefined ? showNewTask : !isAtHome;
  const isChatPage = !isAtHome || location.pathname.startsWith('/task');

  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('selected_manus_model') || 'manus-1.6-lite';
  });
  const [activeMode, setActiveMode] = useState<'chat' | 'work'>(() => {
    return localStorage.getItem('manus_chat_work_mode') === 'work' ? 'work' : 'chat';
  });
  const [isOpen, setIsOpen] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [robotSettings, setRobotSettings] = useState(() => getSettings());
  const [isHappyExpression, setIsHappyExpression] = useState(false);
  const [liveRobotState, setLiveRobotState] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationText, setGenerationText] = useState('Manus is typing...');
  const [generationMode, setGenerationMode] = useState<'chat' | 'website' | 'work'>('chat');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowOverflowMenu(false);
      }
    }
    if (showOverflowMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showOverflowMenu]);

  useEffect(() => {
    const handleSettingsUpdate = (e: any) => {
      if (e.detail?.defaultModel) {
        setSelectedModel(e.detail.defaultModel);
      }
      setRobotSettings(e.detail || getSettings());
    };
    const handleRobotStateChange = (e: any) => {
      if (e.detail) {
        setLiveRobotState(e.detail);
        const state = e.detail;
        if (['thinking', 'working', 'searching', 'speaking', 'generating'].includes(state)) {
          setIsGenerating(true);
          if (state === 'searching') setGenerationText('Searching...');
          else if (state === 'working') setGenerationText('Building...');
          else setGenerationText('Manus is typing...');
        } else if (['idle', 'happy', 'error'].includes(state)) {
          setIsGenerating(false);
        }
      }
    };
    const handleGeneratingEvent = (e: any) => {
      if (e.detail) {
        setIsGenerating(Boolean(e.detail.isGenerating));
        if (e.detail.text) setGenerationText(e.detail.text);
        if (e.detail.mode) setGenerationMode(e.detail.mode);
      }
    };

    window.addEventListener('manus_settings_updated', handleSettingsUpdate);
    window.addEventListener('manus_robot_state_change', handleRobotStateChange);
    window.addEventListener('manus_agent_generating', handleGeneratingEvent);
    return () => {
      window.removeEventListener('manus_settings_updated', handleSettingsUpdate);
      window.removeEventListener('manus_robot_state_change', handleRobotStateChange);
      window.removeEventListener('manus_agent_generating', handleGeneratingEvent);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRobotTap = () => {
    setIsHappyExpression(true);
    toast.success("Robot is happy! 😊", {
      icon: "😊",
      duration: 2500,
    });
    window.dispatchEvent(new CustomEvent('manus_open_settings', { detail: { tab: 'robot' } }));
    setTimeout(() => {
      setIsHappyExpression(false);
    }, 3500);
  };

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
    <header className="h-16 bg-manus-cream/90 dark:bg-background/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between relative transition-colors z-30 border-b border-border/30">
      {/* Left section: Sidebar toggle */}
      <div className="flex items-center gap-3 z-10">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent lg:hidden transition-all duration-200 cursor-pointer hover:scale-105 hover:shadow-xs active:scale-95"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeft size={22} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {/* Middle section: Centered Model Selection on Home OR Interactive Robot Head on Chat Page */}
      {isAtHome ? (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 max-w-[calc(100%-130px)] sm:max-w-md justify-center" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 sm:gap-2 bg-white/80 dark:bg-card/90 backdrop-blur-md border border-border/80 hover:border-foreground/20 px-3 py-1.5 sm:px-3.5 sm:py-1.5 rounded-full shadow-xs hover:shadow-md hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 cursor-pointer text-foreground group shrink-0 min-w-0"
            title="Select AI Model"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-xs sm:text-sm font-semibold tracking-tight truncate max-w-[120px] sm:max-w-none">{currentModel.name}</span>
            <ChevronDown size={14} strokeWidth={2.4} className={`text-muted-foreground transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Subtle Typing Indicator Chip */}
          {isGenerating && (
            <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 dark:bg-emerald-950/60 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-full text-xs font-medium animate-in fade-in zoom-in-95 duration-200 shadow-xs backdrop-blur-sm shrink-0 max-w-[140px]">
              <span className="flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" />
              </span>
              <span className="text-[11px] font-semibold tracking-tight truncate">
                {generationText}
              </span>
            </div>
          )}

          {/* Dropdown Menu */}
          {isOpen && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 sm:w-80 bg-white dark:bg-[#18191c] border border-border rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-2 border-b border-border/60 mb-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Select Intelligence Model</p>
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
                        <Icon size={18} strokeWidth={2.3} />
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
                        <Check size={18} strokeWidth={2.5} className="text-primary shrink-0 self-center ml-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center justify-center gap-2 max-w-[calc(100%-160px)]">
          <button
            onClick={handleRobotTap}
            className="p-1 rounded-2xl hover:bg-manus-soft/80 dark:hover:bg-accent/80 transition-all duration-200 cursor-pointer group flex items-center justify-center hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 shrink-0"
            title="Tap Robot face to customize settings 😊"
            aria-label="Customize robot settings"
          >
            <div className="transform transition-transform duration-200 group-hover:scale-110 active:scale-95 flex items-center justify-center">
              <RobotHead
                state={isHappyExpression ? 'happy' : (liveRobotState as any) || (robotSettings.robotState as any) || 'idle'}
                shape={(robotSettings.robotShape as any) || 'rectangle'}
                size={44}
              />
            </div>
          </button>

          {/* Subtle Typing Indicator Chip */}
          {isGenerating && (
            <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 dark:bg-emerald-950/60 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-full text-xs font-medium animate-in fade-in zoom-in-95 duration-200 shadow-xs backdrop-blur-sm shrink-0 max-w-[130px]">
              <span className="flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" />
              </span>
              <span className="text-[11px] font-semibold tracking-tight truncate">
                {generationText}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Right section: New Chat and Options buttons on upper right corner - only visible on chat page */}
      {isChatPage && (
        <div className="flex items-center gap-2 z-20 shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false);
              if (onNewTask) {
                onNewTask();
                toast.success('Started new chat session');
              } else {
                window.location.href = '/';
              }
            }}
            className="h-10 w-10 sm:h-11 sm:w-11 rounded-full flex items-center justify-center bg-white/90 dark:bg-[#292929]/95 backdrop-blur-sm text-foreground border border-border/50 shadow-xs hover:shadow-md hover:bg-slate-100 dark:hover:bg-white/10 hover:scale-[1.03] transition-all duration-150 cursor-pointer active:scale-95"
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen size={20} strokeWidth={2.2} />
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowOverflowMenu(prev => !prev)}
              className="h-10 w-10 sm:h-11 sm:w-11 rounded-full flex items-center justify-center bg-white/90 dark:bg-[#292929]/95 backdrop-blur-sm text-foreground border border-border/50 shadow-xs hover:shadow-md hover:bg-slate-100 dark:hover:bg-white/10 hover:scale-[1.03] transition-all duration-150 cursor-pointer active:scale-95"
              title="Chat options"
              aria-label="Chat options"
              aria-expanded={showOverflowMenu}
            >
              <MoreVertical size={20} strokeWidth={2.2} />
            </button>

            {showOverflowMenu && (
              <div className="absolute right-0 top-12 min-w-48 rounded-2xl border border-border/80 bg-white/95 dark:bg-[#242424]/95 backdrop-blur-md p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowOverflowMenu(false);
                    if (onNewTask) {
                      onNewTask();
                      toast.success('Started new chat session');
                    } else {
                      window.location.href = '/';
                    }
                  }}
                  className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                >
                  <SquarePen size={16} />
                  <span>New chat</span>
                </button>

                {onExport && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverflowMenu(false);
                      onExport();
                    }}
                    className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                  >
                    <FileText size={16} />
                    <span>Export conversation</span>
                  </button>
                )}

                {onOpenHistory && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverflowMenu(false);
                      onOpenHistory();
                    }}
                    className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                  >
                    <History size={16} />
                    <span>Chat history</span>
                  </button>
                )}

                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverflowMenu(false);
                      onOpenSettings();
                    }}
                    className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                  >
                    <Settings2 size={16} />
                    <span>Settings</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
