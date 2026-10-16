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
  Keyboard,
  Bot,
  Github,
  Cloud,
  Flame,
  Database as DatabaseIcon,
  Smartphone,
  Activity
} from 'lucide-react';
import { AndroidMainSettings } from './AndroidMainSettings';
import { DiagnosticPanel } from './DiagnosticPanel';
import { useFirebase } from '@/context/FirebaseContext';
import { GitHubRepositoryBrowser } from './GitHubRepositoryBrowser';
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
import { requestMicrophonePermission, requestCameraAccess, getPermissionsStatus, PermissionState } from '@/lib/permissionsManager';
import { MicrophonePermissionModal } from '@/components/voice/MicrophonePermissionModal';
import { useTheme } from '@/context/ThemeContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';

const VOICE_LANGUAGE_OPTIONS = [
  { code: 'en-US', name: 'English (United States)', flag: '🇺🇸' },
  { code: 'en-GB', name: 'English (United Kingdom)', flag: '🇬🇧' },
  { code: 'en-IN', name: 'English (India)', flag: '🇮🇳' },
  { code: 'hi-IN', name: 'Hindi (हिंदी - भारत)', flag: '🇮🇳' },
  { code: 'es-ES', name: 'Spanish (Español - España)', flag: '🇪🇸' },
  { code: 'es-MX', name: 'Spanish (Español - México)', flag: '🇲🇽' },
  { code: 'fr-FR', name: 'French (Français)', flag: '🇫🇷' },
  { code: 'de-DE', name: 'German (Deutsch)', flag: '🇩🇪' },
  { code: 'ja-JP', name: 'Japanese (日本語)', flag: '🇯🇵' },
  { code: 'zh-CN', name: 'Chinese Mandarin (中文 - 简体)', flag: '🇨🇳' },
  { code: 'zh-HK', name: 'Chinese Cantonese (粵語 - 香港)', flag: '🇭🇰' },
  { code: 'pt-BR', name: 'Portuguese (Português - Brasil)', flag: '🇧🇷' },
  { code: 'it-IT', name: 'Italian (Italiano)', flag: '🇮🇹' },
  { code: 'ko-KR', name: 'Korean (한국어)', flag: '🇰🇷' },
  { code: 'ar-SA', name: 'Arabic (العربية)', flag: '🇸🇦' },
  { code: 'ru-RU', name: 'Russian (Русский)', flag: '🇷🇺' },
  { code: 'nl-NL', name: 'Dutch (Nederlands)', flag: '🇳🇱' },
  { code: 'tr-TR', name: 'Turkish (Türkçe)', flag: '🇹🇷' },
  { code: 'vi-VN', name: 'Vietnamese (Tiếng Việt)', flag: '🇻🇳' },
  { code: 'auto', name: 'Browser Auto-Detect', flag: '🌐' },
];
import { WorkspaceConnectButton } from '../workspace/WorkspaceConnectButton';
import { RobotHead } from 'robot-heads';

const ROBOT_THEMES = [
  { label: 'Manus blue', shell: '#2b49a3', trim: '#93a6c8', screen: '#e8f2ff' },
  { label: 'Graphite', shell: '#30343b', trim: '#9299a5', screen: '#e9f1ff' },
  { label: 'Mint', shell: '#176b5b', trim: '#9bd8c7', screen: '#e2fff5' },
  { label: 'Violet', shell: '#593c9b', trim: '#b9a7ed', screen: '#f1eaff' },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  activeTaskInfo?: {
    taskId?: string | null;
    prompt?: string;
    taskStatus?: 'idle' | 'running' | 'completed' | 'error';
    messages?: any[];
    steps?: any[];
    result?: any;
  };
}

type SettingsTab = 'general' | 'robot' | 'ai' | 'diagnostics' | 'personalization' | 'voice' | 'data' | 'connectors' | 'about';

export function SettingsModal({ isOpen, onClose, initialTab, activeTaskInfo }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const { user: fbUser, signInWithGoogle, signOut: fbSignOut } = useFirebase();
  const [settings, setSettings] = useState<UserSettings>(getSettings());
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'general');
  const [isExporting, setIsExporting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAndroidView, setShowAndroidView] = useState(false);
  const [micStatus, setMicStatus] = useState<PermissionState>('prompt');
  const [cameraStatus, setCameraStatus] = useState<PermissionState>('prompt');
  const [showMicHelpModal, setShowMicHelpModal] = useState(false);

  const checkMediaPermissions = async () => {
    const status = await getPermissionsStatus();
    setMicStatus(status.microphone);
    setCameraStatus(status.camera);
  };

  useEffect(() => {
    if (isOpen) {
      setSettings(getSettings());
      setShowClearConfirm(false);
      checkMediaPermissions();
      if (initialTab) {
        setActiveTab(initialTab);
      }
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    const handleOpenSettingsEvent = (e: any) => {
      if (e.detail?.tab) {
        setActiveTab(e.detail.tab);
      }
    };
    window.addEventListener('manus_open_settings', handleOpenSettingsEvent);
    return () => window.removeEventListener('manus_open_settings', handleOpenSettingsEvent);
  }, []);

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
    { id: 'connectors', label: 'GitHub & Repos', icon: Github },
    { id: 'robot', label: 'Robot', icon: Bot },
    { id: 'ai', label: 'AI & Models', icon: Brain },
    { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
    { id: 'personalization', label: 'Personalization', icon: User },
    { id: 'voice', label: 'Voice & Audio', icon: Volume2 },
    { id: 'data', label: 'Data & Privacy', icon: Shield },
    { id: 'about', label: 'About', icon: Info },
  ];

  if (showAndroidView) {
    return <AndroidMainSettings onBack={() => setShowAndroidView(false)} isOpen={isOpen} />;
  }

  return (
    <>
      {/* Mobile Android 15 Edge-to-Edge Main Settings */}
      <div className="sm:hidden fixed inset-0 z-50">
        <AndroidMainSettings onBack={onClose} isOpen={isOpen} />
      </div>

      {/* Desktop Responsive Settings Dialog */}
      <div 
        className="hidden sm:flex fixed inset-0 z-50 items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAndroidView(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                title="Switch to Android 15 Edge-to-Edge Settings View"
              >
                <Smartphone size={14} />
                <span>Android 15 View</span>
              </button>
              <button 
                onClick={onClose}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
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

                {/* Auto-scroll to results */}
                <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">Auto-scroll to Results</p>
                    <p className="text-[11px] text-muted-foreground">Automatically center search content in view once stream finishes</p>
                  </div>
                  <button
                    onClick={() => updateSetting('autoScrollToResults', settings.autoScrollToResults === false ? true : false)}
                    role="switch"
                    aria-checked={settings.autoScrollToResults !== false}
                    aria-label="Toggle auto-scroll to results"
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      settings.autoScrollToResults !== false ? "bg-foreground" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out",
                        settings.autoScrollToResults !== false ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>

                {/* Google Workspace Account */}
                <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">Google Workspace Account</p>
                    <p className="text-[11px] text-muted-foreground">Sign in to connect Calendar, Gmail & Drive</p>
                  </div>
                  <WorkspaceConnectButton />
                </div>

                {/* GitHub Connection & Repositories Quick Row */}
                <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">GitHub Integration</p>
                    <p className="text-[11px] text-muted-foreground">Browse user-accessible public & private repositories</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('connectors')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/70 hover:bg-muted text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Github size={13} />
                    <span>Browse Repositories</span>
                  </button>
                </div>
              </div>
            )}

            {/* GITHUB & REPOSITORIES TAB */}
            {activeTab === 'connectors' && (
              <div className="space-y-4 animate-in fade-in duration-100">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">GitHub Repositories</h3>
                  <p className="text-xs text-muted-foreground">Browse, search, and inspect user-accessible repositories for your GitHub connection.</p>
                </div>
                <GitHubRepositoryBrowser />
              </div>
            )}

            {/* ROBOT CUSTOMIZATION TAB */}
            {activeTab === 'robot' && (
              <div className="space-y-5 animate-in fade-in duration-100">
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">Customize Robot</p>
                  <p className="text-[11px] text-muted-foreground">Personalize the robot face shown on the home page. Changes save automatically.</p>
                </div>

                {/* Live Interactive Robot Avatar Preview */}
                <div className="flex flex-col items-center justify-center p-4 rounded-2xl border border-border/60 bg-muted/20 backdrop-blur-xs">
                  <RobotHead
                    state={(settings.robotState as any) || 'idle'}
                    shape={(settings.robotShape as any) || 'rectangle'}
                    size={128}
                    color={ROBOT_THEMES[settings.robotTheme ?? 0]?.shell || ROBOT_THEMES[0].shell}
                    trimColor={ROBOT_THEMES[settings.robotTheme ?? 0]?.trim || ROBOT_THEMES[0].trim}
                    screenColor={ROBOT_THEMES[settings.robotTheme ?? 0]?.screen || ROBOT_THEMES[0].screen}
                    speed={settings.robotSpeed ?? 1}
                    paused={settings.robotPaused ?? false}
                    interactive={settings.robotInteractive ?? true}
                    antenna={settings.robotAntenna ?? true}
                    floorShadow={settings.robotFloorShadow ?? true}
                    seed={settings.robotSeed ?? 0.3}
                    className="shrink-0"
                  />
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-2">
                    Live Robot Preview
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-foreground">Animation State</p>
                      <p className="text-[11px] text-muted-foreground">Choose the robot's expression and activity</p>
                    </div>
                    <select aria-label="Robot animation state" value={settings.robotState} onChange={(e) => updateSetting('robotState', e.target.value)} className="text-xs bg-muted/40 border border-border/60 rounded-lg px-2.5 py-1.5 text-foreground">
                      {[
                        { value: 'idle', label: 'Idle' }, { value: 'thinking', label: 'Thinking' },
                        { value: 'searching', label: 'Searching' }, { value: 'listening', label: 'Listening' },
                        { value: 'speaking', label: 'Speaking' }, { value: 'working', label: 'Working' },
                        { value: 'happy', label: 'Happy' }, { value: 'error', label: 'Error' },
                        { value: 'sleeping', label: 'Sleeping' },
                      ].map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-3 border-t border-border/40">
                    <div>
                      <p className="text-xs font-medium text-foreground">Robot Shape</p>
                      <p className="text-[11px] text-muted-foreground">Change the face outline</p>
                    </div>
                    <select aria-label="Robot shape" value={settings.robotShape} onChange={(e) => updateSetting('robotShape', e.target.value)} className="text-xs bg-muted/40 border border-border/60 rounded-lg px-2.5 py-1.5 text-foreground">
                      <option value="rectangle">TV / Rectangle</option><option value="square">Square</option><option value="circle">Circle</option><option value="hexagon">Hexagon</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-3 border-t border-border/40">
                    <div>
                      <p className="text-xs font-medium text-foreground">Color Style</p>
                      <p className="text-[11px] text-muted-foreground">Choose the robot's shell and screen colors</p>
                    </div>
                    <select aria-label="Robot color theme" value={settings.robotTheme} onChange={(e) => updateSetting('robotTheme', Number(e.target.value))} className="text-xs bg-muted/40 border border-border/60 rounded-lg px-2.5 py-1.5 text-foreground">
                      <option value={0}>Manus blue</option><option value={1}>Graphite</option><option value={2}>Mint</option><option value={3}>Violet</option>
                    </select>
                  </div>

                  <div className="pt-3 border-t border-border/40">
                    <div className="flex items-center justify-between mb-2">
                      <div><p className="text-xs font-medium text-foreground">Animation Speed</p><p className="text-[11px] text-muted-foreground">Adjust how quickly the robot moves</p></div>
                      <span className="text-xs font-mono text-muted-foreground">{settings.robotSpeed.toFixed(1)}×</span>
                    </div>
                    <input aria-label="Robot animation speed" type="range" min="0.5" max="1.8" step="0.1" value={settings.robotSpeed} onChange={(e) => updateSetting('robotSpeed', Number(e.target.value))} className="w-full accent-foreground" />
                  </div>

                  <div className="pt-3 border-t border-border/40">
                    <div className="flex items-center justify-between mb-2">
                      <div><p className="text-xs font-medium text-foreground">Animation Timing</p><p className="text-[11px] text-muted-foreground">Fine-tune the animation variation</p></div>
                      <span className="text-xs font-mono text-muted-foreground">{settings.robotSeed.toFixed(1)}</span>
                    </div>
                    <input aria-label="Robot animation timing" type="range" min="0" max="1" step="0.1" value={settings.robotSeed} onChange={(e) => updateSetting('robotSeed', Number(e.target.value))} className="w-full accent-foreground" />
                  </div>

                  <div className="pt-3 border-t border-border/40 space-y-3">
                    {[
                      { key: 'robotPaused' as const, label: 'Pause Animation', desc: 'Keep the robot face still' },
                      { key: 'robotInteractive' as const, label: 'Pointer / Click Interaction', desc: 'Allow the robot to react to pointer and click input' },
                      { key: 'robotAntenna' as const, label: 'Show Antenna', desc: 'Display the robot antenna' },
                      { key: 'robotFloorShadow' as const, label: 'Floor Shadow', desc: 'Show a shadow beneath the robot' },
                      { key: 'robotCloudSync' as const, label: 'Cloud-Sync Personality & Themes', desc: 'Enables cloud-syncing of custom robot personalities and visual themes across different devices' },
                    ].map((item) => (
                      <div key={item.key} className="flex items-center justify-between gap-4">
                        <div><p className="text-xs font-medium text-foreground">{item.label}</p><p className="text-[11px] text-muted-foreground">{item.desc}</p></div>
                        <button type="button" onClick={() => updateSetting(item.key, !settings[item.key])} role="switch" aria-checked={settings[item.key]} aria-label={item.label} className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none", settings[item.key] ? "bg-foreground" : "bg-muted")}>
                          <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-xs transform transition duration-200 ease-in-out", settings[item.key] ? "translate-x-4" : "translate-x-0")} />
                        </button>
                      </div>
                    ))}
                  </div>
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
                      { id: 'manus-1.6-lite', name: 'Manus 1.6 Lite', desc: 'Fast execution for quick chats and requests (1M context)', tag: 'Fast' },
                      { id: 'manus-1.6-max', name: 'Manus 1.6 Max (2M)', desc: 'Deep reasoning with massive 2 Million token context window', tag: '2M Pro' },
                      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (2M Context)', desc: '2,000,000 token context window for huge codebases, books, and documents', tag: '2M Context' },
                      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: 'Multimodal vision and rapid document analysis (1M context)', tag: 'Vision' },
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

                {/* Active Task Diagnostics in AI Tab */}
                <div className="pt-4 border-t border-border/50">
                  <DiagnosticPanel activeTaskInfo={activeTaskInfo} />
                </div>
              </div>
            )}

            {/* DIAGNOSTICS TAB */}
            {activeTab === 'diagnostics' && (
              <div className="space-y-6 animate-in fade-in duration-100">
                <DiagnosticPanel activeTaskInfo={activeTaskInfo} />
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
                      { id: 'marcus', name: 'Marcus', desc: 'Human Male • Warm' },
                      { id: 'onyx', name: 'Onyx', desc: 'Deep Male • Resonant' },
                      { id: 'echo', name: 'Echo', desc: 'Smooth Male • Calm' },
                      { id: 'tintin', name: 'Tintin', desc: 'Natural Male • Crisp' },
                      { id: 'nova', name: 'Nova', desc: 'Warm Human' },
                      { id: 'alloy', name: 'Alloy', desc: 'Neutral Natural' },
                      { id: 'shimmer', name: 'Shimmer', desc: 'Bright Female' },
                      { id: 'fable', name: 'Fable', desc: 'Clear Natural' },
                    ].map((v) => {
                      const isSelected = settings.voicePersona === v.id;
                      return (
                        <button
                          key={v.id}
                          onClick={() => {
                            updateSetting('voicePersona', v.id as VoicePersona);
                            speakCleanHumanVoice(`Hello! This is ${v.name}, speaking to you in natural human audio.`, {
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

                {/* Voice Input Language (Voice-to-Text) Selector */}
                <div className="pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        Voice Input Language (Voice-to-Text)
                        <Globe size={13} className="text-muted-foreground" />
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Select your preferred spoken language for dictating prompts and voice messaging
                      </p>
                    </div>
                  </div>

                  <Select
                    value={settings.voiceInputLanguage || 'en-US'}
                    onValueChange={(val) => {
                      updateSetting('voiceInputLanguage', val);
                      const opt = VOICE_LANGUAGE_OPTIONS.find(o => o.code === val);
                      toast.success(`Voice input language set to ${opt?.name || val}`);
                    }}
                  >
                    <SelectTrigger className="w-full h-9 text-xs bg-card/40 border-border/60">
                      <SelectValue placeholder="Select preferred voice input language" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {VOICE_LANGUAGE_OPTIONS.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code} className="text-xs cursor-pointer">
                          <span className="flex items-center gap-2">
                            <span>{lang.flag}</span>
                            <span className="font-medium">{lang.name}</span>
                            <span className="text-[10px] font-mono text-muted-foreground ml-2 opacity-80">({lang.code})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

                {/* Voice Pitch Adjustment Slider */}
                <div className="pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between mb-2.5">
                    <div>
                      <p className="text-xs font-medium text-foreground">Voice Pitch</p>
                      <p className="text-[11px] text-muted-foreground">Fine-tune vocal tone to sound more natural or clear</p>
                    </div>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted text-foreground font-semibold">
                      {(settings.voicePitch ?? 1.0).toFixed(2)}x
                    </span>
                  </div>
                  <div className="space-y-2">
                    <Slider
                      value={[settings.voicePitch ?? 1.0]}
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      onValueChange={([val]) => {
                        updateSetting('voicePitch', val);
                      }}
                      onValueCommit={([val]) => {
                        speakCleanHumanVoice(`Voice pitch adjusted to ${val.toFixed(2)}`, {
                          voicePersona: settings.voicePersona,
                          pitch: val,
                          rate: settings.speechSpeed,
                          volume: 1.0,
                        });
                      }}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground font-medium pt-1">
                      <span>0.5x (Deeper)</span>
                      <span>1.0x (Natural)</span>
                      <span>1.5x (Higher)</span>
                    </div>
                  </div>
                </div>

                {/* Audio Processing Filter Checkbox */}
                <div className="pt-4 border-t border-border/50">
                  <div className="flex items-start gap-3 p-3 rounded-xl border border-border/60 bg-card/40 hover:bg-card/70 transition-colors">
                    <Checkbox
                      id="enable-audio-filter"
                      checked={settings.enableAudioFilter ?? true}
                      onCheckedChange={(checked) => {
                        const isChecked = checked === true;
                        updateSetting('enableAudioFilter', isChecked);
                        if (isChecked) {
                          toast.success('Audio clarity filter enabled (Noise reduced & speech enhanced)');
                        } else {
                          toast.info('Audio filter disabled');
                        }
                      }}
                      className="mt-0.5"
                    />
                    <label htmlFor="enable-audio-filter" className="cursor-pointer select-none space-y-0.5">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        Audio Processing Filter
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.2 rounded font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          Recommended
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Reduces background noise, equalizes frequency bands, and sharpens vocal articulation for clean human speech.
                      </p>
                    </label>
                  </div>

                  {/* Auto-Submit Speech After 7s Silence */}
                  <div className="flex items-start gap-3 p-3 mt-2.5 rounded-xl border border-border/60 bg-card/40 hover:bg-card/70 transition-colors">
                    <Checkbox
                      id="enable-auto-submit-silence"
                      checked={settings.autoSubmitVoiceAfterSilence ?? true}
                      onCheckedChange={(checked) => {
                        const isChecked = checked === true;
                        updateSetting('autoSubmitVoiceAfterSilence', isChecked);
                        if (isChecked) {
                          toast.success('Auto-submit after 7s silence enabled');
                        } else {
                          toast.info('Auto-submit after 7s silence disabled');
                        }
                      }}
                      className="mt-0.5"
                    />
                    <label htmlFor="enable-auto-submit-silence" className="cursor-pointer select-none space-y-0.5">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        Auto-Submit Speech After 7s Silence
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.2 rounded font-semibold bg-primary/10 text-primary">
                          7 Seconds
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Automatically sends the transcribed prompt to the AI assistant if you remain silent for more than 7 seconds after speaking.
                      </p>
                    </label>
                  </div>
                </div>

                {/* Microphone & Camera Permission Check */}
                <div className="pt-4 border-t border-border/50 space-y-3">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider text-muted-foreground/80">
                    Device Access & Media Permissions
                  </p>

                  {/* Microphone Permission */}
                  <div className="p-3.5 rounded-xl border border-border/60 bg-card/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground flex items-center gap-2">
                          Microphone Permission
                          {micStatus === 'granted' && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              Granted 🟢
                            </span>
                          )}
                          {micStatus === 'prompt' && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              Permission Needed 🟡
                            </span>
                          )}
                          {(micStatus === 'denied' || micStatus === 'unsupported') && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                              Blocked / Denied 🔴
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {micStatus === 'granted'
                            ? 'Microphone is active and ready for voice input & live calls.'
                            : micStatus === 'denied'
                            ? 'Microphone access is blocked in your browser. Unblock in site settings.'
                            : 'Request microphone access to dictate prompts and talk with AI.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          toast.info('Requesting microphone permission...');
                          const granted = await requestMicrophonePermission();
                          await checkMediaPermissions();
                          if (granted) {
                            toast.success('Microphone permission GRANTED! 🎙️', { icon: '🎙️' });
                          } else {
                            toast.error('Microphone permission was not granted. Please check browser site settings -> Microphone -> Allow.', { duration: 5000 });
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-xl border border-border hover:border-foreground/40 bg-muted/50 hover:bg-muted text-xs font-semibold text-foreground transition-all cursor-pointer shrink-0 ml-3 shadow-xs"
                      >
                        {micStatus === 'granted' ? 'Re-test Mic 🎙️' : 'Grant / Enable Mic 🎙️'}
                      </button>
                    </div>

                    {micStatus === 'denied' && (
                      <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-600 dark:text-rose-300 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">Microphone access is blocked</p>
                          <p className="mt-0.5 opacity-90">Allow Microphone in your browser address bar settings to dictate prompts.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowMicHelpModal(true)}
                          className="px-2.5 py-1 rounded-lg bg-rose-500 text-white font-medium text-xs hover:bg-rose-600 transition-colors shrink-0 cursor-pointer shadow-xs"
                        >
                          Unblock Guide 🎙️
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Camera Permission */}
                  <div className="p-3.5 rounded-xl border border-border/60 bg-card/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground flex items-center gap-2">
                          Camera Permission
                          {cameraStatus === 'granted' && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              Granted 🟢
                            </span>
                          )}
                          {cameraStatus === 'prompt' && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              Permission Needed 🟡
                            </span>
                          )}
                          {(cameraStatus === 'denied' || cameraStatus === 'unsupported') && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                              Blocked / Denied 🔴
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {cameraStatus === 'granted'
                            ? 'Camera is active and ready for visual attachments & photo captures.'
                            : cameraStatus === 'denied'
                            ? 'Camera access is blocked in your browser. Unblock in site settings.'
                            : 'Request camera access to capture photos and analyze documents with AI.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          toast.info('Requesting camera permission...');
                          const granted = await requestCameraAccess();
                          await checkMediaPermissions();
                          if (granted) {
                            toast.success('Camera permission GRANTED! 📷', { icon: '📷' });
                          } else {
                            toast.error('Camera permission was not granted. Please check browser site settings -> Camera -> Allow.', { duration: 5000 });
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-xl border border-border hover:border-foreground/40 bg-muted/50 hover:bg-muted text-xs font-semibold text-foreground transition-all cursor-pointer shrink-0 ml-3 shadow-xs"
                      >
                        {cameraStatus === 'granted' ? 'Re-test Camera 📷' : 'Grant / Enable Camera 📷'}
                      </button>
                    </div>

                    {cameraStatus === 'denied' && (
                      <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-600 dark:text-rose-300">
                        <p className="font-semibold">How to enable Camera in Chrome/Edge:</p>
                        <p className="mt-0.5 opacity-90">1. Click the lock/sliders icon 🔒 in the browser address bar above.</p>
                        <p className="opacity-90">2. Toggle <strong>Camera</strong> to <strong>Allow</strong>.</p>
                        <p className="opacity-90">3. Reload the page and click <em>Re-test Camera</em> above.</p>
                      </div>
                    )}
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
                {/* Firebase Cloud Sync & Database Card */}
                <div className="p-4 rounded-xl border border-border/80 bg-card/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                        <Flame size={18} />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
                          Firebase Firestore Cloud Sync
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Active 🟢
                          </span>
                        </h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Project: <span className="font-mono text-foreground font-medium">eternal-envoy-cnzsc</span> (asia-southeast1)
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-[11px] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Database Engine:</span>
                      <span className="font-medium text-foreground">Cloud Firestore (Enterprise)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Authentication:</span>
                      <span className="font-medium text-foreground">{fbUser ? fbUser.email : 'Google Login Available'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Persistent Collections:</span>
                      <span className="font-mono text-[10px] text-foreground">users, conversations, messages, projects</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="text-[11px] text-muted-foreground">
                      {fbUser ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          Signed in as {fbUser.displayName || fbUser.email}
                        </span>
                      ) : (
                        <span>Sign in to automatically sync your chats & projects across devices.</span>
                      )}
                    </div>
                    {fbUser ? (
                      <button
                        onClick={() => fbSignOut()}
                        className="px-3 py-1.5 text-xs font-medium border border-border hover:border-destructive hover:text-destructive rounded-lg transition-colors cursor-pointer"
                      >
                        Sign Out
                      </button>
                    ) : (
                      <button
                        onClick={() => signInWithGoogle()}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
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
                </div>

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
  </>
);
}
