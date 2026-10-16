import { describe, it, expect, vi } from 'vitest';
import type { Step } from '@/components/agent/Timeline';

// Helper reorder function identical to ChatView & Timeline logic
export function reorderStepsHelper(steps: Step[], fromIndex: number, toIndex: number): Step[] {
  if (
    fromIndex === toIndex || 
    fromIndex < 0 || 
    toIndex < 0 || 
    fromIndex >= steps.length || 
    toIndex >= steps.length
  ) {
    return steps;
  }
  const updated = [...steps];
  const [movedItem] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, movedItem);
  return updated;
}

// Helper gesture classification identical to SwipeableHistoryItem logic
export function classifyGesture(
  deltaX: number, 
  deltaY: number
): 'horizontal' | 'vertical' | 'undecided' {
  if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5) {
    return 'vertical';
  }
  if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) {
    return 'horizontal';
  }
  return 'undecided';
}

// Helper swipe outcome logic identical to SwipeableHistoryItem
export function calculateSwipeOutcome(
  offsetX: number,
  revealThreshold = 55,
  confirmThreshold = 140,
  revealedWidth = 84
): { action: 'delete' | 'reveal' | 'snap_back'; finalOffset: number; isOpen: boolean } {
  if (offsetX <= -confirmThreshold) {
    return { action: 'delete', finalOffset: -400, isOpen: false };
  } else if (offsetX <= -revealThreshold) {
    return { action: 'reveal', finalOffset: -revealedWidth, isOpen: true };
  } else {
    return { action: 'snap_back', finalOffset: 0, isOpen: false };
  }
}

// Rubber band resistance helper
export function computeSwipeOffset(startOffset: number, deltaX: number): number {
  const raw = startOffset + deltaX;
  if (raw > 0) {
    return Math.min(18, raw * 0.15); // damped resistance on right swipe
  }
  return raw;
}

describe('Drag-to-Reorder Task Steps Functionality', () => {
  const initialSteps: Step[] = [
    { id: 'step-1', label: 'Analyze market competitors', status: 'completed' },
    { id: 'step-2', label: 'Scrape pricing benchmarks', status: 'completed' },
    { id: 'step-3', label: 'Synthesize financial metrics', status: 'running' },
    { id: 'step-4', label: 'Generate PDF executive summary', status: 'pending' },
  ];

  it('moves a step down to a later position', () => {
    const result = reorderStepsHelper(initialSteps, 0, 2);
    expect(result.map(s => s.id)).toEqual(['step-2', 'step-3', 'step-1', 'step-4']);
    expect(result[2].label).toBe('Analyze market competitors');
    expect(result.length).toBe(4);
  });

  it('moves a step up to an earlier position', () => {
    const result = reorderStepsHelper(initialSteps, 3, 0);
    expect(result.map(s => s.id)).toEqual(['step-4', 'step-1', 'step-2', 'step-3']);
    expect(result[0].label).toBe('Generate PDF executive summary');
  });

  it('adjacent swap works accurately', () => {
    const result = reorderStepsHelper(initialSteps, 1, 2);
    expect(result.map(s => s.id)).toEqual(['step-1', 'step-3', 'step-2', 'step-4']);
  });

  it('ignores invalid bounds (negative fromIndex, out-of-range toIndex)', () => {
    expect(reorderStepsHelper(initialSteps, -1, 2)).toEqual(initialSteps);
    expect(reorderStepsHelper(initialSteps, 0, 99)).toEqual(initialSteps);
    expect(reorderStepsHelper(initialSteps, 2, 2)).toEqual(initialSteps);
  });

  it('maintains status, traces, and step integrity upon reordering', () => {
    const stepsWithTrace: Step[] = [
      { id: 's1', label: 'Search', status: 'completed', trace: ['Searching for competitors'] },
      { id: 's2', label: 'Calculate', status: 'running', trace: ['Crunching numbers'] }
    ];
    const reordered = reorderStepsHelper(stepsWithTrace, 0, 1);
    expect(reordered[0].id).toBe('s2');
    expect(reordered[0].trace).toEqual(['Crunching numbers']);
    expect(reordered[1].id).toBe('s1');
    expect(reordered[1].trace).toEqual(['Searching for competitors']);
  });
});

describe('Swipe-to-Delete Gestures for History Items', () => {
  it('correctly classifies horizontal left swipe without interrupting vertical scroll', () => {
    expect(classifyGesture(-45, 4)).toBe('horizontal');
    expect(classifyGesture(3, 40)).toBe('vertical');
    expect(classifyGesture(2, 2)).toBe('undecided');
  });

  it('applies rubber-banding resistance on rightward swipes', () => {
    const offsetSmall = computeSwipeOffset(0, 50);
    expect(offsetSmall).toBe(7.5); // 50 * 0.15

    const offsetLarge = computeSwipeOffset(0, 500);
    expect(offsetLarge).toBe(18); // capped at 18px
  });

  it('snaps back when swipe is less than reveal threshold', () => {
    const outcome = calculateSwipeOutcome(-30);
    expect(outcome.action).toBe('snap_back');
    expect(outcome.finalOffset).toBe(0);
    expect(outcome.isOpen).toBe(false);
  });

  it('reveals delete action button when swiped past reveal threshold', () => {
    const outcome = calculateSwipeOutcome(-75);
    expect(outcome.action).toBe('reveal');
    expect(outcome.finalOffset).toBe(-84);
    expect(outcome.isOpen).toBe(true);
  });

  it('triggers full swipe-to-delete when pulled past confirm threshold', () => {
    const outcome = calculateSwipeOutcome(-160);
    expect(outcome.action).toBe('delete');
    expect(outcome.finalOffset).toBe(-400);
    expect(outcome.isOpen).toBe(false);
  });

  it('simulates history session deletion after full swipe', () => {
    let mockSessions = [
      { id: 'session-1', title: 'Market analysis' },
      { id: 'session-2', title: 'Code audit' }
    ];

    const onDelete = (id: string) => {
      mockSessions = mockSessions.filter(s => s.id !== id);
    };

    const outcome = calculateSwipeOutcome(-150);
    if (outcome.action === 'delete') {
      onDelete('session-1');
    }

    expect(mockSessions.length).toBe(1);
    expect(mockSessions[0].id).toBe('session-2');
  });
});
