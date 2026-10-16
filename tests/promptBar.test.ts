import { describe, it, expect } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';

describe('PromptBar Component Verification', () => {
  it('1. Component File Structure: verifies PromptBar.tsx and PromptBar.css exist', () => {
    const tsxPath = path.resolve(__dirname, '../src/components/ui/PromptBar.tsx');
    const cssPath = path.resolve(__dirname, '../src/components/ui/PromptBar.css');

    expect(fs.existsSync(tsxPath)).toBe(true);
    expect(fs.existsSync(cssPath)).toBe(true);
  });

  it('2. Export & Exports Types: exports PromptBar component and relevant interfaces', () => {
    const tsxContent = fs.readFileSync(
      path.resolve(__dirname, '../src/components/ui/PromptBar.tsx'),
      'utf-8'
    );

    expect(tsxContent).toContain('export interface PromptBarSource');
    expect(tsxContent).toContain('export interface PromptBarCommand');
    expect(tsxContent).toContain('export interface PromptBarModel');
    expect(tsxContent).toContain('export interface PromptBarSendDetail');
    expect(tsxContent).toContain('export interface PromptBarProps');
    expect(tsxContent).toContain('export const PromptBar');
    expect(tsxContent).toContain('export default PromptBar');
  });

  it('3. Features & Icons: includes Hugeicons, Motion, and Effort Spark Canvas', () => {
    const tsxContent = fs.readFileSync(
      path.resolve(__dirname, '../src/components/ui/PromptBar.tsx'),
      'utf-8'
    );

    expect(tsxContent).toContain('@hugeicons/react');
    expect(tsxContent).toContain('@hugeicons/core-free-icons');
    expect(tsxContent).toContain('motion/react');
    expect(tsxContent).toContain('sparkRef');
    expect(tsxContent).toContain('SendGlyph');
  });
});
