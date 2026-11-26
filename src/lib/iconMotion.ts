/**
 * Universal icon motion — dynamic icon coverage for Manus Remix.
 *
 * The animation system itself lives in `src/icon-motion.css` and works by
 * selectors alone for the main icon libraries (`.lucide`, `.pulsoicon`) and
 * for any SVG rendered inside an interactive trigger. This module closes the
 * remaining gap: icons mounted *outside* triggers through dynamically
 * generated markup (raw HTML from the code-block/markdown engines, connector
 * panels, plugins, components such as Hugeicons/custom SVGs). Such SVGs are
 * tagged with `data-icon-motion` so the shared CSS layer picks them up
 * exactly like every other icon.
 *
 * Cost profile: one passive MutationObserver, work batched on a shared timer,
 * capped per batch, and fully disabled in performance modes
 * (`data-perf-mode="ultra-lite"|"saver"`, `data-icon-motion-off`), so it adds
 * no recurring JS animation loop and stays safe for low-end Android devices.
 */

import * as React from 'react';

const ICON_ATTR = 'data-icon-motion';

export { ICON_ATTR };

let domObserver: MutationObserver | null = null;
let modeObserver: MutationObserver | null = null;
let pending: Set<Element> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let active = false;

const MAX_BATCH_NODES = 400;

/** Decorative/functional motion should be switched off in these modes. */
function observerWanted(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const root = document.documentElement;
  if (!root || root.hasAttribute('data-icon-motion-off')) return false;
  const mode = root.getAttribute('data-perf-mode');
  return mode !== 'ultra-lite' && mode !== 'saver';
}

/**
 * Heuristic: a 24-unit viewBox SVG with no library identity is treated as an
 * icon (lucide, Hugeicons and the repo's inline icons all use 0 0 24 24).
 * Diagrams (mermaid), charts and embedded images use other viewBoxes or
 * role="img" and are excluded, so they remain untouched.
 */
export function isIconMotionCandidate(el: Element): el is SVGSVGElement {
  if (!(el instanceof SVGSVGElement)) return false;
  if (el.hasAttribute(ICON_ATTR)) return false;
  if (el.getAttribute('role') === 'img') return false;
  // Already covered by the CSS layer's library selectors, or nested inside
  // another SVG / an explicit opt-out region.
  const cls = el.getAttribute('class') || '';
  if (/\b(lucide|pulsoicon|hugeicons)\b/.test(cls)) return false;
  if (el.closest('svg, foreignObject, [data-icon-motion-ignore]')) return false;
  const viewBox = (el.getAttribute('viewBox') || '').replace(/\s+/g, ' ').trim();
  return viewBox === '0 0 24 24';
}

function tagIcon(el: Element): void {
  if (isIconMotionCandidate(el)) el.setAttribute(ICON_ATTR, '');
}

function flush(): void {
  flushTimer = null;
  const batch = pending;
  pending = null;
  if (!batch) return;
  for (const el of batch) tagIcon(el);
}

function enqueue(): void {
  pending ??= new Set<Element>();
  if (flushTimer !== null) return;
  // Batch DOM work on one shared timer instead of doing it per mutation.
  flushTimer = setTimeout(flush, 32);
}

function collectFromRoot(root: Element, batch: Set<Element>): void {
  const svgs = root.querySelectorAll('svg');
  for (const svg of svgs) {
    batch.add(svg);
    if (batch.size >= MAX_BATCH_NODES) break;
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!pending) pending = new Set<Element>();
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (!(node instanceof Element) || pending.size >= MAX_BATCH_NODES) continue;
      if (node instanceof SVGSVGElement) {
        pending.add(node);
      } else if (node.querySelector('svg')) {
        collectFromRoot(node, pending);
      }
    }
  }
  enqueue();
}

function startObserver(): void {
  if (!observerWanted() || domObserver) return;
  domObserver = new MutationObserver(handleMutations);
  domObserver.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
  });
  active = true;
  pending ??= new Set<Element>();
  collectFromRoot(document.documentElement, pending);
  enqueue();
}

function stopObserver(): void {
  domObserver?.disconnect();
  domObserver = null;
  active = false;
}

function syncObserverState(): void {
  if (observerWanted()) {
    if (!active) startObserver();
  } else {
    stopObserver();
  }
}

/**
 * Idempotent bootstrap. Called once at startup (main.tsx). Later calls just
 * re-check whether the observer should be running (e.g. after a performance
 * mode switch back from ultra-lite/saver).
 */
export function initIconMotion(): void {
  if (initialized) {
    syncObserverState();
    return;
  }
  initialized = true;

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof window.MutationObserver === 'undefined') return;

  // Track performance-mode switches so the observer only runs when wanted.
  try {
    modeObserver = new MutationObserver(syncObserverState);
    modeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-perf-mode', 'data-icon-motion-off'],
    });
  } catch {
    modeObserver = null;
  }

  startObserver();
}

/** Imperative tag for code that constructs icon nodes outside React. */
export function applyIconMotion(el: Element | null | undefined): void {
  if (el) tagIcon(el);
}

/** React ref callback: attach to any custom or dynamic SVG icon component. */
export function useIconMotion<T extends SVGSVGElement>(): (node: T | null) => void {
  return React.useCallback((node: T | null) => {
    if (node) node.setAttribute(ICON_ATTR, '');
  }, []);
}

/**
 * One-shot exit animation hook for consumer-controlled removals: set the
 * marker, then remove the node after the icon-motion-exit animation ends.
 */
export function markIconExiting(el: SVGSVGElement | null | undefined): void {
  if (!el) return;
  el.setAttribute('data-icon-motion-exiting', '');
}
