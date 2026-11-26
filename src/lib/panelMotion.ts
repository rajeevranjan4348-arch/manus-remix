import type { Transition, Variants } from 'framer-motion';

/**
 * Ultra-fast spring-based motion presets for workspace panels, drawers, and modals.
 * Tuned for near-instant opening speed with crisp physical settle and snappy exit.
 */
export const WORKSPACE_PANEL_SPRING_OPEN: Transition = {
  type: 'spring',
  stiffness: 560,
  damping: 29,
  mass: 0.62,
};

export const WORKSPACE_PANEL_SPRING_CLOSE: Transition = {
  type: 'spring',
  stiffness: 780,
  damping: 46,
  mass: 0.46,
};

export const WORKSPACE_SHEET_SPRING_OPEN: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 28,
  mass: 0.65,
};

export const WORKSPACE_SHEET_SPRING_CLOSE: Transition = {
  type: 'spring',
  stiffness: 740,
  damping: 46,
  mass: 0.48,
};

export const WORKSPACE_BACKDROP_TRANSITION: Transition = {
  duration: 0.09,
  ease: [0.16, 1, 0.3, 1],
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
      duration: 0.075,
      ease: [0.4, 0, 1, 1],
    },
  },
};

export const WORKSPACE_DIALOG_SPRING_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.96,
    y: 8,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: WORKSPACE_PANEL_SPRING_OPEN,
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 6,
    transition: WORKSPACE_PANEL_SPRING_CLOSE,
  },
};

export const WORKSPACE_RIGHT_SHEET_SPRING_VARIANTS: Variants = {
  hidden: {
    x: '100%',
    opacity: 0.96,
  },
  visible: {
    x: 0,
    opacity: 1,
    transition: WORKSPACE_SHEET_SPRING_OPEN,
  },
  exit: {
    x: '100%',
    opacity: 0.94,
    transition: WORKSPACE_SHEET_SPRING_CLOSE,
  },
};

export const WORKSPACE_REDUCED_MOTION_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: { duration: 0.06 },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.05 },
  },
};

export const WORKSPACE_DROPDOWN_SPRING_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.97,
    y: -4,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 780,
      damping: 44,
      mass: 0.45,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: -3,
    transition: {
      duration: 0.07,
      ease: [0.4, 0, 1, 1],
    },
  },
};

export const WORKSPACE_FLOATING_BUTTON_SPRING_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.92,
    y: 8,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 720,
      damping: 40,
      mass: 0.48,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.94,
    y: 5,
    transition: {
      duration: 0.08,
      ease: [0.4, 0, 1, 1],
    },
  },
};

export const WORKSPACE_MODE_PILL_SPRING: Transition = {
  type: 'spring',
  stiffness: 800,
  damping: 46,
  mass: 0.45,
};

export const WORKSPACE_SECTION_REVEAL_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    y: 6,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 680,
      damping: 42,
      mass: 0.5,
    },
  },
  exit: {
    opacity: 0,
    y: 4,
    transition: {
      duration: 0.08,
      ease: [0.4, 0, 1, 1],
    },
  },
};

