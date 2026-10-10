import React, { useState, useEffect } from 'react';
import { 
  X, 
  Monitor, 
  Sun, 
  Moon, 
  Brain, 
  User, 
  Volume2, 
  Shield, 
  Info, 
  Download, 
  Upload, 
  Trash2, 
  RotateCcw, 
  Check, 
  Sparkles, 
  Zap, 
  Cpu, 
  Globe, 
  Terminal, 
  VolumeX, 
  Keyboard
} from 'lucide-react';
import { 
  UserSettings, 
  AppTheme, 
  AppMode, 
  ResponseTone, 
  VoicePersona 
} from '@/types/settings';
import { 
  getSettings, 
  saveSettings, 
  resetSettings, 
  playNotificationSound, 
  exportWorkspaceBackup, 
  importWorkspaceBackup, 
  clearAllWorkspaceHistory 
} from '@/lib/settingsStore';
import { useTheme } from '@/context/ThemeContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'ai' | 'personalization' | 'voice' | 'data' | 'about';

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<UserSettings>(getSettings());
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [isExporting, setIsExporting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSettings(getSettings());
      setShowClearConfirm(false);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const updated = saveSettings({ [key]: value });
    setSettings(updated);

    if (key === 'theme') {
      setTheme(value as any);
    }

    if (key === 'soundEffects' && value === true) {
      playNotificationSound('pop');
    }
  };

  const handleThemeChange = (newTheme: AppTheme) => {
    setTheme(newTheme);
    const updated = saveSettings({ theme: newTheme });
    setSettings(updated);
    toast.success(`Theme set to ${newTheme.charAt(0).toUpperCase() + newTheme.slice(1)}`);
  };

  const handleExportData = () => {
    try {
      setIsExporting(true);
      const json = exportWorkspaceBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manus-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Workspace exported');
    } catch {
      toast.error('Failed to export backup');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const success = importWorkspaceBackup(content);
        if (success) {
          setSettings(getSettings());
          toast.success('Workspace restored');
        } else {
          toast.error('Invalid backup file');
        }
      } catch {
        toast.error('Error reading backup file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClearHistory = () => {
    clearAllWorkspaceHistory();
    setShowClearConfirm(false);
    toast.success('History cleared');
  };

  const handleResetDefaults = () => {
    const def = resetSettings();
    setSettings(def);
    setTheme('light');
    toast.success('Restored defaults');
  };

  if (!isOpen) return null;

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'general', label: 'General', icon: Sun },
    { id: 'ai', label: 'AI & Models', icon: Brain },
    { id: 'personalization', label: 'Personalization', icon: User },
    { id: 'voice', label: 'Voice & Audio', icon: Volume2 },
    { id: 'data', label: 'Data & Privacy', icon: Shield },
    { id: 'about', label: 'About', icon: Info },
  ];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="w-full max-w-2xl h-[560px] max-h-[90vh] bg-background border border-border/70 rounded-2xl shadow-xl flex flex-col overflow-hidden text-foreground animate-in zoom-in-98 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        {/* Minimal Header */}
        <div className="px-5 py-3.5 border-b border-border/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <h2 id="settings-dialog-title" className="text-sm font-semibold tracking-tight text-foreground">
              Settings
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
          {/* Minimalist Sidebar */}
          <nav className="w-full sm:w-48 border-b sm:border-b-0 sm:border-r border-border/50 p-2 shrink-0 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-y-auto no-scrollbar bg-muted/20">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left whitespace-nowrap cursor-pointer",
                    isActive
                      ? "bg-foreground text-background font-semibold shadow-2xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon size={14} className="shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Active Tab Panel */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 custom-scrollbar bg-background">
            {/* GENERAL TAB */}
            {activeTab === 'general' && (
              <div className="space-y-6 animate-in fade-in duration-100">
                {/* Theme row */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">Appearance</p>
                      <p className="text-[11px] text-muted-foreground">Choose your workspace interface theme</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[
                      { id: 'light', label: 'Light', icon: Sun },
                      { id: 'dark', label: 'Dark', icon: Moon },
                      { id: 'system', label: 'System', icon: Monitor },
                    ].map((item) => {
                      const Icon = item.icon;
                      const isSelected = theme === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleThemeChange(item.id as AppTheme)}
                          className={cn(
                            "flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all cursor-pointer",
                            isSelected
                              ? "border-foreground/30 bg-muted/70 text-foreground shadow-2xs ring-1 ring-border"
                              : "border-border/60 hover:border-border text-muted-foreground hover:text-foreground bg-card/50"
                          )}
                        >
                          <Icon size={13} />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Workspace Mode */}
                <div className="pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-foreground">Default Mode</p>
                      <p className="text-[11px] text-muted-foreground">Select default task launch mode</p>
                    </div>
                    <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-muted/30">
                      <button
                        onClick={() => updateSetting('defaultMode', 'chat')}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                          settings.defaultMode === 'chat'
                            ? "bg-background text-foreground shadow-2xs font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Chat
                      </button>
                      <button
                        onClick={() => updateSetting('defaultMode', 'work')}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                          settings.defaultMode === 'work'
                            ? "bg-background text-foreground shadow-2xs font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Agent Work
                      </button>
                    </div>
                  </div>
                </div>

                {/* Language */}
                <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">Language</p>
                    <p className="text-[11px] text-muted-foreground">Display and prompt locale</p>
                  </div>
                  <select
                    value={settings.language}
                    onChange={(e) => updateSetting('language', e.target.value as any)}
                    className="text-xs bg-muted/40 border border-border/60 rounded-lg px-2.5 py-1 font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-foreground/20"
                    aria-label="Language selection"
                  >
                    <option value="en">English (US)</option>
                    <option value="hi">हिंदी (Hindi)</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                  </select>
                </div>

                {/* Sound Effects */}
                <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">Sound Effects</p>
                    <p className="text-[11px] text-muted-foreground">Play subtle chimes on completions</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {settings.soundEffects && (
                      <button
                        onClick={() => playNotificationSound('success')}
                        className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/50 cursor-pointer"
                      >
                        Test
                      </button>
                    )}
                    <button
                      onClick={() => updateSetting('soundEffects', !settings.soundEffects)}
                      role="switch"
                      aria-checked={settings.soundEffects}
                      aria-label="Toggle sound effects"
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        settings.soundEffects ? "bg-foreground" : "bg-muted"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out",
                          settings.soundEffects ? "translate-x-4" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Reduced Motion */}
                <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">Reduced Motion</p>
                    <p className="text-[11px] text-muted-foreground">Minimize decorative animations</p>
                  </div>
                  <button
                    onClick={() => updateSetting('reducedMotion', !settings.reducedMotion)}
                    role="switch"
                    aria-checked={settings.reducedMotion}
                    aria-label="Toggle reduced motion"
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      settings.reducedMotion ? "bg-foreground" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out",
                        settings.reducedMotion ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* AI & INTELLIGENCE TAB */}
            {activeTab === 'ai' && (
              <div className="space-y-6 animate-in fade-in duration-100">
                {/* Default Model */}
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">Model Selection</p>
                  <p className="text-[11px] text-muted-foreground mb-3">Choose the default intelligence engine</p>
                  
                  <div className="space-y-1.5">
                    {[
                      { id: 'manus-1.6-lite', name: 'Manus 1.6 Lite', desc: 'Fast execution for quick chats and requests', tag: 'Fast' },
                      { id: 'manus-1.6-max', name: 'Manus 1.6 Max', desc: 'Deep reasoning and complex autonomous flows', tag: 'Pro' },
                      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Multimodal vision and rapid document analysis', tag: 'Vision' },
                      { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'High precision code and structured engineering', tag: 'Code' },
                    ].map((m) => {
                      const isSelected = settings.defaultModel === m.id;
                      return (
                        <div
                          key={m.id}
                          onClick={() => updateSetting('defaultModel', m.id)}
                          className={cn(
                            "flex items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-colors",
                            isSelected
                              ? "border-foreground/30 bg-muted/60 text-foreground"
                              : "border-border/60 hover:border-border text-muted-foreground hover:text-foreground bg-card/30"
                          )}
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-foreground">{m.name}</span>
                              <span className="text-[10px] text-muted-foreground px-1.5 py-0.2 rounded bg-muted">
                                {m.tag}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{m.desc}</p>
                          </div>
                          {isSelected && <Check size={14} className="text-foreground shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Temperature Slider */}
                <div className="pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">Temperature</p>
                      <p className="text-[11px] text-muted-foreground">Balance factual precision vs creativity</p>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                      {settings.temperature.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.temperature}
                    onChange={(e) => updateSetting('temperature', parseFloat(e.target.value))}
                    aria-label="Temperature slider"
                    className="w-full accent-foreground h-1.5 bg-muted rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                    <span>Precise (0.0)</span>
                    <span>Balanced (0.7)</span>
                    <span>Creative (1.0)</span>
                  </div>
                </div>

                {/* Capabilities */}
                <div className="pt-4 border-t border-border/50 space-y-3">
                  <p className="text-xs font-medium text-foreground">Capabilities</p>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-foreground">Web Search Grounding</p>
                      <p className="text-[11px] text-muted-foreground">Access live web information</p>
                    </div>
                    <button
                      onClick={() => updateSetting('enableWebSearch', !settings.enableWebSearch)}
                      role="switch"
                      aria-checked={settings.enableWebSearch}
                      aria-label="Toggle web search"
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        settings.enableWebSearch ? "bg-foreground" : "bg-muted"
                      )}
                    >
                      <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out", settings.enableWebSearch ? "translate-x-4" : "translate-x-0")} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-foreground">Code Sandbox Execution</p>
                      <p className="text-[11px] text-muted-foreground">Run calculations and code snippets</p>
                    </div>
                    <button
                      onClick={() => updateSetting('enableCodeSandbox', !settings.enableCodeSandbox)}
                      role="switch"
                      aria-checked={settings.enableCodeSandbox}
                      aria-label="Toggle code sandbox"
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        settings.enableCodeSandbox ? "bg-foreground" : "bg-muted"
                      )}
                    >
                      <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out", settings.enableCodeSandbox ? "translate-x-4" : "translate-x-0")} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-foreground">Deep Multi-Step Research</p>
                      <p className="text-[11px] text-muted-foreground">Conduct iterative multi-query analysis</p>
                    </div>
                    <button
                      onClick={() => updateSetting('deepResearchMode', !settings.deepResearchMode)}
                      role="switch"
                      aria-checked={settings.deepResearchMode}
                      aria-label="Toggle deep research mode"
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        settings.deepResearchMode ? "bg-foreground" : "bg-muted"
                      )}
                    >
                      <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out", settings.deepResearchMode ? "translate-x-4" : "translate-x-0")} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* PERSONALIZATION TAB */}
            {activeTab === 'personalization' && (
              <div className="space-y-6 animate-in fade-in duration-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Alex"
                      value={settings.userName}
                      onChange={(e) => updateSetting('userName', e.target.value)}
                      className="w-full text-xs bg-muted/30 border border-border/70 rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">
                      Role / Profession
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Software Engineer"
                      value={settings.userRole}
                      onChange={(e) => updateSetting('userRole', e.target.value)}
                      className="w-full text-xs bg-muted/30 border border-border/70 rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <p className="text-xs font-medium text-foreground mb-1">Tone & Style</p>
                  <p className="text-[11px] text-muted-foreground mb-2.5">Set the assistant response character</p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { id: 'balanced', label: 'Balanced' },
                      { id: 'concise', label: 'Concise' },
                      { id: 'professional', label: 'Professional' },
                      { id: 'creative', label: 'Creative' },
                      { id: 'academic', label: 'Academic' },
                    ].map((tone) => {
                      const isSelected = settings.responseTone === tone.id;
                      return (
                        <button
                          key={tone.id}
                          onClick={() => updateSetting('responseTone', tone.id as ResponseTone)}
                          className={cn(
                            "py-2 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer text-center",
                            isSelected
                              ? "border-foreground/30 bg-muted/70 text-foreground shadow-2xs font-semibold"
                              : "border-border/60 hover:border-border text-muted-foreground hover:text-foreground bg-card/40"
                          )}
                        >
                          {tone.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <label className="text-xs font-medium text-foreground block mb-1">
                    Custom Instructions
                  </label>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Appended to every prompt across sessions
                  </p>
                  <textarea
                    rows={4}
                    placeholder="e.g. Respond with concise bullet points. Prefer TypeScript examples..."
                    value={settings.customInstructions}
                    onChange={(e) => updateSetting('customInstructions', e.target.value)}
                    className="w-full text-xs bg-muted/30 border border-border/70 rounded-lg p-2.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 leading-relaxed resize-none"
                  />
                </div>
              </div>
            )}

            {/* VOICE & AUDIO TAB */}
            {activeTab === 'voice' && (
              <div className="space-y-6 animate-in fade-in duration-100">
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">Voice Persona</p>
                  <p className="text-[11px] text-muted-foreground mb-2.5">Select voice for audio responses</p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { id: 'nova', name: 'Nova', desc: 'Warm Human' },
                      { id: 'alloy', name: 'Alloy', desc: 'Neutral Human' },
                      { id: 'echo', name: 'Echo', desc: 'Smooth Male' },
                      { id: 'fable', name: 'Fable', desc: 'Clear Natural' },
                      { id: 'onyx', name: 'Onyx', desc: 'Deep Male' },
                      { id: 'shimmer', name: 'Shimmer', desc: 'Bright Female' },
                    ].map((v) => {
                      const isSelected = settings.voicePersona === v.id;
                      return (
                        <button
                          key={v.id}
                          onClick={() => {
                            updateSetting('voicePersona', v.id as VoicePersona);
                            speakCleanHumanVoice(`Hello! This is ${v.name}, speaking clearly in high-fidelity audio.`, {
                              voicePersona: v.id,
                              rate: settings.speechSpeed,
                              volume: 1.0,
                            });
                          }}
                          className={cn(
                            "flex items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-colors group",
                            isSelected
                              ? "border-foreground/30 bg-muted/70 text-foreground font-semibold ring-1 ring-foreground/20"
                              : "border-border/60 hover:border-border text-muted-foreground hover:text-foreground bg-card/40"
                          )}
                        >
                          <div>
                            <p className="text-xs font-medium text-foreground">{v.name}</p>
                            <p className="text-[10px] text-muted-foreground">{v.desc}</p>
                          </div>
                          {isSelected ? (
                            <Check size={12} className="text-foreground" />
                          ) : (
                            <Volume2 size={12} className="opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">Speech Speed</p>
                      <p className="text-[11px] text-muted-foreground">Playback rate for voice synthesis</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {[0.75, 1.0, 1.25, 1.5].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => updateSetting('speechSpeed', spd)}
                        className={cn(
                          "flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer",
                          settings.speechSpeed === spd
                            ? "bg-foreground text-background font-semibold border-foreground"
                            : "border-border/60 hover:border-border text-muted-foreground hover:text-foreground bg-card/40"
                        )}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">Auto-Play Audio</p>
                    <p className="text-[11px] text-muted-foreground">Read responses aloud automatically</p>
                  </div>
                  <button
                    onClick={() => updateSetting('autoPlayAudio', !settings.autoPlayAudio)}
                    role="switch"
                    aria-checked={settings.autoPlayAudio}
                    aria-label="Toggle auto play audio"
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      settings.autoPlayAudio ? "bg-foreground" : "bg-muted"
                    )}
                  >
                    <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out", settings.autoPlayAudio ? "translate-x-4" : "translate-x-0")} />
                  </button>
                </div>
              </div>
            )}

            {/* DATA & PRIVACY TAB */}
            {activeTab === 'data' && (
              <div className="space-y-6 animate-in fade-in duration-100">
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">Backup & Restore</p>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Export your tasks, projects, and settings as a JSON file or restore from a previous file.
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={handleExportData}
                      disabled={isExporting}
                      className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-border/80 hover:border-foreground/30 text-xs font-medium text-foreground bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer"
                    >
                      <Download size={13} className="text-muted-foreground" />
                      <span>Export Backup</span>
                    </button>

                    <label className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-border/80 hover:border-foreground/30 text-xs font-medium text-foreground bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer">
                      <Upload size={13} className="text-muted-foreground" />
                      <span>Restore Backup</span>
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImportFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50 space-y-3">
                  <p className="text-xs font-medium text-foreground">Maintenance</p>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
                    <div>
                      <p className="text-xs font-medium text-foreground">Clear Session History</p>
                      <p className="text-[11px] text-muted-foreground">Delete past chats and agent tasks</p>
                    </div>

                    {showClearConfirm ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleClearHistory}
                          className="px-2.5 py-1 text-xs font-medium bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setShowClearConfirm(false)}
                          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowClearConfirm(true)}
                        className="px-2.5 py-1 text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 rounded-md transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
                    <div>
                      <p className="text-xs font-medium text-foreground">Reset All Settings</p>
                      <p className="text-[11px] text-muted-foreground">Restore original workspace defaults</p>
                    </div>
                    <button
                      onClick={handleResetDefaults}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border/60 hover:border-border rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      <RotateCcw size={12} />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ABOUT TAB */}
            {activeTab === 'about' && (
              <div className="space-y-6 animate-in fade-in duration-100">
                <div>
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-6 h-6 rounded-md bg-foreground text-background flex items-center justify-center font-bold text-xs">
                      M
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Manus AI Workspace</p>
                      <p className="text-[11px] text-muted-foreground">Version 2.4.0</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                    Autonomous execution engine with multi-step research, web browsing, code sandbox, and site generation capabilities.
                  </p>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <p className="text-xs font-medium text-foreground mb-2">Shortcuts</p>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground text-xs">Open Settings</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">Ctrl / ⌘ + ,</kbd>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground text-xs">Open History</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">Ctrl / ⌘ + H</kbd>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground text-xs">Send Message</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">Enter</kbd>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground text-xs">New line in input</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">Shift + Enter</kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="px-5 py-2.5 border-t border-border/50 flex items-center justify-between shrink-0 bg-muted/10">
          <span className="text-[11px] text-muted-foreground">
            Saved automatically
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-md bg-foreground text-background font-medium text-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
