# Smooth Application Motion & View Transitions

Implement smooth, elegant motion transitions (300-400ms soft ease-out) across all application views, navigation routes, sidebars, drawers, modals, tabs, and interactive micro-interactions in Manus Remix.

## User Review & Critical Decisions

> [!IMPORTANT]
> Based on confirmed preferences, motion transitions will be applied comprehensively across all key surface areas with a refined 300–400ms soft ease-out curve (`cubic-bezier(0.16, 1, 0.3, 1)`).

- **Confirmed Scope**: Comprehensive transition enhancements across:
  1. Page & Route View Switching (Home, Task/Chat, Website Builder)
  2. Modals & Drawers (Settings Modal, Google Drive Explorer, History Panel Drawer)
  3. Sidebar Collapsing & Tab/Section Transitions
  4. Interactive Controls & Card Micro-Interactions
- **Confirmed Motion Style**: Smooth & elegant with 300-400ms soft ease-out duration and hardware-accelerated GPU transforms (`transform: translate3d(...)`, `opacity`).
- **Confirmed View Switching Effect**: Slide-and-fade animations for route/view transitions and tab/sidebar switches.

---

## 1. Overview & Core Concept

- **Goal**: Transform the feel of Manus Remix into an ultra-fluid, native-app-like web experience with zero visual stutter, smooth view transitions, animated drawer slide-outs, sleek tab switching, and tactile button feedback.
- **Target Experience**: Seamless transitions between zero-state prompt input, active chat streams, website builder previews, history drawer panels, and settings tabs without jarring layout breaks or instant element pops.

---

## 2. User Experience & Visual Design

### Key Motion & UX Flows
1. **Route & View Slide-and-Fade**:
   - Switching between `/` (Home) and `/task/:taskId` (Task/Chat View) or Website Builder triggers a subtle horizontal slide (+12px to 0px) accompanied by an opacity fade over 350ms.
2. **Sidebar & History Drawer Motion**:
   - Sidebar expansion/collapse operates with smooth width/transform interpolation, sliding adjacent main content gracefully without clipping.
   - History Panel drawer slides in smoothly from the right edge with a backdrop blur fade-in.
3. **Modal Entrance & Backdrop**:
   - Settings Modal and Google Drive File Explorer modal enter with scale-up (0.96 -> 1.0) and fade-in over 300ms, while backdrops smoothly transition opacity from 0 to 1.
4. **Settings Tabs & Section Transitions**:
   - Tab content switches in Settings Modal slide horizontally into view with cross-fade effects. Tab indicators slide fluidly underneath selected tabs.
5. **Interactive Micro-Interactions**:
   - Quick prompt pills, action buttons, cards, and input fields utilize fluid spring-like hover transforms (`translateY(-2px)`) and soft active scale feedback (`scale(0.975)`).

### Visual Identity & Timing Budget
- **Transition Curve**: `cubic-bezier(0.16, 1, 0.3, 1)` (Custom Apple/Figma style smooth deceleration curve).
- **Duration**: 300ms–380ms for views and drawers; 150ms–200ms for micro-interactions and button presses.
- **Accessibility**: Strict fallback to instant transitions when `prefers-reduced-motion: reduce` is enabled.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Compositor-Only GPU Animations**:
  - *Chosen Approach*: Use `transform` (`translate3d`, `scale`) and `opacity` exclusively for page view and modal transitions.
  - *Why*: Eliminates browser layout reflows (paint bottlenecks) and keeps framerates locked at 60–120 FPS.
- **Decision 2: Motion Container Wrappers in Route Engine**:
  - *Chosen Approach*: Wrap `Routes` and active view components in animated container shells with key location-aware animation hooks.
  - *Why*: Ensures route changes smoothly cross-fade without unmounting glitches or flash of plain white canvas.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        App Layout & Motion Shell                        │
│                                                                        │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐  │
│  │   Animated Sidebar   │  │           Main View Container          │  │
│  │  (Slide/Expand 320ms)│  │     (Slide-and-Fade Route Transitions) │  │
│  └──────────────────────┘  │  ┌──────────────┐    ┌──────────────┐  │  │
│                            │  │  Home View   │ -> │  Chat View   │  │  │
│                            │  └──────────────┘    └──────────────┘  │  │
│                            └────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐  │
│  │ History Drawer Panel │  │    Settings Modal & Drive Explorer     │  │
│  │ (Slide-In Right 350ms)  │    (Scale & Backdrop Fade 300ms)       │  │
│  └──────────────────────┘  └────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Component & Style Enhancement Plan
1. **`src/index.css`**: Add keyframes for `.page-slide-fade-enter`, `.tab-slide-fade-enter`, `.drawer-slide-in-right`, `.modal-backdrop-fade`, and `.card-hover-glide`.
2. **`src/App.tsx`**: Enhance the main content router and view container with location keys and transition wrappers for `/` and `/task/:taskId`.
3. **`src/components/layout/Sidebar.tsx`**: Apply smooth width transition and toggle icon animation.
4. **`src/components/history/HistoryPanel.tsx`**: Add smooth drawer backdrop and slide-in transition.
5. **`src/components/settings/SettingsModal.tsx`**: Add animated tab transitions and modal scale entrance.
6. **`src/components/workspace/GoogleDriveFileExplorer.tsx`**: Add smooth list loading, tab sliding, and preview card transition effects.
7. **`src/pages/Home.tsx` & `src/components/agent/ChatView.tsx`**: Upgrade action cards, prompt buttons, and chat message bubbles with micro-interaction animations.
