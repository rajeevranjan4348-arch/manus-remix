/**
 * Ultra-smooth scrolling engine (UI-logic layer).
 *
 * Frame-rate-independent inertial / spring scroll animation built on rAF.
 * Honors `prefers-reduced-motion` and coarse pointers by falling back to
 * native behavior, so it never fights the platform or changes visuals.
 */

export interface SmoothScrollOptions {
  /** Max animation duration in ms (default 650). */
  duration?: number;
  /** Spring stiffness for snap-to-target mode (default 180). */
  stiffness?: number;
  /** Spring damping ratio (default 1 — critically damped, no overshoot jitter). */
  damping?: number;
  /** Cancel any in-flight animation for the same element before starting. */
  interruptible?: boolean;
}

type ActiveAnimation = { cancel: () => void };

const registry = new WeakMap<Element, ActiveAnimation>();

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const isCoarsePointer = (): boolean => {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};

/** True when we should hand control back to the browser's own smooth scroll. */
const shouldBypassEngine = (): boolean => prefersReducedMotion() || isCoarsePointer();

/**
 * Animate an element's scrollTop toward `targetTop` with a velocity-aware
 * exponential-decay curve (critically-damped, C1-continuous), using
 * delta-time integration so it feels identical at 60/120/144 Hz.
 */
export function animateScrollTop(
  el: Element & { scrollTop: number },
  targetTop: number,
  options: SmoothScrollOptions = {},
): void {
  const { duration = 650, interruptible = true } = options;

  // Cancel previous run on this element so rapid calls don't fight each other.
  if (interruptible) {
    registry.get(el)?.cancel();
  }

  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const goal = Math.min(Math.max(targetTop, 0), max);
  const start = el.scrollTop;
  const delta = goal - start;

  if (Math.abs(delta) < 1 || shouldBypassEngine()) {
    // Too small to matter, or user/platform wants native motion: do it plainly.
    if (delta !== 0) {
      try {
        el.scrollTo({ top: goal, behavior: 'smooth' });
      } catch {
        el.scrollTop = goal;
      }
    }
    return;
  }

  let raf = 0;
  let lastT: number | null = null;
  let current = start;
  let velocity = 0; // px/s, integrated — keeps motion continuous across frames
  let elapsed = 0;
  let finished = false;

  const cancel = () => {
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    registry.delete(el);
  };

  // Time-constant tuned so ~99.5% of distance closes within `duration`.
  const tau = duration / 5.3;

  const step = (t: number) => {
    if (finished) return;
    if (lastT === null) lastT = t;
    // Clamp dt to avoid huge jumps after tab-switch stalls.
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    elapsed += dt * 1000;

    // Critically-damped approach: spring pulls remaining distance,
    // damping removes oscillation → buttery deceleration, zero overshoot.
    const remaining = goal - current;
    const springAccel = (remaining / (tau * tau)) * 1000; // px/s^2 scale
    velocity += (springAccel - (2 * velocity) / tau) * dt;
    current += velocity * dt;

    // Snap-close near the end to prevent sub-pixel crawl.
    if (Math.abs(goal - current) < 0.5 && elapsed > duration * 0.35) {
      el.scrollTop = goal;
      registry.delete(el);
      return;
    }

    el.scrollTop = current;

    if (elapsed >= duration * 1.6) {
      el.scrollTop = goal;
      registry.delete(el);
      return;
    }
    raf = requestAnimationFrame(step);
  };

  registry.set(el, { cancel });
  raf = requestAnimationFrame(step);
}

/** Convenience: ultra-smooth scroll an element to its bottom (chat follow). */
export function smoothScrollToBottom(
  el: Element & { scrollTop: number },
  options: SmoothScrollOptions = {},
): void {
  animateScrollTop(el, el.scrollHeight, options);
}

/** Convenience: smooth-scroll an element until a descendant is in view. */
export function smoothScrollIntoView(
  container: Element & { scrollTop: number },
  child: Element,
  offset = 0,
  options: SmoothScrollOptions = {},
): void {
  const cRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const target = container.scrollTop + (childRect.top - cRect.top) + offset;
  animateScrollTop(container, target, options);
}

/**
 * Wheel smoothing: converts discrete mouse-wheel steps into one continuous
 * animated scroll per gesture burst, killing the classic "stepped" feel.
 * Attach via the React hook below; returns a disposer.
 */
export function attachWheelSmoothing(
  el: Element & { scrollTop: number },
  sensitivity = 1,
): () => void {
  if (shouldBypassEngine()) return () => {};

  let accumulator = 0;
  let raf = 0;

  const flush = () => {
    raf = 0;
    if (!accumulator) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const next = Math.min(Math.max(el.scrollTop + accumulator, 0), max);
    accumulator = 0;
    animateScrollTop(el, next, { duration: 180 });
  };

  const onWheel = (e: WheelEvent) => {
    // Only tame vertical wheel scrolling inside this surface.
    if (e.deltaY === 0 || e.ctrlKey) return; // leave pinch-zoom alone
    e.preventDefault();
    accumulator += e.deltaY * sensitivity;
    if (!raf) raf = requestAnimationFrame(flush);
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    if (raf) cancelAnimationFrame(raf);
    el.removeEventListener('wheel', onWheel);
  };
}
