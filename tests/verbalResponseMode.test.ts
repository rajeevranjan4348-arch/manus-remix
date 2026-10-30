import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, saveSettings, resetSettings } from '../src/lib/settingsStore';

describe('Topbar Verbal Response Mode Toggle & Visual Indicator', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, val: string) => {
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
    (globalThis as any).window = {
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    resetSettings();
  });

  it('toggles autoPlayAudio in settingsStore and persists verbal response mode state', () => {
    expect(getSettings().autoPlayAudio).toBe(false);

    const enabled = saveSettings({ autoPlayAudio: true });
    expect(enabled.autoPlayAudio).toBe(true);
    expect(getSettings().autoPlayAudio).toBe(true);

    const disabled = saveSettings({ autoPlayAudio: false });
    expect(disabled.autoPlayAudio).toBe(false);
    expect(getSettings().autoPlayAudio).toBe(false);
  });

  it('keeps Topbar clean without the Speaker toggle button', () => {
    const topbarSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/layout/Topbar.tsx'),
      'utf-8'
    );

    expect(topbarSource).not.toContain('data-testid="topbar-verbal-mode-toggle"');
    expect(topbarSource).not.toContain('handleToggleVerbalMode');
  });

  it('triggers speakCleanHumanVoice in useAgentTask and MyAIChat when verbal mode is active', () => {
    const agentTaskSource = fs.readFileSync(
      path.resolve(__dirname, '../src/hooks/useAgentTask.ts'),
      'utf-8'
    );
    expect(agentTaskSource).toContain('curSettings.autoPlayAudio');
    expect(agentTaskSource).toContain('speakCleanHumanVoice');

    const myAiChatSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/chat/MyAIChat.tsx'),
      'utf-8'
    );
    expect(myAiChatSource).toContain('curSettings.autoPlayAudio');
    expect(myAiChatSource).toContain('speakCleanHumanVoice');
  });
});
