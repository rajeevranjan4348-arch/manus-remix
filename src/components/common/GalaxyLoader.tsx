import React from "react";

export type GalaxyLoaderVariant = "blocks" | "orbit" | "dots";

export interface GalaxyLoaderProps {
  /** Visual treatment inspired by the Uiverse Galaxy loader collection. */
  variant?: GalaxyLoaderVariant;
  label?: string;
  className?: string;
}

/**
 * Optional, standalone loaders adapted from the Uiverse Galaxy collection.
 * This component is intentionally not mounted globally so existing screens
 * and loading states remain unchanged until a caller opts in.
 * Source collection: https://github.com/rajeevranjan4348-arch/galaxy
 * Uiverse: https://uiverse.io/ (MIT-licensed collection; creator attribution
 * should be retained when using a specific archived design).
 */
export function GalaxyLoader({
  variant = "orbit",
  label = "Loading",
  className = "",
}: GalaxyLoaderProps) {
  return (
    <div
      className={`galaxy-loader-wrap ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <style>{`
        .galaxy-loader-wrap{display:inline-flex;align-items:center;justify-content:center;gap:.65rem;color:currentColor}
        .galaxy-loader-visual{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none}
        .galaxy-loader-orbit{width:1.75rem;height:1.75rem;border:2px solid color-mix(in srgb,currentColor 18%,transparent);border-top-color:#6366f1;border-right-color:#38bdf8;border-radius:50%;animation:galaxy-orbit .8s linear infinite}
        .galaxy-loader-dots{display:flex;align-items:center;gap:.28rem;height:1.25rem}
        .galaxy-loader-dots i{display:block;width:.38rem;height:.38rem;border-radius:50%;background:currentColor;opacity:.35;animation:galaxy-dot 1s ease-in-out infinite}
        .galaxy-loader-dots i:nth-child(2){animation-delay:.15s}.galaxy-loader-dots i:nth-child(3){animation-delay:.3s}
        .galaxy-loader-blocks{width:1.8rem;height:1.8rem;display:grid;grid-template-columns:repeat(2,.65rem);grid-template-rows:repeat(2,.65rem);gap:.15rem}
        .galaxy-loader-blocks i{border-radius:2px;background:#6366f1;animation:galaxy-block 1s ease-in-out infinite}
        .galaxy-loader-blocks i:nth-child(2){animation-delay:.15s}.galaxy-loader-blocks i:nth-child(3){animation-delay:.3s}.galaxy-loader-blocks i:nth-child(4){animation-delay:.45s}
        .galaxy-loader-label{font-size:.875rem;line-height:1.4}
        @keyframes galaxy-orbit{to{transform:rotate(360deg)}}
        @keyframes galaxy-dot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-.35rem);opacity:1}}
        @keyframes galaxy-block{0%,100%{transform:scale(.72);opacity:.45}50%{transform:scale(1);opacity:1}}
        @media(prefers-reduced-motion:reduce){.galaxy-loader-orbit,.galaxy-loader-dots i,.galaxy-loader-blocks i{animation-duration:2.5s}}
      `}</style>
      <span className="galaxy-loader-visual" aria-hidden="true">
        {variant === "orbit" && <span className="galaxy-loader-orbit" />}
        {variant === "dots" && <span className="galaxy-loader-dots"><i /><i /><i /></span>}
        {variant === "blocks" && <span className="galaxy-loader-blocks"><i /><i /><i /><i /></span>}
      </span>
      {label && <span className="galaxy-loader-label">{label}</span>}
    </div>
  );
}

export default GalaxyLoader;
