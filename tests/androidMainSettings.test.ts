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

  it('11. Robot Settings: Spherical chassis parameters & animation configuration', () => {
    saveSettings({
      robotShape: 'sphere',
      robotSpeed: 1.5,
      robotInteractive: true,
      robotAntenna: true,
      robotFloorShadow: true
    });

    const current = getSettings();
    expect(current.robotShape).toBe('sphere');
    expect(current.robotSpeed).toBe(1.5);
    expect(current.robotInteractive).toBe(true);
    expect(current.robotAntenna).toBe(true);
  });

  it('12. Robot Settings: Hardware pause and reset lifecycle', () => {
    saveSettings({
      robotPaused: true,
      robotSpeed: 0.5
    });

    let current = getSettings();
    expect(current.robotPaused).toBe(true);
    expect(current.robotSpeed).toBe(0.5);

    saveSettings({
      robotPaused: false,
      robotSpeed: 1.0
    });
    current = getSettings();
    expect(current.robotPaused).toBe(false);
    expect(current.robotSpeed).toBe(1.0);
  });

  it('13. Robot Appearance: Cloud-syncing toggle of custom robot personalities and visual themes', () => {
    // Initial state is false
    let current = getSettings();
    expect(current.robotCloudSync).toBe(false);

    // Toggle ON cloud-syncing across different devices
    saveSettings({
      robotCloudSync: true,
      robotPersonality: 'autonomous',
      robotEyeColor: 'lavender',
      robotAccentHardware: 'cyan'
    });

    current = getSettings();
    expect(current.robotCloudSync).toBe(true);
    expect(current.robotPersonality).toBe('autonomous');
    expect(current.robotEyeColor).toBe('lavender');
    expect(current.robotAccentHardware).toBe('cyan');

    // Toggle OFF cloud-syncing to keep settings local
    saveSettings({
      robotCloudSync: false
    });
    current = getSettings();
    expect(current.robotCloudSync).toBe(false);
    expect(current.robotPersonality).toBe('autonomous'); // attributes preserved
  });

  it('14. Robot Appearance: Multi-device sync payload consistency', () => {
    const multiDevicePayload = {
      robotCloudSync: true,
      robotPersonality: 'analytical',
      robotEyeColor: 'emerald',
      robotAccentHardware: 'graphite',
      robotName: 'Nexus Core',
      robotSize: 110,
      robotSpeed: 1.4,
      robotShape: 'sphere',
      robotTheme: 2
    };

    saveSettings(multiDevicePayload);
    const settings = getSettings();

    expect(settings.robotCloudSync).toBe(true);
    expect(settings.robotPersonality).toBe('analytical');
    expect(settings.robotEyeColor).toBe('emerald');
    expect(settings.robotAccentHardware).toBe('graphite');
    expect(settings.robotName).toBe('Nexus Core');
    expect(settings.robotSize).toBe(110);
    expect(settings.robotSpeed).toBe(1.4);
    expect(settings.robotShape).toBe('sphere');
  });

  it('15. Status Bar Removal: Verifies settings components do not render mockup status bars (5G, wifi, battery_full)', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const files = [
      path.resolve(__dirname, '../src/components/settings/AndroidGeneralSettings.tsx'),
      path.resolve(__dirname, '../src/components/settings/AndroidVoiceSettings.tsx'),
      path.resolve(__dirname, '../src/components/settings/AndroidRobotSettings.tsx'),
      path.resolve(__dirname, '../src/components/settings/AndroidMainSettings.tsx'),
      path.resolve(__dirname, '../src/components/settings/AndroidConnectorsSettings.tsx'),
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toContain('battery_full');
      expect(content).not.toContain('>5G<');
      expect(content).not.toContain('Top Android / Status Bar');
      expect(content).not.toContain('Android System Status Bar');
      // Content extends to top edge with standard pt-safe or calc(3.5rem+env(safe-area-inset-top))
      expect(content).toContain('pt-safe');
    }
  });

  it('16. High-Performance Sub-millisecond Execution: getSettings executes under 1ms', () => {
    // Warm up
    getSettings();

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const s = getSettings();
      expect(s).toBeDefined();
    }
    const elapsed = performance.now() - start;
    const avgPerCall = elapsed / iterations;
    // Each call must easily be sub-millisecond (< 1.0ms)
    expect(avgPerCall).toBeLessThan(1.0);
  });
});

