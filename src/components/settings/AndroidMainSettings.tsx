import React, { useState, useEffect } from 'react';
import { 
  getSettings, 
  saveSettings, 
  exportWorkspaceBackup, 
  importWorkspaceBackup, 
  clearAllWorkspaceHistory,
  playNotificationSound 
} from '@/lib/settingsStore';
import { UserSettings, AppTheme, ResponseTone, VoicePersona } from '@/types/settings';
import { useTheme } from '@/context/ThemeContext';
import { useFirebase } from '@/context/FirebaseContext';
import { useBlinkAuth } from '@blinkdotnew/react';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';
import { toast } from 'sonner';
import { 
  X, 
  Check, 
  Play, 
  Square, 
  Trash2, 
  Download, 
  Upload, 
  Sparkles, 
  AlertTriangle,
  LogOut,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { GitHubRepositoryBrowser } from './GitHubRepositoryBrowser';
import { WorkspaceConnectButton } from '../workspace/WorkspaceConnectButton';
import { AndroidGeneralSettings } from './AndroidGeneralSettings';
import { AndroidVoiceSettings } from './AndroidVoiceSettings';
import { AndroidRobotSettings } from './AndroidRobotSettings';
import { DiagnosticPanel } from './DiagnosticPanel';
import { StitchSettingsPanels } from './StitchSettingsPanels';
import type { StitchSettingsView } from './StitchSettingsPanels';

interface AndroidMainSettingsProps {
  onBack?: () => void;
  isOpen?: boolean;
}

type ActiveSubView = 
  | null 
  | 'personalization' 
  | 'memory' 
  | 'plugins' 
  | 'workspace' 
  | 'robot' 
  | 'plan' 
  | 'usage' 
  | 'account_info' 
  | 'email' 
  | 'profile_details' 
  | 'accent_color' 
  | 'general' 
  | 'notifications' 
  | 'voice' 
  | 'safety' 
  | 'security' 
  | 'remote_control' 
  | 'storage' 
  | 'privacy' 
  | 'data_controls' 
  | 'report_bug'
  | 'edit_avatar'
  | StitchSettingsView;

const ACCENT_COLORS = [
  { id: 'white', name: 'Pure White', hex: '#FFFFFF', ring: 'ring-white/30' },
  { id: 'blue', name: 'Manus Blue', hex: '#3B82F6', ring: 'ring-blue-500/30' },
  { id: 'emerald', name: 'Emerald Green', hex: '#10B981', ring: 'ring-emerald-500/30' },
  { id: 'violet', name: 'Electric Violet', hex: '#8B5CF6', ring: 'ring-violet-500/30' },
  { id: 'amber', name: 'Warm Amber', hex: '#F59E0B', ring: 'ring-amber-500/30' },
  { id: 'rose', name: 'Sunset Rose', hex: '#F43F5E', ring: 'ring-rose-500/30' },
  { id: 'cyan', name: 'Cyan Wave', hex: '#06B6D4', ring: 'ring-cyan-500/30' }
];

const VOICE_OPTIONS: { id: VoicePersona; label: string; desc: string; preview: string }[] = [
  { id: 'alloy', label: 'Alloy', desc: 'Neutral, balanced & versatile', preview: 'Hello! I am Alloy, your balanced Manus AI voice assistant.' },
  { id: 'echo', label: 'Echo', desc: 'Warm, clear & conversational', preview: 'Greetings! I am Echo, ready to assist your workflows.' },
  { id: 'nova', label: 'Nova', desc: 'Energetic, cheerful & crisp', preview: 'Hi there! Nova here, let us tackle your project!' },
  { id: 'shimmer', label: 'Shimmer', desc: 'Bright, expressive & friendly', preview: 'Welcome to Manus. I am Shimmer, how can I help?' },
  { id: 'fable', label: 'Fable', desc: 'Warm narrative storytelling', preview: 'Hello! I am Fable, bringing nuance and precision.' },
  { id: 'onyx', label: 'Onyx', desc: 'Deep, authoritative & smooth', preview: 'Onyx online. Autonomous systems ready.' },
  { id: 'marcus', label: 'Marcus', desc: 'Calm, thoughtful & technical', preview: 'Marcus speaking. Let us review the architecture.' },
  { id: 'tintin', label: 'Tintin', desc: 'Inquisitive & articulate', preview: 'Ready for deep research and real-time execution.' },
  { id: 'guy', label: 'Guy', desc: 'Friendly, down-to-earth & clear', preview: 'Hey there! Ready to get some real work done.' },
];

export function AndroidMainSettings({ onBack }: AndroidMainSettingsProps) {
  const { theme, setTheme } = useTheme();
  const { user: fbUser, signOut: fbSignOut, signInWithGoogle } = useFirebase();
  const { user: blinkUser } = useBlinkAuth();
  
  const [settings, setSettings] = useState<UserSettings>(getSettings());
  const [activeSubView, setActiveSubView] = useState<ActiveSubView>(null);
  const [currentTime, setCurrentTime] = useState('9:41');
  const [selectedAccent, setSelectedAccent] = useState('white');
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Form states for profile and personalization
  const [userName, setUserName] = useState(settings.userName || 'Manus User');
  const [userRole, setUserRole] = useState(settings.userRole || 'Software Architect');
  const [aboutUser, setAboutUser] = useState(settings.aboutUser || '');
  const [customInstructions, setCustomInstructions] = useState(settings.customInstructions || '');
  const [userInitials, setUserInitials] = useState('RR');
  const [userHandle, setUserHandle] = useState('@manus_user');
  const [userEmail, setUserEmail] = useState('user@manus.im');

  // Bug report states
  const [bugCategory, setBugCategory] = useState('UI / Layout');
  const [bugDescription, setBugDescription] = useState('');
  const [isSubmittingBug, setIsSubmittingBug] = useState(false);

  // Memory bank mock/live items
  const [memories, setMemories] = useState<string[]>([
    'Prefers clean TypeScript code with Tailwind CSS utilities.',
    'Always use responsive 100dvh for mobile viewport-aware components.',
    'Working on Manus Remix autonomous agent application with voice integration.'
  ]);
  const [newMemory, setNewMemory] = useState('');

  // Clock sync
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      // Format as 12-hour or standard
      const formatted = `${hours % 12 || 12}:${minutes}`;
      setCurrentTime(formatted);
    };
    updateClock();
    const interval = setInterval(updateClock, 30000);
    return () => clearInterval(interval);
  }, []);

  // Update profile from auth or stored settings
  useEffect(() => {
    const currentSettings = getSettings();
    setSettings(currentSettings);
    if (currentSettings.userName) {
      setUserName(currentSettings.userName);
      const parts = currentSettings.userName.trim().split(' ');
      if (parts.length >= 2) {
        setUserInitials(`${parts[0][0]}${parts[1][0]}`.toUpperCase());
      } else if (parts[0]) {
        setUserInitials(parts[0].slice(0, 2).toUpperCase());
      }
    }
    if (fbUser?.email) {
      setUserEmail(fbUser.email);
      setUserHandle(`@${fbUser.email.split('@')[0]}`);
    } else if (blinkUser?.email) {
      setUserEmail(blinkUser.email);
      setUserHandle(`@${blinkUser.email.split('@')[0]}`);
    }
  }, [fbUser, blinkUser]);

  const handleUpdateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const updated = saveSettings({ [key]: value });
    setSettings(updated);
    if (key === 'theme') {
      setTheme(value as any);
    }
  };

  const handleSaveProfile = () => {
    handleUpdateSetting('userName', userName);
    handleUpdateSetting('userRole', userRole);
    handleUpdateSetting('aboutUser', aboutUser);
    handleUpdateSetting('customInstructions', customInstructions);
    toast.success('Profile and preferences updated');
    setActiveSubView(null);
  };

  const handleVoicePreview = (sampleText: string) => {
    if (isPlayingVoice) {
      stopCleanSpeech();
      setIsPlayingVoice(false);
      return;
    }
    setIsPlayingVoice(true);
    speakCleanHumanVoice(
      sampleText,
      {
        voicePersona: settings.voicePersona,
        rate: settings.speechSpeed,
        pitch: settings.voicePitch,
        onEnd: () => setIsPlayingVoice(false),
        onError: () => setIsPlayingVoice(false)
      }
    );
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
      toast.success('Workspace backup downloaded');
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
          toast.success('Workspace restored successfully');
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
    toast.success('All history and cached checkpoints cleared');
  };

  const handleSignOut = async () => {
    try {
      if (fbUser) await fbSignOut();
      toast.success('Signed out successfully');
      setShowLogoutConfirm(false);
      if (onBack) onBack();
    } catch {
      toast.error('Error signing out');
    }
  };

  const handleSubmitBugReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bugDescription.trim()) {
      toast.error('Please describe the issue');
      return;
    }
    setIsSubmittingBug(true);
    setTimeout(() => {
      setIsSubmittingBug(false);
      setBugDescription('');
      setActiveSubView(null);
      toast.success('Thank you! Bug report submitted to engineering');
    }, 700);
  };

  const handleBack = () => {
    if (activeSubView) {
      setActiveSubView(null);
    } else if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#000000] font-sans text-neutral-200 antialiased flex flex-col min-h-screen selection:bg-[#333537] selection:text-white overflow-hidden">
      
      {/* Android 15 Edge-to-Edge Status Bar */}
      <div className="fixed top-0 inset-x-0 h-11 z-50 flex items-center justify-between px-6 bg-[#000000]/90 backdrop-blur-md text-white select-none pt-safe">
        <div className="flex items-center">
          <span className="text-[14px] font-semibold tracking-tight text-white/95">{currentTime}</span>
        </div>
        <div className="flex items-center space-x-2 text-white/90">
          <span className="text-[12px] font-bold tracking-wider text-neutral-400">5G</span>
          <span className="material-symbols-outlined text-[18px]">wifi</span>
          <span className="material-symbols-outlined text-[19px]">battery_full</span>
        </div>
      </div>

      {/* Android Native App Bar Header */}
      <header className="fixed top-0 inset-x-0 z-40 bg-[#000000]/95 backdrop-blur-md pt-safe border-b border-[#333537]/20">
        <div className="h-16 pt-3 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button 
              aria-label="Go back" 
              className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-neutral-200 active:bg-neutral-800 transition-colors cursor-pointer" 
              onClick={handleBack} 
              type="button"
            >
              <span className="material-symbols-outlined text-[24px]">arrow_back</span>
            </button>
            <h1 className="text-[20px] font-semibold text-white tracking-tight">
              {activeSubView ? (
                activeSubView.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
              ) : (
                'Main Settings'
              )}
            </h1>
          </div>
          <button 
            type="button"
            onClick={() => setActiveSubView('profile_details')}
            className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm cursor-pointer active:scale-95 transition-transform"
            title="Profile"
          >
            <span className="material-symbols-outlined text-neutral-900 text-[19px] fill-current">person</span>
          </button>
        </div>
      </header>

      {/* Main Scrollable Content */}
      <main className="flex flex-col relative w-full px-4 pt-24 pb-14 bg-[#000000] flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        <div className="flex flex-col w-full select-none max-w-md mx-auto">
          
          {/* Profile Header Hero */}
          <div className="flex flex-col items-center justify-center pt-2 pb-7">
            {/* Circular Dark Charcoal Avatar with Floating Pencil Badge */}
            <div className="relative flex items-center justify-center">
              <div className="w-[92px] h-[92px] rounded-full bg-[#1E1F20] border border-[#333537] flex items-center justify-center shadow-md">
                <span className="text-[32px] font-bold text-white tracking-tight">{userInitials}</span>
              </div>
              <button 
                aria-label="Edit Profile Picture" 
                onClick={() => setActiveSubView('profile_details')}
                className="absolute -bottom-0.5 -right-0.5 w-8 h-8 rounded-full bg-[#252627] border border-[#333537] flex items-center justify-center text-neutral-200 shadow-md active:scale-95 transition-transform cursor-pointer" 
                type="button"
              >
                <span className="material-symbols-outlined text-[17px]">edit</span>
              </button>
            </div>
            {/* Identity & Sleek Pro Badge */}
            <h2 className="mt-3.5 text-[21px] font-semibold text-white tracking-tight">{userName}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="text-[13px] text-neutral-400 font-medium">{userHandle}</span>
              <div 
                onClick={() => setActiveSubView('plan')}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1E1F20] border border-[#333537] ml-0.5 cursor-pointer active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[13px] text-amber-300">auto_awesome</span>
                <span className="text-[11px] font-semibold text-neutral-200 uppercase tracking-wider">Pro Tier</span>
              </div>
            </div>
          </div>

          {/* Settings Groups */}
          <div className="flex flex-col gap-6 w-full">
            
            {/* Group 1: My Manus */}
            <div className="flex flex-col">
              <span className="px-3 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">My Manus</span>
              <div className="bg-[#1E1F20] border border-[#333537] rounded-28 overflow-hidden flex flex-col shadow-sm">
                
                {/* Personalization */}
                <button 
                  onClick={() => setActiveSubView('personalization')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left group cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">mood</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Personalization</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px] group-active:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Memory */}
                <button 
                  onClick={() => setActiveSubView('memory')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left group cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">bookmarks</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Memory</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px] group-active:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Plugins & Connectors */}
                <button 
                  onClick={() => setActiveSubView('plugins')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left group cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">extension</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Plugins &amp; Connectors</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px] group-active:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
              </div>
            </div>

            {/* AI, providers and agent execution */}
            <div className="flex flex-col">
              <span className="px-3 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">AI &amp; Execution</span>
              <div className="bg-[#1E1F20] border border-[#333537] rounded-28 overflow-hidden flex flex-col shadow-sm">
                <button onClick={() => setActiveSubView('ai_models')} className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-all duration-200 text-left group cursor-pointer" type="button">
                  <div className="flex items-center gap-3.5 min-w-0"><div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0"><span className="material-symbols-outlined text-neutral-200 text-[20px]">memory</span></div><div className="min-w-0"><span className="block text-[15px] font-medium text-white truncate">AI Models &amp; Providers</span><span className="block text-[11px] text-neutral-500 mt-0.5">Model selection, routing and provider setup</span></div></div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px] group-active:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>
                <button onClick={() => setActiveSubView('connectors_integrations')} className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-all duration-200 text-left group cursor-pointer" type="button">
                  <div className="flex items-center gap-3.5 min-w-0"><div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0"><span className="material-symbols-outlined text-neutral-200 text-[20px]">extension</span></div><div className="min-w-0"><span className="block text-[15px] font-medium text-white truncate">Connectors &amp; Integrations</span><span className="block text-[11px] text-neutral-500 mt-0.5">Google Workspace, GitHub and tools</span></div></div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px] group-active:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>
                <button onClick={() => setActiveSubView('work_execution')} className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-all duration-200 text-left group cursor-pointer" type="button">
                  <div className="flex items-center gap-3.5 min-w-0"><div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0"><span className="material-symbols-outlined text-neutral-200 text-[20px]">terminal</span></div><div className="min-w-0"><span className="block text-[15px] font-medium text-white truncate">Work Mode Execution</span><span className="block text-[11px] text-neutral-500 mt-0.5">Autonomy, checkpoints and sandbox settings</span></div></div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px] group-active:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
              </div>
            </div>

            {/* Group 2: Account */}
            <div className="flex flex-col">
              <span className="px-3 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">Account</span>
              <div className="bg-[#1E1F20] border border-[#333537] rounded-28 overflow-hidden flex flex-col shadow-sm">
                
                {/* Workspace */}
                <button 
                  onClick={() => setActiveSubView('workspace')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">work_outline</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Workspace</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] text-neutral-400">Personal</span>
                    <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                  </div>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Plan & Subscription */}
                <button 
                  onClick={() => setActiveSubView('plan')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">auto_awesome</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Plan &amp; Subscription</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#252627] border border-[#333537] text-white text-[12px] font-semibold tracking-wide">Pro Tier</span>
                    <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                  </div>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Usage & Limits */}
                <button 
                  onClick={() => setActiveSubView('usage')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">bar_chart</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Usage &amp; Limits</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Account Information */}
                <button 
                  onClick={() => setActiveSubView('account_info')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">badge</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Account Information</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Email */}
                <button 
                  onClick={() => setActiveSubView('email')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">mail</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Email</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] text-neutral-400 truncate max-w-[130px]">{userEmail}</span>
                    <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                  </div>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Profile Details */}
                <button 
                  onClick={() => setActiveSubView('profile_details')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">account_circle</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Profile Details</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
              </div>
            </div>

            {/* Group 3: Preferences */}
            <div className="flex flex-col">
              <span className="px-3 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">Preferences</span>
              <div className="bg-[#1E1F20] border border-[#333537] rounded-28 overflow-hidden flex flex-col shadow-sm">
                
                {/* Accent Color */}
                <button 
                  onClick={() => setActiveSubView('accent_color')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">palette</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Accent Color</span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span 
                      className="w-4 h-4 rounded-full inline-block ring-2"
                      style={{ 
                        backgroundColor: ACCENT_COLORS.find(c => c.id === selectedAccent)?.hex || '#ffffff',
                        borderColor: '#ffffff'
                      }}
                    />
                    <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                  </div>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* General */}
                <button 
                  onClick={() => setActiveSubView('general')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">tune</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">General</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Notifications */}
                <button 
                  onClick={() => setActiveSubView('notifications')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">notifications</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Notifications</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Voice */}
                <button 
                  onClick={() => setActiveSubView('voice')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">graphic_eq</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Voice</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] text-neutral-400">Natural (Neural)</span>
                    <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                  </div>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Robot Avatar Settings */}
                <button 
                  onClick={() => setActiveSubView('robot')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">smart_toy</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Robot Settings</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] text-neutral-400">Sphere v2.4</span>
                    <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                  </div>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Safety & Wellbeing */}
                <button 
                  onClick={() => setActiveSubView('safety')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">health_and_safety</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Safety &amp; Wellbeing</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
              </div>
            </div>

            {/* Group 4: System & Privacy */}
            <div className="flex flex-col">
              <span className="px-3 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">System &amp; Privacy</span>
              <div className="bg-[#1E1F20] border border-[#333537] rounded-28 overflow-hidden flex flex-col shadow-sm">
                
                {/* Security & Login */}
                <button 
                  onClick={() => setActiveSubView('security')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">admin_panel_settings</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Security &amp; Login</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Remote Control */}
                <button 
                  onClick={() => setActiveSubView('remote_control')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">devices</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Remote Control</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Storage */}
                <button 
                  onClick={() => setActiveSubView('storage')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">hard_drive</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Storage</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] text-neutral-400">1.4 GB</span>
                    <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                  </div>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Privacy Center */}
                <button 
                  onClick={() => setActiveSubView('privacy')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">shield</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Privacy Center</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Data Controls */}
                <button 
                  onClick={() => setActiveSubView('data_controls')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">database</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Data Controls</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
                <div className="h-[1px] bg-[#333537] ml-16 mr-3"></div>

                {/* Report a Bug */}
                <button 
                  onClick={() => setActiveSubView('report_bug')}
                  className="w-full flex items-center justify-between px-4 h-[68px] active:bg-[#252627] transition-colors text-left cursor-pointer" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-neutral-200 text-[20px]">bug_report</span>
                    </div>
                    <span className="text-[15px] font-medium text-white truncate">Report a Bug</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px]">chevron_right</span>
                </button>
              </div>
            </div>

            {/* Log Out Option Card */}
            <div className="flex flex-col mt-1">
              <div className="bg-[#1E1F20] border border-[#333537] rounded-28 overflow-hidden flex flex-col shadow-sm">
                <button 
                  onClick={() => setShowLogoutConfirm(true)}
                  className="w-full flex items-center justify-between px-4 h-[64px] active:bg-[#252627] transition-colors text-left cursor-pointer group" 
                  type="button"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#252627] border border-[#333537]/80 flex items-center justify-center shrink-0 text-red-400">
                      <span className="material-symbols-outlined text-[20px]">logout</span>
                    </div>
                    <span className="text-[15px] font-medium text-red-400 truncate">Sign Out</span>
                  </div>
                  <span className="material-symbols-outlined text-neutral-500 text-[20px] group-active:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
              </div>
            </div>

            {/* Version & Build Info */}
            <div className="text-center py-6 text-neutral-500 text-xs space-y-1">
              <p className="font-medium">Manus Remix v2.5.0</p>
              <p className="text-[11px] text-neutral-600">Android 15 Edge-to-Edge • Mobile Stack</p>
            </div>

          </div>
        </div>
      </main>

      {/* SUB-PANEL MODALS */}

      {/* 1. Personalization Sub-panel */}
      {activeSubView === 'personalization' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setActiveSubView(null)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white"
              >
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Personalization</h2>
            </div>
            <button 
              onClick={handleSaveProfile}
              className="px-3 py-1.5 rounded-full bg-white text-black font-semibold text-xs active:scale-95 transition-transform"
            >
              Save
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Display Information</h3>
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Your Name</label>
                <input 
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full bg-[#252627] border border-[#333537] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-white/50"
                  placeholder="Your Name"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Role / Title</label>
                <input 
                  type="text"
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  className="w-full bg-[#252627] border border-[#333537] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-white/50"
                  placeholder="e.g. Software Engineer, Researcher"
                />
              </div>
            </div>

            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Custom AI Instructions</h3>
              <p className="text-xs text-neutral-400">Tell Manus what you want it to know about your preferences and response style.</p>
              <textarea 
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={4}
                className="w-full bg-[#252627] border border-[#333537] rounded-xl p-3 text-white text-sm outline-none focus:border-white/50 resize-none custom-scrollbar"
                placeholder="e.g. Prefer concise answers with functional TypeScript code..."
              />
            </div>

            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">Tone &amp; Style</h3>
              <div className="grid grid-cols-2 gap-2">
                {(['balanced', 'concise', 'professional', 'creative'] as ResponseTone[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleUpdateSetting('responseTone', t)}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium capitalize text-left flex items-center justify-between ${
                      settings.responseTone === t 
                        ? 'bg-white text-black border-white' 
                        : 'bg-[#252627] text-neutral-300 border-[#333537]'
                    }`}
                  >
                    <span>{t}</span>
                    {settings.responseTone === t && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Memory Bank Sub-panel */}
      {activeSubView === 'memory' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSubView(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Manus Memory</h2>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-3">
              <p className="text-xs text-neutral-400 leading-relaxed">
                Manus learns details from your conversations to personalize future responses. You can view or clear memories anytime.
              </p>
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder="Add custom remembered fact..."
                  className="flex-1 bg-[#252627] border border-[#333537] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-white/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newMemory.trim()) {
                      setMemories(prev => [...prev, newMemory.trim()]);
                      setNewMemory('');
                      toast.success('Memory saved');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newMemory.trim()) {
                      setMemories(prev => [...prev, newMemory.trim()]);
                      setNewMemory('');
                      toast.success('Memory saved');
                    }
                  }}
                  className="px-3 py-2 bg-white text-black font-semibold text-xs rounded-xl active:scale-95"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-1">Learned Knowledge</h3>
              {memories.map((m, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3 p-3 bg-[#252627] rounded-2xl border border-[#333537]/60">
                  <span className="text-xs text-neutral-200 leading-relaxed">{m}</span>
                  <button 
                    onClick={() => {
                      setMemories(prev => prev.filter((_, i) => i !== idx));
                      toast.info('Memory deleted');
                    }}
                    className="text-neutral-500 hover:text-red-400 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3. Plugins & Connectors Sub-panel */}
      {activeSubView === 'plugins' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSubView(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Plugins &amp; Connectors</h2>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Google Workspace Integration</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Connect your Google Drive, Docs, Sheets, Gmail, and Calendar for live context injection into agent reasoning.
              </p>
              <div className="pt-2">
                <WorkspaceConnectButton />
              </div>
            </div>

            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">GitHub Integration</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Browse, search, and clone GitHub repositories directly inside your Manus agent workspace.
              </p>
              <GitHubRepositoryBrowser />
            </div>
          </div>
        </div>
      )}

      {/* 4. Plan & Subscription Sub-panel */}
      {activeSubView === 'plan' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSubView(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Plan &amp; Subscription</h2>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-gradient-to-br from-[#1E1F20] to-[#252627] border border-[#333537] rounded-28 p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mx-auto text-amber-300">
                <Sparkles size={24} />
              </div>
              <h3 className="text-xl font-bold text-white tracking-tight">Pro Tier Active</h3>
              <p className="text-xs text-neutral-400 max-w-xs mx-auto">
                Unlimited access to multi-step reasoning, voice calls, deep web research, and live coding.
              </p>
              <div className="pt-2">
                <span className="inline-block px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold rounded-full">
                  Subscribed • Renews Next Cycle
                </span>
              </div>
            </div>

            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Included Features</h4>
              <div className="space-y-2.5 text-xs text-neutral-200">
                <div className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400" /> High-speed Gemini 2.5 Flash &amp; Pro</div>
                <div className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400" /> Full-duplex Voice Call with Low Latency</div>
                <div className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400" /> Autonomous Browser Sandbox &amp; Execution</div>
                <div className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400" /> Continuous Periodic Auto-Save &amp; Recovery</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Usage & Limits Sub-panel */}
      {activeSubView === 'usage' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSubView(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Usage &amp; Limits</h2>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <div className="flex justify-between items-center text-sm font-semibold">
                <span>Reasoning Tokens</span>
                <span className="text-emerald-400">124,500 / Unlimited</span>
              </div>
              <div className="w-full bg-[#252627] h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full w-[38%] rounded-full"></div>
              </div>
              <p className="text-xs text-neutral-400">38% of soft monthly allocation used. No throttling enabled.</p>
            </div>

            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <div className="flex justify-between items-center text-sm font-semibold">
                <span>Voice Call Minutes</span>
                <span className="text-blue-400">42 / Unlimited</span>
              </div>
              <div className="w-full bg-[#252627] h-2 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full w-[21%] rounded-full"></div>
              </div>
              <p className="text-xs text-neutral-400">Unlimited high-definition neural voice calls active.</p>
            </div>

            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5">
              <DiagnosticPanel />
            </div>
          </div>
        </div>
      )}

      {/* 6. Accent Color Sub-panel */}
      {activeSubView === 'accent_color' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSubView(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Accent Color</h2>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <p className="text-xs text-neutral-400">Choose your system highlight and badge color.</p>
              <div className="grid grid-cols-1 gap-2.5">
                {ACCENT_COLORS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedAccent(c.id);
                      toast.success(`Accent color set to ${c.name}`);
                    }}
                    className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                      selectedAccent === c.id 
                        ? 'bg-[#252627] border-white/60' 
                        : 'bg-[#1E1F20] border-[#333537] active:bg-[#252627]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full ring-2" style={{ backgroundColor: c.hex, borderColor: '#333537' }} />
                      <span className="text-sm font-medium text-white">{c.name}</span>
                    </div>
                    {selectedAccent === c.id && <Check size={16} className="text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. General Preferences Sub-panel (Obsidian Tactile Engine) */}
      {activeSubView === 'general' && (
        <AndroidGeneralSettings onBack={() => setActiveSubView(null)} />
      )}

      {/* 8. Voice Sub-panel (Acoustic Studio & Voice Engine) */}
      {activeSubView === 'voice' && (
        <AndroidVoiceSettings onBack={() => setActiveSubView(null)} />
      )}

      {/* 8b. Robot Avatar Sub-panel (Spherical Chassis & Neural Visualizer) */}
      {activeSubView === 'robot' && (
        <AndroidRobotSettings onBack={() => setActiveSubView(null)} />
      )}

      {/* Stitch-inspired detailed provider, connector and execution panels */}
      {(activeSubView === 'ai_models' || activeSubView === 'connectors_integrations' || activeSubView === 'work_execution') && (
        <StitchSettingsPanels view={activeSubView} onBack={() => setActiveSubView(null)} />
      )}

      {/* 9. Data Controls Sub-panel */}
      {activeSubView === 'data_controls' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSubView(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Data Controls</h2>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Workspace Backup</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Export or restore all conversations, generated artifacts, settings, and task history as a clean JSON package.
              </p>
              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  onClick={handleExportData}
                  disabled={isExporting}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-[#252627] border border-[#333537] rounded-2xl text-xs font-semibold text-white active:scale-98"
                >
                  <Download size={15} />
                  <span>{isExporting ? 'Exporting...' : 'Export Workspace (.json)'}</span>
                </button>
                
                <label className="w-full flex items-center justify-center gap-2 py-3 bg-[#252627] border border-[#333537] rounded-2xl text-xs font-semibold text-white active:scale-98 cursor-pointer">
                  <Upload size={15} />
                  <span>Restore from Backup</span>
                  <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
                </label>
              </div>
            </div>

            <div className="bg-[#1E1F20] border border-red-500/20 rounded-28 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-red-400">Danger Zone</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Permanently purge all saved conversations, checkpoint states, and temporary sandbox outputs.
              </p>
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full flex items-center justify-center gap-2 py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl text-xs font-semibold active:scale-98"
              >
                <Trash2 size={15} />
                <span>Clear All Workspace History</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Report a Bug Sub-panel */}
      {activeSubView === 'report_bug' && (
        <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col animate-in slide-in-from-right duration-200">
          <header className="h-16 pt-safe px-4 border-b border-[#333537]/40 flex items-center justify-between bg-[#1E1F20]">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSubView(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <h2 className="text-lg font-semibold text-white">Report a Bug</h2>
            </div>
          </header>
          <form onSubmit={handleSubmitBugReport} className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full custom-scrollbar">
            <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-5 space-y-4">
              <div>
                <label className="text-xs text-neutral-400 block mb-1.5 font-medium">Issue Category</label>
                <select
                  value={bugCategory}
                  onChange={(e) => setBugCategory(e.target.value)}
                  className="w-full bg-[#252627] border border-[#333537] rounded-xl px-3 py-2.5 text-white text-xs outline-none"
                >
                  <option value="UI / Layout">UI / Layout Clipping or Stacking</option>
                  <option value="Voice Call">Voice Call / Audio Sync</option>
                  <option value="Agent Tasks">Agent Execution / Reasoning</option>
                  <option value="Auto-Save">Auto-Save / Session Recovery</option>
                  <option value="Other">Other / Feature Request</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5 font-medium">Description</label>
                <textarea
                  value={bugDescription}
                  onChange={(e) => setBugDescription(e.target.value)}
                  rows={5}
                  placeholder="Describe what occurred, steps to reproduce, or expected behavior..."
                  className="w-full bg-[#252627] border border-[#333537] rounded-xl p-3 text-white text-xs outline-none resize-none focus:border-white/50 custom-scrollbar"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingBug}
                className="w-full py-3 bg-white text-black font-semibold text-xs rounded-2xl active:scale-98 transition-transform"
              >
                {isSubmittingBug ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Modals */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-60 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-6 max-w-sm w-full space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-base font-semibold text-white">Clear All History?</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              This action cannot be undone. All active chat messages, auto-saved drafts, and task runs will be deleted.
            </p>
            <div className="flex gap-2 pt-2">
              <button 
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#333537] bg-[#252627] text-xs font-semibold text-white"
              >
                Cancel
              </button>
              <button 
                onClick={handleClearHistory}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-xs font-semibold text-white"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-60 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1E1F20] border border-[#333537] rounded-28 p-6 max-w-sm w-full space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-[#252627] border border-[#333537] flex items-center justify-center mx-auto text-red-400">
              <LogOut size={22} />
            </div>
            <h3 className="text-base font-semibold text-white">Sign Out of Manus?</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              You can sign back in anytime to access your synced sessions and Pro tier features.
            </p>
            <div className="flex gap-2 pt-2">
              <button 
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#333537] bg-[#252627] text-xs font-semibold text-white"
              >
                Cancel
              </button>
              <button 
                onClick={handleSignOut}
                className="flex-1 py-2.5 rounded-xl bg-white text-black text-xs font-semibold"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
