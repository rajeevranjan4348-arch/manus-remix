import React, { useState, useEffect, useRef } from 'react';
import { getSettings, saveSettings } from '@/lib/settingsStore';
import { UserSettings, VoicePersona } from '@/types/settings';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';
import { getPermissionsStatus, requestMicrophonePermission, PermissionState } from '@/lib/permissionsManager';
import { toast } from 'sonner';

interface AndroidVoiceSettingsProps {
  onBack?: () => void;
  isOpen?: boolean;
}

interface VoiceModelOption {
  id: string;
  name: string;
  cadence: string;
  desc: string;
  personaKey: VoicePersona;
  previewText: string;
}

const VOICE_PERSONAS: VoiceModelOption[] = [
  {
    id: 'cove',
    name: 'Cove',
    cadence: 'Warm & Direct',
    desc: 'Warm & Direct executive tone',
    personaKey: 'marcus',
    previewText: 'Hello, I am Cove. Ready to assist with executive synthesis, architecture, and real-time execution.'
  },
  {
    id: 'breeze',
    name: 'Breeze',
    cadence: 'Casual & Calm',
    desc: 'Natural, relaxed and conversational',
    personaKey: 'alloy',
    previewText: 'Hey there, I am Breeze. Let us explore your ideas and collaborate at your own pace.'
  },
  {
    id: 'ember',
    name: 'Ember',
    cadence: 'Confident & Crisp',
    desc: 'Confident, articulate and sharp',
    personaKey: 'fable',
    previewText: 'Greetings, I am Ember. Delivering sharp precision, technical citations, and autonomous task clarity.'
  },
  {
    id: 'juniper',
    name: 'Juniper',
    cadence: 'Upbeat & Clear',
    desc: 'Bright, energetic and inspiring',
    personaKey: 'nova',
    previewText: 'Hi! I am Juniper. Excited to build, code, and tackle complex workflows together!'
  },
  {
    id: 'sol',
    name: 'Sol',
    cadence: 'Deep & Resonant',
    desc: 'Deep, grounded and steady presence',
    personaKey: 'onyx',
    previewText: 'Sol online. Grounded intelligence, deep reasoning, and deliberate architectural execution.'
  },
  {
    id: 'lyra',
    name: 'Lyra',
    cadence: 'Lyrical & Gentle',
    desc: 'Warm, lyrical and soothing narrator',
    personaKey: 'shimmer',
    previewText: 'Welcome to Manus. I am Lyra, ready to guide your workflows with gentle clarity.'
  }
];

const SPEED_OPTIONS = [
  { label: '0.8x', val: 0.8 },
  { label: '1.0x', val: 1.0 },
  { label: '1.2x', val: 1.2 },
  { label: '1.5x', val: 1.5 },
  { label: '2.0x', val: 2.0 }
];

export function AndroidVoiceSettings({ onBack }: AndroidVoiceSettingsProps) {
  const [settings, setSettings] = useState<UserSettings>(getSettings());
  const [currentTime, setCurrentTime] = useState('9:41');

  // Selected persona state
  const initialPersona = VOICE_PERSONAS.find(p => p.personaKey === settings.voicePersona) || VOICE_PERSONAS[0];
  const [selectedVoice, setSelectedVoice] = useState<VoiceModelOption>(initialPersona);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformBars, setWaveformBars] = useState<number[]>([16, 24, 40, 64, 28, 48, 64, 36, 56, 44, 60, 40, 24, 52, 28, 16]);

  // Conversational toggles
  const [readAloud, setReadAloud] = useState(settings.autoPlayAudio ?? true);
  const [bargeIn, setBargeIn] = useState(true);
  const [wakeWord, setWakeWord] = useState(true);

  // Hardware permissions
  const [micState, setMicState] = useState<PermissionState>('prompt');
  const [audioFilter, setAudioFilter] = useState(settings.enableAudioFilter ?? true);

  const animRef = useRef<number | null>(null);

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

  // Check microphone permissions
  useEffect(() => {
    getPermissionsStatus().then(status => {
      setMicState(status.microphone);
    });
  }, []);

  // Waveform animation loop during playback
  useEffect(() => {
    if (!isPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      setWaveformBars([16, 24, 40, 64, 28, 48, 64, 36, 56, 44, 60, 40, 24, 52, 28, 16]);
      return;
    }

    const animate = () => {
      setWaveformBars(prev => prev.map(() => Math.floor(Math.random() * 52) + 16));
      animRef.current = requestAnimationFrame(animate);
    };

    const timer = setInterval(() => {
      setWaveformBars(prev => prev.map(() => Math.floor(Math.random() * 52) + 16));
    }, 120);

    return () => {
      clearInterval(timer);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isPlaying]);

  const handleUpdate = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const updated = saveSettings({ [key]: value });
    setSettings(updated);
  };

  const handleSelectVoice = (voice: VoiceModelOption) => {
    setSelectedVoice(voice);
    handleUpdate('voicePersona', voice.personaKey);
    toast.success(`Voice set to ${voice.name} (${voice.cadence})`);

    // If currently playing, switch voice smoothly
    if (isPlaying) {
      stopCleanSpeech();
      playVoiceSample(voice);
    }
  };

  const playVoiceSample = (voiceToPlay = selectedVoice) => {
    setIsPlaying(true);
    speakCleanHumanVoice(
      voiceToPlay.previewText,
      {
        voicePersona: voiceToPlay.personaKey,
        rate: settings.speechSpeed || 1.0,
        pitch: settings.voicePitch || 1.0,
        onEnd: () => setIsPlaying(false),
        onError: () => setIsPlaying(false)
      }
    );
  };

  const handleTogglePlayback = () => {
    if (isPlaying) {
      stopCleanSpeech();
      setIsPlaying(false);
    } else {
      playVoiceSample();
    }
  };

  const handleSelectSpeed = (speedVal: number) => {
    handleUpdate('speechSpeed', speedVal);
    toast.success(`Speech speed set to ${speedVal}x`);
    if (isPlaying) {
      stopCleanSpeech();
      playVoiceSample();
    }
  };

  const handleToggleReadAloud = () => {
    const nextVal = !readAloud;
    setReadAloud(nextVal);
    handleUpdate('autoPlayAudio', nextVal);
    toast.success(nextVal ? 'Automatic response voice playback enabled' : 'Response voice playback disabled');
  };

  const handleToggleBargeIn = () => {
    setBargeIn(prev => {
      const next = !prev;
      toast.success(next ? 'Barge-in speech interruption active' : 'Barge-in speech interruption disabled');
      return next;
    });
  };

  const handleToggleWakeWord = () => {
    setWakeWord(prev => {
      const next = !prev;
      toast.success(next ? 'Wake Word "Hey Manus" active' : 'Wake Word disabled');
      return next;
    });
  };

  const handleToggleAudioFilter = () => {
    const nextVal = !audioFilter;
    setAudioFilter(nextVal);
    handleUpdate('enableAudioFilter', nextVal);
    toast.success(nextVal ? 'Spectral noise reduction enabled' : 'Spectral noise reduction disabled');
  };

  const handleGrantMic = async () => {
    const granted = await requestMicrophonePermission();
    setMicState(granted ? 'granted' : 'denied');
    if (granted) {
      toast.success('Microphone permission granted');
    } else {
      toast.error('Microphone blocked. Please allow in browser permissions.');
    }
  };

  const handleBack = () => {
    if (isPlaying) {
      stopCleanSpeech();
    }
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black font-sans text-[#F0F0F2] antialiased flex flex-col min-h-screen selection:bg-[#33363A] selection:text-white overflow-hidden">
      
      {/* Top Android / Status Bar */}
      <div className="fixed top-0 inset-x-0 h-12 z-50 flex items-center justify-between px-6 bg-black/90 backdrop-blur-xl text-[#F0F0F2] select-none pt-safe">
        <div className="flex items-center space-x-1">
          <span className="text-[12px] font-semibold text-[#F0F0F2]">{currentTime}</span>
        </div>
        <div className="flex items-center space-x-2 text-[#F0F0F2]">
          <span className="text-[11px] font-semibold tracking-wider text-[#92959C]">5G</span>
          <span className="material-symbols-outlined text-[18px]">wifi</span>
          <span className="material-symbols-outlined text-[20px]">battery_full</span>
        </div>
      </div>

      {/* Sticky Header */}
      <header className="fixed top-0 inset-x-0 z-40 bg-black/85 backdrop-blur-xl pt-safe border-b border-[#2C2E32]/40">
        <div className="h-28 pt-12 px-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              aria-label="Go back" 
              className="w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-[#F0F0F2] active:bg-[#202225] transition-colors cursor-pointer" 
              onClick={handleBack} 
              type="button"
            >
              <span className="material-symbols-outlined text-[24px]">arrow_back</span>
            </button>
            <div className="flex flex-col">
              <h1 className="text-[18px] text-white font-semibold tracking-tight">Voice Settings</h1>
              <span className="text-[10px] text-[#92959C] uppercase tracking-wider font-semibold">Acoustic Studio &amp; Voice Engine</span>
            </div>
          </div>
          <div className="w-8 h-8 rounded-full bg-[#202225] border border-[#2A2C30]/60 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-white text-[18px]">person</span>
          </div>
        </div>
      </header>

      {/* Main Settings Canvas */}
      <main className="flex flex-col relative w-full px-4 pt-28 pb-12 bg-black flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        <div className="flex flex-col w-full pb-8 space-y-6 max-w-md mx-auto">
          
          {/* Acoustic Studio Top Audio Card */}
          <div className="w-full bg-[#161719] rounded-[28px] p-5 flex flex-col space-y-4 shadow-xl border border-[#2A2C30]/30 relative overflow-hidden">
            <div className="flex items-start justify-between z-10">
              <div className="flex items-center space-x-3.5">
                <div className="w-11 h-11 rounded-2xl bg-[#202225] border border-[#2C2E32] flex items-center justify-center text-white shadow-inner">
                  <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    graphic_eq
                  </span>
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[18px] text-white font-bold">{selectedVoice.name}</span>
                    <span className="px-2 py-0.5 rounded-full bg-[#2C2E32] text-white text-[11px] font-semibold border border-[#2A2C30]/40">
                      Active
                    </span>
                  </div>
                  <p className="text-[13px] text-[#92959C] mt-0.5">{selectedVoice.desc}</p>
                </div>
              </div>

              {/* Prominent Circular Playback / Test Button with Pulse Ripple */}
              <div className="relative flex items-center justify-center">
                <button 
                  aria-label="Test voice preview" 
                  onClick={handleTogglePlayback}
                  className={`relative w-12 h-12 rounded-full bg-white text-black flex items-center justify-center active:scale-95 transition-all shadow-[0_0_24px_rgba(255,255,255,0.25)] cursor-pointer z-10 ${
                    isPlaying ? 'pulse-ripple' : ''
                  }`}
                >
                  <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {isPlaying ? 'stop' : 'play_arrow'}
                  </span>
                </button>
              </div>
            </div>

            {/* Interactive Sound Waveform Engine Canvas/Bars */}
            <div className="h-20 w-full bg-[#111213] rounded-2xl px-4 py-3 flex items-center justify-between gap-1 overflow-hidden border border-[#2A2C30]/20">
              {waveformBars.map((height, i) => (
                <div 
                  key={i} 
                  className="waveform-bar w-1 rounded-full bg-white transition-all duration-150"
                  style={{ 
                    height: `${height}px`,
                    opacity: isPlaying ? 0.9 : (0.3 + (i % 5) * 0.15)
                  }}
                />
              ))}
            </div>

            {/* Sample Transcript Snippet & Audio Badge */}
            <div className="flex items-center justify-between text-[#92959C] text-[12px] px-1 pt-0.5">
              <span className="flex items-center gap-1.5 font-medium truncate max-w-[260px]">
                <span className="material-symbols-outlined text-[16px]">record_voice_over</span>
                <span>{isPlaying ? 'Streaming preview utterance...' : 'Sample preview audio'}</span>
              </span>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-[#92959C] bg-[#202225] px-2 py-0.5 rounded-md border border-[#2A2C30]/30 shrink-0">
                24kHz PCM
              </span>
            </div>
          </div>

          {/* Group 1: Voice Persona & Speech Characteristics */}
          <div className="flex flex-col space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#92959C] px-2">Voice &amp; Cadence</span>
            <div className="bg-[#161719] rounded-[28px] p-4 flex flex-col space-y-3.5 border border-[#2A2C30]/30">
              
              {/* Header inside container */}
              <div className="px-1 pt-1 flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white">
                  <span className="material-symbols-outlined text-[20px]">person_play</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[16px] text-white font-semibold block leading-tight">Voice Persona</span>
                  <span className="text-[13px] text-[#92959C]">Selected personality model</span>
                </div>
              </div>

              {/* Voice Persona Grid: 2-column cards (Cove, Breeze, Ember, Juniper, Sol, Lyra) */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                {VOICE_PERSONAS.map((v) => {
                  const isSelected = selectedVoice.id === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => handleSelectVoice(v)}
                      className={`voice-chip flex items-center justify-between p-3.5 rounded-2xl transition-all text-left cursor-pointer active:scale-98 ${
                        isSelected 
                          ? 'bg-[#33363A] text-white border border-white/20 shadow-sm' 
                          : 'bg-[#202225] text-[#92959C] hover:text-white border border-transparent'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-1">
                        <span className={`text-[14px] font-semibold truncate ${isSelected ? 'text-white' : 'text-[#F0F0F2]'}`}>
                          {v.name}
                        </span>
                        <span className="text-[11px] text-[#92959C] truncate">
                          {v.cadence}
                        </span>
                      </div>
                      <span 
                        className={`material-symbols-outlined text-[19px] shrink-0 ${
                          isSelected ? 'text-white' : 'text-transparent'
                        }`}
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        check_circle
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Divider line */}
              <div className="h-px bg-[#2C2E32] my-1 mx-1"></div>

              {/* Speech Speed Stepped Control (0.8x, 1.0x, 1.2x, 1.5x, 2.0x) */}
              <div className="px-1 py-1 flex flex-col space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white">
                    <span className="material-symbols-outlined text-[20px]">speed</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[16px] text-white font-medium block leading-tight">Speech Speed</span>
                    <span className="text-[13px] text-[#92959C]">Agent cadence rate</span>
                  </div>
                  <span className="text-[14px] text-white font-bold px-2 py-0.5 rounded-md bg-[#202225] border border-[#2A2C30]/40">
                    {settings.speechSpeed || 1.0}x
                  </span>
                </div>

                {/* Segmented Speed Picker Pills (0.8x, 1.0x, 1.2x, 1.5x, 2.0x) */}
                <div className="grid grid-cols-5 gap-1.5 bg-[#111213] p-1.5 rounded-2xl border border-[#2A2C30]/30">
                  {SPEED_OPTIONS.map((opt) => {
                    const isSpeedActive = (settings.speechSpeed || 1.0) === opt.val;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => handleSelectSpeed(opt.val)}
                        className={`speed-step py-2 rounded-xl text-center text-[12px] transition-all cursor-pointer ${
                          isSpeedActive 
                            ? 'bg-[#33363A] text-white font-semibold shadow-sm border border-[#2A2C30]/40' 
                            : 'text-[#92959C] hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>

          {/* Group 2: Conversational Behaviors & Interaction */}
          <div className="flex flex-col space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#92959C] px-2">Conversational Behavior</span>
            <div className="bg-[#161719] rounded-[28px] p-2 flex flex-col border border-[#2A2C30]/30 divide-y divide-[#2C2E32]">
              
              {/* Read responses aloud */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-start space-x-3.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[20px]">volume_up</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[16px] text-white font-medium">Read responses aloud</span>
                    <span className="text-[13px] text-[#92959C]">Automatically speak synthesized answers</span>
                  </div>
                </div>
                <button 
                  aria-checked={readAloud} 
                  onClick={handleToggleReadAloud}
                  className={`toggle-switch relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${
                    readAloud ? 'bg-white' : 'bg-[#202225]'
                  }`} 
                  role="switch" 
                  type="button"
                >
                  <span 
                    className={`toggle-thumb absolute top-0.5 w-6 h-6 rounded-full transition-transform ${
                      readAloud ? 'right-0.5 bg-black' : 'left-0.5 bg-[#92959C]'
                    }`}
                  />
                </button>
              </div>

              {/* Interrupt on speech (Barge-in) */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-start space-x-3.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[20px]">front_hand</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[16px] text-white font-medium">Interrupt on speech (Barge-in)</span>
                    <span className="text-[13px] text-[#92959C]">Pause AI playback instantly when you speak</span>
                  </div>
                </div>
                <button 
                  aria-checked={bargeIn} 
                  onClick={handleToggleBargeIn}
                  className={`toggle-switch relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${
                    bargeIn ? 'bg-white' : 'bg-[#202225]'
                  }`} 
                  role="switch" 
                  type="button"
                >
                  <span 
                    className={`toggle-thumb absolute top-0.5 w-6 h-6 rounded-full transition-transform ${
                      bargeIn ? 'right-0.5 bg-black' : 'left-0.5 bg-[#92959C]'
                    }`}
                  />
                </button>
              </div>

              {/* Wake Word row with switch and status */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-start space-x-3.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[20px]">hearing</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-[16px] text-white font-medium">Wake Word</span>
                      <span className="text-[11px] text-white font-medium bg-[#202225] px-2 py-0.5 rounded-full border border-[#2A2C30]/40">
                        {wakeWord ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <span className="text-[13px] text-[#92959C]">Listen for "Hey Manus"</span>
                  </div>
                </div>
                <button 
                  aria-checked={wakeWord} 
                  onClick={handleToggleWakeWord}
                  className={`toggle-switch relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${
                    wakeWord ? 'bg-white' : 'bg-[#202225]'
                  }`} 
                  role="switch" 
                  type="button"
                >
                  <span 
                    className={`toggle-thumb absolute top-0.5 w-6 h-6 rounded-full transition-transform ${
                      wakeWord ? 'right-0.5 bg-black' : 'left-0.5 bg-[#92959C]'
                    }`}
                  />
                </button>
              </div>

            </div>
          </div>

          {/* Group 3: Hardware & Permissions */}
          <div className="flex flex-col space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#92959C] px-2">Hardware &amp; Permissions</span>
            <div className="bg-[#161719] rounded-[28px] p-2 flex flex-col border border-[#2A2C30]/30 divide-y divide-[#2C2E32]">
              
              {/* Microphone Access */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-start space-x-3.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[20px]">mic</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[16px] text-white font-medium">Microphone Access</span>
                    <span className="text-[13px] text-[#92959C]">Voice dictation &amp; full-duplex calls</span>
                  </div>
                </div>
                {micState === 'granted' ? (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    Allowed
                  </span>
                ) : (
                  <button
                    onClick={handleGrantMic}
                    className="px-3 py-1.5 rounded-xl bg-white text-black font-semibold text-[12px] active:scale-95"
                  >
                    Grant
                  </button>
                )}
              </div>

              {/* Audio Clarity Filter */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-start space-x-3.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[20px]">tune</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[16px] text-white font-medium">Audio Clarity Engine</span>
                    <span className="text-[13px] text-[#92959C]">Active high-pass filter &amp; ambient noise suppression</span>
                  </div>
                </div>
                <button 
                  aria-checked={audioFilter} 
                  onClick={handleToggleAudioFilter}
                  className={`toggle-switch relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${
                    audioFilter ? 'bg-white' : 'bg-[#202225]'
                  }`} 
                  role="switch" 
                  type="button"
                >
                  <span 
                    className={`toggle-thumb absolute top-0.5 w-6 h-6 rounded-full transition-transform ${
                      audioFilter ? 'right-0.5 bg-black' : 'left-0.5 bg-[#92959C]'
                    }`}
                  />
                </button>
              </div>

              {/* Neural Synthesis Architecture */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-start space-x-3.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-[#202225] flex items-center justify-center text-white shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[20px]">memory</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[16px] text-white font-medium">Neural Architecture</span>
                    <span className="text-[13px] text-[#92959C]">Low-latency 24kHz stream decoding</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#202225] text-[#92959C] text-[11px] font-semibold border border-[#2A2C30]/40">
                  Ultra HD
                </span>
              </div>

            </div>
          </div>

          {/* Engine Signature */}
          <div className="flex flex-col items-center justify-center gap-1.5 text-center pt-2 text-[#92959C]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff] animate-pulse"></span>
              <span className="text-[11px] uppercase tracking-[0.16em] font-bold text-white">Acoustic Studio v2.4.0</span>
            </div>
            <span className="text-[11px] text-[#92959C]">High-Fidelity Neural Voice Engine for Android 15</span>
          </div>

        </div>
      </main>

    </div>
  );
}
