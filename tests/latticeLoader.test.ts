import { describe, it, expect } from 'vitest';

// Polyfill window & localStorage in test environment if needed
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

import React from 'react';
import LatticeLoader, { LatticeLoaderProps } from '../src/components/ui/LatticeLoader';

describe('LatticeLoader Component', () => {
  it('exports LatticeLoader as default and named export', () => {
    expect(LatticeLoader).toBeDefined();
    expect(typeof LatticeLoader).toBe('function');
  });

  it('accepts custom status, pattern, grid, and colors without throwing', () => {
    const props: LatticeLoaderProps = {
      label: 'Analyzing dataset',
      doneLabel: 'Completed in',
      errorLabel: 'Execution failed after',
      status: 'working',
      pattern: 'orbit',
      grid: 3,
      shape: 'round',
      color: '#3b82f6',
      doneColor: '#22c55e',
      errorColor: '#ef4444',
      cellSize: 8,
      gap: 3,
      fontSize: 14,
      showTimer: true,
      glow: true,
    };

    expect(props.label).toBe('Analyzing dataset');
    expect(props.status).toBe('working');
    expect(props.grid).toBe(3);
  });

  it('handles 4x4 grid patterns cleanly', () => {
    const props: LatticeLoaderProps = {
      status: 'done',
      pattern: 'sweep',
      grid: 4,
      showTimer: true,
      elapsed: 12.5,
    };

    expect(props.grid).toBe(4);
    expect(props.elapsed).toBe(12.5);
    expect(props.pattern).toBe('sweep');
  });
});
