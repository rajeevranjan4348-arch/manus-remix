import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { GrokColorTheme } from './Grok3DAvatar';

export interface VoiceFrequencyAnalyzerProps {
  callStatus: 'listening' | 'speaking' | 'thinking' | 'paused';
  audioLevel?: number; // 0.0 - 1.0 overall volume
  frequencyData?: number[]; // Array of 16-32 normalized (0-1) frequency band values
  colorTheme?: GrokColorTheme;
  barCount?: number; // Default 24 bars
  variant?: 'spectrum' | 'mirror' | 'compact' | 'capsule';
  className?: string;
  showDbGrid?: boolean;
  experimentalFrameRateBoost?: boolean;
}

// Color theme presets for frequency spectrum gradients
const THEME_GRADIENTS: Record<string, { barStart: string; barEnd: string; peak: string; glow: string }> = {
  'electric-blue': {
    barStart: '#38bdf8', // sky-400
    barEnd: '#6366f1', // indigo-500
    peak: '#e0f2fe',
    glow: 'rgba(56, 189, 248, 0.5)',
  },
  'cyber-cyan': {
    barStart: '#06b6d4', // cyan-500
    barEnd: '#10b981', // emerald-500
    peak: '#ccfbf1',
    glow: 'rgba(6, 182, 212, 0.5)',
  },
  'neon-violet': {
    barStart: '#ec4899', // pink-500
    barEnd: '#8b5cf6', // purple-500
    peak: '#fce7f3',
    glow: 'rgba(236, 72, 153, 0.5)',
  },
  'obsidian-gold': {
    barStart: '#f59e0b', // amber-500
    barEnd: '#ef4444', // red-500
    peak: '#fef3c7',
    glow: 'rgba(245, 158, 11, 0.5)',
  },
  'emerald-matrix': {
    barStart: '#10b981', // emerald-500
    barEnd: '#84cc16', // lime-500
    peak: '#dcfce7',
    glow: 'rgba(16, 185, 129, 0.5)',
  },
};

/**
 * Dynamic CSS-based Frequency Analyzer Bar component.
 * Features 120fps GPU-accelerated rendering with Experimental Frame Rate Boost,
 * peak-hold gravity indicators, real-time audio stream FFT spectrum binding, and theme-matched gradients.
 */
export function VoiceFrequencyAnalyzer({
  callStatus,
  audioLevel = 0,
  frequencyData,
  colorTheme = 'electric-blue',
  barCount = 24,
  variant = 'spectrum',
  className = '',
  showDbGrid = true,
  experimentalFrameRateBoost = true,
}: VoiceFrequencyAnalyzerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const peaksRef = useRef<number[]>(new Array(barCount).fill(0));
  const [displayBands, setDisplayBands] = useState<number[]>(() => new Array(barCount).fill(0.05));
  const [displayPeaks, setDisplayPeaks] = useState<number[]>(() => new Array(barCount).fill(0.08));

  // Speech synth animation generator when AI is speaking or frequencyData is omitted
  useEffect(() => {
    let animId: number;
    let phase = 0;

    const updateFrames = () => {
      const phaseStep = experimentalFrameRateBoost ? 0.08 : 0.14;
      phase += phaseStep;
      const isSpeaking = callStatus === 'speaking';
      const isListening = callStatus === 'listening';
      const isThinking = callStatus === 'thinking';

      const newBands = new Array(barCount).fill(0);
      const newPeaks = [...peaksRef.current];

      for (let i = 0; i < barCount; i++) {
        let val = 0.04; // base floor noise

        if (frequencyData && frequencyData.length > 0) {
          // Map provided frequencyData (FFT stream) to barCount
          const sourceIdx = Math.floor((i / barCount) * frequencyData.length);
          val = frequencyData[sourceIdx] || 0.04;
        } else if (isSpeaking) {
          // Simulate dynamic speech spectrum with voice harmonics when speaking
          const centerFreq = barCount * 0.35;
          const dist = Math.abs(i - centerFreq) / (barCount * 0.5);
          const harmonic = Math.sin(phase * 1.5 + i * 0.4) * 0.5 + 0.5;
          const harmonic2 = Math.cos(phase * 2.1 - i * 0.3) * 0.5 + 0.5;
          const baseVol = Math.max(0.2, audioLevel);
          val = Math.min(1.0, (1 - dist * 0.6) * baseVol * (0.4 + 0.6 * harmonic * harmonic2) + Math.random() * 0.08);
        } else if (isListening && audioLevel > 0.02) {
          // Synthesize responsive spectrum from overall volume level
          const bell = Math.sin((i / (barCount - 1)) * Math.PI);
          const noise = Math.sin(phase * 2 + i * 0.8) * 0.3 + 0.7;
          val = Math.min(1.0, audioLevel * bell * noise * 1.3 + Math.random() * 0.05);
        } else if (isThinking) {
          // Traveling scanning wave during thinking state
          const wave = Math.sin(phase * 1.8 - i * 0.35) * 0.5 + 0.5;
          val = 0.05 + Math.pow(wave, 3) * 0.45;
        } else {
          // Ambient breathing idle state
          const idleWave = Math.sin(phase * 0.5 + i * 0.2) * 0.02 + 0.04;
          val = idleWave;
        }

        // Apply smooth clamping
        val = Math.max(0.04, Math.min(1.0, val));
        newBands[i] = val;

        // Peak Hold Gravity Physics
        if (val >= newPeaks[i]) {
          newPeaks[i] = val;
        } else {
          // Gravity decay for peaks
          newPeaks[i] = Math.max(val, newPeaks[i] - 0.025);
        }
      }

      peaksRef.current = newPeaks;
      setDisplayBands(newBands);
      setDisplayPeaks(newPeaks);

      animId = requestAnimationFrame(updateFrames);
    };

    animId = requestAnimationFrame(updateFrames);
    return () => cancelAnimationFrame(animId);
  }, [callStatus, audioLevel, frequencyData, barCount]);

  const activeTheme = THEME_GRADIENTS[colorTheme] || THEME_GRADIENTS['electric-blue'];

  return (
    <div
      ref={containerRef}
      className={cn(
        'voice-frequency-analyzer-container relative flex flex-col items-center justify-end w-full select-none py-2 px-3 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 shadow-2xl transition-all duration-300',
        className
      )}
      style={{
        '--theme-start': activeTheme.barStart,
        '--theme-end': activeTheme.barEnd,
        '--theme-peak': activeTheme.peak,
        '--theme-glow': activeTheme.glow,
      } as React.CSSProperties}
    >
      {/* Background DB Grid Ticks */}
      {showDbGrid && (
        <div className="absolute inset-x-3 top-2 bottom-6 flex flex-col justify-between pointer-events-none opacity-20">
          <div className="w-full border-b border-dashed border-white/40 text-[9px] text-white/70 font-mono tracking-tighter flex justify-between">
            <span>0 dB</span>
            <span>CLIP</span>
          </div>
          <div className="w-full border-b border-dashed border-white/30 text-[9px] text-white/50 font-mono tracking-tighter flex justify-between">
            <span>-12 dB</span>
            <span>VOICE</span>
          </div>
          <div className="w-full border-b border-dashed border-white/20 text-[9px] text-white/30 font-mono tracking-tighter flex justify-between">
            <span>-24 dB</span>
            <span>FLOOR</span>
          </div>
        </div>
      )}

      {/* Analyzer Bars Main Stage */}
      <div
        className={cn(
          'relative z-10 w-full flex items-end justify-between gap-[2px] sm:gap-[3px] h-16 sm:h-20 pt-2 pb-1',
          variant === 'mirror' && 'items-center',
          variant === 'compact' && 'h-10 sm:h-12'
        )}
      >
        {displayBands.map((val, idx) => {
          const heightPct = Math.round(val * 100);
          const peakPct = Math.round((displayPeaks[idx] || val) * 100);
          const isHighPeak = peakPct > 82;

          return (
            <div
              key={idx}
              className="relative flex-1 h-full flex flex-col justify-end items-center group cursor-pointer"
            >
              {/* Floating Peak Cap Indicator */}
              <span
                className={cn(
                  'absolute w-full h-[2px] sm:h-[3px] rounded-full transition-all duration-75 z-20',
                  isHighPeak ? 'bg-amber-300 shadow-[0_0_8px_#fde047]' : 'bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.8)]'
                )}
                style={{
                  bottom: `${Math.max(2, peakPct)}%`,
                  backgroundColor: isHighPeak ? '#fde047' : activeTheme.peak,
                }}
              />

              {/* Spectral Bar with Gradient */}
              <div
                className={cn(
                  'w-full rounded-t-sm transition-all duration-75 relative overflow-hidden',
                  callStatus === 'listening' && val > 0.35 && 'shadow-[0_0_12px_var(--theme-glow)]'
                )}
                style={{
                  height: `${heightPct}%`,
                  background: `linear-gradient(to top, var(--theme-start), var(--theme-end))`,
                  opacity: callStatus === 'paused' ? 0.35 : 0.85 + val * 0.15,
                }}
              >
                {/* Inner highlight sheen */}
                <div className="absolute inset-x-0 top-0 h-1/3 bg-white/20 rounded-t-sm" />
              </div>

              {/* Bottom Mirror / Reflection Effect for Mirror Variant */}
              {variant === 'mirror' && (
                <div
                  className="w-full rounded-b-sm opacity-30 blur-[1px] transform scale-y-[-1] origin-top transition-all duration-75"
                  style={{
                    height: `${heightPct * 0.4}%`,
                    background: `linear-gradient(to top, var(--theme-start), var(--theme-end))`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Spectrum Frequency Labels */}
      <div className="relative z-10 w-full flex justify-between items-center text-[9px] font-mono font-medium text-white/40 pt-1 border-t border-white/10">
        <span>60Hz</span>
        <span>250Hz</span>
        <span>1kHz</span>
        <span>4kHz</span>
        <span>12kHz</span>
      </div>
    </div>
  );
}
