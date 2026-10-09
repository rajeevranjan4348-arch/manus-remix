import React from 'react';

type VoicePulseOrbProps = {
  callStatus: 'listening' | 'speaking' | 'thinking' | 'paused';
  className?: string;
};

/**
 * Soft, organic voice-call orb inspired by the supplied reference clip.
 * Pure CSS: no canvas/WebGL, external assets, or additional dependencies.
 */
export function VoicePulseOrb({ callStatus, className = '' }: VoicePulseOrbProps) {
  return (
    <div
      className={`voice-pulse-orb-stage relative flex items-center justify-center select-none ${className}`}
      data-status={callStatus}
      role="img"
      aria-label={callStatus === 'speaking' ? 'Assistant speaking' : callStatus === 'thinking' ? 'Assistant thinking' : callStatus === 'paused' ? 'Voice call paused' : 'Listening'}
    >
      <style>{`
        .voice-pulse-orb-stage { width: min(68vw, 280px); height: min(68vw, 280px); isolation: isolate; }
        .voice-pulse-orb-stage::before, .voice-pulse-orb-stage::after {
          content: ""; position: absolute; inset: 9%; border-radius: 50%; pointer-events: none;
        }
        .voice-pulse-orb-stage::before {
          background: radial-gradient(circle, rgba(236,72,153,.15) 0%, rgba(168,85,247,.09) 35%, transparent 72%);
          filter: blur(25px); transform: scale(1.25); animation: voice-orb-aura 3.2s ease-in-out infinite;
        }
        .voice-pulse-orb-stage::after {
          inset: 4%; border: 1px solid rgba(255,255,255,.055);
          box-shadow: 0 0 38px rgba(168,85,247,.05), inset 0 0 32px rgba(59,130,246,.035);
        }
        .voice-pulse-orb-shell {
          position: relative; width: 31%; aspect-ratio: 1; z-index: 1; border-radius: 50%;
          display: grid; place-items: center;
          background: radial-gradient(circle at 35% 25%, rgba(255,255,255,.28), transparent 38%);
          box-shadow: 0 0 18px rgba(236,72,153,.35), 0 0 45px rgba(168,85,247,.24), inset 0 0 12px rgba(255,255,255,.15);
          animation: voice-orb-float 3s ease-in-out infinite;
          transition: opacity .35s ease, filter .35s ease;
        }
        .voice-pulse-orb-core {
          position: absolute; inset: 9%; border-radius: 42% 58% 55% 45% / 46% 42% 58% 54%;
          background: radial-gradient(ellipse at 34% 25%, #ffb7a3 0%, #ff718e 24%, #ed4eaa 52%, #a83ce1 78%, #6539bd 100%);
          box-shadow: inset 2px 3px 9px rgba(255,255,255,.36), inset -7px -10px 16px rgba(73,20,119,.38), 0 0 22px rgba(236,72,153,.48);
          filter: saturate(1.08);
          animation: voice-orb-morph 4.8s ease-in-out infinite, voice-orb-color 9s linear infinite;
        }
        .voice-pulse-orb-highlight {
          position: absolute; width: 35%; height: 22%; top: 16%; left: 19%; border-radius: 50%;
          background: rgba(255,255,255,.48); filter: blur(5px); transform: rotate(-28deg);
        }
        .voice-pulse-orb-stage[data-status="speaking"] .voice-pulse-orb-shell { animation-duration: 1.05s; }
        .voice-pulse-orb-stage[data-status="speaking"] .voice-pulse-orb-core { animation-duration: 1.35s, 7s; box-shadow: inset 2px 3px 9px rgba(255,255,255,.4), inset -7px -10px 16px rgba(73,20,119,.38), 0 0 30px rgba(236,72,153,.68); }
        .voice-pulse-orb-stage[data-status="thinking"] .voice-pulse-orb-core { animation-duration: 2.1s, 5s; }
        .voice-pulse-orb-stage[data-status="paused"] .voice-pulse-orb-shell { animation-play-state: paused; opacity: .65; filter: saturate(.65); }
        .voice-pulse-orb-stage[data-status="paused"] .voice-pulse-orb-core { animation-play-state: paused; }
        @keyframes voice-orb-morph {
          0%,100% { border-radius: 42% 58% 55% 45% / 46% 42% 58% 54%; transform: scale(.96) rotate(-8deg); }
          25% { border-radius: 57% 43% 42% 58% / 52% 58% 42% 48%; transform: scale(1.04) rotate(7deg); }
          50% { border-radius: 48% 52% 60% 40% / 39% 48% 52% 61%; transform: scale(1.01) rotate(14deg); }
          75% { border-radius: 38% 62% 48% 52% / 57% 39% 61% 43%; transform: scale(1.06) rotate(2deg); }
        }
        @keyframes voice-orb-color {
          0%,100% { filter: hue-rotate(0deg) saturate(1.08); }
          33% { filter: hue-rotate(28deg) saturate(1.18); }
          66% { filter: hue-rotate(-28deg) saturate(1.15); }
        }
        @keyframes voice-orb-float { 0%,100% { transform: translateY(0) scale(.98); } 50% { transform: translateY(-5px) scale(1.04); } }
        @keyframes voice-orb-aura { 0%,100% { opacity: .55; transform: scale(1.1); } 50% { opacity: 1; transform: scale(1.35); } }
        @media (prefers-reduced-motion: reduce) {
          .voice-pulse-orb-stage::before, .voice-pulse-orb-shell, .voice-pulse-orb-core { animation-duration: 12s !important; }
        }
      `}</style>
      <div className="voice-pulse-orb-shell">
        <div className="voice-pulse-orb-core">
          <span className="voice-pulse-orb-highlight" />
        </div>
      </div>
    </div>
  );
}
