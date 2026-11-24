import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildModelIdentityInstruction,
  normalizeModel,
} from '../server/geminiService';
import { formatChatAsMarkdown } from '../src/lib/chatExport';

const rootDir = process.cwd();
const readText = (relPath: string) =>
  fs.readFileSync(path.join(rootDir, relPath), 'utf8');

describe('Global Rebranding Verification — Manus AI → Deku AI', () => {
  it('updates HTML title, SEO metadata, PWA manifest, metadata.json, and Capacitor appName to Deku AI', () => {
    const indexHtml = readText('index.html');
    expect(indexHtml).toContain('<title>Deku AI</title>');
    expect(indexHtml).toContain('content="Deku AI"');
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.json" />');
    expect(indexHtml).not.toContain('Manus AI');

    const manifest = JSON.parse(readText('public/manifest.json'));
    expect(manifest.name).toBe('Deku AI');
    expect(manifest.short_name).toBe('Deku');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');

    const metadata = JSON.parse(readText('metadata.json'));
    expect(metadata.name).toBe('Deku AI');

    const capacitorConfig = readText('capacitor.config.ts');
    expect(capacitorConfig).toContain("appName: 'Deku AI'");
    // Preserves Android package identifier for existing installations
    expect(capacitorConfig).toContain("appId: 'com.rajeevranjan.manusremix'");
  });

  it('keeps model identity claims generic while preserving backend aliases', () => {
    expect(normalizeModel('deku-1.6-max')).toBe('gemini-3.1-pro-preview');
    expect(normalizeModel('manus-1.6-max')).toBe('gemini-3.1-pro-preview');

    const instruction = buildModelIdentityInstruction();
    expect(instruction).toContain('The application is Deku AI');
    expect(instruction).toContain('Do not infer or claim a specific underlying model ID or provider');
    expect(instruction).toContain('backend-confirmed response metadata');
    expect(instruction).not.toContain('Active Underlying LLM Model ID:');
    expect(instruction).not.toContain('Model Provider: Google Gemini');
  });

  it('updates visible brand UI components (Logo, Topbar, WorkModeThinkingAnimation, SettingsModal) to Deku AI', () => {
    const logoSrc = readText('src/components/layout/Logo.tsx');
    expect(logoSrc).toContain('>deku</span>');
    expect(logoSrc).toContain('export const DekuLogo = ManusLogo;');

    const topbarSrc = readText('src/components/layout/Topbar.tsx');
    expect(topbarSrc).toContain("name: 'Deku 1.6 Lite'");
    expect(topbarSrc).toContain("name: 'Deku 1.6 Max'");
    expect(topbarSrc).toContain('Deku is typing...');

    const workThinkingSrc = readText('src/components/agent/WorkModeThinkingAnimation.tsx');
    expect(workThinkingSrc).toContain("'Deku Deep Reasoning'");
    expect(workThinkingSrc).toContain("'Deku AI is thinking'");

    const settingsSrc = readText('src/components/settings/SettingsModal.tsx');
    expect(settingsSrc).toContain('Deku AI Workspace');
    expect(settingsSrc).toContain('Deku 1.6 Lite');
    expect(settingsSrc).toContain('Deku 1.6 Max (2M)');
  });

  it('exports chat sessions with Deku AI branding', () => {
    const markdown = formatChatAsMarkdown({
      taskId: 'task_deku_1',
      prompt: 'Architecture Review',
      status: 'completed',
      messages: [
        { id: '1', role: 'user', content: 'Hello Deku' },
        { id: '2', role: 'assistant', content: 'Hello! I am Deku AI.' },
      ],
    });
    expect(markdown).toContain('### 2. Deku AI');
    expect(markdown).not.toContain('Manus AI');
  });
});
