import React from 'react';

type VoiceCallVisualState = 'connecting' | 'listening' | 'thinking' | 'searching' | 'speaking' | 'ready' | 'paused' | 'error';

type VoicePulseOrbProps = {
  callStatus: VoiceCallVisualState;
  audioLevel?: number;
  className?: string;
};

const ORB_STYLES = `
  .voice-pulse-orb-stage { width: min(78vw, 390px); height: min(78vw, 390px); isolation: isolate; contain: layout paint; }
  .voice-pulse-orb-stage::before, .voice-pulse-orb-stage::after { content: ""; position: absolute; inset: 4%; border-radius: 50%; pointer-events: none; }
  .voice-pulse-orb-stage::before {
    inset: 8%; background: radial-gradient(circle, rgba(251, 119, 32, .38) 0%, rgba(193, 49, 24, .19) 38%, transparent 72%);
    filter: blur(28px); opacity: .7; transform: scale(var(--aura-scale, 1.05));
    animation: voice-orb-aura 4s ease-in-out infinite; will-change: transform, opacity;
  }
  .voice-pulse-orb-stage::after {
    inset: 2%; border: 1px solid rgba(255, 173, 83, .13);
    box-shadow: inset 0 0 54px rgba(255, 110, 30, .055), 0 0 44px rgba(193, 48, 20, .08);
  }
  .voice-pulse-orb-halo { position: absolute; width: 80%; aspect-ratio: 1; border: 1px solid rgba(255, 174, 99, .16); border-radius: 50%; transform: rotateX(68deg) rotate(-16deg); box-shadow: 0 0 18px rgba(255, 118, 40, .1); }
  .voice-pulse-orb-shell {
    position: relative; width: 70%; aspect-ratio: 1; z-index: 1; border-radius: 50%; display: grid; place-items: center;
    background: radial-gradient(circle at 32% 20%, rgba(255,255,255,.26), transparent 26%), radial-gradient(circle at 72% 78%, rgba(202,45,25,.24), transparent 47%), #140c0a;
    box-shadow: 0 0 30px rgba(255, 105, 30, .32), 0 0 100px rgba(196, 39, 20, .18), inset 0 0 17px rgba(255,255,255,.11), inset -12px -18px 30px rgba(0,0,0,.62);
    transform: scale(var(--orb-scale, 1)); transition: transform 100ms ease-out, box-shadow 220ms ease-out;
    animation: voice-orb-float 5s ease-in-out infinite; will-change: transform;
  }
  .voice-pulse-orb-core {
    position: absolute; inset: 7%; overflow: hidden; border-radius: 50%;
    background: radial-gradient(ellipse at 30% 23%, #fff6df 0%, #ffd189 8%, #ff9b43 21%, #f36b29 39%, #d64128 62%, #761d18 83%, #2a100e 100%);
    box-shadow: inset 5px 7px 18px rgba(255,255,255,.34), inset -18px -24px 32px rgba(56,11,10,.58), 0 0 42px rgba(255,104,34,.43);
    animation: voice-orb-light 8s ease-in-out infinite; will-change: background-position, transform;
  }
  .voice-pulse-orb-core::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit;
    background: radial-gradient(ellipse at 29% 23%, rgba(255,255,255,.76) 0%, rgba(255,245,219,.27) 9%, transparent 28%), radial-gradient(ellipse at 75% 78%, rgba(39,8,8,.6) 0%, transparent 40%);
  }
  .voice-pulse-orb-core::after {
    content: ""; position: absolute; width: 60%; height: 23%; top: 13%; left: 15%; border-radius: 50%;
    background: linear-gradient(105deg, rgba(255,255,255,.42), rgba(255,255,255,.07) 48%, transparent 75%); filter: blur(6px); transform: rotate(-28deg);
  }
  .voice-pulse-orb-stage[data-status="connecting"] .voice-pulse-orb-halo { animation: voice-orb-connect 1.8s ease-out infinite; }
  .voice-pulse-orb-stage[data-status="listening"] .voice-pulse-orb-shell { box-shadow: 0 0 34px rgba(255, 128, 37, .42), 0 0 104px rgba(215, 52, 25, .24), inset 0 0 17px rgba(255,255,255,.12), inset -12px -18px 30px rgba(0,0,0,.62); }
  .voice-pulse-orb-stage[data-status="thinking"] .voice-pulse-orb-core,
  .voice-pulse-orb-stage[data-status="searching"] .voice-pulse-orb-core { animation: voice-orb-think 3s linear infinite; }
  .voice-pulse-orb-stage[data-status="speaking"] .voice-pulse-orb-shell { animation: voice-orb-speak 1.15s ease-in-out infinite; }
  .voice-pulse-orb-stage[data-status="ready"] .voice-pulse-orb-shell { animation-duration: 6s; }
  .voice-pulse-orb-stage[data-status="paused"] .voice-pulse-orb-shell { animation-play-state: paused; opacity: .72; filter: saturate(.62); }
  .voice-pulse-orb-stage[data-status="error"] .voice-pulse-orb-shell { box-shadow: 0 0 38px rgba(239, 68, 68, .38), 0 0 100px rgba(185, 28, 28, .24), inset 0 0 16px rgba(255,255,255,.08); }
  .voice-pulse-orb-stage[data-status="error"] .voice-pulse-orb-core { background: radial-gradient(ellipse at 30% 23%, #ffe1d7 0%, #ff9a73 15%, #e84732 43%, #7a1718 78%, #250b0b 100%); }
  @keyframes voice-orb-float { 0%,100% { transform: translateY(0) scale(var(--orb-scale, 1)); } 50% { transform: translateY(-7px) scale(var(--float-scale, 1.025)); } }
  @keyframes voice-orb-speak { 0%,100% { transform: translateY(0) scale(1.01); } 50% { transform: translateY(-4px) scale(1.065); } }
  @keyframes voice-orb-light { 0%,100% { filter: saturate(1); } 50% { filter: saturate(1.14) brightness(1.05); } }
  @keyframes voice-orb-think { to { transform: rotate(360deg); } }
  @keyframes voice-orb-aura { 0%,100% { opacity: .56; transform: scale(1); } 50% { opacity: .84; transform: scale(1.12); } }
  @keyframes voice-orb-connect { 0% { transform: rotateX(68deg) rotate(-16deg) scale(.84); opacity: .25; } 70%,100% { transform: rotateX(68deg) rotate(-16deg) scale(1.18); opacity: .85; } }
  @media (prefers-reduced-motion: reduce) {
    .voice-pulse-orb-stage::before, .voice-pulse-orb-halo, .voice-pulse-orb-shell, .voice-pulse-orb-core { animation-duration: 12s !important; }
  }
`;

/** Warm, layered voice orb. Listening reactivity is driven by real microphone input. */
export function VoicePulseOrb({ callStatus, audioLevel = 0, className = '' }: VoicePulseOrbProps) {
  const normalizedLevel = callStatus === 'listening'
    ? Math.min(1, Math.max(0, audioLevel))
    : 0;
  const orbScale = 1 + normalizedLevel * 0.16;
  const auraScale = 1.05 + normalizedLevel * 0.2;
  const floatScale = orbScale + 0.025;

  return (
    <div
      className={`voice-pulse-orb-stage relative flex items-center justify-center select-none ${className}`}
      data-status={callStatus}
      style={{ '--audio-level': normalizedLevel, '--orb-scale': orbScale, '--aura-scale': auraScale, '--float-scale': floatScale } as React.CSSProperties}
      role="img"
      aria-label={`AI voice orb, ${callStatus}`}
    >
      <style>{ORB_STYLES}</style>
      <div className="voice-pulse-orb-halo" aria-hidden="true" />
      <div className="voice-pulse-orb-shell" aria-hidden="true">
        <div className="voice-pulse-orb-core" />
      </div>
    </div>
  );
}
