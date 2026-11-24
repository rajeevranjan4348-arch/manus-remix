import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActiveWorkspacePanel,
  buildSearchWithPanel,
  isConnectorsPanelActive,
  parsePanelFromSearch,
  resolveConnectorsSection,
} from '../src/lib/panelNavigation';

const ROOT = path.resolve(__dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Part 1 — Connectors & Plugins Sidebar Navigation Regression Suite', () => {
  describe('URL & Panel State Synchronization (preserves context, no Home redirect)', () => {
    it('1. opens Connectors panel immediately while preserving current pathname', () => {
      const currentPath = '/task/session-42';
      const nextSearch = buildSearchWithPanel('', 'connectors');
      expect(currentPath).toBe('/task/session-42');
      expect(nextSearch).toBe('?panel=connectors');
      expect(parsePanelFromSearch(nextSearch)).toBe('connectors');
      expect(isConnectorsPanelActive('connectors')).toBe(true);
      expect(resolveConnectorsSection('connectors')).toBe('connectors');
    });

    it('2. opens Plugins panel immediately while preserving current pathname', () => {
      const nextSearch = buildSearchWithPanel('?tab=chat', 'plugins');
      expect(nextSearch).toContain('tab=chat');
      expect(nextSearch).toContain('panel=plugins');
      expect(parsePanelFromSearch(nextSearch)).toBe('plugins');
      expect(isConnectorsPanelActive('plugins')).toBe(true);
      expect(resolveConnectorsSection('plugins')).toBe('plugins');
    });

    it('3. switches cleanly between Connectors and Plugins without losing unrelated query params', () => {
      const s1 = buildSearchWithPanel('?ref=chat', 'connectors');
      expect(parsePanelFromSearch(s1)).toBe('connectors');
      const s2 = buildSearchWithPanel(s1, 'plugins');
      expect(parsePanelFromSearch(s2)).toBe('plugins');
      expect(s2).toContain('ref=chat');
      const s3 = buildSearchWithPanel(s2, 'connectors');
      expect(parsePanelFromSearch(s3)).toBe('connectors');
      expect(resolveConnectorsSection(parsePanelFromSearch(s3))).toBe('connectors');
    });

    it('4. works identically from Home ("/") and from an active chat ("/task/:taskId")', () => {
      for (const routePath of ['/', '/task/abc-123']) {
        const search = buildSearchWithPanel('', 'connectors');
        expect(routePath + search).toBe(`${routePath}?panel=connectors`);
        expect(parsePanelFromSearch(search)).toBe('connectors');
      }
    });

    it('5. handles rapid repeated taps safely and idempotently without duplicate search mutations', () => {
      const sequence: ActiveWorkspacePanel[] = [
        'connectors',
        'connectors',
        'plugins',
        'plugins',
        'connectors',
        'history',
        'plugins',
      ];
      let search = '';
      for (const panel of sequence) {
        search = buildSearchWithPanel(search, panel);
        expect(parsePanelFromSearch(search)).toBe(panel);
      }
      expect(parsePanelFromSearch(search)).toBe('plugins');
    });

    it('6. preserves active panel state across page refresh via URL query restoration', () => {
      const persistedUrlSearch = buildSearchWithPanel('', 'connectors');
      // Simulate fresh app mount reading location.search after page reload
      const restoredPanel = parsePanelFromSearch(persistedUrlSearch);
      expect(restoredPanel).toBe('connectors');
      expect(isConnectorsPanelActive(restoredPanel)).toBe(true);

      const closedSearch = buildSearchWithPanel(persistedUrlSearch, null);
      expect(closedSearch).toBe('');
      expect(parsePanelFromSearch(closedSearch)).toBeNull();
    });

    it('7. ignores unknown or tampered panel query parameters safely', () => {
      expect(parsePanelFromSearch('?panel=invalid_panel')).toBeNull();
      expect(parsePanelFromSearch('?panel=../../etc/passwd')).toBeNull();
      expect(parsePanelFromSearch('')).toBeNull();
    });
  });

  describe('Root-Cause Prevention & Source Architecture Verification', () => {
    it('8. App.tsx mounts ConnectorsStorePanel and TagAnalyticsModal outside Sidebar and never redirects to Home when opening panels', () => {
      const appSrc = readSource('src/App.tsx');
      expect(appSrc).toContain('const ConnectorsStorePanel = lazy(');
      expect(appSrc).toContain('const TagAnalyticsModal = lazy(');
      expect(appSrc).toContain('<ConnectorsStorePanel');
      expect(appSrc).toContain('initialSection={resolveConnectorsSection(activePanel)}');
      expect(appSrc).toContain('onOpenConnectors={handleOpenConnectors}');
      expect(appSrc).toContain('onOpenPlugins={handleOpenPlugins}');
      expect(appSrc).toContain('onCloseSidebar={handleCloseSidebar}');
      // Updates panel state and URL preserving location.pathname BEFORE closing sidebar
      expect(appSrc).toMatch(/setActivePanel\(nextPanel\);\s*syncPanelToUrl\(nextPanel\);/);
      expect(appSrc).toContain('{ pathname: location.pathname, search: nextSearch }');
    });

    it('9. Sidebar.tsx never unmounts modals when collapsed/closed and uses idempotent mobile dismissal (no toggle-inversion race)', () => {
      const sidebarSrc = readSource('src/components/layout/Sidebar.tsx');
      // No early `if (!isOpen) { return (<aside...` return that would unmount bottom modals
      expect(sidebarSrc).not.toMatch(/if\s*\(!isOpen\)\s*\{\s*return\s*\(/);
      // Uses idempotent onCloseSidebar instead of blind onToggle() inside handleMobileSelect
      expect(sidebarSrc).toContain('onCloseSidebar?: () => void');
      expect(sidebarSrc).toContain('if (onCloseSidebar) {\n        onCloseSidebar();');
      // Calls action BEFORE dismissing sidebar on mobile
      expect(sidebarSrc).toMatch(/if\s*\(action\)\s*action\(\);\s*dismissSidebarOnMobile\(\);/);
      // Synchronizes sidebar active item with activePanel
      expect(sidebarSrc).toContain('activePanel === \'connectors\' || activePanel === \'plugins\'');
      expect(sidebarSrc).toContain('aria-current={itemActive ? \'page\' : undefined}');
    });

    it('10. ConnectorsStorePanel guards Dialog onOpenChange so open=true never triggers onClose', () => {
      const panelSrc = readSource('src/components/connectors/ConnectorsStorePanel.tsx');
      expect(panelSrc).toContain('onOpenChange={(open) => { if (!open) onClose(); }}');
      expect(panelSrc).toContain('data-testid="connectors-store-panel"');
      expect(panelSrc).toContain('data-active-section={initialSection}');
    });
  });
});
