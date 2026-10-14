import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Manus Remix UI Text & Icon Overlapping Fixes', () => {
  const homePath = path.resolve(__dirname, '../src/pages/Home.tsx');
  const chatViewPath = path.resolve(__dirname, '../src/components/agent/ChatView.tsx');

  it('1. Chat/Work switcher container contains relative positioning, overflow-hidden, and radiogroup attributes', () => {
    const homeContent = fs.readFileSync(homePath, 'utf8');
    expect(homeContent).toContain('role="radiogroup"');
    expect(homeContent).toContain('relative inline-flex items-center');
    expect(homeContent).toContain('overflow-hidden');
    expect(homeContent).toContain('max-w-full');
  });

  it('2. Chat/Work switcher buttons ensure toggle indicator is inside container and never covers labels', () => {
    const homeContent = fs.readFileSync(homePath, 'utf8');
    // Active and inactive modes use relative z-10 and whitespace-nowrap
    expect(homeContent).toContain('relative z-10 inline-flex items-center justify-center gap-2');
    expect(homeContent).toContain('whitespace-nowrap shrink-0');
    // Active circular toggle indicator has shrink-0 and is inline
    expect(homeContent).toContain('w-1.5 h-1.5 rounded-full bg-emerald-400');
    expect(homeContent).toContain('shrink-0 ml-0.5');
  });

  it('3. Home bottom action toolbar buttons have consistent w-9 h-9 sizing and shrink-0 to prevent squishing on mobile', () => {
    const homeContent = fs.readFileSync(homePath, 'utf8');
    // Circular + attachment button
    expect(homeContent).toContain('w-9 h-9 rounded-full border border-slate-200/90');
    // VoiceInputButton has shrink-0 and w-9 h-9
    expect(homeContent).toContain('w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-accent transition-colors flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer shrink-0');
    // Send button has w-9 h-9 and shrink-0
    expect(homeContent).toContain('w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer shadow-md shrink-0');
  });

  it('4. Action chips toolbar in Home.tsx has safe horizontal scrolling, shrink-0, and normal-sized icons', () => {
    const homeContent = fs.readFileSync(homePath, 'utf8');
    expect(homeContent).toContain('overflow-x-auto overscroll-x-contain scroll-px-2 no-scrollbar px-2 sm:px-4 py-1.5 whitespace-nowrap');
    expect(homeContent).toContain('shrink-0 inline-flex items-center justify-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2');
    expect(homeContent).toContain('chip.icon size={16}');
  });

  it('5. ChatView bottom action toolbar buttons also have consistent w-9 h-9 sizing, shrink-0, and proper alignment', () => {
    const chatContent = fs.readFileSync(chatViewPath, 'utf8');
    expect(chatContent).toContain('w-9 h-9 rounded-full border border-slate-200/90');
    expect(chatContent).toContain('w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-accent');
    expect(chatContent).toContain('w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 shadow-2xs shrink-0 cursor-pointer');
    expect(chatContent).toContain('flex items-center justify-between gap-2 sm:gap-3 pt-1 border-t border-transparent min-w-0 w-full');
  });
});
