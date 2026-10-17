# Implementation Plan: ChatView Runtime Fix & React Error Boundary Integration

Fix the `ReferenceError: Cannot access 'cleanUserMessage' before initialization` in `ChatView.tsx` and integrate a high-grade, friendly React `ErrorBoundary` component across the application to prevent full-page crashes.

> [!IMPORTANT] Confirmed Requirements
> - **Primary Fix**: Resolve function hoisting and Temporal Dead Zone (TDZ) order in `ChatView.tsx` so `cleanUserMessage` is accessible prior to `useMemo` execution.
> - **Resilience Addition**: Wrap `ChatView` and major layout routes in a reusable React `ErrorBoundary` with a clean, user-friendly fallback view, retry button, and toggleable detail drawer.

---

## 1. Overview & Core Concept

### What It Does
This update stabilizes the agent chat interface by reordering module declarations in `ChatView.tsx` and wrapping view components in a resilient React Error Boundary (`ErrorBoundary.tsx`). If an uncaught JavaScript error occurs during rendering or streaming state updates, the application displays a friendly recovery card with a direct "Reload Component" action rather than a white screen or browser crash.

### Key Value
- **Zero White-Screen Crashes**: Graceful error handling for unexpected runtime exceptions.
- **Immediate Chat Recovery**: Restores access to the AI agent and conversational features instantly.
- **Production-Grade Code Hygiene**: Fixes function scope ordering and prevents TDZ reference errors.

---

## 2. User Experience & Visual Design

### Fallback Error Boundary UI
- **Visual Style**: Clean, non-alarmist surface card (`bg-slate-900/90` or `bg-white` depending on theme) featuring a subtle warning accent icon (`AlertTriangle`).
- **Typography & Prose**: Warm, natural language ("Something went wrong loading this view") instead of cryptic system traces.
- **Interactive Actions**:
  - **Primary CTA Button**: "Try Again" / "Reload View" button that resets error state.
  - **Secondary CTA Button**: "Return to Dashboard" to navigate back to safety.
  - **Collapsible Technical Details**: Subtle unboxed toggle ("Show Technical Details") for debugging stack traces without cluttering the main UI.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Pure Function Hoisting vs Hook Placement
- **Chosen Approach**: Place utility functions (`cleanUserMessage`, string manipulators) at the very top of `ChatView.tsx` outside the main React component function, or ensure top-level standard function declarations before any component hooks.
- **Why**: Pure functions defined outside component render functions avoid re-allocation on every render and prevent Temporal Dead Zone (TDZ) initialization errors when called inside `useMemo` hooks.

### Decision 2: Granular Error Boundary Boundaries
- **Chosen Approach**: Place an `ErrorBoundary` wrapper around `ChatView` specifically, as well as an overall app-level `ErrorBoundary` in `App.tsx` / main layout.
- **Why**: Keeps errors localized—if the chat view encounters a malformed message stream, the surrounding sidebar and navigation remain fully functional.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────┐
│                    App / Main Layout                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │               Root ErrorBoundary                  │  │
│  │  ┌─────────────────┐    ┌──────────────────────┐  │  │
│  │  │ Sidebar Nav     │    │ ChatView ErrorBoundary│ │  │
│  │  │                 │    │  ┌────────────────┐  │ │  │
│  │  │ - Dashboard     │    │  │   ChatView     │  │ │  │
│  │  │ - Voice Call    │    │  │ (cleanUserMsg) │  │ │  │
│  │  │ - Settings      │    │  └────────────────┘  │ │  │
│  │  └─────────────────┘    └──────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Component & State Mapping
1. **`src/components/common/ErrorBoundary.tsx`**:
   - Implements `React.Component` with `getDerivedStateFromError` and `componentDidCatch`.
   - Manages `{ hasError: boolean, error: Error | null }` state.
   - Provides an optional custom `fallback` or default friendly error UI with a "Try Again" reset handler.
2. **`src/components/agent/ChatView.tsx`**:
   - Hoists `cleanUserMessage` above `ChatView` component definition and hooks.
   - Ensures `displayMessages` `useMemo` executes cleanly with zero initialization errors.
3. **`src/App.tsx` / `VoiceCallModal.tsx`**:
   - Encloses `ChatView` and primary view containers in `<ErrorBoundary>`.
