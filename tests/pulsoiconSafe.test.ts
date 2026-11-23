import { describe, it, expect } from 'vitest';
import * as PulsoIcons from 'pulsoicon-react';

describe('Mount-Safe PulsoIcon Wrapper Library', () => {
  it('exports all animated PulsoIcons used across the application with valid iconSpecs', () => {
    const requiredIcons = [
      'ArrowUp',
      'ChevronDown',
      'ChevronRight',
      'ChevronUp',
      'Copy',
      'Edit3',
      'History',
      'MessageSquare',
      'MessageSquarePlus',
      'Mic',
      'MoreHorizontal',
      'MoreVertical',
      'PanelLeft',
      'Paperclip',
      'Plus',
      'Search',
      'Settings',
      'Share2',
      'SquarePen',
      'ThumbsDown',
      'ThumbsUp',
      'Trash2',
    ] as const;

    for (const name of requiredIcons) {
      const IconComponent = (PulsoIcons as Record<string, any>)[name];
      expect(IconComponent).toBeDefined();
      expect(PulsoIcons.iconSpec(IconComponent)).toBeDefined();
    }
  });
});
