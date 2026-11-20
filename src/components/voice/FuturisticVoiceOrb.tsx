import React from 'react';
import { cn } from '@/lib/utils';
import type { VoiceCallState } from '@/lib/voiceCallEngine';

interface FuturisticVoiceOrbProps {
  state: VoiceCallState;
  /**
   * Host ref where the audio rAF loop sets `--orb-level` (0..1) directly on DOM style
   * so audio reactivity runs at 60fps with zero React re-render overhead on low-RAM devices.
   */
  orbRef?: React.RefObject<HTMLDivElement | null>;
  onTap?: () => void;
  ariaLabel?: string;
}

/**
 * Volumetric 3D glowing AI orb inspired by the reference futuristic voice call screen.
 * Uses GPU-compositor-only transforms/opacity and a CSS custom property (`--orb-level`)
 * for fluid audio-reactive scaling and illumination without React state thrashing.
 */
export const FuturisticVoiceOrb: React.FC<FuturisticVoiceOrbProps> = React.memo(
  function FuturisticVoiceOrb({ state, orbRef, onTap, ariaLabel }) {
    const isError = state === 'error';
    const isConnecting = state === 'connecting';
    const isThinking = state === 'thinking' || state === 'searching';
    const isListening = state === 'listening';
    const isSpeaking = state === 'speaking';
    const isIdle = state === 'idle';

    return (
      <div
        ref={orbRef}
        data-orb-state={state}
        style={{ '--orb-level': 0 } as React.CSSProperties}
        className="relative flex items-center justify-center w-[228px] h-[228px] sm:w-[264px] sm:h-[264px] select-none"
      >
        {/* Expanding concentric rings while connecting */}
        {isConnecting && (
          <>
            <span
              aria-hidden="true"
              className="voice-orb-connect-ring pointer-events-none absolute inset-[-10%] rounded-full border border-orange-400/35"
            />
            <span
              aria-hidden="true"
              className="voice-orb-connect-ring pointer-events-none absolute inset-[-10%] rounded-full border border-amber-300/25"
              style={{ animationDelay: '0.85s' }}
            />
          </>
        )}

        {/* Ambient volumetric outer halo — reacts smoothly to live audio level */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-[-22%] rounded-full transition-opacity duration-500 will-change-transform',
            isError ? 'opacity-80' : 'opacity-90'
          )}
          style={{
            background: isError
              ? 'radial-gradient(circle, rgba(220,38,38,0.48) 0%, rgba(153,27,27,0.22) 48%, rgba(0,0,0,0) 74%)'
              : 'radial-gradient(circle, rgba(255,146,56,0.52) 0%, rgba(225,74,18,0.24) 46%, rgba(120,24,4,0.08) 66%, rgba(0,0,0,0) 78%)',
            transform: 'scale(calc(1 + var(--orb-level, 0) * 0.22))',
          }}
        />

        {/* Secondary warm back-glow behind the orb */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-[-6%] rounded-full blur-2xl will-change-transform',
            isListening || isSpeaking ? 'opacity-90' : 'opacity-70'
          )}
          style={{
            background: isError
              ? 'radial-gradient(circle at 38% 36%, rgba(248,113,113,0.55) 0%, rgba(185,28,28,0.3) 55%, rgba(0,0,0,0) 75%)'
              : 'radial-gradient(circle at 36% 36%, rgba(255,184,92,0.62) 0%, rgba(240,86,20,0.34) 52%, rgba(0,0,0,0) 76%)',
            transform: 'scale(calc(1 + var(--orb-level, 0) * 0.14))',
          }}
        />

        {/* Interactive 3D Sphere Button */}
        <button
          type="button"
          onClick={onTap}
          aria-label={ariaLabel || `AI voice orb — ${state}`}
          className={cn(
            'group relative w-[184px] h-[184px] sm:w-[216px] sm:h-[216px] rounded-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400 will-change-transform',
            isIdle && 'voice-orb-float',
            isThinking && 'voice-orb-think-breathe'
          )}
          style={{
            transform:
              isListening || isSpeaking
                ? 'scale(calc(1 + var(--orb-level, 0) * 0.12))'
                : undefined,
            boxShadow: isError
              ? '0 0 42px rgba(220,38,38,0.45), inset -18px -22px 44px rgba(32,2,2,0.92)'
              : '0 0 48px rgba(249,115,22,0.42), 0 0 90px rgba(194,65,12,0.22), inset -20px -24px 50px rgba(24,4,0,0.94)',
          }}
        >
          {/* Base 3D spherical volumetric gradient (sunlit amber-gold left-center, burnt-ember right crescent) */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full overflow-hidden"
            style={{
              background: isError
                ? 'radial-gradient(circle at 34% 34%, #fecaca 0%, #ef4444 26%, #991b1b 58%, #2a0404 84%, #120202 100%)'
                : 'radial-gradient(circle at 34% 36%, #fff5d6 0%, #ffc46b 18%, #f97316 40%, #9a2406 66%, #2c0702 86%, #140301 100%)',
            }}
          />

          {/* Warm left-lower incandescent bloom matching reference sphere lighting */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full overflow-hidden mix-blend-screen opacity-90"
            style={{
              background: isError
                ? 'radial-gradient(circle at 32% 46%, rgba(254,202,202,0.72) 0%, rgba(239,68,68,0.34) 38%, rgba(0,0,0,0) 68%)'
                : 'radial-gradient(circle at 32% 46%, rgba(255,244,214,0.88) 0%, rgba(255,168,76,0.48) 36%, rgba(234,88,12,0.14) 58%, rgba(0,0,0,0) 72%)',
            }}
          />

          {/* Smooth rotating internal light sweep while Thinking or Searching */}
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 rounded-full overflow-hidden transition-opacity duration-500',
              isThinking ? 'opacity-85' : 'opacity-25'
            )}
          >
            <span
              className={cn(
                'block w-full h-full rounded-full',
                isThinking ? 'voice-orb-think-spin' : 'voice-orb-idle-spin'
              )}
              style={{
                background: isError
                  ? 'conic-gradient(from 0deg, transparent 0deg, rgba(254,202,202,0.45) 60deg, transparent 150deg, rgba(220,38,38,0.28) 250deg, transparent 360deg)'
                  : 'conic-gradient(from 0deg, transparent 0deg, rgba(255,237,204,0.58) 55deg, rgba(251,146,60,0.32) 125deg, transparent 210deg, rgba(255,186,96,0.26) 300deg, transparent 360deg)',
              }}
            />
          </span>

          {/* Deep dark-side crescent occlusion for realistic 3D curvature */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle at 82% 58%, rgba(16,3,1,0.92) 0%, rgba(36,6,2,0.72) 34%, rgba(0,0,0,0) 66%)',
            }}
          />

          {/* Soft glass-like top-left specular highlight & subtle lower rim bounce light */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(ellipse 46% 32% at 32% 24%, rgba(255,252,240,0.52) 0%, rgba(255,220,168,0.14) 58%, rgba(255,255,255,0) 100%)',
            }}
          />

          {/* Fine warm rim border */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: isError
                ? 'inset 0 0 18px rgba(248,113,113,0.45), inset 6px 6px 22px rgba(254,226,226,0.32)'
                : 'inset 0 0 18px rgba(255,168,76,0.45), inset 6px 6px 24px rgba(255,244,214,0.35)',
            }}
          />
        </button>
      </div>
    );
  }
);
