import { describe, it, expect } from 'vitest';
import {
  shouldDismissRightDrawerOnSwipe,
  shouldDismissModalOnSwipe,
  DEFAULT_SWIPE_DISMISS_OFFSET_PX,
  DEFAULT_SWIPE_DISMISS_VELOCITY_PX_PER_SEC,
} from '../src/lib/swipeToDismiss';

describe('Framer Motion Swipe-to-Dismiss Gestures (History & Settings Panels)', () => {
  describe('shouldDismissRightDrawerOnSwipe (HistoryPanel right-docked drawer)', () => {
    it('dismisses when swiped right past the distance threshold', () => {
      expect(
        shouldDismissRightDrawerOnSwipe({
          offset: { x: DEFAULT_SWIPE_DISMISS_OFFSET_PX + 15, y: 10 },
          velocity: { x: 180, y: 5 },
        })
      ).toBe(true);
    });

    it('dismisses on a fast rightward flick even with moderate horizontal offset', () => {
      expect(
        shouldDismissRightDrawerOnSwipe({
          offset: { x: 45, y: 6 },
          velocity: { x: DEFAULT_SWIPE_DISMISS_VELOCITY_PX_PER_SEC + 80, y: 12 },
        })
      ).toBe(true);
    });

    it('does NOT dismiss when swiped left (preserves SwipeableHistoryItem swipe-to-delete)', () => {
      expect(
        shouldDismissRightDrawerOnSwipe({
          offset: { x: -140, y: 4 },
          velocity: { x: -650, y: 0 },
        })
      ).toBe(false);
    });

    it('does NOT dismiss when swipe distance and velocity are below thresholds', () => {
      expect(
        shouldDismissRightDrawerOnSwipe({
          offset: { x: 35, y: 5 },
          velocity: { x: 120, y: 0 },
        })
      ).toBe(false);
    });

    it('does NOT dismiss during predominantly vertical scrolling', () => {
      expect(
        shouldDismissRightDrawerOnSwipe({
          offset: { x: 40, y: 120 },
          velocity: { x: 500, y: 900 },
        })
      ).toBe(false);
    });

    it('does NOT dismiss if the user flicks back to the left at release', () => {
      expect(
        shouldDismissRightDrawerOnSwipe({
          offset: { x: 110, y: 0 },
          velocity: { x: -240, y: 0 },
        })
      ).toBe(false);
    });
  });

  describe('shouldDismissModalOnSwipe (SettingsModal downward swipe-to-dismiss)', () => {
    it('dismisses when swiped downward past the vertical offset threshold', () => {
      expect(
        shouldDismissModalOnSwipe({
          offset: { x: 8, y: DEFAULT_SWIPE_DISMISS_OFFSET_PX + 20 },
          velocity: { x: 10, y: 200 },
        })
      ).toBe(true);
    });

    it('dismisses on a fast downward flick even with moderate vertical offset', () => {
      expect(
        shouldDismissModalOnSwipe({
          offset: { x: 4, y: 42 },
          velocity: { x: 0, y: DEFAULT_SWIPE_DISMISS_VELOCITY_PX_PER_SEC + 100 },
        })
      ).toBe(true);
    });

    it('does NOT dismiss when swiped upward', () => {
      expect(
        shouldDismissModalOnSwipe({
          offset: { x: 0, y: -120 },
          velocity: { x: 0, y: -600 },
        })
      ).toBe(false);
    });

    it('does NOT dismiss when downward swipe is small and slow', () => {
      expect(
        shouldDismissModalOnSwipe({
          offset: { x: 2, y: 30 },
          velocity: { x: 5, y: 110 },
        })
      ).toBe(false);
    });

    it('does NOT dismiss during predominantly horizontal tab bar scrolling', () => {
      expect(
        shouldDismissModalOnSwipe({
          offset: { x: 95, y: 40 },
          velocity: { x: 600, y: 480 },
        })
      ).toBe(false);
    });

    it('does NOT dismiss if the user flicks back upward at release', () => {
      expect(
        shouldDismissModalOnSwipe({
          offset: { x: 0, y: 115 },
          velocity: { x: 0, y: -220 },
        })
      ).toBe(false);
    });
  });
});
