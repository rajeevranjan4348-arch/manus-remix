import { UserSettings } from '@/types/settings';

const SETTINGS_KEY = 'manus_user_settings';

export const DEFAULT_SETTINGS: UserSettings = {
  // General
  theme: 'light',
  defaultMode: 'chat',
  language: 'en',
  soundEffects: true,
  reducedMotion: false,

  // AI & Intelligence
  defaultModel: 'manus-1.6-lite',
  temperature: 0.7,
  enableWebSearch: true,
  enableCodeSandbox: true,
  deepResearchMode: false,
  streamingSpeed: 'fast',

  // Personalization
  userName: '',
  userRole: 'Developer / Builder',
  aboutUser: '',
  customInstructions: 'Be direct, helpful, and provide high-quality responses with code examples when relevant.',
  responseTone: 'balanced',

  // Voice & Audio
  voicePersona: 'nova',
  speechSpeed: 1.0,
  autoPlayAudio: false,

  lastUpdated: new Date().toISOString(),
};

export function getSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch (err) {
    console.error('Failed to load settings:', err);
    return { ...DEFAULT_SETTINGS };
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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));

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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
    window.dispatchEvent(new CustomEvent('manus_settings_updated', { detail: defaults }));
    return defaults;
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Play gentle synthesized chime using Web Audio API (zero audio file dependencies)
 */
export function playNotificationSound(type: 'success' | 'send' | 'pop' = 'pop') {
  try {
    const settings = getSettings();
    if (!settings.soundEffects) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

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
