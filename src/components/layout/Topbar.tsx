import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, Sparkles, Zap, Brain, Cpu, MessageSquare, Briefcase, FileText, FileCode, Braces } from 'lucide-react';
import { ChevronDown, PanelLeft, Settings as Settings2, SquarePen, MoreVertical, History } from 'pulsoicon-react';
import { RobotHead } from 'robot-heads';
import { toast } from 'sonner';
import { getSettings } from '@/lib/settingsStore';
import { ChatExportFormat } from '@/lib/chatExport';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AMBIENT_ROBOT_EXPRESSION_SEQUENCE,
  RobotHeadState,
} from '@/lib/robotAnimationEngine';
import {
  WORKSPACE_DROPDOWN_SPRING_VARIANTS,
  WORKSPACE_REDUCED_MOTION_VARIANTS,
} from '@/lib/panelMotion';
import {
  preloadHistoryPanel,
  preloadSettingsModal,
} from '@/lib/instantPreload';

interface TopbarProps {
  onToggleSidebar?: () => void;
  onOpenHistory?: () => void;
  onNewTask?: () => void;
  onOpenSettings?: () => void;
  onExport?: (format?: ChatExportFormat) => void;
  showNewTask?: boolean;
}

const MODELS = [
  { id: 'manus-1.6-lite', name: 'Deku 1.6 Lite', badge: 'Fast', desc: 'Optimized for speed and quick tasks', icon: Zap },
  { id: 'manus-1.6-max', name: 'Deku 1.6 Max', badge: 'Pro', desc: 'Complex reasoning & autonomous workflows', icon: Brain },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', badge: 'Multimodal', desc: 'Ultra-fast vision & text processing', icon: Sparkles },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'Code', desc: 'Advanced coding & data synthesis', icon: Cpu },
];

export const Topbar = React.memo(function Topbar({ onToggleSidebar, onOpenHistory, onNewTask, onOpenSettings, onExport, showNewTask }: TopbarProps) {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const isAtHome = location.pathname === '/';
  const shouldShowNewTask = showNewTask !== undefined ? showNewTask : !isAtHome;
  const isChatPage = !isAtHome || location.pathname.startsWith('/task');

  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('selected_manus_model') || 'manus-1.6-lite';
      }
    } catch {}
    return 'manus-1.6-lite';
  });
  const [activeMode, setActiveMode] = useState<'chat' | 'work'>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('manus_chat_work_mode') === 'work' ? 'work' : 'chat';
      }
    } catch {}
    return 'chat';
  });
  const [isOpen, setIsOpen] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [robotSettings, setRobotSettings] = useState(() => getSettings());
  const [isHappyExpression, setIsHappyExpression] = useState(false);
  const [liveRobotState, setLiveRobotState] = useState<string | null>(null);
  const [ambientRobotState, setAmbientRobotState] = useState<RobotHeadState>('idle');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationText, setGenerationText] = useState('Deku is typing...');
  const [generationMode, setGenerationMode] = useState<'chat' | 'website' | 'work'>('chat');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (robotSettings.robotPaused) return;
    let stepIndex = 0;
    let timerId: number;

    const scheduleNextExpression = () => {
      const currentStep = AMBIENT_ROBOT_EXPRESSION_SEQUENCE[stepIndex];
      setAmbientRobotState(currentStep.state);
      timerId = window.setTimeout(() => {
        stepIndex = (stepIndex + 1) % AMBIENT_ROBOT_EXPRESSION_SEQUENCE.length;
        scheduleNextExpression();
      }, currentStep.durationMs);
    };

    scheduleNextExpression();
    return () => window.clearTimeout(timerId);
  }, [robotSettings.robotPaused]);

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
          else setGenerationText('Deku is typing...');
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

  const ActiveModelIcon = currentModel.icon;
  const dropdownVariants = prefersReducedMotion
    ? WORKSPACE_REDUCED_MOTION_VARIANTS
    : WORKSPACE_DROPDOWN_SPRING_VARIANTS;

  return (
    <header className="h-16 bg-manus-cream/90 dark:bg-background/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between relative transition-colors z-30 border-b border-border/40">
      {/* Left section: Sidebar toggle */}
      <div className="flex items-center gap-3 z-10">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent lg:hidden transition-[transform,background-color,color,box-shadow] duration-150 ease-out cursor-pointer hover:scale-[1.03] active:scale-95"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeft size={22} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {/* Middle section: Centered Model Selection on Home OR Interactive Robot Head on Chat Page */}
      {isAtHome ? (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 bg-[#FFFFFF] dark:bg-[#141414] backdrop-blur-md border border-[#E0E0E0] dark:border-[#2E2E2E] hover:border-[#000000]/60 dark:hover:border-[#FFFFFF]/60 px-3.5 py-1.5 rounded-full shadow-xs hover:shadow-md hover:-translate-y-[0.5px] active:scale-[0.98] transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-out cursor-pointer text-[#000000] dark:text-[#FFFFFF] group whitespace-nowrap"
            title="Select AI Model"
          >
            <ActiveModelIcon size={14} strokeWidth={2.3} className="shrink-0 text-foreground/80 transition-transform duration-150 group-hover:scale-105" />
            <span className="text-sm font-semibold tracking-tight">{currentModel.name}</span>
            <ChevronDown size={15} strokeWidth={2.4} className={`text-[#777777] dark:text-[#AAAAAA] transition-transform duration-200 ease-out ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Subtle Typing Indicator Chip */}
          {isGenerating && (
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#F2F2F2] dark:bg-[#171717] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF] rounded-full text-xs font-medium animate-in fade-in zoom-in-95 duration-200 shadow-xs backdrop-blur-sm shrink-0">
              <span className="flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#000000] dark:bg-[#FFFFFF] animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#000000] dark:bg-[#FFFFFF] animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#000000] dark:bg-[#FFFFFF] animate-bounce" />
              </span>
              <span className="text-[11.5px] font-semibold tracking-tight whitespace-nowrap">
                {generationText}
              </span>
            </div>
          )}

          {/* Dropdown Menu */}
          <AnimatePresence>
            {isOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 sm:w-80 z-50">
                <motion.div
                  variants={dropdownVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="bg-white/95 dark:bg-[#151517]/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl p-2 origin-top will-change-transform"
                >
                  <div className="px-3 py-2 border-b border-border/60 mb-1.5">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Select Intelligence Model</p>
                  </div>

                  <div className="space-y-1">
                    {MODELS.map((model) => {
                      const Icon = model.icon;
                      const isSelected = model.id === selectedModel;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => handleSelectModel(model.id, model.name)}
                          className={`group w-full flex items-start gap-3 p-2.5 rounded-xl transition-[transform,background-color,border-color,color] duration-150 ease-out cursor-pointer text-left active:scale-[0.985] ${
                            isSelected 
                              ? 'bg-primary/10 dark:bg-white/10 border border-primary/20 dark:border-white/15 text-foreground' 
                              : 'border border-transparent hover:bg-manus-soft dark:hover:bg-accent/70 text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <div className={`p-2 rounded-lg shrink-0 transition-colors duration-150 ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:text-foreground'}`}>
                            <Icon size={17} strokeWidth={2.3} className="manus-icon-spring" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-xs font-semibold text-foreground truncate">{model.name}</span>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground whitespace-nowrap">
                                {model.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{model.desc}</p>
                          </div>
                          {isSelected && (
                            <Check size={16} strokeWidth={2.5} className="manus-tag-pop text-primary shrink-0 self-center ml-1" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center justify-center gap-2.5">
          <button
            onClick={handleRobotTap}
            className="p-1 rounded-2xl hover:bg-manus-soft/80 dark:hover:bg-accent/80 transition-all duration-200 cursor-pointer group flex items-center justify-center hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            title="Tap Robot face to customize settings 😊"
            aria-label="Customize robot settings"
          >
            <div className="transform transition-transform duration-200 group-hover:scale-110 active:scale-95 flex items-center justify-center">
              {(() => {
                const activeTopbarState: RobotHeadState = isHappyExpression
                  ? 'happy'
                  : liveRobotState && liveRobotState !== 'idle'
                    ? (liveRobotState as RobotHeadState)
                    : robotSettings.robotState && robotSettings.robotState !== 'idle'
                      ? (robotSettings.robotState as RobotHeadState)
                      : ambientRobotState || 'idle';
                return (
                  <RobotHead
                    state={activeTopbarState}
                    shape={(robotSettings.robotShape as any) || 'rectangle'}
                    size={50}
                    paused={Boolean(robotSettings.robotPaused)}
                    data-robot-state={activeTopbarState}
                    className={robotSettings.robotPaused ? '' : 'manus-hero-robot-breathe'}
                  />
                );
              })()}
            </div>
          </button>
        </div>
      )}

      {/* Right section: New Chat and Options buttons on chat page */}
      <div className="flex items-center gap-2 z-20 shrink-0">
        {isChatPage && (
          <>
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
            className="h-10 w-10 sm:h-10 sm:w-10 rounded-full flex items-center justify-center bg-white/90 dark:bg-[#1a1a1c]/95 backdrop-blur-sm text-foreground border border-border/60 shadow-xs hover:shadow-md hover:bg-manus-soft dark:hover:bg-white/10 hover:-translate-y-[0.5px] transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out cursor-pointer active:scale-95"
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen size={19} strokeWidth={2.2} />
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onPointerEnter={() => {
                preloadHistoryPanel();
                preloadSettingsModal();
              }}
              onTouchStart={() => {
                preloadHistoryPanel();
                preloadSettingsModal();
              }}
              onClick={() => setShowOverflowMenu(prev => !prev)}
              className="h-10 w-10 sm:h-10 sm:w-10 rounded-full flex items-center justify-center bg-white/90 dark:bg-[#1a1a1c]/95 backdrop-blur-sm text-foreground border border-border/60 shadow-xs hover:shadow-md hover:bg-manus-soft dark:hover:bg-white/10 hover:-translate-y-[0.5px] transition-[transform,background-color,border-color,box-shadow] duration-100 ease-out cursor-pointer active:scale-95"
              title="Chat options"
              aria-label="Chat options"
              aria-expanded={showOverflowMenu}
            >
              <MoreVertical size={19} strokeWidth={2.2} />
            </button>

            <AnimatePresence>
              {showOverflowMenu && (
                <motion.div
                  variants={dropdownVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="absolute right-0 top-12 min-w-52 rounded-2xl border border-border/80 bg-white/95 dark:bg-[#151517]/95 backdrop-blur-xl p-1.5 shadow-2xl z-50 origin-top-right will-change-transform"
                >
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
                    className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-left hover:bg-manus-soft dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                  >
                    <SquarePen size={16} />
                    <span>New chat</span>
                  </button>

                  {onExport && (
                    <div className="my-1 pt-1 border-t border-border/50">
                      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Export Conversation
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowOverflowMenu(false);
                          onExport('pdf');
                        }}
                        className="w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-1.5 text-sm text-left hover:bg-manus-soft dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5">
                          <FileText size={15} />
                          <span>Export as PDF</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">.pdf</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowOverflowMenu(false);
                          onExport('markdown');
                        }}
                        className="w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-1.5 text-sm text-left hover:bg-manus-soft dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5">
                          <FileCode size={15} />
                          <span>Export as Markdown</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">.md</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowOverflowMenu(false);
                          onExport('json');
                        }}
                        className="w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-1.5 text-sm text-left hover:bg-manus-soft dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5">
                          <Braces size={15} />
                          <span>Export as JSON</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">.json</span>
                      </button>
                    </div>
                  )}

                  {onOpenHistory && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowOverflowMenu(false);
                        onOpenHistory();
                      }}
                      className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-left hover:bg-manus-soft dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
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
                      className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-left hover:bg-manus-soft dark:hover:bg-white/10 transition-colors text-foreground cursor-pointer"
                    >
                      <Settings2 size={16} />
                      <span>Settings</span>
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          </>
        )}
      </div>
    </header>
  );
});
