import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSafeLocalPointerX } from '../src/components/analytics/D3TagTimelineChart';
import { MarkdownRenderer } from '../src/components/agent/MarkdownRenderer';

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

      const ultraLiteGpuMatch = indexCss.match(/\[data-perf-mode="ultra-lite"\]\s*\.gpu-accelerated\s*\{([\s\S]*?)\}/);
      expect(ultraLiteGpuMatch).toBeTruthy();
      expect(ultraLiteGpuMatch![1]).not.toContain('transform: none');
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

  describe('Assistant response overflow and Markdown rendering', () => {
    it('wraps long response tokens and confines horizontal scrolling to tables and code blocks', () => {
      const css = readWorkspaceFile('src/index.css');
      const renderer = readWorkspaceFile('src/components/agent/MarkdownRenderer.tsx');
      const codeBlock = readWorkspaceFile('src/components/agent/CodeBlock.tsx');
      const myAIChat = readWorkspaceFile('src/components/chat/MyAIChat.tsx');

      expect(css).toContain('.manus-markdown');
      expect(css).toContain('overflow-wrap: anywhere;');
      expect(css).toContain('min-width: 0;');
      expect(css).toContain('.manus-markdown-table-scroll');
      expect(css).toContain('overscroll-behavior-x: contain;');
      expect(css).toContain('width: max-content;');
      expect(renderer).toContain('manus-markdown-table-scroll w-full max-w-full min-w-0 overflow-x-auto');
      expect(codeBlock).toContain('manus-codeblock-scroll w-full max-w-full min-w-0 overflow-x-auto');
      expect(myAIChat).toContain('<MarkdownRenderer content={msg.content} />');
      expect(css).toContain('.manus-markdown hr');
    });

    it('renders long and Markdown-heavy assistant responses as semantic, width-constrained elements', () => {
      const longWord = 'unbroken-token-'.repeat(36);
      const longUrl = `https://example.com/${'very-long-path-segment-'.repeat(18)}`;
      const longInlineCode = `inline-${'code-token-'.repeat(14)}`;
      const markdown =
        `# Response heading\n\nA paragraph with **bold text**, an unbroken token ${longWord}, a [long URL](${longUrl}), and \`${longInlineCode}\`.\n\n` +
        '- First list item with a long wrapped value\n- Second list item\n\n---\n\n' +
        `| Column A | Column B |\n| --- | --- |\n| ${longWord} | table content |\n\n` +
        `\`\`\`text\n${longWord}\n\`\`\``;
      const html = renderToStaticMarkup(
        React.createElement(MarkdownRenderer, { content: markdown, animateTypewriter: false })
      );

      expect(html).toContain('<h1>Response heading</h1>');
      expect(html).toContain('<p>');
      expect(html).toContain('<strong>bold text</strong>');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
      expect(html).toContain('<hr');
      expect(html).toContain('manus-inline-code-pill');
      expect(html).toContain(longUrl);
      expect(html).toContain('manus-markdown-table-scroll');
      expect(html).toContain('<table>');
      expect(html).toContain('data-testid="code-block-scroll-viewport"');
      expect(html).toContain('manus-markdown');
    });
  });

  describe('Shared UI Primitives viewport clamping & transform-independent centering', () => {
    it('clamps DialogContent and AlertDialogContent to viewport width and 100dvh height and centers via fixed inset-0 flex wrapper', () => {
      const dialogTsx = readWorkspaceFile('src/components/ui/dialog.tsx');
      const alertDialogTsx = readWorkspaceFile('src/components/ui/alert-dialog.tsx');

      expect(dialogTsx).toContain('fixed inset-0 z-50 flex items-center justify-center');
      expect(dialogTsx).not.toContain('left-[50%]');
      expect(dialogTsx).toContain('w-[calc(100vw-1rem)]');
      expect(dialogTsx).toContain('max-w-[calc(100vw-1rem)]');
      expect(dialogTsx).toContain('max-h-[calc(100dvh-1rem)]');

      expect(alertDialogTsx).toContain('fixed inset-0 z-50 flex items-center justify-center');
      expect(alertDialogTsx).not.toContain('left-[50%]');
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
    it('ensures TagAnalyticsModal and D3 charts resize dynamically and fit within mobile viewports without tailwind-merge max-w conflicts', () => {
      const tagModal = readWorkspaceFile('src/components/analytics/TagAnalyticsModal.tsx');
      const timelineChart = readWorkspaceFile('src/components/analytics/D3TagTimelineChart.tsx');
      const barChart = readWorkspaceFile('src/components/analytics/D3TagBarChart.tsx');

      expect(tagModal).toContain('w-[calc(100vw-1rem)]');
      expect(tagModal).toContain('max-w-[calc(100vw-1rem)]');
      expect(tagModal).toContain('sm:max-w-4xl');
      expect(tagModal).toContain('max-h-[calc(100dvh-1rem)]');
      expect(tagModal).toContain('grid-cols-5');
      expect(tagModal).toContain('grid-cols-2');
      expect(timelineChart).toContain('ResizeObserver');
      expect(barChart).toContain('ResizeObserver');
    });

    it('safely extracts pointer X coordinates across mouse, touch, and non-finite events without SVGPoint errors', () => {
      const mockTarget = {
        getBoundingClientRect: () => ({ left: 20, top: 10, width: 200, height: 150 }),
      } as unknown as Element;

      // Standard mouse event
      expect(getSafeLocalPointerX({ clientX: 120, clientY: 50 }, mockTarget, 400)).toBe(200);

      // TouchEvent where clientX is undefined at top level and present on touches[0]
      expect(
        getSafeLocalPointerX(
          { touches: [{ clientX: 70, clientY: 60 }] },
          mockTarget,
          400
        )
      ).toBe(100);

      // Non-finite / empty touch event must return null instead of throwing SVGPoint TypeError
      expect(getSafeLocalPointerX({ touches: [] }, mockTarget, 400)).toBeNull();
      expect(getSafeLocalPointerX({ clientX: NaN, clientY: undefined }, mockTarget, 400)).toBeNull();
    });

    it('ensures SettingsModal, ConnectorsStorePanel, ConnectorConfigModal, and WorkspaceMentionPicker fit mobile screens', () => {
      const settingsModal = readWorkspaceFile('src/components/settings/SettingsModal.tsx');
      const connectorsPanel = readWorkspaceFile('src/components/connectors/ConnectorsStorePanel.tsx');
      const connectorConfigModal = readWorkspaceFile('src/components/connectors/ConnectorConfigModal.tsx');
      const mentionPicker = readWorkspaceFile('src/components/chat/WorkspaceMentionPicker.tsx');
      const driveExplorer = readWorkspaceFile('src/components/workspace/GoogleDriveFileExplorer.tsx');

      expect(settingsModal).toContain('max-h-[calc(100dvh-1rem)]');
      expect(connectorsPanel).toContain('w-[calc(100vw-1rem)]');
      expect(connectorsPanel).toContain('max-w-[calc(100vw-1rem)]');
      expect(connectorsPanel).toContain('sm:max-w-2xl');
      expect(connectorsPanel).toContain('grid-cols-3');
      expect(connectorConfigModal).toContain('max-w-[calc(100vw-1rem)]');
      expect(connectorConfigModal).toContain('sm:max-w-xl');
      expect(mentionPicker).toContain('w-[calc(100vw-2rem)]');
      expect(driveExplorer).toContain('w-[calc(100vw-1rem)]');
      expect(driveExplorer).toContain('max-w-[calc(100vw-1rem)]');
      expect(driveExplorer).toContain('sm:max-w-4xl');
    });
  });
});
