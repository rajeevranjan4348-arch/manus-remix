import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CircleDot, Hexagon, Bot, Radio, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GrokAvatarStyle, GrokColorTheme } from './Grok3DAvatar';

interface UiverseSphereLoaderProps {
  callStatus: 'listening' | 'speaking' | 'thinking' | 'paused';
  liveTranscript?: string;
  colorTheme?: GrokColorTheme;
  avatarStyle?: GrokAvatarStyle;
  onStyleChange?: (style: GrokAvatarStyle) => void;
  onColorChange?: (color: GrokColorTheme) => void;
  className?: string;
}

const THEME_STYLES: Record<GrokColorTheme, {
  highlight: string;
  mid: string;
  deep: string;
  dark: string;
  glow: string;
  ambient: string;
  letter: string;
  letterGlow: string;
  name: string;
}> = {
  'electric-blue': {
    highlight: '#a1a1aa',
    mid: '#27272a',
    deep: '#18181b',
    dark: '#000000',
    glow: 'rgba(0, 0, 0, 0.75)',
    ambient: 'rgba(24, 24, 27, 0.55)',
    letter: '#ffffff',
    letterGlow: 'rgba(0, 0, 0, 0.8)',
    name: 'Obsidian Black'
  },
  'cyber-cyan': {
    highlight: '#a5f3fc',
    mid: '#06b6d4',
    deep: '#0891b2',
    dark: '#083344',
    glow: 'rgba(6, 182, 212, 0.75)',
    ambient: 'rgba(34, 211, 238, 0.45)',
    letter: '#a5f3fc',
    letterGlow: 'rgba(165, 243, 252, 0.9)',
    name: 'Cyber Cyan'
  },
  'neon-purple': {
    highlight: '#f3e8ff',
    mid: '#a855f7',
    deep: '#7e22ce',
    dark: '#3b0764',
    glow: 'rgba(168, 85, 247, 0.75)',
    ambient: 'rgba(192, 132, 252, 0.45)',
    letter: '#e9d5ff',
    letterGlow: 'rgba(233, 213, 255, 0.9)',
    name: 'Neon Violet'
  },
  'obsidian-gold': {
    highlight: '#fef08a',
    mid: '#f59e0b',
    deep: '#d97706',
    dark: '#1c1917',
    glow: 'rgba(245, 158, 11, 0.75)',
    ambient: 'rgba(251, 191, 36, 0.45)',
    letter: '#fef08a',
    letterGlow: 'rgba(254, 240, 138, 0.9)',
    name: 'Grok Obsidian'
  }
};

const DEFAULT_LETTERS = ['G', 'e', 'n', 'e', 'r', 'a', 't', 'i', 'n', 'g', '.', '.', '.'];

export function UiverseSphereLoader({
  callStatus,
  colorTheme = 'electric-blue',
  avatarStyle = 'sphere',
  onStyleChange,
  onColorChange,
  className
}: UiverseSphereLoaderProps) {
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Interactive 3D tilt tracking
  const [rotateX, setRotateX] = useState(15);
  const [rotateYOffset, setRotateYOffset] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const themeVars = useMemo(() => THEME_STYLES[colorTheme] || THEME_STYLES['electric-blue'], [colorTheme]);

  // Audio pulse simulation for speaking state
  const [audioLevel, setAudioLevel] = useState(0);
  useEffect(() => {
    if (callStatus !== 'speaking') {
      setAudioLevel(0);
      return;
    }
    const interval = setInterval(() => {
      setAudioLevel(Math.random() * 0.4 + 0.6);
    }, 120);
    return () => clearInterval(interval);
  }, [callStatus]);

  // Mouse move tilt effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    
    // Smooth angle bounds
    const maxTilt = 25;
    setRotateX(15 - (y / (rect.height / 2)) * maxTilt);
    setRotateYOffset((x / (rect.width / 2)) * maxTilt);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotateX(15);
    setRotateYOffset(0);
  };

  // Dynamic orbit duration depending on call state
  const orbitDuration = callStatus === 'thinking' ? '4s' : callStatus === 'speaking' ? '5.5s' : callStatus === 'paused' ? '18s' : '9s';

  return (
    <div className={cn("relative flex flex-col items-center justify-center select-none", className)}>
      {/* Ambient background glow aura */}
      <div 
        className={cn(
          "absolute inset-0 rounded-full filter blur-[85px] pointer-events-none transition-all duration-700 -z-10",
          callStatus === 'speaking' 
            ? "scale-125 opacity-75" 
            : callStatus === 'thinking'
              ? "scale-110 opacity-60 animate-pulse"
              : callStatus === 'paused'
                ? "scale-75 opacity-20"
                : "scale-100 opacity-45"
        )}
        style={{
          background: `radial-gradient(circle, ${themeVars.glow} 0%, rgba(15, 23, 42, 0) 70%)`
        }}
      />

      {/* Orbit Dust / Particles (Decorative outer ring) */}
      <div 
        className="absolute w-72 h-72 rounded-full border border-white/5 pointer-events-none -z-5 animate-spin"
        style={{ animationDuration: '24s' }}
      />
      <div 
        className="absolute w-80 h-80 rounded-full border border-dashed border-white/5 pointer-events-none -z-5"
        style={{ 
          borderColor: themeVars.ambient, 
          transform: `rotateX(${rotateX + 25}deg) rotateZ(12deg)` 
        }}
      />

      {/* <!-- From Uiverse.io by joao-canais --> */}
      <div 
        ref={containerRef}
        className="loader cursor-grab active:cursor-grabbing transition-transform duration-200"
        id="loader"
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={handleMouseLeave}
        style={{
          ['--sphere-highlight' as any]: themeVars.highlight,
          ['--sphere-mid' as any]: themeVars.mid,
          ['--sphere-deep' as any]: themeVars.deep,
          ['--sphere-dark' as any]: themeVars.dark,
          ['--sphere-glow' as any]: themeVars.glow,
          ['--sphere-ambient' as any]: themeVars.ambient,
          ['--sphere-letter' as any]: themeVars.letter,
          ['--sphere-letter-glow' as any]: themeVars.letterGlow,
        }}
      >
        <div 
          className="loader-wrapper"
          style={{
            animationDuration: orbitDuration,
            transform: isHovered 
              ? `rotateX(${rotateX}deg) rotateY(${rotateYOffset}deg)` 
              : undefined
          }}
        >
          {DEFAULT_LETTERS.map((char, index) => (
            <span 
              key={index} 
              className="loader-letter"
              style={{
                ['--index' as any]: index,
                animationDuration: callStatus === 'speaking' ? '1.4s' : '2.4s'
              }}
            >
              {char}
            </span>
          ))}
          <div 
            className="loader-circle" 
            style={{
              transform: callStatus === 'speaking' 
                ? `scale(${1 + audioLevel * 0.12})` 
                : undefined,
              boxShadow: callStatus === 'speaking'
                ? `0 0 ${40 + audioLevel * 25}px ${themeVars.glow}, 0 0 90px ${themeVars.ambient}, inset 0 0 35px rgba(255, 255, 255, 0.8), inset 0 -12px 25px rgba(0, 0, 0, 0.75)`
                : undefined
            }}
          />
        </div>
      </div>
    </div>
  );
}
