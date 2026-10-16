import { describe, it, expect, beforeEach } from 'vitest';

// Polyfill window & localStorage in Node test environment if undefined
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

import { getSettings, saveSettings, resetSettings } from '../src/lib/settingsStore';

describe('Android 15 Edge-to-Edge Main Settings Integration Suite', () => {
  beforeEach(() => {
    resetSettings();
  });

  it('1. Setting persistence: saves and retrieves user profile details', () => {
    saveSettings({
      userName: 'Rajeev Ranjan',
      userRole: 'Lead AI Engineer',
      aboutUser: 'Autonomous agent specialist',
      customInstructions: 'Prefer strict TypeScript and Tailwind CSS.'
    });

    const current = getSettings();
    expect(current.userName).toBe('Rajeev Ranjan');
    expect(current.userRole).toBe('Lead AI Engineer');
    expect(current.customInstructions).toContain('strict TypeScript');
  });

  it('2. Voice Persona and speech rate configuration for Android voice stack', () => {
    saveSettings({
      voicePersona: 'nova',
      speechSpeed: 1.25,
      voicePitch: 1.1
    });

    const current = getSettings();
    expect(current.voicePersona).toBe('nova');
    expect(current.speechSpeed).toBe(1.25);
    expect(current.voicePitch).toBe(1.1);
  });

  it('3. Interface theme & reduced motion preferences', () => {
    saveSettings({
      theme: 'dark',
      reducedMotion: true
    });

    const current = getSettings();
    expect(current.theme).toBe('dark');
    expect(current.reducedMotion).toBe(true);
  });

  it('4. Tool approval policies and safety controls', () => {
    saveSettings({
      toolApprovalPolicy: 'ask_sensitive'
    });

    const current = getSettings();
    expect(current.toolApprovalPolicy).toBe('ask_sensitive');
  });

  it('5. Obsidian Tactile Engine: Default Mode selection (chat vs autonomous work)', () => {
    saveSettings({
      defaultMode: 'work'
    });

    let current = getSettings();
    expect(current.defaultMode).toBe('work');

    saveSettings({
      defaultMode: 'chat'
    });
    current = getSettings();
    expect(current.defaultMode).toBe('chat');
  });

  it('6. Obsidian Tactile Engine: Cognitive elaboration density & response tone', () => {
    saveSettings({
      responseTone: 'professional'
    });

    let current = getSettings();
    expect(current.responseTone).toBe('professional');

    saveSettings({
      responseTone: 'concise'
    });
    current = getSettings();
    expect(current.responseTone).toBe('concise');
  });

  it('7. Obsidian Tactile Engine: Localization language & speech input model', () => {
    saveSettings({
      language: 'ja',
      voiceInputLanguage: 'ja-JP'
    });

    const current = getSettings();
    expect(current.language).toBe('ja');
    expect(current.voiceInputLanguage).toBe('ja-JP');
  });

  it('8. Obsidian Tactile Engine: Reset to defaults restores initial parameters', () => {
    saveSettings({
      theme: 'dark',
      defaultMode: 'work',
      userName: 'Custom User'
    });

    const resetResult = resetSettings();
    expect(resetResult.theme).toBe('light');
    expect(resetResult.defaultMode).toBe('chat');
    expect(resetResult.userName).toBe('');
  });

  it('9. Acoustic Studio & Voice Engine: Persona models and cadence speed', () => {
    saveSettings({
      voicePersona: 'onyx',
      speechSpeed: 1.5,
      voicePitch: 1.0
    });

    let current = getSettings();
    expect(current.voicePersona).toBe('onyx');
    expect(current.speechSpeed).toBe(1.5);

    saveSettings({
      voicePersona: 'shimmer',
      speechSpeed: 0.8
    });
    current = getSettings();
    expect(current.voicePersona).toBe('shimmer');
    expect(current.speechSpeed).toBe(0.8);
  });

  it('10. Acoustic Studio & Voice Engine: Conversational audio toggles and filter', () => {
    saveSettings({
      autoPlayAudio: true,
      enableAudioFilter: true
    });

    let current = getSettings();
    expect(current.autoPlayAudio).toBe(true);
    expect(current.enableAudioFilter).toBe(true);

    saveSettings({
      autoPlayAudio: false,
      enableAudioFilter: false
    });
    current = getSettings();
    expect(current.autoPlayAudio).toBe(false);
    expect(current.enableAudioFilter).toBe(false);
  });
});
