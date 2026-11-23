import type { ViewDensity } from '@/types/settings';

export const DEFAULT_VIEW_DENSITY: ViewDensity = 'spacious';

export const VIEW_DENSITY_CSS_VARIABLES: Record<ViewDensity, Record<string, string>> = {
  compact: {
    '--density-font-size-base': '14.5px',
    '--density-font-size-chat': '0.84375rem',
    '--density-line-height-chat': '1.45',
    '--density-spacing-unit': '0.2rem',
    '--density-chat-gap': '0.375rem',
    '--density-message-py': '0.375rem',
    '--density-bubble-px': '0.75rem',
    '--density-bubble-py': '0.4375rem',
    '--density-input-px': '0.875rem',
    '--density-input-py': '0.5rem',
    '--density-panel-padding': '0.875rem',
  },
  spacious: {
    '--density-font-size-base': '16px',
    '--density-font-size-chat': '0.9375rem',
    '--density-line-height-chat': '1.6',
    '--density-spacing-unit': '0.25rem',
    '--density-chat-gap': '0.75rem',
    '--density-message-py': '0.75rem',
    '--density-bubble-px': '1rem',
    '--density-bubble-py': '0.625rem',
    '--density-input-px': '1.125rem',
    '--density-input-py': '0.75rem',
    '--density-panel-padding': '1.25rem',
  },
};

export function normalizeViewDensity(value: unknown): ViewDensity {
  return value === 'compact' ? 'compact' : 'spacious';
}

export function applyViewDensityToDocument(
  density: unknown,
  root?: HTMLElement | null
): ViewDensity {
  const normalized = normalizeViewDensity(density);
  const target =
    root !== undefined
      ? root
      : typeof document !== 'undefined'
        ? document.documentElement
        : null;

  if (!target) {
    return normalized;
  }

  target.setAttribute('data-view-density', normalized);
  const variables = VIEW_DENSITY_CSS_VARIABLES[normalized];
  for (const [name, val] of Object.entries(variables)) {
    target.style.setProperty(name, val);
  }

  return normalized;
}
