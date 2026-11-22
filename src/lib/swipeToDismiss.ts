import type { PanInfo } from 'framer-motion';

export interface SwipeDismissThresholds {
  offsetThresholdPx?: number;
  velocityThresholdPxPerSec?: number;
}

export const DEFAULT_SWIPE_DISMISS_OFFSET_PX = 90;
export const DEFAULT_SWIPE_DISMISS_VELOCITY_PX_PER_SEC = 420;

/**
 * Evaluates whether a horizontal right-swipe gesture on a right-docked drawer
 * (such as HistoryPanel) exceeds the distance or velocity threshold to dismiss.
 * Ensures left-swipes (e.g. SwipeableHistoryItem delete gestures) or vertical scrolls
 * never trigger panel dismissal.
 */
export function shouldDismissRightDrawerOnSwipe(
  info: Pick<PanInfo, 'offset' | 'velocity'>,
  thresholds?: SwipeDismissThresholds
): boolean {
  const offsetThreshold = thresholds?.offsetThresholdPx ?? DEFAULT_SWIPE_DISMISS_OFFSET_PX;
  const velocityThreshold =
    thresholds?.velocityThresholdPxPerSec ?? DEFAULT_SWIPE_DISMISS_VELOCITY_PX_PER_SEC;

  const { x: offsetX, y: offsetY } = info.offset;
  const { x: velocityX } = info.velocity;

  // Must be predominantly horizontal in the positive (+X / rightward) direction
  if (offsetX <= 0) {
    return false;
  }

  // Guard against predominantly vertical scroll movements
  if (Math.abs(offsetY) > Math.abs(offsetX) * 1.25 && offsetX < offsetThreshold) {
    return false;
  }

  // Prevent dismissal if the user is actively flicking back to the left
  if (velocityX < -150) {
    return false;
  }

  return offsetX >= offsetThreshold || (offsetX >= 28 && velocityX >= velocityThreshold);
}

/**
 * Evaluates whether a downward vertical swipe gesture (or rightward back-swipe)
 * on a modal/panel (such as SettingsModal) exceeds the distance or velocity threshold to dismiss.
 */
export function shouldDismissModalOnSwipe(
  info: Pick<PanInfo, 'offset' | 'velocity'>,
  thresholds?: SwipeDismissThresholds
): boolean {
  const offsetThreshold = thresholds?.offsetThresholdPx ?? DEFAULT_SWIPE_DISMISS_OFFSET_PX;
  const velocityThreshold =
    thresholds?.velocityThresholdPxPerSec ?? DEFAULT_SWIPE_DISMISS_VELOCITY_PX_PER_SEC;

  const { y: offsetY, x: offsetX } = info.offset;
  const { y: velocityY } = info.velocity;

  // Must be downward (+Y)
  if (offsetY <= 0) {
    return false;
  }

  // Guard against predominantly horizontal tab scrolling
  if (Math.abs(offsetX) > Math.abs(offsetY) * 1.25 && offsetY < offsetThreshold) {
    return false;
  }

  // Prevent dismissal if flicking back upward
  if (velocityY < -150) {
    return false;
  }

  return offsetY >= offsetThreshold || (offsetY >= 28 && velocityY >= velocityThreshold);
}
