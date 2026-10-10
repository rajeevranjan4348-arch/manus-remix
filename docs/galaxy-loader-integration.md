# Galaxy loader integration

This change adds an opt-in React loader component at `src/components/common/GalaxyLoader.tsx`, inspired by the CSS loader collection in [Uiverse Galaxy](https://github.com/rajeevranjan4348-arch/galaxy).

## Usage

```tsx
import { GalaxyLoader } from "@/components/common/GalaxyLoader";

// Choose one: "orbit" (default), "dots", or "blocks".
<GalaxyLoader variant="orbit" label="Loading" />
```

The component is deliberately not mounted globally and does not replace existing loading states. Use it only at a specific loading location after reviewing that screen. It has no new package dependencies, exposes an accessible status label, and respects reduced-motion preferences.

The upstream Galaxy repository contains thousands of standalone HTML snippets. This integration adapts a small reusable loader treatment rather than bulk-importing unrelated components or changing the existing app UI.
