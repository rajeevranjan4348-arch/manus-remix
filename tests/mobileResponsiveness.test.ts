import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const readWorkspaceFile = (relPath: string): string => {
  return fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf-8');
};

describe('Global Mobile Responsiveness & UI Overflow Fixes', () => {
  describe('Root-cause CSS fixes in src/index.css', () => {
    const indexCss = readWorkspaceFile('src/index.css');

    it('does not override Tailwind centering transforms on dialogs, poppers, or gpu-accelerated elements', () => {
      // Previously, transform: translate3d(0, 0, 0) on [role="dialog"] and .gpu-accelerated
      // overwrote Tailwind's translate-x-[-50%] translate-y-[-50%], pinning modals at (50%, 50%) and clipping them off-screen.
      const dialogRuleMatch = indexCss.match(/\[role="dialog"\][\s\S]*?\{([\s\S]*?)\}/);
      expect(dialogRuleMatch).toBeTruthy();
      expect(dialogRuleMatch![1]).not.toContain('transform: translate3d');

      const gpuRuleMatch = indexCss.match(/\.gpu-accelerated\s*\{([\s\S]*?)\}/);
      expect(gpuRuleMatch).toBeTruthy();
      expect(gpuRuleMatch![1]).not.toContain('transform: translate3d');
    });

    it('enforces global box-sizing: border-box, 100dvh, and overflow-x protection', () => {
      expect(indexCss).toContain('box-sizing: border-box;');
      expect(indexCss).toContain('min-height: 100dvh;');
      expect(indexCss).toContain('overflow-x: hidden;');
      expect(indexCss).toContain('[data-radix-popper-content-wrapper]');
      expect(indexCss).toContain('max-width: calc(100vw - 1rem) !important;');
    });

    it('scopes icon-only button rule strictly to direct child SVGs so composite buttons never collapse', () => {
      expect(indexCss).toContain('button[aria-label]:has(> svg:only-child)');
      expect(indexCss).not.toContain('button[aria-label]:has(svg:only-child)');
    });
  });

  describe('Shared UI Primitives viewport clamping', () => {
    it('clamps DialogContent and AlertDialogContent to viewport width and 100dvh height on mobile', () => {
      const dialogTsx = readWorkspaceFile('src/components/ui/dialog.tsx');
      const alertDialogTsx = readWorkspaceFile('src/components/ui/alert-dialog.tsx');

      expect(dialogTsx).toContain('w-[calc(100vw-1rem)]');
      expect(dialogTsx).toContain('max-w-[calc(100vw-1rem)]');
      expect(dialogTsx).toContain('max-h-[calc(100dvh-1rem)]');

      expect(alertDialogTsx).toContain('w-[calc(100vw-1rem)]');
      expect(alertDialogTsx).toContain('max-w-[calc(100vw-1rem)]');
      expect(alertDialogTsx).toContain('max-h-[calc(100dvh-1rem)]');
    });

    it('clamps SheetContent to 100dvh and 100vw', () => {
      const sheetTsx = readWorkspaceFile('src/components/ui/sheet.tsx');
      expect(sheetTsx).toContain('h-[100dvh]');
      expect(sheetTsx).toContain('max-w-[100vw]');
    });

    it('configures PopoverContent, DropdownMenuContent, and HoverCardContent with collisionPadding and max-w viewport bounds', () => {
      const popoverTsx = readWorkspaceFile('src/components/ui/popover.tsx');
      const dropdownTsx = readWorkspaceFile('src/components/ui/dropdown-menu.tsx');
      const hoverCardTsx = readWorkspaceFile('src/components/ui/hover-card.tsx');

      expect(popoverTsx).toContain('collisionPadding = 12');
      expect(popoverTsx).toContain('max-w-[calc(100vw-1.5rem)]');

      expect(dropdownTsx).toContain('collisionPadding = 12');
      expect(dropdownTsx).toContain('max-w-[calc(100vw-1.5rem)]');

      expect(hoverCardTsx).toContain('collisionPadding = 12');
      expect(hoverCardTsx).toContain('max-w-[calc(100vw-1.5rem)]');
    });
  });

  describe('Dashboards, Modals, Popups & D3 Charts mobile responsiveness', () => {
    it('ensures TagAnalyticsModal and D3 charts resize dynamically and fit within mobile viewports', () => {
      const tagModal = readWorkspaceFile('src/components/analytics/TagAnalyticsModal.tsx');
      const timelineChart = readWorkspaceFile('src/components/analytics/D3TagTimelineChart.tsx');
      const barChart = readWorkspaceFile('src/components/analytics/D3TagBarChart.tsx');

      expect(tagModal).toContain('w-[calc(100vw-1rem)]');
      expect(tagModal).toContain('max-h-[calc(100dvh-1rem)]');
      expect(timelineChart).toContain('ResizeObserver');
      expect(barChart).toContain('ResizeObserver');
    });

    it('ensures SettingsModal, ConnectorsStorePanel, ProjectModals, and WorkspaceMentionPicker fit mobile screens', () => {
      const settingsModal = readWorkspaceFile('src/components/settings/SettingsModal.tsx');
      const connectorsPanel = readWorkspaceFile('src/components/connectors/ConnectorsStorePanel.tsx');
      const mentionPicker = readWorkspaceFile('src/components/chat/WorkspaceMentionPicker.tsx');
      const driveExplorer = readWorkspaceFile('src/components/workspace/GoogleDriveFileExplorer.tsx');

      expect(settingsModal).toContain('max-h-[calc(100dvh-1rem)]');
      expect(connectorsPanel).toContain('w-[calc(100vw-1rem)]');
      expect(mentionPicker).toContain('w-[calc(100vw-2rem)]');
      expect(driveExplorer).toContain('w-[calc(100vw-1rem)]');
    });
  });
});
