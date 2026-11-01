import { UserSettings } from '@/types/settings';
import { setPerformanceProfileConfiguration, getActivePerformanceProfile } from '@/lib/performanceEngine';

const SETTINGS_KEY = 'manus_user_settings';

export const DEFAULT_SETTINGS: UserSettings = {
  // General
  theme: 'light',
  defaultMode: 'chat',
  language: 'en',
  soundEffects: true,
  reducedMotion: false,
  autoScrollToResults: true,

  // Robot appearance and animation
  robotState: 'idle',
  robotShape: 'rectangle',
  robotTheme: 0,
  robotSpeed: 1,
  robotSeed: 0.3,
  robotPaused: false,
  robotInteractive: true,
  robotAntenna: true,
  robotFloorShadow: true,
  robotCloudSync: false,

  // AI & Intelligence
  defaultModel: 'manus-1.6-lite',
  temperature: 0.7,
  enableWebSearch: true,
  enableCodeSandbox: true,
  deepResearchMode: false,
  streamingSpeed: 'fast',
  openRouterApiKey: '',
  workModeApiKey: '',

  // Personalization
  userName: '',
  userRole: 'Developer / Builder',
  aboutUser: '',
  customInstructions: 'Be direct, helpful, and provide high-quality responses with code examples when relevant.',
  responseTone: 'balanced',

  // Voice & Audio
  voicePersona: 'marcus',
  voiceInputLanguage: 'en-US',
  speechSpeed: 1.0,
  voicePitch: 1.0,
  enableAudioFilter: true,
  autoPlayAudio: false,
  enableHandsFreeVoice: false,
  autoSubmitVoiceAfterSilence: true,
  autoSubmitSilenceDelay: 7,

  // Security, Authorization & Permissions
  toolApprovalPolicy: 'ask_sensitive',
  enableBackgroundNotifications: true,
  enablePhoneCommands: true,

  // Performance & Rendering (Target Device Profile: 2GB RAM Android)
  ultraLiteMode: true,
  performanceProfile: 'auto',
  experimentalFrameRateBoost: false,
  frameRateTarget: 60,

  lastUpdated: new Date().toISOString(),
};

let cachedSettings: UserSettings | null = null;

export function getSettings(): UserSettings {
  if (cachedSettings) return cachedSettings;
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      cachedSettings = { ...DEFAULT_SETTINGS };
      return cachedSettings;
    }
    const parsed = JSON.parse(raw);
    cachedSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
    return cachedSettings;
  } catch (err) {
    cachedSettings = { ...DEFAULT_SETTINGS };
    return cachedSettings;
  }
}

export function saveSettings(updates: Partial<UserSettings>): UserSettings {
  try {
    const current = getSettings();
    const updated: UserSettings = {
      ...current,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
    cachedSettings = updated;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));

    // Sync Ultra-Lite Performance Engine configuration if updated
    if (typeof updates.ultraLiteMode === 'boolean' || updates.performanceProfile) {
      setPerformanceProfileConfiguration({
        ultraLiteMode: updated.ultraLiteMode,
        performanceProfile: updated.performanceProfile,
      });
    }

    // Also sync selected model if updated
    if (updates.defaultModel) {
      localStorage.setItem('selected_manus_model', updates.defaultModel);
    }

    // Also sync default mode if updated
    if (updates.defaultMode) {
      localStorage.setItem('manus_chat_work_mode', updates.defaultMode);
    }

    // Dispatch global event for components to react in real-time
    window.dispatchEvent(new CustomEvent('manus_settings_updated', { detail: updated }));
    return updated;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return getSettings();
  }
}

export function resetSettings(): UserSettings {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    const defaults = { ...DEFAULT_SETTINGS };
    cachedSettings = defaults;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
    setPerformanceProfileConfiguration({
      ultraLiteMode: defaults.ultraLiteMode,
      performanceProfile: defaults.performanceProfile,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('manus_settings_updated', { detail: defaults }));
    }
    return defaults;
  } catch (err) {
    cachedSettings = { ...DEFAULT_SETTINGS };
    return cachedSettings;
  }
}

export const settingsStore = {
  get: getSettings,
  save: saveSettings,
  reset: resetSettings,
};

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    if (sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume().catch(() => {});
    }
    return sharedAudioContext;
  }
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  sharedAudioContext = new AudioContextClass();
  return sharedAudioContext;
}

/**
 * Play gentle synthesized chime using a single shared Web Audio API context
 * (prevents AudioContext native thread/heap leaks on 2GB RAM Android WebViews)
 */
export function playNotificationSound(type: 'success' | 'send' | 'pop' | 'error' = 'pop') {
  try {
    const settings = getSettings();
    if (!settings.soundEffects) return;
    // Skip nonessential decorative sound synthesis in ultra-lite mode when document is hidden
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (getActivePerformanceProfile() === 'ultra-lite' && type === 'pop') return;

    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };

    if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
      return;
    }

    if (type === 'send') {
      // Crisp subtle upward click
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'success') {
      // Pleasant two-tone chime
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.09); // A5
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      // Soft pop
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    }
  } catch (err) {
    // Ignore audio permission/context errors silently
  }
}

/**
 * Export all workspace data (tasks, projects, library items, settings)
 */
export function exportWorkspaceBackup(): string {
  const data = {
    exportDate: new Date().toISOString(),
    version: 'manus-2.4.0',
    settings: getSettings(),
    tasks: localStorage.getItem('manus_agent_tasks') 
      ? JSON.parse(localStorage.getItem('manus_agent_tasks') || '[]') 
      : [],
    projects: localStorage.getItem('manus_agent_projects') 
      ? JSON.parse(localStorage.getItem('manus_agent_projects') || '[]') 
      : [],
    library: localStorage.getItem('manus_shared_library') 
      ? JSON.parse(localStorage.getItem('manus_shared_library') || '[]') 
      : [],
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Import and restore workspace data
 */
export function importWorkspaceBackup(rawJson: string): boolean {
  try {
    const data = JSON.parse(rawJson);
    if (data.settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.settings));
      window.dispatchEvent(new CustomEvent('manus_settings_updated', { detail: data.settings }));
    }
    if (Array.isArray(data.tasks)) {
      localStorage.setItem('manus_agent_tasks', JSON.stringify(data.tasks));
      window.dispatchEvent(new CustomEvent('manus_tasks_updated'));
    }
    if (Array.isArray(data.projects)) {
      localStorage.setItem('manus_agent_projects', JSON.stringify(data.projects));
      window.dispatchEvent(new CustomEvent('manus_projects_updated'));
    }
    if (Array.isArray(data.library)) {
      localStorage.setItem('manus_shared_library', JSON.stringify(data.library));
    }
    return true;
  } catch (err) {
    console.error('Failed to import backup:', err);
    return false;
  }
}

/**
 * Clear all chat & task history
 */
export function clearAllWorkspaceHistory(): void {
  try {
    localStorage.removeItem('manus_agent_tasks');
    window.dispatchEvent(new CustomEvent('manus_tasks_updated'));
  } catch (err) {
    console.error('Failed to clear history:', err);
  }
}
