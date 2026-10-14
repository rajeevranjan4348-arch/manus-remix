import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Sidebar Smooth Slide Transition Suite', () => {
  const sidebarPath = path.resolve(__dirname, '../src/components/layout/Sidebar.tsx');
  const sidebarContent = fs.readFileSync(sidebarPath, 'utf-8');

  it('contains Tailwind transition utilities for smooth slide-in and slide-out', () => {
    // Verifies transition-all / transition-transform and duration utilities
    expect(sidebarContent).toContain('transition-all duration-300 ease-in-out');
    // Verifies slide-out state
    expect(sidebarContent).toContain('-translate-x-full');
    // Verifies slide-in state
    expect(sidebarContent).toContain('translate-x-0');
  });

  it('contains smooth fade transition utilities for mobile backdrop', () => {
    expect(sidebarContent).toContain('transition-opacity duration-300 ease-in-out');
    expect(sidebarContent).toContain('opacity-100 pointer-events-auto');
    expect(sidebarContent).toContain('opacity-0 pointer-events-none');
  });

  it('preserves desktop collapsed icon rail and expanded navigation', () => {
    expect(sidebarContent).toContain('w-16 opacity-100 pointer-events-auto');
    expect(sidebarContent).toContain('lg:w-64');
  });
});
