import type { Transition, Variants } from 'framer-motion';

/**
 * Natural spring-based motion presets for workspace panels, drawers, and modals.
 * Tuned for crisp responsiveness with subtle physical settle and clean exit.
 */
export const WORKSPACE_PANEL_SPRING_OPEN: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 30,
  mass: 0.85,
};

export const WORKSPACE_PANEL_SPRING_CLOSE: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.78,
};

export const WORKSPACE_SHEET_SPRING_OPEN: Transition = {
  type: 'spring',
  stiffness: 340,
  damping: 30,
  mass: 0.85,
};

export const WORKSPACE_SHEET_SPRING_CLOSE: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 34,
  mass: 0.8,
};

export const WORKSPACE_BACKDROP_TRANSITION: Transition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
};

export const WORKSPACE_BACKDROP_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: WORKSPACE_BACKDROP_TRANSITION,
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.18,
      ease: [0.4, 0, 1, 1],
    },
  },
};

export const WORKSPACE_DIALOG_SPRING_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.94,
    y: 14,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: WORKSPACE_PANEL_SPRING_OPEN,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: WORKSPACE_PANEL_SPRING_CLOSE,
  },
};

export const WORKSPACE_RIGHT_SHEET_SPRING_VARIANTS: Variants = {
  hidden: {
    x: '100%',
    opacity: 0.92,
  },
  visible: {
    x: 0,
    opacity: 1,
    transition: WORKSPACE_SHEET_SPRING_OPEN,
  },
  exit: {
    x: '100%',
    opacity: 0.9,
    transition: WORKSPACE_SHEET_SPRING_CLOSE,
  },
};

export const WORKSPACE_REDUCED_MOTION_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: { duration: 0.12 },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.1 },
  },
};
