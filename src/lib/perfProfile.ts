/**
 * ULTRA-LITE PERFORMANCE ENGINE — Device Profile Detection
 *
 * Target device profile: low-end Android (2 GB RAM) in constrained WebViews.
 * Detects device capability from cheap, synchronous signals at startup and
 * exposes three profiles:
 *   - 'ultra-lite' : 2GB-class devices → minimal heap, no GPU effects, batched streaming
 *   - 'balanced'   : default desktop / mid-range behaviour
 *   - 'full'       : high-end devices (deviceMemory >= 8) → all effects enabled
 *
 * A manual override is persisted in localStorage ('manus_perf_profile') and can
 * be set to 'auto' | 'ultra-lite' | 'balanced' | 'full' from Settings.
 */

export type PerfProfile = 'ultra-lite' | 'balanced' | 'full';
export type PerfProfileSetting = 'auto' | PerfProfile;

export interface PerfLimits {
  /** Hard cap on messages kept mounted in the chat list (windowing). */
  maxRenderedMessages: number;
  /** Above this message count, windowing kicks in even on balanced. */
  virtualizationThreshold: number;
  /** SSE/stream token flush interval in ms (0 = flush every frame). */
  streamFlushMs: number;
  /** Max characters appended to the visible buffer per flush tick. */
  streamMaxCharsPerFlush: number;
  /** Bounded LRU cache size for conversation reads. */
  conversationCacheSize: number;
  /** Debounce for IndexedDB message persistence writes (ms). */
  persistDebounceMs: number;
  /** Whether GSAP entrance animations run at all. */
  allowGsapAnimations: boolean;
  /** Whether heavy GPU layers (3D voice avatar, blur orbs) may load. */
  allowGpuEffects: boolean;
  /** Whether charts render eagerly or wait for idle callbacks. */
  deferCharts: boolean;
  /** Delay before Work Mode / website-builder chunk starts loading (ms). */
  workModeLoadDelayMs: number;
}

const PROFILES: Record<PerfProfile, PerfLimits> = {
  'ultra-lite': {
    maxRenderedMessages: 15,
    virtualizationThreshold: 12,
    streamFlushMs: 140,
    streamMaxCharsPerFlush: 260,
    conversationCacheSize: 8,
    persistDebounceMs: 900,
    allowGsapAnimations: false,
    allowGpuEffects: false,
    deferCharts: true,
    workModeLoadDelayMs: 2500,
  },
  balanced: {
    maxRenderedMessages: 40,
    virtualizationThreshold: 40,
    streamFlushMs: 50,
    streamMaxCharsPerFlush: 900,
    conversationCacheSize: 20,
    persistDebounceMs: 400,
    allowGsapAnimations: true,
    allowGpuEffects: true,
    deferCharts: false,
    workModeLoadDelayMs: 0,
  },
  full: {
    maxRenderedMessages: Infinity,
    virtualizationThreshold: Infinity,
    streamFlushMs: 16,
    streamMaxCharsPerFlush: Infinity,
    conversationCacheSize: 40,
    persistDebounceMs: 200,
    allowGsapAnimations: true,
    allowGpuEffects: true,
    deferCharts: false,
    workModeLoadDelayMs: 0,
  },
};

const PROFILE_KEY = 'manus_perf_profile';

let cachedRaw: string | null | undefined;
function readStoredSetting(): string | null {
  if (cachedRaw !== undefined) return cachedRaw;
  try {
    cachedRaw = localStorage.getItem(PROFILE_KEY);
  } catch {
    cachedRaw = null;
  }
  return cachedRaw;
}

export function getProfileSetting(): PerfProfileSetting {
  const raw = readStoredSetting();
  if (raw === 'ultra-lite' || raw === 'balanced' || raw === 'full' || raw === 'auto') return raw;
  return 'auto';
}

/** Cheap, synchronous heuristic detection tuned for the 2GB Android target. */
export function detectAutoProfile(): PerfProfile {
  try {
    // Explicit user-agent hints from mobile browsers / WebViews
    const ua = navigator.userAgent || '';
    const isAndroidWebView = /Android/i.test(ua) && (/wv|WebViewAppLinux|Version\/[\d.]+.*Chrome/i.test(ua));
    const isMobile = /Android|Mobile|iPod|BlackBerry|Opera Mini/i.test(ua);

    // deviceMemory is rounded (0.25/0.5/1/2/4/8). <=2 → low-end class.
    const mem = (navigator as any).deviceMemory as number | undefined;
    // hardwareConcurrency on 2GB Android typically 4 (Cortex-A53 quad) or fewer.
    const cores = navigator.hardwareConcurrency || (isMobile ? 4 : 8);
    // Touch + small screen strongly indicates a phone-class device.
    const touch = typeof window !== 'undefined' && 'ontouchstart' in window;
    const smallScreen = typeof window !== 'undefined' && window.innerWidth < 900;

    // Respect OS-level reduced motion: treat as lite signal (not decisive alone).
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let score = 0; // higher = more capable
    if (mem !== undefined) {
      if (mem <= 2) score -= 3;
      else if (mem <= 4) score += 0;
      else score += 2;
    } else if (isMobile) {
      score -= 1; // unknown memory on mobile → conservative
    } else {
      score += 1; // desktop without API → assume capable
    }

    if (cores <= 4) score -= 1;
    if (cores >= 8) score += 1;
    if (isAndroidWebView) score -= 1;
    if (touch && smallScreen) score -= 1;
    if (!isMobile && !touch) score += 1;
    if (prefersReducedMotion) score -= 1;

    if (score <= -3) return 'ultra-lite';
    if (mem !== undefined && mem >= 8 && cores >= 8) return 'full';
    return 'balanced';
  } catch {
    return 'balanced';
  }
}

let activeProfile: PerfProfile | null = null;

export function getActiveProfile(): PerfProfile {
  if (activeProfile) return activeProfile;
  const setting = getProfileSetting();
  activeProfile = setting === 'auto' ? detectAutoProfile() : setting;
  // Tag <html> so CSS can strip shadows/animations without JS involvement.
  try {
    document.documentElement.dataset.perfProfile = activeProfile;
  } catch {}
  return activeProfile;
}

export function getLimits(): PerfLimits {
  return PROFILES[getActiveProfile()];
}

export function isUltraLite(): boolean {
  return getActiveProfile() === 'ultra-lite';
}

export function setProfileSetting(setting: PerfProfileSetting): PerfProfile {
  try {
    localStorage.setItem(PROFILE_KEY, setting);
  } catch {}
  cachedRaw = setting;
  activeProfile = null; // recompute
  return getActiveProfile();
}

/** requestIdleCallback shim (missing in many low-end WebViews). */
export function onIdle(cb: () => void, timeout = 2000): void {
  const w = window as any;
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(cb, { timeout });
  } else {
    setTimeout(cb, Math.min(timeout, 200));
  }
}
