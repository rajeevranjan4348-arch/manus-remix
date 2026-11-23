/**
 * Mount-Safe Runtime Patch for `pulsoicon-react`
 *
 * Root Cause:
 * `pulsoicon-react` attaches `focusout` and `pointerleave` listeners to the closest
 * `<button>` ancestor (`trigger.addEventListener("focusout", rest)`).
 * When React unmounts a focused button during a state update (`removeChild` inside
 * `commitDeletionEffectsOnFiber`), the browser synchronously dispatches a `focusout`
 * event BEFORE React runs `useEffect` cleanups. Meanwhile, `motion/react`'s
 * `VisualElement` has already unmounted from `useAnimation()`'s `controls`, so
 * `controls.start("normal")` rejects its returned Promise with:
 *   `Error: controls.start() should only be called after a component has mounted.`
 * Because `pulsoicon-react` invokes `void stop()` without a `.catch()` or mount guard,
 * this produces an unhandled promise rejection.
 *
 * This module wraps `createIcon` from `pulsoicon-react/dist/runtime/createIcon.js`
 * with a mounted ref guard (`isMountedRef.current && svgRef.current?.isConnected`)
 * and swallows any post-unmount `controls.start()` rejection while preserving 100%
 * of `pulsoicon-react`'s SVG shapes, solid/outline variants, and hover/focus animations.
 */

import React, {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from 'react';
import { motion, useAnimation } from 'motion/react';
import { RECIPES, SOLID_FALLBACK, solidNodes } from 'pulsoicon-core';

const TRIGGER_SELECTOR =
  'button, a, label, summary, [role="button"], [role="menuitem"], [role="tab"], [role="link"], [data-icon-trigger]';

const MOTION_TAGS: Record<string, any> = {
  path: motion.path,
  line: motion.line,
  circle: motion.circle,
  rect: motion.rect,
  ellipse: motion.ellipse,
  polyline: motion.polyline,
  polygon: motion.polygon,
};

const MASK_BOX = { x: '-12', y: '-12', width: '48', height: '48' };
const EMPTY_SOLID = { fills: [] as any[], cuts: [] as any[], lines: [] as any[] };

const variantsOf = (m: any, filled: boolean) =>
  (RECIPES as any)[(filled && (SOLID_FALLBACK as any)[m.r]) || m.r]({
    d: m.d ?? 0,
    x: m.x ?? 0,
    y: m.y ?? 0,
    a: m.a ?? 0,
  });

function prepareNode(m: any, filled: boolean) {
  const [x, y] = m.o ?? [12, 12];
  return {
    variants: variantsOf(m, filled),
    style: { transformBox: 'view-box' as const, originX: `${x}px`, originY: `${y}px` },
  };
}

function prepareSvg(m: any, filled: boolean) {
  const [x, y] = m.o ?? [12, 12];
  return {
    variants: variantsOf(m, filled),
    style: { transformOrigin: `${(x / 24) * 100}% ${(y / 24) * 100}%` },
  };
}

const prepareNodes = (nodes: readonly any[], filled = false) =>
  nodes.map(([tag, attrs, m]: any) => ({
    tag,
    attrs,
    prepared: m ? prepareNode(m, filled && attrs.fill !== 'none') : undefined,
  }));

function prepareSolid(nodes: readonly any[]) {
  const of = (role: string) => nodes.filter((n) => (n[3] ?? 'fill') === role);
  return {
    fills: prepareNodes(of('fill'), true),
    cuts: prepareNodes(of('cut')),
    lines: prepareNodes(of('line')),
  };
}

const specs = new WeakMap<any, any>();
export const iconSpec = (icon: any) => specs.get(icon);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function toPixels(size: number | string): number {
  return typeof size === 'number' ? size : Number.parseFloat(size) || 24;
}

export function createIcon(displayName: string, iconName: string, spec: any) {
  const outlineSvg = spec.svg ? prepareSvg(spec.svg, false) : undefined;
  const outline = prepareNodes(spec.nodes);
  const solidSvg = spec.svg ? prepareSvg(spec.svg, true) : undefined;
  let solid: { fills: any[]; cuts: any[]; lines: any[] } | undefined;
  const solidParts = () =>
    (solid ??= prepareSolid(solidNodes({ ...spec, name: displayName, key: iconName })));
  const iconClass = `pulsoicon pulsoicon-${iconName}`;

  const Icon = forwardRef<any, any>((props, ref) => {
    const {
      size = 24,
      color = 'currentColor',
      strokeWidth = 2,
      absoluteStrokeWidth,
      solid: isSolid = false,
      animated = true,
      autoAnimated = true,
      play,
      className,
      style,
      ...rest
    } = props;

    const controls = useAnimation();
    const svgRef = useRef<SVGSVGElement | null>(null);
    const isMountedRef = useRef<boolean>(false);
    const maskId = `pulsoicon${useId().replace(/[^\w-]/g, '')}`;

    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
      };
    }, []);

    const canAnimateSafely = useCallback((): boolean => {
      if (!isMountedRef.current) return false;
      const svgEl = svgRef.current;
      if (!svgEl || !svgEl.isConnected) return false;
      return true;
    }, []);

    const start = useCallback(async () => {
      if (!animated || prefersReducedMotion() || !canAnimateSafely()) return;
      try {
        await controls.start('animate');
      } catch {
        // Safely ignore if component unmounted mid-frame
      }
    }, [animated, controls, canAnimateSafely]);

    const stop = useCallback(async () => {
      if (!animated || !canAnimateSafely()) return;
      try {
        await controls.start('normal');
      } catch {
        // Safely ignore if component unmounted during focusout / removeChild
      }
    }, [animated, controls, canAnimateSafely]);

    useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }), [
      start,
      stop,
    ]);

    useEffect(() => {
      if (!animated && canAnimateSafely()) {
        try {
          controls.set('normal');
        } catch {}
      }
    }, [animated, controls, canAnimateSafely]);

    useEffect(() => {
      if (!animated || play === undefined) return;
      void (play ? start() : stop());
    }, [animated, play, start, stop]);

    useEffect(() => {
      const svg = svgRef.current;
      if (!animated || !autoAnimated || !svg) return;
      const trigger = svg.closest(TRIGGER_SELECTOR) ?? svg;
      const onPlay = () => {
        if (canAnimateSafely()) void start();
      };
      const onRest = () => {
        if (canAnimateSafely()) void stop();
      };
      trigger.addEventListener('pointerenter', onPlay);
      trigger.addEventListener('pointerleave', onRest);
      trigger.addEventListener('focusin', onPlay);
      trigger.addEventListener('focusout', onRest);
      return () => {
        trigger.removeEventListener('pointerenter', onPlay);
        trigger.removeEventListener('pointerleave', onRest);
        trigger.removeEventListener('focusin', onPlay);
        trigger.removeEventListener('focusout', onRest);
      };
    }, [animated, autoAnimated, start, stop, canAnimateSafely]);

    const px = toPixels(size);
    const stroke = absoluteStrokeWidth
      ? (Number(strokeWidth) * 24) / px
      : Number(strokeWidth);
    const svgMotion = isSolid ? solidSvg : outlineSvg;
    const { fills, cuts, lines } = isSolid ? solidParts() : EMPTY_SOLID;
    const holes = cuts.length + lines.length > 0;

    const renderNodes = (list: any[]) =>
      list.map(({ tag, attrs, prepared }, i) => {
        if (!prepared) return createElement(tag, { key: i, ...attrs });
        const { transform, ...own } = attrs;
        const shape = createElement(MOTION_TAGS[tag], {
          key: i,
          ...own,
          animate: controls,
          initial: 'normal',
          variants: prepared.variants,
          style: prepared.style,
        });
        return transform ? createElement('g', { key: i, transform }, shape) : shape;
      });

    return (
      <motion.svg
        aria-hidden="true"
        {...rest}
        animate={controls}
        className={className ? `${iconClass} ${className}` : iconClass}
        fill="none"
        height={size}
        initial="normal"
        ref={svgRef}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={stroke}
        style={{ overflow: 'visible', ...svgMotion?.style, ...style }}
        variants={svgMotion?.variants}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        {!isSolid ? (
          renderNodes(outline)
        ) : !holes ? (
          <g fill={color}>{renderNodes(fills)}</g>
        ) : (
          <>
            <defs>
              <mask id={`${maskId}-fill`} maskUnits="userSpaceOnUse" {...MASK_BOX}>
                <rect {...MASK_BOX} fill="white" stroke="none" />
                <g stroke="black">
                  {renderNodes(cuts)}
                  {renderNodes(lines)}
                </g>
              </mask>
              <mask id={`${maskId}-line`} maskUnits="userSpaceOnUse" {...MASK_BOX}>
                <rect {...MASK_BOX} fill="white" stroke="none" />
                <g fill="black" stroke="none">
                  {renderNodes(fills)}
                </g>
              </mask>
            </defs>
            <g fill={color} mask={`url(#${maskId}-fill)`}>
              {renderNodes(fills)}
            </g>
            <g mask={`url(#${maskId}-line)`}>{renderNodes(lines)}</g>
          </>
        )}
      </motion.svg>
    );
  });

  Icon.displayName = displayName;
  specs.set(Icon, spec);
  return Icon;
}
