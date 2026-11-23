import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  HISTORY_PANEL_SLIDE_VARIANTS,
  HISTORY_TASK_LIST_CONTAINER_VARIANTS,
  HISTORY_LIST_ITEM_VARIANTS,
  HISTORY_GROUP_HEADER_VARIANTS,
  getHistoryItemStaggerDelay,
} from '../src/components/history/HistoryPanel';

describe('HistoryPanel Slide-In & Staggered List-Item Entrance Animations', () => {
  it('configures a smooth right-to-left spring slide-in animation for panel opening', () => {
    const hidden = HISTORY_PANEL_SLIDE_VARIANTS.hidden as Record<string, any>;
    const visible = HISTORY_PANEL_SLIDE_VARIANTS.visible as Record<string, any>;

    expect(hidden.x).toBe('100%');
    expect(visible.x).toBe(0);
    expect(visible.opacity).toBe(1);
    expect(visible.transition.type).toBe('spring');
    expect(visible.transition.stiffness).toBeGreaterThan(200);
    expect(visible.transition.damping).toBeGreaterThan(20);
  });

  it('configures staggered container choreography for task history items on panel open', () => {
    const hidden = HISTORY_TASK_LIST_CONTAINER_VARIANTS.hidden as Record<string, any>;
    const visible = HISTORY_TASK_LIST_CONTAINER_VARIANTS.visible as Record<string, any>;

    expect(hidden.opacity).toBe(0);
    expect(visible.opacity).toBe(1);
    expect(visible.transition.staggerChildren).toBeGreaterThan(0);
    expect(visible.transition.delayChildren).toBeGreaterThan(0);
  });

  it('computes bounded, monotonically increasing stagger delays for sessions and saved documents', () => {
    const d0 = getHistoryItemStaggerDelay(0);
    const d1 = getHistoryItemStaggerDelay(1);
    const d2 = getHistoryItemStaggerDelay(2);
    const d10 = getHistoryItemStaggerDelay(10);
    const d25 = getHistoryItemStaggerDelay(25);

    expect(d0).toBe(0.06);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    expect(d10).toBeGreaterThan(d2);
    // Caps at maxSteps (10) so long lists never stall
    expect(d25).toBe(d10);
    // Clamps negative indices safely to 0
    expect(getHistoryItemStaggerDelay(-3)).toBe(d0);
  });

  it('resolves per-item staggered entrance variants for list items and date group headers', () => {
    const hiddenItem = HISTORY_LIST_ITEM_VARIANTS.hidden as Record<string, any>;
    const resolveVisibleItem = HISTORY_LIST_ITEM_VARIANTS.visible as (index: number) => Record<string, any>;

    expect(hiddenItem.opacity).toBe(0);
    expect(hiddenItem.y).toBeGreaterThan(0);

    const firstItem = resolveVisibleItem(0);
    const fourthItem = resolveVisibleItem(3);
    expect(firstItem.opacity).toBe(1);
    expect(firstItem.y).toBe(0);
    expect(fourthItem.transition.delay).toBeGreaterThan(firstItem.transition.delay);

    const resolveGroupHeader = HISTORY_GROUP_HEADER_VARIANTS.visible as (index: number) => Record<string, any>;
    expect(resolveGroupHeader(0).opacity).toBe(1);
    expect(resolveGroupHeader(4).transition.delay).toBeGreaterThan(resolveGroupHeader(0).transition.delay);
  });

  it('applies slide-in and staggered animations in HistoryPanel.tsx while preserving swipe-to-dismiss and reduced motion', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/components/history/HistoryPanel.tsx'),
      'utf8'
    );

    // Respects reduced motion
    expect(source).toContain('useReducedMotion()');

    // Slide-in drawer container preserves swipe-to-dismiss
    expect(source).toContain('data-testid="history-panel-swipe-container"');
    expect(source).toContain('data-animation="slide-in"');
    expect(source).toContain('HISTORY_PANEL_SLIDE_VARIANTS');
    expect(source).toContain('drag="x"');
    expect(source).toContain('onDragEnd={handleHistorySwipeEnd}');

    // Task history list container & open-cycle staggered replay
    expect(source).toContain('data-testid="history-task-list-container"');
    expect(source).toContain('HISTORY_TASK_LIST_CONTAINER_VARIANTS');
    expect(source).toContain('openAnimationCycle');
    expect(source).toContain('data-stagger-delay-ms={staggerDelayMs}');

    // Staggered entrance applied to sessions and saved documents/library items (list & grid)
    expect(source).toContain('data-testid="history-session-list-item"');
    expect(source).toContain('data-testid="history-library-list-item"');
    expect(source).toContain('data-testid="history-library-grid-item"');
    expect(source).toContain('HISTORY_LIST_ITEM_VARIANTS');
    expect(source).toContain('HISTORY_GROUP_HEADER_VARIANTS');
  });
});
