import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE_PANEL_SPRING_OPEN,
  WORKSPACE_PANEL_SPRING_CLOSE,
  WORKSPACE_SHEET_SPRING_OPEN,
  WORKSPACE_SHEET_SPRING_CLOSE,
  WORKSPACE_BACKDROP_VARIANTS,
  WORKSPACE_DIALOG_SPRING_VARIANTS,
  WORKSPACE_RIGHT_SHEET_SPRING_VARIANTS,
  WORKSPACE_REDUCED_MOTION_VARIANTS,
} from '../src/lib/panelMotion';
import { HISTORY_PANEL_SLIDE_VARIANTS } from '../src/components/history/HistoryPanel';

const ROOT = path.resolve(__dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Workspace Panel Spring-Based Open/Close Transitions', () => {
  it('defines physics-based spring presets for dialog and sheet open & close transitions', () => {
    const presets = [
      WORKSPACE_PANEL_SPRING_OPEN,
      WORKSPACE_PANEL_SPRING_CLOSE,
      WORKSPACE_SHEET_SPRING_OPEN,
      WORKSPACE_SHEET_SPRING_CLOSE,
    ] as Array<Record<string, any>>;

    for (const preset of presets) {
      expect(preset.type).toBe('spring');
      expect(preset.stiffness).toBeGreaterThan(250);
      expect(preset.damping).toBeGreaterThan(20);
      expect(preset.mass).toBeGreaterThan(0);
    }

    // Close spring should be slightly crisper than open spring
    expect((WORKSPACE_PANEL_SPRING_CLOSE as any).stiffness).toBeGreaterThan(
      (WORKSPACE_PANEL_SPRING_OPEN as any).stiffness
    );
    expect((WORKSPACE_SHEET_SPRING_CLOSE as any).stiffness).toBeGreaterThan(
      (WORKSPACE_SHEET_SPRING_OPEN as any).stiffness
    );
  });

  it('configures Framer Motion dialog, right-sheet, backdrop, and reduced-motion variants with exit states', () => {
    const dialogHidden = WORKSPACE_DIALOG_SPRING_VARIANTS.hidden as Record<string, any>;
    const dialogVisible = WORKSPACE_DIALOG_SPRING_VARIANTS.visible as Record<string, any>;
    const dialogExit = WORKSPACE_DIALOG_SPRING_VARIANTS.exit as Record<string, any>;

    expect(dialogHidden.opacity).toBe(0);
    expect(dialogHidden.scale).toBeLessThan(1);
    expect(dialogVisible.opacity).toBe(1);
    expect(dialogVisible.scale).toBe(1);
    expect(dialogVisible.transition.type).toBe('spring');
    expect(dialogExit.opacity).toBe(0);
    expect(dialogExit.transition.type).toBe('spring');

    const sheetExit = WORKSPACE_RIGHT_SHEET_SPRING_VARIANTS.exit as Record<string, any>;
    expect(sheetExit.x).toBe('100%');
    expect(sheetExit.transition.type).toBe('spring');

    // HistoryPanel uses the shared right-sheet spring variants (open + close)
    expect(HISTORY_PANEL_SLIDE_VARIANTS).toEqual(WORKSPACE_RIGHT_SHEET_SPRING_VARIANTS);

    const backdropExit = WORKSPACE_BACKDROP_VARIANTS.exit as Record<string, any>;
    expect(backdropExit.opacity).toBe(0);

    const reducedVisible = WORKSPACE_REDUCED_MOTION_VARIANTS.visible as Record<string, any>;
    const reducedExit = WORKSPACE_REDUCED_MOTION_VARIANTS.exit as Record<string, any>;
    expect(reducedVisible.opacity).toBe(1);
    expect(reducedExit.opacity).toBe(0);
  });

  it('wires AnimatePresence and spring exit transitions in SettingsModal and HistoryPanel while preserving swipe-to-dismiss and reduced motion', () => {
    const settingsSrc = readSource('src/components/settings/SettingsModal.tsx');
    expect(settingsSrc).toContain('AnimatePresence');
    expect(settingsSrc).toContain('useReducedMotion()');
    expect(settingsSrc).toContain('WORKSPACE_DIALOG_SPRING_VARIANTS');
    expect(settingsSrc).toContain('WORKSPACE_BACKDROP_VARIANTS');
    expect(settingsSrc).toContain('WORKSPACE_REDUCED_MOTION_VARIANTS');
    expect(settingsSrc).toContain('data-spring-transition="true"');
    expect(settingsSrc).toContain('exit="exit"');
    expect(settingsSrc).not.toContain('if (!isOpen) return null;');
    expect(settingsSrc).toContain('onDragEnd={handleSettingsSwipeEnd}');

    const historySrc = readSource('src/components/history/HistoryPanel.tsx');
    expect(historySrc).toContain('AnimatePresence');
    expect(historySrc).toContain('forceMount');
    expect(historySrc).toContain('WORKSPACE_RIGHT_SHEET_SPRING_VARIANTS');
    expect(historySrc).toContain('WORKSPACE_REDUCED_MOTION_VARIANTS');
    expect(historySrc).toContain('data-spring-transition="true"');
    expect(historySrc).toContain('exit="exit"');
    expect(historySrc).toContain('onDragEnd={handleHistorySwipeEnd}');
  });

  it('upgrades Dialog, Sheet, and Sidebar primitives to spring transitions and defines CSS spring curves with reduced-motion and ultra-lite guards', () => {
    const dialogSrc = readSource('src/components/ui/dialog.tsx');
    expect(dialogSrc).toContain('workspace-panel-spring');
    expect(dialogSrc).toContain('data-spring-transition="true"');

    const sheetSrc = readSource('src/components/ui/sheet.tsx');
    expect(sheetSrc).toContain('workspace-sheet-spring-right');
    expect(sheetSrc).toContain('workspace-sheet-spring-left');
    expect(sheetSrc).toContain('workspace-sheet-spring-top');
    expect(sheetSrc).toContain('workspace-sheet-spring-bottom');
    expect(sheetSrc).toContain('forceMount?: true');
    expect(sheetSrc).toContain('data-spring-transition="true"');

    const sidebarSrc = readSource('src/components/layout/Sidebar.tsx');
    expect(sidebarSrc).toContain('workspace-drawer-spring-left');
    expect(sidebarSrc).toContain('data-spring-transition="true"');

    const cssSrc = readSource('src/index.css');
    expect(cssSrc).toContain('@keyframes workspace-panel-spring-in');
    expect(cssSrc).toContain('@keyframes workspace-panel-spring-out');
    expect(cssSrc).toContain('@keyframes workspace-sheet-spring-in-right');
    expect(cssSrc).toContain('@keyframes workspace-sheet-spring-out-right');
    expect(cssSrc).toContain('@keyframes workspace-sheet-spring-in-left');
    expect(cssSrc).toContain('@keyframes workspace-sheet-spring-out-left');
    expect(cssSrc).toContain('.workspace-panel-spring[data-state="open"]');
    expect(cssSrc).toContain('.workspace-panel-spring[data-state="closed"]');
    expect(cssSrc).toContain('.workspace-drawer-spring-left');
    expect(cssSrc).toContain('[data-perf-mode="ultra-lite"] .workspace-panel-spring');
    expect(cssSrc).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('latches lazy workspace panels in App.tsx after first open so spring close animations complete before unmounting', () => {
    const appSrc = readSource('src/App.tsx');
    expect(appSrc).toContain('const [loadedPanels, setLoadedPanels] = React.useState');
    expect(appSrc).toContain('loadedPanels.history &&');
    expect(appSrc).toContain('loadedPanels.settings &&');
    expect(appSrc).toContain('loadedPanels.connectors &&');
    expect(appSrc).toContain('loadedPanels.analytics &&');
  });
});
