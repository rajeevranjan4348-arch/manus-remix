import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Black & White Monochrome Chat UI Theme', () => {
  const indexCss = readFileSync(resolve(__dirname, '../src/index.css'), 'utf-8');
  const chatViewSource = readFileSync(resolve(__dirname, '../src/components/agent/ChatView.tsx'), 'utf-8');
  const thoughtProcessSource = readFileSync(resolve(__dirname, '../src/components/agent/ThoughtProcess.tsx'), 'utf-8');
  const logoSource = readFileSync(resolve(__dirname, '../src/components/layout/Logo.tsx'), 'utf-8');

  it('defines monochrome black (#000000) and white (#FFFFFF) primary, background, and logo variables across light and dark modes', () => {
    expect(indexCss).toContain('--background: 0 0% 100%;');
    expect(indexCss).toContain('--background: 0 0% 0%;');
    expect(indexCss).toContain('--primary: 0 0% 0%;');
    expect(indexCss).toContain('--primary-foreground: 0 0% 100%;');
    expect(indexCss).toContain('--logo-color: #000000;');
    expect(indexCss).toContain('--logo-color: #FFFFFF;');
  });

  it('styles the user message bubble with solid black (#000000) background and white (#FFFFFF) text', () => {
    expect(chatViewSource).toContain('bg-[#000000] text-[#FFFFFF]');
  });

  it('removes all purple, violet, and blue classes from ThoughtProcess widget and uses light-gray circular icon background and black icons', () => {
    expect(thoughtProcessSource).not.toMatch(/purple-|violet-|indigo-|#a855f7/i);
    expect(thoughtProcessSource).toContain('rounded-full');
    expect(thoughtProcessSource).toContain('text-[#000000]');
  });

  it('keeps ManusLogo branding monochrome with light-gray Lite badge', () => {
    expect(logoSource).toContain('text-[#000000] dark:text-[#FFFFFF]');
  });
});
