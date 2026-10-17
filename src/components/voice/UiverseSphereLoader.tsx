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
  accent: string;
  dark: string;
  glow: string;
  ambient: string;
  letter: string;
  name: string;
}> = {
  'electric-blue': {
    highlight: '#ffffff',
    mid: '#ad5fff',
    deep: '#471eec',
    accent: '#d60a47',
    dark: '#311e80',
    glow: 'rgba(71, 30, 236, 0.75)',
    ambient: 'rgba(173, 95, 255, 0.45)',
    letter: '#ffffff',
    name: 'Obsidian Black'
  },
  'cyber-cyan': {
    highlight: '#a5f3fc',
    mid: '#06b6d4',
    deep: '#0891b2',
    accent: '#0284c7',
    dark: '#083344',
    glow: 'rgba(6, 182, 212, 0.75)',
    ambient: 'rgba(34, 211, 238, 0.45)',
    letter: '#a5f3fc',
    name: 'Cyber Cyan'
  },
  'neon-purple': {
    highlight: '#f3e8ff',
    mid: '#c084fc',
    deep: '#7e22ce',
    accent: '#e11d48',
    dark: '#3b0764',
    glow: 'rgba(168, 85, 247, 0.75)',
    ambient: 'rgba(192, 132, 252, 0.45)',
    letter: '#e9d5ff',
    name: 'Neon Violet'
  },
  'obsidian-gold': {
    highlight: '#fef08a',
    mid: '#f59e0b',
    deep: '#d97706',
    accent: '#dc2626',
    dark: '#1c1917',
    glow: 'rgba(245, 158, 11, 0.75)',
    ambient: 'rgba(251, 191, 36, 0.45)',
    letter: '#fef08a',
    name: 'Grok Obsidian'
  }
};

const DEFAULT_LETTERS = ['M', 'a', 'n', 'u', 's', ' ', 'A', 'I'];

export function UiverseSphereLoader({
  callStatus,
  colorTheme = 'electric-blue',
  avatarStyle = 'sphere',
  onStyleChange,
  onColorChange,
  className
}: UiverseSphereLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Detect prefers-reduced-motion media query
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else if ('addListener' in mediaQuery) {
      (mediaQuery as any).addListener(handleChange);
      return () => (mediaQuery as any).removeListener(handleChange);
    }
  }, []);

  // Interactive 3D tilt tracking
  const [rotateX, setRotateX] = useState(15);
  const [rotateYOffset, setRotateYOffset] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const themeVars = useMemo(() => THEME_STYLES[colorTheme] || THEME_STYLES['electric-blue'], [colorTheme]);

  // Audio pulse simulation for speaking state
  const [audioLevel, setAudioLevel] = useState(0);
  useEffect(() => {
    if (callStatus !== 'speaking' || prefersReducedMotion) {
      setAudioLevel(0);
      return;
    }
    const interval = setInterval(() => {
      setAudioLevel(Math.random() * 0.4 + 0.6);
    }, 120);
    return () => clearInterval(interval);
  }, [callStatus, prefersReducedMotion]);

  // Mouse move tilt effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || prefersReducedMotion) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    
    const maxTilt = 20;
    setRotateX(15 - (y / (rect.height / 2)) * maxTilt);
    setRotateYOffset((x / (rect.width / 2)) * maxTilt);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotateX(15);
    setRotateYOffset(0);
  };

  const letters = callStatus === 'speaking' 
    ? ['S', 'p', 'e', 'a', 'k', 'i', 'n', 'g', '.', '.'] 
    : callStatus === 'thinking'
      ? ['T', 'h', 'i', 'n', 'k', 'i', 'n', 'g', '.', '.']
      : DEFAULT_LETTERS;

  return (
    <div 
      ref={containerRef}
      className={cn(
        "sphere-loader-appear relative flex flex-col items-center justify-center select-none py-4", 
        className
      )}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => !prefersReducedMotion && setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      style={{
        ['--sphere-highlight' as any]: themeVars.highlight,
        ['--sphere-mid' as any]: themeVars.mid,
        ['--sphere-deep' as any]: themeVars.deep,
        ['--sphere-accent' as any]: themeVars.accent,
        ['--sphere-dark' as any]: themeVars.dark,
        ['--sphere-glow' as any]: themeVars.glow,
        ['--sphere-ambient' as any]: themeVars.ambient,
        ['--sphere-letter' as any]: themeVars.letter,
      }}
    >
      {/* Ambient background glow aura */}
      <div 
        className={cn(
          "absolute inset-0 rounded-full filter blur-[85px] pointer-events-none transition-all duration-700 -z-10",
          prefersReducedMotion
            ? "scale-100 opacity-40"
            : callStatus === 'speaking' 
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

      {/* From Uiverse.io by dexter-st 3D sphere loader */}
      <div 
        className={cn(
          "loader-wrapper cursor-grab active:cursor-grabbing",
          !prefersReducedMotion && "transition-transform duration-200"
        )}
        style={{
          transform: (isHovered && !prefersReducedMotion)
            ? `rotateX(${rotateX}deg) rotateY(${rotateYOffset}deg) scale(${1 + audioLevel * 0.08})` 
            : (!prefersReducedMotion ? `scale(${1 + audioLevel * 0.08})` : 'none')
        }}
      >
        <div 
          className="loader" 
          style={{
            animationDuration: prefersReducedMotion ? '8s' : (callStatus === 'speaking' ? '1.2s' : callStatus === 'thinking' ? '1.5s' : '2s')
          }}
        />
        {letters.map((char, index) => (
          <span 
            key={index} 
            className="loader-letter"
            style={{
              animationDelay: `${index * 0.1}s`,
              animationDuration: prefersReducedMotion ? '0s' : (callStatus === 'speaking' ? '1.4s' : '2s')
            }}
          >
            {char}
          </span>
        ))}
      </div>
    </div>
  );
}
