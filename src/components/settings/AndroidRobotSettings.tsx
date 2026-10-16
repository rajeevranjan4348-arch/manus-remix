import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings } from '@/lib/settingsStore';
import { UserSettings } from '@/types/settings';
import { useFirebase } from '@/context/FirebaseContext';
import { 
  saveRobotSettingsToFirestore, 
  subscribeToRobotSettings 
} from '@/lib/firestoreService';
import { toast } from 'sonner';

interface AndroidRobotSettingsProps {
  onBack?: () => void;
  isOpen?: boolean;
}

type RobotMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'searching' | 'sleeping';

interface EyeColorOption {
  id: string;
  label: string;
  hex: string;
  shadow: string;
  auraBg: string;
  haloBorder: string;
}

const EYE_COLORS: EyeColorOption[] = [
  {
    id: 'cyan',
    label: 'Cyan Pulse',
    hex: '#22D3EE',
    shadow: 'shadow-[0_0_14px_#22D3EE,inset_0_0_4px_#ffffff]',
    auraBg: 'bg-[#22D3EE]/15',
    haloBorder: 'border-[#22D3EE]/30 shadow-[0_0_30px_rgba(34,211,238,0.25)]'
  },
  {
    id: 'lavender',
    label: 'Lavender Glow',
    hex: '#A78BFA',
    shadow: 'shadow-[0_0_14px_#A78BFA,inset_0_0_4px_#ffffff]',
    auraBg: 'bg-[#A78BFA]/15',
    haloBorder: 'border-[#A78BFA]/30 shadow-[0_0_30px_rgba(167,139,250,0.25)]'
  },
  {
    id: 'emerald',
    label: 'Emerald Bio',
    hex: '#10B981',
    shadow: 'shadow-[0_0_14px_#10B981,inset_0_0_4px_#ffffff]',
    auraBg: 'bg-[#10B981]/15',
    haloBorder: 'border-[#10B981]/30 shadow-[0_0_30px_rgba(16,185,129,0.25)]'
  },
  {
    id: 'amber',
    label: 'Amber Core',
    hex: '#FBBF24',
    shadow: 'shadow-[0_0_14px_#FBBF24,inset_0_0_4px_#ffffff]',
    auraBg: 'bg-[#FBBF24]/15',
    haloBorder: 'border-[#FBBF24]/30 shadow-[0_0_30px_rgba(251,191,36,0.25)]'
  },
  {
    id: 'white',
    label: 'Pure White',
    hex: '#FFFFFF',
    shadow: 'shadow-[0_0_14px_#FFFFFF,inset_0_0_4px_#ffffff]',
    auraBg: 'bg-white/15',
    haloBorder: 'border-white/30 shadow-[0_0_30px_rgba(255,255,255,0.25)]'
  }
];

const ACCENT_HARDWARE_OPTIONS = [
  { id: 'lavender', label: 'Lavender', hex: '#A78BFA' },
  { id: 'cyan', label: 'Cyan', hex: '#22D3EE' },
  { id: 'emerald', label: 'Emerald', hex: '#10B981' },
  { id: 'graphite', label: 'Graphite', hex: '#6B7280' }
];

export const PERSONALITY_OPTIONS = [
  { id: 'balanced', label: 'Balanced Assistant', desc: 'Versatile, thoughtful & adaptive' },
  { id: 'autonomous', label: 'Autonomous Engineer', desc: 'Direct, structured & proactive' },
  { id: 'analytical', label: 'Analytical Researcher', desc: 'Methodical, inquisitive & detailed' },
  { id: 'creative', label: 'Creative Designer', desc: 'Expressive, visual & exploratory' },
  { id: 'companion', label: 'Playful Companion', desc: 'Warm, friendly & empathetic' }
];

export function AndroidRobotSettings({ onBack }: AndroidRobotSettingsProps) {
  const { user: fbUser } = useFirebase();
  const [settings, setSettings] = useState<UserSettings>(getSettings());

  // Robot preview states
  const [activeMode, setActiveMode] = useState<RobotMode>('idle');
  const [activeEyeColor, setActiveEyeColor] = useState<EyeColorOption>(EYE_COLORS[0]);
  const [activeAccentHardware, setActiveAccentHardware] = useState(ACCENT_HARDWARE_OPTIONS[0]);
  const [robotName, setRobotName] = useState(settings.userName ? `${settings.userName}'s Assistant` : 'Manus');
  const [isEditingName, setIsEditingName] = useState(false);
  const [robotSize, setRobotSize] = useState(100);

  // Toggles
  const [showInChat, setShowInChat] = useState(true);
  const [floatingOverlay, setFloatingOverlay] = useState(false);
  const [idleBreathing, setIdleBreathing] = useState(true);
  const [thinkingAnim, setThinkingAnim] = useState(true);
  const [speakingAnim, setSpeakingAnim] = useState(true);
  const [searchingScan, setSearchingScan] = useState(true);

  // Sliders
  const [intensity, setIntensity] = useState(2); // 1: Subtle, 2: Default, 3: Dynamic
  const [speed, setSpeed] = useState(settings.robotSpeed || 1);

  // Cloud sync & personality state
  const [cloudSync, setCloudSync] = useState<boolean>(settings.robotCloudSync ?? false);
  const [personality, setPersonality] = useState<string>(settings.robotPersonality || 'balanced');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Sync with settings store updates from other parts of the app
  useEffect(() => {
    const handleSettingsUpdate = (e: any) => {
      if (e.detail) {
        if (typeof e.detail.robotCloudSync === 'boolean') {
          setCloudSync(e.detail.robotCloudSync);
        }
        if (e.detail.robotPersonality) {
          setPersonality(e.detail.robotPersonality);
        }
      }
    };
    window.addEventListener('manus_settings_updated', handleSettingsUpdate);
    return () => window.removeEventListener('manus_settings_updated', handleSettingsUpdate);
  }, []);

  // Listen for real-time remote cloud updates across devices when cloudSync is enabled
  useEffect(() => {
    if (!cloudSync || !fbUser) return;

    const unsubscribe = subscribeToRobotSettings(fbUser.uid, (remote) => {
      if (remote) {
        if (remote.robotName) setRobotName(remote.robotName);
        if (remote.robotSpeed) setSpeed(remote.robotSpeed);
        if (remote.robotSize) setRobotSize(remote.robotSize);
        if (remote.robotPersonality) setPersonality(remote.robotPersonality);
        if (remote.robotEyeColor) {
          const matched = EYE_COLORS.find(c => c.id === remote.robotEyeColor);
          if (matched) setActiveEyeColor(matched);
        }
        if (remote.robotAccentHardware) {
          const matched = ACCENT_HARDWARE_OPTIONS.find(a => a.id === remote.robotAccentHardware);
          if (matched) setActiveAccentHardware(matched);
        }
        if (remote.robotState) {
          setActiveMode(remote.robotState as RobotMode);
        }
        if (remote.updatedAt) {
          try {
            setLastSyncTime(new Date(remote.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          } catch {}
        }
      }
    });

    return () => unsubscribe();
  }, [cloudSync, fbUser]);

  const triggerLiveCloudSync = (overrides?: Partial<UserSettings>) => {
    if (!cloudSync || !fbUser) return;
    saveRobotSettingsToFirestore({
      ...settings,
      robotCloudSync: true,
      robotPersonality: personality,
      robotEyeColor: activeEyeColor.id,
      robotAccentHardware: activeAccentHardware.id,
      robotName: robotName,
      robotSize: robotSize,
      robotSpeed: speed,
      robotState: activeMode,
      ...overrides
    }).then(() => {
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }).catch(() => {});
  };

  const handleToggleCloudSync = async () => {
    const nextVal = !cloudSync;
    setCloudSync(nextVal);
    handleUpdate('robotCloudSync', nextVal);

    if (nextVal) {
      setIsSyncing(true);
      try {
        if (fbUser) {
          await saveRobotSettingsToFirestore({
            ...settings,
            robotCloudSync: true,
            robotPersonality: personality,
            robotEyeColor: activeEyeColor.id,
            robotAccentHardware: activeAccentHardware.id,
            robotName: robotName,
            robotSize: robotSize,
            robotSpeed: speed,
            robotState: activeMode
          });
          setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          toast.success('Cloud-sync enabled: custom robot personalities and visual themes synced across all devices');
        } else {
          toast.success('Cloud-sync enabled: custom robot personalities and visual themes will sync across devices upon sign in');
        }
      } catch {
        toast.info('Cloud-sync activated on this device');
      } finally {
        setIsSyncing(false);
      }
    } else {
      toast.info('Cloud-sync disabled: custom robot personalities and visual themes stored locally on this device only');
    }
  };



  const handleUpdate = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const updated = saveSettings({ [key]: value });
    setSettings(updated);
  };

  const handleSelectEyeColor = (c: EyeColorOption) => {
    setActiveEyeColor(c);
    handleUpdate('robotEyeColor', c.id);
    triggerLiveCloudSync({ robotEyeColor: c.id });
    toast.success(`Eye glow set to ${c.label}`);
  };

  const handleSelectMode = (mode: RobotMode) => {
    setActiveMode(mode);
    handleUpdate('robotState', mode);
  };

  const handleResetRobot = () => {
    setActiveMode('idle');
    setActiveEyeColor(EYE_COLORS[0]);
    setActiveAccentHardware(ACCENT_HARDWARE_OPTIONS[0]);
    setRobotSize(100);
    setIntensity(2);
    setSpeed(1);
    setShowInChat(true);
    setFloatingOverlay(false);
    handleUpdate('robotState', 'idle');
    handleUpdate('robotSpeed', 1);
    toast.success('Robot avatar parameters reset to defaults');
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  const sizeLabel = robotSize < 90 ? 'Compact (80%)' : robotSize > 110 ? 'Expanded (120%)' : 'Normal (100%)';
  const intensityLabel = intensity === 1 ? 'Subtle' : intensity === 3 ? 'Dynamic' : 'Default';

  return (
    <div className="fixed inset-0 z-50 bg-black font-sans text-[#F3F4F6] antialiased flex flex-col min-h-screen selection:bg-[#A78BFA] selection:text-black overflow-hidden">
      
      {/* Compact Top App Bar */}
      <header className="fixed top-0 inset-x-0 z-40 bg-black/85 backdrop-blur-xl border-b border-[#2A2B2D] pt-safe">
        <div className="h-14 px-4 flex items-center justify-between">
          <button 
            aria-label="Go back" 
            className="w-11 h-11 rounded-full flex items-center justify-center text-white active:bg-[#2A2B2D] transition-colors cursor-pointer" 
            onClick={handleBack} 
            type="button"
          >
            <span className="material-symbols-outlined text-[24px]">chevron_left</span>
          </button>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-semibold text-white tracking-tight">Robot Settings</h1>
            <span className="text-[11px] text-neutral-400 font-normal">Customize your Manus assistant</span>
          </div>
          <button 
            aria-label="Robot Info and Help" 
            className="w-11 h-11 rounded-full flex items-center justify-center text-neutral-300 active:bg-[#2A2B2D] transition-colors cursor-pointer" 
            onClick={() => toast.info('Manus AI Robot Assistant • Hardware & Neural Persona v2.4')} 
            type="button"
          >
            <span className="material-symbols-outlined text-[21px]">info</span>
          </button>
        </div>
      </header>

      {/* Main Content Scroll Area */}
      <main className="flex-1 px-4 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-12 w-full max-w-md mx-auto space-y-4 overflow-y-auto overscroll-contain custom-scrollbar">
        
        {/* 1. Hero Robot Preview Card */}
        <div className="bg-[#1E1F20] border border-[#2F2F2F] rounded-[28px] p-5 relative overflow-hidden shadow-2xl">
          
          {/* Background Ambient Lighting Effect */}
          <div 
            className={`absolute -top-12 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl pointer-events-none transition-colors duration-700 animate-ambient-glow ${activeEyeColor.auraBg}`} 
          />

          {/* Top Card Header: Name + Ready status */}
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-1.5">
              {isEditingName ? (
                <input
                  type="text"
                  value={robotName}
                  onChange={(e) => setRobotName(e.target.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                  autoFocus
                  className="bg-[#2A2B2D] border border-neutral-600 rounded-lg px-2 py-0.5 text-sm font-semibold text-white outline-none w-32"
                />
              ) : (
                <>
                  <span className="text-lg font-semibold text-white tracking-tight">{robotName}</span>
                  <button 
                    aria-label="Edit Robot Name" 
                    onClick={() => setIsEditingName(true)}
                    className="text-neutral-400 hover:text-white p-1 rounded-full active:bg-[#2A2B2D] transition-colors cursor-pointer" 
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-[#3A3B3D] text-[11px] text-neutral-200 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10B981] animate-pulse"></span>
              <span className="capitalize">{activeMode === 'idle' ? 'Ready' : activeMode}</span>
            </div>
          </div>

          {/* 3D Illuminated Spherical Robot Avatar Viewport */}
          <div className="relative py-4 flex items-center justify-center z-10">
            
            {/* Back-glow Halo Ring */}
            <div 
              className={`absolute w-44 h-44 rounded-full border transition-all duration-500 ${activeEyeColor.haloBorder}`}
              style={{
                transform: `scale(${robotSize / 100})`
              }}
            />

            {/* Spherical Robot Head Chassis */}
            <div 
              className="w-36 h-36 rounded-full bg-gradient-to-b from-[#2E3033] via-[#161719] to-[#0A0A0C] border-2 border-[#484848]/70 shadow-[inset_0_4px_16px_rgba(255,255,255,0.15),0_12px_32px_rgba(0,0,0,0.9)] flex items-center justify-center relative p-3 transition-transform duration-300"
              style={{
                transform: `scale(${robotSize / 100})`
              }}
            >
              {/* Metallic Top Accent Antenna Notch */}
              <div 
                className="absolute -top-1.5 w-8 h-2 rounded-full shadow-sm"
                style={{
                  background: `linear-gradient(to right, #4E5055, ${activeAccentHardware.hex}, #4E5055)`
                }}
              />

              {/* Glass Visor Faceplate */}
              <div className="w-full h-24 rounded-[32px] bg-black/90 border border-neutral-700/80 shadow-[inset_0_0_12px_rgba(0,0,0,0.95)] flex flex-col items-center justify-center relative overflow-hidden">
                
                {/* LED Visor Eyes */}
                <div className={`flex items-center justify-center gap-5 transition-all duration-300 ${
                  activeMode === 'thinking' ? 'animate-pulse' : ''
                }`}>
                  {/* Left Eye */}
                  <div 
                    className={`w-5 h-7 rounded-full transition-all duration-300 ${activeEyeColor.shadow}`}
                    style={{ 
                      backgroundColor: activeEyeColor.hex,
                      transform: activeMode === 'sleeping' 
                        ? 'scaleY(0.1)' 
                        : activeMode === 'listening' 
                        ? 'scale(1.15)' 
                        : activeMode === 'searching'
                        ? 'translateX(-3px)'
                        : 'scale(1)'
                    }} 
                  />
                  {/* Right Eye */}
                  <div 
                    className={`w-5 h-7 rounded-full transition-all duration-300 ${activeEyeColor.shadow}`}
                    style={{ 
                      backgroundColor: activeEyeColor.hex,
                      transform: activeMode === 'sleeping' 
                        ? 'scaleY(0.1)' 
                        : activeMode === 'listening' 
                        ? 'scale(1.15)' 
                        : activeMode === 'searching'
                        ? 'translateX(3px)'
                        : 'scale(1)'
                    }} 
                  />
                </div>

                {/* Subtle Visor Audio/Equalizer Mouth Line (for Speaking mode) */}
                <div className={`flex items-center gap-1 mt-2 transition-all duration-200 ${
                  activeMode === 'speaking' ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'
                }`}>
                  <span className="w-1 h-2 rounded-full animate-bounce" style={{ backgroundColor: activeEyeColor.hex }} />
                  <span className="w-1 h-3.5 rounded-full animate-bounce [animation-delay:0.1s]" style={{ backgroundColor: activeEyeColor.hex }} />
                  <span className="w-1 h-5 rounded-full animate-bounce [animation-delay:0.2s]" style={{ backgroundColor: activeEyeColor.hex }} />
                  <span className="w-1 h-3.5 rounded-full animate-bounce [animation-delay:0.1s]" style={{ backgroundColor: activeEyeColor.hex }} />
                  <span className="w-1 h-2 rounded-full animate-bounce" style={{ backgroundColor: activeEyeColor.hex }} />
                </div>
              </div>

              {/* Side Ear Hinges */}
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-2 h-7 rounded-l-md bg-[#3F4045] border border-neutral-600" />
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-2 h-7 rounded-r-md bg-[#3F4045] border border-neutral-600" />
            </div>
          </div>

          {/* Segmented Mode Preview Chips */}
          <div className="relative z-10 flex items-center justify-between p-1 rounded-full bg-black/70 border border-[#3A3B3D] text-xs font-medium text-neutral-400">
            {(['idle', 'listening', 'thinking', 'speaking'] as RobotMode[]).map((mode) => (
              <button
                key={mode}
                className={`mode-chip flex-1 py-1.5 rounded-full transition-all text-center capitalize cursor-pointer ${
                  activeMode === mode 
                    ? 'text-white bg-[#2F2F2F] shadow-sm font-semibold' 
                    : 'hover:text-white'
                }`}
                onClick={() => handleSelectMode(mode)}
                type="button"
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Primary Action: Randomize or Test Avatar */}
          <button 
            className="mt-4 w-full py-3 px-4 rounded-full bg-white text-black font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg cursor-pointer" 
            onClick={() => {
              const nextMode: RobotMode = activeMode === 'idle' ? 'listening' : activeMode === 'listening' ? 'thinking' : activeMode === 'thinking' ? 'speaking' : 'idle';
              handleSelectMode(nextMode);
              toast.success(`Active state: ${nextMode}`);
            }}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">auto_fix_high</span>
            <span>Cycle Expression Mode</span>
          </button>
        </div>

        {/* 2. Card: Robot Appearance */}
        <div className="bg-[#1E1F20] border border-[#2F2F2F] rounded-[28px] p-4 space-y-4 shadow-md">
          <div className="flex items-center gap-2 pb-1 border-b border-[#333438]">
            <span className="material-symbols-outlined text-[#A78BFA] text-[20px]">palette</span>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">Robot Appearance</h2>
          </div>

          {/* Robot Avatar Model */}
          <div className="flex items-center justify-between py-1 cursor-pointer active:opacity-80">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#2A2B2D] border border-neutral-700 flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[19px]">smart_toy</span>
              </div>
              <div>
                <div className="text-sm font-medium text-white">Robot Avatar</div>
                <div className="text-xs text-neutral-400">Base geometry preset</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-neutral-300">
              <span className="bg-[#2A2B2D] px-2.5 py-1 rounded-full border border-neutral-700">Standard Sphere v2</span>
              <span className="material-symbols-outlined text-[18px] text-neutral-500">chevron_right</span>
            </div>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Robot Name Setting */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium text-white">Robot Name</div>
              <div className="text-xs text-neutral-400">Used during voice conversations</div>
            </div>
            <input 
              className="w-32 text-right bg-transparent text-sm font-medium text-[#A78BFA] border-b border-transparent focus:border-[#A78BFA] focus:outline-none transition-colors" 
              type="text" 
              value={robotName}
              onChange={(e) => setRobotName(e.target.value)}
            />
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Eye Glow Swatches */}
          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">Eye Glow Color</span>
              <span className="text-xs font-semibold" style={{ color: activeEyeColor.hex }}>
                {activeEyeColor.label}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              {EYE_COLORS.map((c) => {
                const isSelected = activeEyeColor.id === c.id;
                return (
                  <button
                    key={c.id}
                    aria-label={c.label}
                    onClick={() => handleSelectEyeColor(c)}
                    className={`color-swatch relative w-9 h-9 rounded-full transition-transform cursor-pointer active:scale-95 ${
                      isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-black scale-105' : 'ring-0 opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Accent Color selection */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium text-white">Accent Hardware Color</div>
              <div className="text-xs text-neutral-400">Trims, indicators and badges</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={activeAccentHardware.id}
                onChange={(e) => {
                  const found = ACCENT_HARDWARE_OPTIONS.find(o => o.id === e.target.value);
                  if (found) {
                    setActiveAccentHardware(found);
                    toast.success(`Hardware accent set to ${found.label}`);
                  }
                }}
                className="bg-[#2A2B2D] border border-neutral-700 text-xs rounded-full px-2.5 py-1 text-white outline-none cursor-pointer"
              >
                {ACCENT_HARDWARE_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Robot Size Slider */}
          <div className="space-y-1.5 py-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-sm font-medium text-white">Robot Canvas Size</span>
              <span className="text-neutral-400 font-medium">{sizeLabel}</span>
            </div>
            <input 
              className="w-full tactile-slider accent-[#A78BFA] cursor-pointer" 
              max="120" 
              min="80" 
              type="range" 
              value={robotSize}
              onChange={(e) => setRobotSize(Number(e.target.value))}
            />
            <div className="flex justify-between text-[10px] text-neutral-500">
              <span>Compact</span>
              <span>Normal</span>
              <span>Expanded</span>
            </div>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Show Robot in Chat Toggle */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium text-white">Show Robot in Chat</div>
              <div className="text-xs text-neutral-400">Displays miniature avatar reacting to stream</div>
            </div>
            <button 
              aria-label="Toggle Show Robot in Chat" 
              onClick={() => {
                setShowInChat(prev => !prev);
                toast.success(!showInChat ? 'Robot visible in chat' : 'Robot hidden in chat');
              }}
              className={`toggle-btn w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                showInChat ? 'bg-[#A78BFA]' : 'bg-[#3A3B3D]'
              }`}
              type="button"
            >
              <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                showInChat ? 'bg-black translate-x-6' : 'bg-white translate-x-0'
              }`} />
            </button>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Floating Overlay Robot (PiP) */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium text-white">Floating Overlay Robot</div>
              <div className="text-xs text-neutral-400">Android Picture-in-Picture over other apps</div>
            </div>
            <button 
              aria-label="Toggle Floating Overlay" 
              onClick={() => {
                setFloatingOverlay(prev => !prev);
                toast.success(!floatingOverlay ? 'Picture-in-picture mode enabled' : 'Picture-in-picture mode disabled');
              }}
              className={`toggle-btn w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                floatingOverlay ? 'bg-[#A78BFA]' : 'bg-[#3A3B3D]'
              }`}
              type="button"
            >
              <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                floatingOverlay ? 'bg-black translate-x-6' : 'bg-white translate-x-0'
              }`} />
            </button>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Custom Robot Personality Profile */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium text-white">Robot Personality</div>
              <div className="text-xs text-neutral-400">Behavioral temperament &amp; cognitive tone</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={personality}
                onChange={(e) => {
                  const val = e.target.value;
                  setPersonality(val);
                  handleUpdate('robotPersonality', val);
                  triggerLiveCloudSync({ robotPersonality: val });
                  const opt = PERSONALITY_OPTIONS.find(p => p.id === val);
                  if (opt) toast.success(`Robot personality set to ${opt.label}`);
                }}
                className="bg-[#2A2B2D] border border-neutral-700 text-xs rounded-full px-2.5 py-1 text-white outline-none cursor-pointer max-w-[150px] truncate"
              >
                {PERSONALITY_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Cloud-Sync Robot Personalities & Visual Themes */}
          <div className="flex items-center justify-between py-1.5">
            <div className="space-y-1 max-w-[76%]">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[19px] text-[#A78BFA]">
                  {cloudSync ? 'cloud_done' : 'cloud_sync'}
                </span>
                <span className="text-sm font-medium text-white">Cloud-Sync Personality &amp; Themes</span>
              </div>
              <p className="text-xs text-neutral-400 leading-snug">
                Enables cloud-syncing of custom robot personalities and visual themes across different devices
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${cloudSync ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
                  <span className="text-[11px] text-neutral-400 font-mono">
                    {cloudSync 
                      ? (fbUser ? 'Cloud Synced • Cross-Device' : 'Enabled (Cloud Mirrors on Sign In)') 
                      : 'Local Device Only'}
                  </span>
                </div>
                {lastSyncTime && cloudSync && (
                  <span className="text-[10px] text-neutral-500 font-mono">
                    • Last: {lastSyncTime}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button 
                aria-label="Toggle Cloud Sync of Custom Robot Personalities and Visual Themes"
                role="switch"
                aria-checked={cloudSync}
                onClick={handleToggleCloudSync}
                className={`toggle-btn w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                  cloudSync ? 'bg-[#A78BFA]' : 'bg-[#3A3B3D]'
                }`}
                type="button"
              >
                <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                  cloudSync ? 'bg-black translate-x-6' : 'bg-white translate-x-0'
                }`} />
              </button>
              {cloudSync && fbUser && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSyncing(true);
                    triggerLiveCloudSync();
                    setTimeout(() => {
                      setIsSyncing(false);
                      toast.success('Robot theme & personality force-synced to cloud');
                    }, 400);
                  }}
                  disabled={isSyncing}
                  className="text-[10px] text-[#A78BFA] hover:text-[#C4B5FD] flex items-center gap-0.5 transition-colors cursor-pointer mt-0.5"
                >
                  <span className={`material-symbols-outlined text-[13px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                  <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 3. Card: Expressions & Animations */}
        <div className="bg-[#1E1F20] border border-[#2F2F2F] rounded-[28px] p-4 space-y-4 shadow-md">
          <div className="flex items-center gap-2 pb-1 border-b border-[#333438]">
            <span className="material-symbols-outlined text-[#A78BFA] text-[20px]">animation</span>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">Expressions &amp; Animations</h2>
          </div>

          {/* Expression preview pills horizontally scrollable */}
          <div>
            <span className="text-xs text-neutral-400 block mb-2 font-medium">Expression Library Test</span>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              {[
                { expr: 'idle' as RobotMode, label: 'Idle (calm)', icon: 'sentiment_satisfied' },
                { expr: 'thinking' as RobotMode, label: 'Thinking', icon: 'psychology' },
                { expr: 'listening' as RobotMode, label: 'Listening', icon: 'graphic_eq' },
                { expr: 'speaking' as RobotMode, label: 'Speaking', icon: 'record_voice_over' },
                { expr: 'searching' as RobotMode, label: 'Searching', icon: 'radar' },
                { expr: 'sleeping' as RobotMode, label: 'Sleeping', icon: 'bedtime' }
              ].map(item => (
                <button
                  key={item.expr}
                  onClick={() => handleSelectMode(item.expr)}
                  className={`expr-pill shrink-0 px-3 py-1.5 rounded-full border text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeMode === item.expr 
                      ? 'bg-[#A78BFA] text-black border-[#A78BFA] font-semibold' 
                      : 'bg-[#2A2B2D] border-neutral-700 text-white hover:border-neutral-500'
                  }`}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[14px]">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Specific Animation Toggles */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Idle Breathing Animation</div>
                <div className="text-xs text-neutral-400">Micro-movements and visor eye blinking</div>
              </div>
              <button 
                onClick={() => setIdleBreathing(prev => !prev)}
                className={`toggle-btn w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                  idleBreathing ? 'bg-[#A78BFA]' : 'bg-[#3A3B3D]'
                }`}
                type="button"
              >
                <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                  idleBreathing ? 'bg-black translate-x-6' : 'bg-white translate-x-0'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Thinking Animation</div>
                <div className="text-xs text-neutral-400">Orbital eye glow while querying LLM tools</div>
              </div>
              <button 
                onClick={() => setThinkingAnim(prev => !prev)}
                className={`toggle-btn w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                  thinkingAnim ? 'bg-[#A78BFA]' : 'bg-[#3A3B3D]'
                }`}
                type="button"
              >
                <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                  thinkingAnim ? 'bg-black translate-x-6' : 'bg-white translate-x-0'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Speaking Animation</div>
                <div className="text-xs text-neutral-400">Dynamic waveform synced to TTS audio</div>
              </div>
              <button 
                onClick={() => setSpeakingAnim(prev => !prev)}
                className={`toggle-btn w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                  speakingAnim ? 'bg-[#A78BFA]' : 'bg-[#3A3B3D]'
                }`}
                type="button"
              >
                <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                  speakingAnim ? 'bg-black translate-x-6' : 'bg-white translate-x-0'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Searching &amp; Web Scan</div>
                <div className="text-xs text-neutral-400">Radar sweep effect during autonomous research</div>
              </div>
              <button 
                onClick={() => setSearchingScan(prev => !prev)}
                className={`toggle-btn w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                  searchingScan ? 'bg-[#A78BFA]' : 'bg-[#3A3B3D]'
                }`}
                type="button"
              >
                <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                  searchingScan ? 'bg-black translate-x-6' : 'bg-white translate-x-0'
                }`} />
              </button>
            </div>
          </div>

          <div className="h-[1px] bg-[#2A2B2D]" />

          {/* Sliders: Intensity & Speed */}
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-sm font-medium text-white">Animation Intensity</span>
                <span className="text-neutral-400 font-medium">{intensityLabel}</span>
              </div>
              <input 
                className="w-full tactile-slider accent-[#A78BFA] cursor-pointer" 
                max="3" 
                min="1" 
                type="range" 
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
              />
              <div className="flex justify-between text-[10px] text-neutral-500">
                <span>Subtle</span>
                <span>Default</span>
                <span>Dynamic</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-sm font-medium text-white">Animation Speed</span>
                <span className="text-neutral-400 font-medium">{speed.toFixed(1)}x</span>
              </div>
              <input 
                className="w-full tactile-slider accent-[#A78BFA] cursor-pointer" 
                max="2.0" 
                min="0.5" 
                step="0.1"
                type="range" 
                value={speed}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setSpeed(s);
                  handleUpdate('robotSpeed', s);
                }}
              />
              <div className="flex justify-between text-[10px] text-neutral-500">
                <span>0.5x</span>
                <span>1.0x</span>
                <span>2.0x</span>
              </div>
            </div>
          </div>

          {/* Reset Action */}
          <button
            onClick={handleResetRobot}
            className="w-full py-2.5 rounded-xl border border-neutral-700 bg-[#2A2B2D] text-xs font-semibold text-neutral-300 hover:text-white transition-colors cursor-pointer"
            type="button"
          >
            Reset Avatar to Defaults
          </button>
        </div>

        {/* Footer Signature */}
        <div className="text-center py-4 text-neutral-500 text-xs space-y-1">
          <p className="font-medium text-neutral-400">Manus AI Assistant • Spherical Head Chassis v2.4</p>
          <p className="text-[11px] text-neutral-600">Android 15 Edge-to-Edge Neural Assistant</p>
        </div>

      </main>

    </div>
  );
}
