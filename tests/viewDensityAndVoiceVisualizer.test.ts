import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  VIEW_DENSITY_CSS_VARIABLES,
  DEFAULT_VIEW_DENSITY,
  normalizeViewDensity,
  applyViewDensityToDocument,
} from '../src/lib/viewDensity';
import { getSettings, saveSettings, resetSettings } from '../src/lib/settingsStore';
import { computeFrequencyBands } from '../src/components/voice/VoiceInputButton';

function createMockRootElement() {
  const attributes = new Map<string, string>();
  const styleProps = new Map<string, string>();
  return {
    attributes,
    styleProps,
    element: {
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      getAttribute(name: string) {
        return attributes.get(name) ?? null;
      },
      style: {
        setProperty(name: string, value: string) {
          styleProps.set(name, value);
        },
        getPropertyValue(name: string) {
          return styleProps.get(name) ?? '';
        },
      },
    } as unknown as HTMLElement,
  };
}

describe('View Density CSS variables and persistence', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    resetSettings();
  });

  it('defines tighter spacing and smaller font sizes for Compact vs Spacious', () => {
    const compactFont = parseFloat(VIEW_DENSITY_CSS_VARIABLES.compact['--density-font-size-base']);
    const spaciousFont = parseFloat(VIEW_DENSITY_CSS_VARIABLES.spacious['--density-font-size-base']);
    expect(compactFont).toBeLessThan(spaciousFont);

    const compactChatFont = parseFloat(VIEW_DENSITY_CSS_VARIABLES.compact['--density-font-size-chat']);
    const spaciousChatFont = parseFloat(VIEW_DENSITY_CSS_VARIABLES.spacious['--density-font-size-chat']);
    expect(compactChatFont).toBeLessThan(spaciousChatFont);

    const compactGap = parseFloat(VIEW_DENSITY_CSS_VARIABLES.compact['--density-chat-gap']);
    const spaciousGap = parseFloat(VIEW_DENSITY_CSS_VARIABLES.spacious['--density-chat-gap']);
    expect(compactGap).toBeLessThan(spaciousGap);
  });

  it('normalizes unknown density values safely to spacious', () => {
    expect(normalizeViewDensity('compact')).toBe('compact');
    expect(normalizeViewDensity('spacious')).toBe('spacious');
    expect(normalizeViewDensity('invalid')).toBe('spacious');
    expect(normalizeViewDensity(undefined)).toBe(DEFAULT_VIEW_DENSITY);
  });

  it('applies data-view-density attribute and all CSS variables to document root', () => {
    const { element, attributes, styleProps } = createMockRootElement();

    const appliedCompact = applyViewDensityToDocument('compact', element);
    expect(appliedCompact).toBe('compact');
    expect(attributes.get('data-view-density')).toBe('compact');
    for (const [key, val] of Object.entries(VIEW_DENSITY_CSS_VARIABLES.compact)) {
      expect(styleProps.get(key)).toBe(val);
    }

    const appliedSpacious = applyViewDensityToDocument('spacious', element);
    expect(appliedSpacious).toBe('spacious');
    expect(attributes.get('data-view-density')).toBe('spacious');
    for (const [key, val] of Object.entries(VIEW_DENSITY_CSS_VARIABLES.spacious)) {
      expect(styleProps.get(key)).toBe(val);
    }
  });

  it('persists viewDensity via settingsStore saveSettings and restores default on reset', () => {
    if (typeof localStorage === 'undefined') {
      expect(getSettings().viewDensity).toBe('spacious');
      return;
    }

    const updated = saveSettings({ viewDensity: 'compact' });
    expect(updated.viewDensity).toBe('compact');
    expect(getSettings().viewDensity).toBe('compact');

    const reset = resetSettings();
    expect(reset.viewDensity).toBe('spacious');
    expect(getSettings().viewDensity).toBe('spacious');
  });
});

describe('Reactive Voice Frequency Visualization', () => {
  it('returns zeros on silence or empty FFT array', () => {
    expect(computeFrequencyBands(new Uint8Array(32), 5)).toEqual([0, 0, 0, 0, 0]);
    expect(computeFrequencyBands([], 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('maps distinct frequency bands from Web Audio FFT bins accurately', () => {
    const bins = new Uint8Array(32);
    bins[0] = 220;
    bins[1] = 200;
    bins[2] = 190;
    bins[3] = 180;
    bins[16] = 120;
    bins[17] = 110;

    const bands = computeFrequencyBands(bins, 5);
    expect(bands).toHaveLength(5);
    expect(bands[0]).toBeGreaterThan(0.75);
    expect(bands[2]).toBe(0);
    expect(bands[4]).toBeGreaterThan(0.3);
    for (const value of bands) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('clamps extreme FFT values cleanly within [0, 1]', () => {
    const maxed = new Uint8Array(32).fill(255);
    const bands = computeFrequencyBands(maxed, 5);
    expect(bands).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('UI wiring for SettingsModal View Density and ChatView Equalizer', () => {
  it('exposes Compact and Spacious View Density options in SettingsModal', () => {
    const settingsModalSrc = readFileSync(
      resolve(__dirname, '../src/components/settings/SettingsModal.tsx'),
      'utf8'
    );
    expect(settingsModalSrc).toContain('View Density');
    expect(settingsModalSrc).toContain('view-density-${option.id}');
    expect(settingsModalSrc).toContain("id: 'compact'");
    expect(settingsModalSrc).toContain("id: 'spacious'");
    expect(settingsModalSrc).toContain('Dense for desktop');
    expect(settingsModalSrc).toContain('Mobile-optimized');
  });

  it('renders reactive manus-voice-equalizer visualization inside ChatView input area', () => {
    const chatViewSrc = readFileSync(
      resolve(__dirname, '../src/components/agent/ChatView.tsx'),
      'utf8'
    );
    const indexCssSrc = readFileSync(
      resolve(__dirname, '../src/index.css'),
      'utf8'
    );
    expect(chatViewSrc).toContain('chat-input-frequency-visualizer');
    expect(chatViewSrc).toContain('manus-voice-equalizer');
    expect(chatViewSrc).toContain('onFrequencyDataChange={setVoiceFrequencyBands}');
    expect(indexCssSrc).toContain('.manus-voice-equalizer');
    expect(indexCssSrc).toContain('.manus-voice-equalizer--reactive');
    expect(indexCssSrc).toContain('[data-view-density="compact"]');
    expect(indexCssSrc).toContain('[data-view-density="spacious"]');
  });
});
