import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings, resetSettings } from '@/lib/settingsStore';
import { UserSettings, AppTheme, AppMode, ResponseTone, AppLanguage } from '@/types/settings';
import { useTheme } from '@/context/ThemeContext';
import { toast } from 'sonner';

interface AndroidGeneralSettingsProps {
  onBack?: () => void;
  isOpen?: boolean;
}

interface AccentOption {
  id: string;
  name: string;
  tagline: string;
  hex: string;
  ring: string;
  shadow: string;
}

const ACCENT_OPTIONS: AccentOption[] = [
  { 
    id: 'white', 
    name: 'Pure White', 
    tagline: 'Classic Obsidian', 
    hex: '#FFFFFF', 
    ring: 'ring-white/40', 
    shadow: 'shadow-[0_0_8px_rgba(255,255,255,0.4)]' 
  },
  { 
    id: 'violet', 
    name: 'Cyber Violet', 
    tagline: 'Neural Pulse', 
    hex: '#8B5CF6', 
    ring: 'ring-[#8B5CF6]/40', 
    shadow: 'shadow-[0_0_8px_rgba(139,92,246,0.4)]' 
  },
  { 
    id: 'emerald', 
    name: 'Emerald Glow', 
    tagline: 'Autonomous Mint', 
    hex: '#10B981', 
    ring: 'ring-[#10B981]/40', 
    shadow: 'shadow-[0_0_8px_rgba(16,185,129,0.4)]' 
  },
  { 
    id: 'amber', 
    name: 'Solar Amber', 
    tagline: 'Deep Reasoning', 
    hex: '#F59E0B', 
    ring: 'ring-[#F59E0B]/40', 
    shadow: 'shadow-[0_0_8px_rgba(245,158,11,0.4)]' 
  },
  { 
    id: 'rose', 
    name: 'Rose Pulse', 
    tagline: 'Creative Spark', 
    hex: '#F43F5E', 
    ring: 'ring-[#F43F5E]/40', 
    shadow: 'shadow-[0_0_8px_rgba(244,63,94,0.4)]' 
  },
  { 
    id: 'cyan', 
    name: 'Cyan Neon', 
    tagline: 'Live Streaming', 
    hex: '#06B6D4', 
    ring: 'ring-[#06B6D4]/40', 
    shadow: 'shadow-[0_0_8px_rgba(6,182,212,0.4)]' 
  },
];

const LANGUAGE_OPTIONS: { code: AppLanguage; label: string; flag: string }[] = [
  { code: 'en', label: 'English (US)', flag: '🇺🇸' },
  { code: 'es', label: 'Spanish (Español)', flag: '🇪🇸' },
  { code: 'fr', label: 'French (Français)', flag: '🇫🇷' },
  { code: 'de', label: 'German (Deutsch)', flag: '🇩🇪' },
  { code: 'ja', label: 'Japanese (日本語)', flag: '🇯🇵' },
  { code: 'zh', label: 'Chinese (中文)', flag: '🇨🇳' },
  { code: 'hi', label: 'Hindi (हिंदी)', flag: '🇮🇳' },
];

const SPEECH_INPUT_OPTIONS = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'hi-IN', label: 'Hindi (भारत)' },
  { code: 'es-ES', label: 'Spanish (España)' },
  { code: 'fr-FR', label: 'French (France)' },
  { code: 'de-DE', label: 'German (Deutschland)' },
  { code: 'ja-JP', label: 'Japanese (日本)' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
];

export function AndroidGeneralSettings({ onBack }: AndroidGeneralSettingsProps) {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<UserSettings>(getSettings());
  const [currentTime, setCurrentTime] = useState('9:41');

  // Interactive UI state
  const [showHelpBanner, setShowHelpBanner] = useState(false);
  const [isAccentModalOpen, setIsAccentModalOpen] = useState(false);
  const [isResponseStyleModalOpen, setIsResponseStyleModalOpen] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [isSpeechModalOpen, setIsSpeechModalOpen] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Settings values
  const [selectedAccent, setSelectedAccent] = useState<AccentOption>(ACCENT_OPTIONS[0]);
  const [animationEnabled, setAnimationEnabled] = useState(!settings.reducedMotion);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  // Sync clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setCurrentTime(`${hours % 12 || 12}:${minutes}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  // Sync initial settings
  useEffect(() => {
    const current = getSettings();
    setSettings(current);
    setAnimationEnabled(!current.reducedMotion);
  }, []);

  const handleUpdate = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const updated = saveSettings({ [key]: value });
    setSettings(updated);
    if (key === 'theme') {
      setTheme(value as any);
    }
  };

  const handleSelectTheme = (t: AppTheme) => {
    handleUpdate('theme', t);
    toast.success(`Theme set to ${t.charAt(0).toUpperCase() + t.slice(1)}`);
  };

  const handleSelectMode = (m: AppMode) => {
    handleUpdate('defaultMode', m);
    toast.success(`Default mode set to ${m === 'work' ? 'Work (Autonomous)' : 'Chat (Interactive)'}`);
  };

  const handleToggleAnimations = () => {
    const nextVal = !animationEnabled;
    setAnimationEnabled(nextVal);
    handleUpdate('reducedMotion', !nextVal);
    toast.success(nextVal ? 'Fluid animations enabled' : 'Reduced motion enabled');
  };

  const handleToggleAutoScroll = () => {
    setAutoScrollEnabled(prev => {
      const next = !prev;
      toast.success(next ? 'Auto-scroll enabled' : 'Auto-scroll disabled');
      return next;
    });
  };

  const handleSelectAccent = (accent: AccentOption) => {
    setSelectedAccent(accent);
    setIsAccentModalOpen(false);
    toast.success(`Accent color set to ${accent.name}`);
  };

  const handleSelectResponseStyle = (tone: ResponseTone) => {
    handleUpdate('responseTone', tone);
    setIsResponseStyleModalOpen(false);
    toast.success(`Response style set to ${tone.charAt(0).toUpperCase() + tone.slice(1)}`);
  };

  const handleSelectLanguage = (lang: AppLanguage) => {
    handleUpdate('language', lang);
    setIsLanguageModalOpen(false);
    const matched = LANGUAGE_OPTIONS.find(l => l.code === lang);
    toast.success(`Language set to ${matched?.label || lang}`);
  };

  const handleSelectSpeech = (code: string) => {
    handleUpdate('voiceInputLanguage', code);
    setIsSpeechModalOpen(false);
    const matched = SPEECH_INPUT_OPTIONS.find(s => s.code === code);
    toast.success(`Speech input set to ${matched?.label || code}`);
  };

  const handleExecuteReset = () => {
    const def = resetSettings();
    setSettings(def);
    setTheme('dark');
    setAnimationEnabled(true);
    setAutoScrollEnabled(true);
    setSelectedAccent(ACCENT_OPTIONS[0]);
    setShowResetConfirm(false);
    toast.success('All settings reset to Obsidian defaults');
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  const currentLangLabel = LANGUAGE_OPTIONS.find(l => l.code === settings.language)?.label || 'English (US)';
  const currentSpeechLabel = SPEECH_INPUT_OPTIONS.find(s => s.code === (settings.voiceInputLanguage || 'auto'))?.label || 'Auto-detect';
  const currentToneLabel = settings.responseTone ? (settings.responseTone.charAt(0).toUpperCase() + settings.responseTone.slice(1)) : 'Balanced';

  return (
    <div className="fixed inset-0 z-50 bg-black text-[#F1F2F4] antialiased flex flex-col min-h-screen selection:bg-[#343538] selection:text-white font-sans overflow-hidden">
      
      {/* Top Android / Status Bar */}
      <div className="fixed top-0 inset-x-0 h-12 z-50 flex items-center justify-between px-6 bg-black/90 backdrop-blur-xl text-white select-none pt-safe">
        <div className="flex items-center space-x-1">
          <span className="text-[13px] font-semibold tracking-tight text-white">{currentTime}</span>
        </div>
        <div className="flex items-center space-x-2 text-white">
          <span className="text-[11px] font-bold tracking-wider text-neutral-400">5G</span>
          <span className="material-symbols-outlined text-[17px] text-white">wifi</span>
          <span className="material-symbols-outlined text-[19px] text-white">battery_full</span>
        </div>
      </div>

      {/* Sticky Header */}
      <header className="fixed top-0 inset-x-0 z-40 bg-black/85 backdrop-blur-xl border-b border-[#1F2124] pt-safe shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
        <div className="h-16 pt-3 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button 
              aria-label="Go back" 
              className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-white active:bg-[#222428] transition-colors cursor-pointer" 
              onClick={handleBack} 
              type="button"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <div className="flex flex-col">
              <h1 className="text-[18px] font-semibold text-white tracking-tight leading-tight">General Settings</h1>
              <span className="text-[11px] text-[#8E939D] font-medium tracking-wide">Obsidian Tactile Engine</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              aria-label="Quick profile" 
              onClick={handleBack}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-md active:scale-95 transition-transform cursor-pointer" 
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>person</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Settings Canvas */}
      <main className="flex flex-col relative w-full px-4 pt-24 pb-16 bg-black flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        <div className="flex flex-col w-full pb-8 space-y-6 max-w-md mx-auto">
          
          {/* Micro Section Header */}
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[#828792] font-bold">Preferences</span>
            <button 
              aria-label="Settings guide" 
              onClick={() => setShowHelpBanner(prev => !prev)}
              className="w-7 h-7 rounded-full bg-[#1C1D1F] border border-[#2B2D31] flex items-center justify-center text-[#9CA3AF] active:text-white active:bg-[#25272A] transition-colors cursor-pointer" 
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">help_outline</span>
            </button>
          </div>

          {/* Collapsible Help Banner */}
          {showHelpBanner && (
            <div className="p-3.5 rounded-2xl bg-[#1C1D1F] border border-[#2B2D31] text-white relative shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[18px]">tune</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white tracking-tight">Autonomous Agent Tuning</p>
                  <p className="text-[12px] text-[#9CA3AF] leading-relaxed mt-0.5">
                    Tactile Autonomous Obsidian mode unlocks high-density micro-adjustments for background execution, fluid rendering, and neural token delivery.
                  </p>
                </div>
                <button 
                  onClick={() => setShowHelpBanner(false)}
                  className="text-[#828792] hover:text-white transition-colors cursor-pointer" 
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>
          )}

          {/* SECTION 1: THEME & DISPLAY */}
          <div className="flex flex-col">
            <div className="px-1 mb-2">
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-[#828792] font-bold">Theme &amp; Display</h2>
            </div>
            <div className="bg-[#1C1D1F] border border-[#282A2E] rounded-[24px] overflow-hidden flex flex-col shadow-xl">
              
              {/* Appearance */}
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                    <span className="material-symbols-outlined text-[19px]">dark_mode</span>
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[14px] text-white font-medium tracking-tight">Appearance</span>
                    <span className="text-[12px] text-[#8E939D]">System-wide luminance &amp; contrast styling</span>
                  </div>
                </div>
                
                {/* Segmented Pill Toggle */}
                <div aria-label="Theme selection" className="grid grid-cols-3 p-1 bg-[#121315] border border-[#24262A] rounded-2xl" role="radiogroup">
                  <button 
                    className={`theme-tab py-2 rounded-xl text-[12px] font-medium text-center transition-all flex items-center justify-center gap-1.5 active:scale-[0.98] cursor-pointer ${
                      settings.theme === 'light' 
                        ? 'text-white font-semibold bg-[#2C2E33] shadow-md border border-[#3E4249]' 
                        : 'text-[#9CA3AF]'
                    }`}
                    onClick={() => handleSelectTheme('light')} 
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">light_mode</span>
                    <span>Light</span>
                  </button>
                  <button 
                    className={`theme-tab py-2 rounded-xl text-[12px] font-semibold text-center transition-all flex items-center justify-center gap-1.5 active:scale-[0.98] cursor-pointer ${
                      settings.theme === 'dark' 
                        ? 'text-white font-semibold bg-[#2C2E33] shadow-md border border-[#3E4249]' 
                        : 'text-[#9CA3AF]'
                    }`}
                    onClick={() => handleSelectTheme('dark')} 
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: settings.theme === 'dark' ? "'FILL' 1" : undefined }}>dark_mode</span>
                    <span>Dark</span>
                  </button>
                  <button 
                    className={`theme-tab py-2 rounded-xl text-[12px] font-medium text-center transition-all flex items-center justify-center gap-1.5 active:scale-[0.98] cursor-pointer ${
                      settings.theme === 'system' 
                        ? 'text-white font-semibold bg-[#2C2E33] shadow-md border border-[#3E4249]' 
                        : 'text-[#9CA3AF]'
                    }`}
                    onClick={() => handleSelectTheme('system')} 
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">settings_suggest</span>
                    <span>System</span>
                  </button>
                </div>
              </div>

              <div className="h-[1px] bg-[#26282D] ml-16"></div>

              {/* Accent Color with Interactive Swatch Trigger */}
              <div 
                className="p-4 flex items-center justify-between active:bg-[#232529] transition-colors cursor-pointer" 
                onClick={() => setIsAccentModalOpen(true)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                    <span className="material-symbols-outlined text-[19px]">palette</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] text-white font-medium tracking-tight">Accent Color</span>
                    <span className="text-[12px] text-[#8E939D]">UI highlight, glows and status rings</span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <div 
                    className={`w-4 h-4 rounded-full ring-2 ${selectedAccent.ring} ${selectedAccent.shadow}`}
                    style={{ backgroundColor: selectedAccent.hex }}
                  />
                  <span className="text-[13px] text-[#D1D5DB] font-medium">{selectedAccent.name}</span>
                  <span className="material-symbols-outlined text-[#6B7280] text-[18px]">chevron_right</span>
                </div>
              </div>

              <div className="h-[1px] bg-[#26282D] ml-16"></div>

              {/* Animation Preferences Switch */}
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                    <span className="material-symbols-outlined text-[19px]">auto_awesome_motion</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] text-white font-medium tracking-tight">Animation Preferences</span>
                    <span className="text-[12px] text-[#8E939D] truncate">Fluid spring physics &amp; motion dynamics</span>
                  </div>
                </div>
                {/* Tactile Pill Toggle */}
                <button 
                  aria-checked={animationEnabled} 
                  className={`switch-btn relative w-12 h-7 rounded-full transition-all duration-200 flex items-center p-0.5 shrink-0 shadow-inner focus:outline-none cursor-pointer ${
                    animationEnabled ? 'bg-white' : 'bg-[#25272A]'
                  }`} 
                  onClick={handleToggleAnimations} 
                  role="switch" 
                  type="button"
                >
                  <span 
                    className={`switch-thumb w-6 h-6 rounded-full shadow-md transition-transform duration-200 ${
                      animationEnabled ? 'bg-black translate-x-5' : 'bg-[#9CA3AF] translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* SECTION 2: CHAT & EXECUTION */}
          <div className="flex flex-col">
            <div className="px-1 mb-2">
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-[#828792] font-bold">Chat &amp; Execution</h2>
            </div>
            <div className="bg-[#1C1D1F] border border-[#282A2E] rounded-[24px] overflow-hidden flex flex-col shadow-xl">
              
              {/* Default Mode Selector */}
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                      <span className="material-symbols-outlined text-[19px]">terminal</span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[14px] text-white font-medium tracking-tight">Default Mode</span>
                      <span className="text-[12px] text-[#8E939D]">Default prompt runtime architecture</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {settings.defaultMode === 'work' ? 'Autonomous' : 'Interactive'}
                  </span>
                </div>
                
                {/* Tactile Mode Selector */}
                <div className="grid grid-cols-2 p-1 bg-[#121315] border border-[#24262A] rounded-2xl" role="radiogroup">
                  <button 
                    className={`mode-tab py-2.5 rounded-xl text-[12px] font-medium text-center transition-all flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer ${
                      settings.defaultMode === 'chat' 
                        ? 'text-white font-semibold bg-[#2C2E33] shadow-md border border-[#3E4249]' 
                        : 'text-[#9CA3AF]'
                    }`}
                    onClick={() => handleSelectMode('chat')} 
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">chat_bubble_outline</span>
                    <span>Chat (Interactive)</span>
                  </button>
                  <button 
                    className={`mode-tab py-2.5 rounded-xl text-[12px] font-semibold text-center transition-all flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer ${
                      settings.defaultMode === 'work' 
                        ? 'text-white font-semibold bg-[#2C2E33] shadow-md border border-[#3E4249]' 
                        : 'text-[#9CA3AF]'
                    }`}
                    onClick={() => handleSelectMode('work')} 
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: settings.defaultMode === 'work' ? "'FILL' 1" : undefined }}>
                      precision_manufacturing
                    </span>
                    <span>Work (Autonomous)</span>
                  </button>
                </div>
              </div>

              <div className="h-[1px] bg-[#26282D] ml-16"></div>

              {/* Response Style Chevron Row */}
              <div 
                className="p-4 flex items-center justify-between active:bg-[#232529] transition-colors cursor-pointer" 
                onClick={() => setIsResponseStyleModalOpen(true)}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                    <span className="material-symbols-outlined text-[19px]">forum</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] text-white font-medium tracking-tight">Response Style</span>
                    <span className="text-[12px] text-[#8E939D]">Cognitive token elaboration density</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[12px] font-semibold text-white bg-[#26282E] border border-[#34373E] px-2.5 py-1 rounded-lg">
                    {currentToneLabel}
                  </span>
                  <span className="material-symbols-outlined text-[#6B7280] text-[18px]">chevron_right</span>
                </div>
              </div>

              <div className="h-[1px] bg-[#26282D] ml-16"></div>

              {/* Auto-scroll Toggle */}
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                    <span className="material-symbols-outlined text-[19px]">arrow_circle_down</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] text-white font-medium tracking-tight">Auto-scroll</span>
                    <span className="text-[12px] text-[#8E939D] truncate">Follow streaming token generation</span>
                  </div>
                </div>
                <button 
                  aria-checked={autoScrollEnabled} 
                  className={`switch-btn relative w-12 h-7 rounded-full transition-all duration-200 flex items-center p-0.5 shrink-0 shadow-inner focus:outline-none cursor-pointer ${
                    autoScrollEnabled ? 'bg-white' : 'bg-[#25272A]'
                  }`} 
                  onClick={handleToggleAutoScroll} 
                  role="switch" 
                  type="button"
                >
                  <span 
                    className={`switch-thumb w-6 h-6 rounded-full shadow-md transition-transform duration-200 ${
                      autoScrollEnabled ? 'bg-black translate-x-5' : 'bg-[#9CA3AF] translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* SECTION 3: LOCALIZATION & LANGUAGE */}
          <div className="flex flex-col">
            <div className="px-1 mb-2">
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-[#828792] font-bold">Localization &amp; Language</h2>
            </div>
            <div className="bg-[#1C1D1F] border border-[#282A2E] rounded-[24px] overflow-hidden flex flex-col shadow-xl">
              
              {/* App Language */}
              <div 
                className="p-4 flex items-center justify-between active:bg-[#232529] transition-colors cursor-pointer" 
                onClick={() => setIsLanguageModalOpen(true)}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                    <span className="material-symbols-outlined text-[19px]">language</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] text-white font-medium tracking-tight">Language</span>
                    <span className="text-[12px] text-[#8E939D]">App display &amp; system synthesis</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[12px] font-semibold text-[#E5E7EB] bg-[#121315] border border-[#2A2C31] px-2.5 py-1 rounded-lg">
                    {currentLangLabel}
                  </span>
                  <span className="material-symbols-outlined text-[#6B7280] text-[18px]">chevron_right</span>
                </div>
              </div>

              <div className="h-[1px] bg-[#26282D] ml-16"></div>

              {/* Speech Input */}
              <div 
                className="p-4 flex items-center justify-between active:bg-[#232529] transition-colors cursor-pointer" 
                onClick={() => setIsSpeechModalOpen(true)}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-9 h-9 rounded-xl bg-[#25272A] border border-[#31343A] flex items-center justify-center shrink-0 text-white">
                    <span className="material-symbols-outlined text-[19px]">mic</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] text-white font-medium tracking-tight">Speech Input</span>
                    <span className="text-[12px] text-[#8E939D]">Neural voice transcription model</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[12px] font-semibold text-[#E5E7EB] bg-[#121315] border border-[#2A2C31] px-2.5 py-1 rounded-lg">
                    {currentSpeechLabel}
                  </span>
                  <span className="material-symbols-outlined text-[#6B7280] text-[18px]">chevron_right</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 4: MAINTENANCE / DANGER ZONE */}
          <div className="flex flex-col">
            <div className="px-1 mb-2">
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-[#828792] font-bold">Maintenance</h2>
            </div>
            <div className="bg-[#1C1D1F] border border-[#2E2828] rounded-[24px] overflow-hidden flex flex-col shadow-xl">
              <div 
                className="p-4 flex items-center justify-between active:bg-[#261E1E] transition-colors cursor-pointer" 
                onClick={() => setShowResetConfirm(prev => !prev)}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-9 h-9 rounded-xl bg-[#2D1A1A] border border-[#482020] flex items-center justify-center shrink-0 text-[#F87171]">
                    <span className="material-symbols-outlined text-[19px]">restart_alt</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] text-[#F87171] font-semibold tracking-tight">Reset to Defaults</span>
                    <span className="text-[12px] text-[#9CA3AF]">Restore standard autonomous runtime parameters</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="material-symbols-outlined text-[#8A4A4A] text-[18px]">chevron_right</span>
                </div>
              </div>

              {/* Inline Confirmation Bar */}
              {showResetConfirm && (
                <div className="bg-[#161010] border-t border-[#3B1E1E] p-3.5 flex items-center justify-between gap-2 animate-in fade-in duration-150">
                  <div className="flex items-center gap-2 text-white min-w-0">
                    <span className="material-symbols-outlined text-[18px] text-[#EF4444]">warning</span>
                    <span className="text-[12px] font-medium text-[#FCA5A5] truncate">Reset all settings to default?</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      className="px-3 py-1.5 rounded-xl text-[12px] text-[#9CA3AF] bg-[#221B1B] hover:text-white border border-[#352525] active:bg-[#2B2323] transition-colors cursor-pointer" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowResetConfirm(false);
                      }} 
                      type="button"
                    >
                      Cancel
                    </button>
                    <button 
                      className="px-3 py-1.5 rounded-xl text-[12px] bg-[#DC2626] text-white font-semibold shadow-md active:opacity-90 transition-opacity cursor-pointer" 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExecuteReset();
                      }} 
                      type="button"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Obsidian Engine Badge / Signature */}
          <div className="flex flex-col items-center justify-center gap-1.5 text-center pt-2 text-[#6B7280]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff] animate-pulse"></span>
              <span className="text-[11px] uppercase tracking-[0.16em] font-bold text-[#E5E7EB]">Manus Kernel v2.4.0</span>
            </div>
            <span className="text-[11px] text-[#6B7280]">Obsidian Tactile Engine localized for Android 15</span>
          </div>

        </div>
      </main>

      {/* ACCENT COLOR MODAL */}
      {isAccentModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsAccentModalOpen(false)}
        >
          <div 
            className="w-full max-w-sm bg-[#1C1D1F] border border-[#2E3035] rounded-[28px] p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-white">palette</span>
                <h3 className="text-[15px] font-semibold text-white tracking-tight">Select Accent Color</h3>
              </div>
              <button 
                className="w-7 h-7 rounded-full bg-[#25272A] text-[#9CA3AF] flex items-center justify-center hover:text-white cursor-pointer" 
                onClick={() => setIsAccentModalOpen(false)} 
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {ACCENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`p-3 rounded-2xl bg-[#121315] border flex items-center gap-3 transition-all text-left cursor-pointer active:scale-95 ${
                    selectedAccent.id === opt.id 
                      ? 'border-white/60 bg-[#25272A]' 
                      : 'border-white/10 hover:border-white/30'
                  }`}
                  onClick={() => handleSelectAccent(opt)}
                >
                  <div 
                    className={`w-6 h-6 rounded-full ring-2 ${opt.ring} shadow-sm shrink-0`}
                    style={{ backgroundColor: opt.hex }}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-medium text-white truncate">{opt.name}</span>
                    <span className="text-[10px] text-[#9CA3AF] truncate">{opt.tagline}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RESPONSE STYLE MODAL */}
      {isResponseStyleModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsResponseStyleModalOpen(false)}
        >
          <div 
            className="w-full max-w-sm bg-[#1C1D1F] border border-[#2E3035] rounded-[28px] p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-white">forum</span>
                <h3 className="text-[15px] font-semibold text-white tracking-tight">Response Elaboration Style</h3>
              </div>
              <button 
                className="w-7 h-7 rounded-full bg-[#25272A] text-[#9CA3AF] flex items-center justify-center hover:text-white cursor-pointer" 
                onClick={() => setIsResponseStyleModalOpen(false)} 
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {[
                { tone: 'balanced' as ResponseTone, title: 'Balanced', desc: 'Standard synthesis with balanced depth and speed' },
                { tone: 'concise' as ResponseTone, title: 'Concise', desc: 'Brief, high-density answers without excess fluff' },
                { tone: 'professional' as ResponseTone, title: 'Detailed', desc: 'Extensive multi-step cognitive reasoning breakdown' },
                { tone: 'creative' as ResponseTone, title: 'Creative', desc: 'Exploratory ideation and architectural thinking' },
                { tone: 'academic' as ResponseTone, title: 'Academic', desc: 'Rigorous citations, analysis, and formal proofs' },
              ].map(item => (
                <button
                  key={item.tone}
                  onClick={() => handleSelectResponseStyle(item.tone)}
                  className={`p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                    settings.responseTone === item.tone 
                      ? 'bg-[#25272A] border-white/60 text-white' 
                      : 'bg-[#121315] border-[#2A2C31] text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="text-[13px] font-semibold text-white">{item.title}</span>
                    <span className="text-[11px] text-[#8E939D]">{item.desc}</span>
                  </div>
                  {settings.responseTone === item.tone && (
                    <span className="material-symbols-outlined text-white text-[18px]">check</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* LANGUAGE PICKER MODAL */}
      {isLanguageModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsLanguageModalOpen(false)}
        >
          <div 
            className="w-full max-w-sm bg-[#1C1D1F] border border-[#2E3035] rounded-[28px] p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-white">language</span>
                <h3 className="text-[15px] font-semibold text-white tracking-tight">Select Language</h3>
              </div>
              <button 
                className="w-7 h-7 rounded-full bg-[#25272A] text-[#9CA3AF] flex items-center justify-center hover:text-white cursor-pointer" 
                onClick={() => setIsLanguageModalOpen(false)} 
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto custom-scrollbar">
              {LANGUAGE_OPTIONS.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleSelectLanguage(lang.code)}
                  className={`p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                    settings.language === lang.code 
                      ? 'bg-[#25272A] border-white/60 text-white' 
                      : 'bg-[#121315] border-[#2A2C31] text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">{lang.flag}</span>
                    <span className="text-[13px] font-medium text-white">{lang.label}</span>
                  </div>
                  {settings.language === lang.code && (
                    <span className="material-symbols-outlined text-white text-[18px]">check</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SPEECH INPUT MODAL */}
      {isSpeechModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsSpeechModalOpen(false)}
        >
          <div 
            className="w-full max-w-sm bg-[#1C1D1F] border border-[#2E3035] rounded-[28px] p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-white">mic</span>
                <h3 className="text-[15px] font-semibold text-white tracking-tight">Speech Recognition Model</h3>
              </div>
              <button 
                className="w-7 h-7 rounded-full bg-[#25272A] text-[#9CA3AF] flex items-center justify-center hover:text-white cursor-pointer" 
                onClick={() => setIsSpeechModalOpen(false)} 
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto custom-scrollbar">
              {SPEECH_INPUT_OPTIONS.map((item) => (
                <button
                  key={item.code}
                  onClick={() => handleSelectSpeech(item.code)}
                  className={`p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                    (settings.voiceInputLanguage || 'auto') === item.code 
                      ? 'bg-[#25272A] border-white/60 text-white' 
                      : 'bg-[#121315] border-[#2A2C31] text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  <span className="text-[13px] font-medium text-white">{item.label}</span>
                  {(settings.voiceInputLanguage || 'auto') === item.code && (
                    <span className="material-symbols-outlined text-white text-[18px]">check</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
