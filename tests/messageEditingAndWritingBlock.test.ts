import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { detectWritingBlock } from '../src/lib/writingDetector';
import {
  applyUserMessageEditBranch,
  preserveUserMessageAttachments,
} from '../src/lib/messageBranching';
import {
  clampMenuPosition,
  formatMessageContextTimestamp,
  DEFAULT_LONG_PRESS_DELAY_MS,
  DEFAULT_LONG_PRESS_MOVE_THRESHOLD_PX,
  shouldCancelLongPressForMove,
  isInteractiveTarget,
  shouldDismissBackdropClick,
} from '../src/components/agent/MessageContextMenu';
import { shareTextContent } from '../src/lib/messageShare';

describe('Intelligent Writing Mode Detector (detectWritingBlock)', () => {
  it('detects an email draft and splits conversational intro and outro outside the Writing Block', () => {
    const markdown = [
      "Here's a professional follow-up email draft you can send:",
      '',
      '**Subject:** Follow-Up on Q4 Product Roadmap Alignment',
      '',
      'Dear Alex,',
      '',
      'Thank you for taking the time to meet with our product and engineering team earlier today. Following our discussion, I have compiled the updated milestones and delivery dates for the Q4 launch.',
      '',
      'Please let me know if you have any feedback before we lock in the sprint schedule on Friday.',
      '',
      'Best regards,',
      'Samira',
      '',
      'Let me know if you would like a shorter or more casual tone.',
    ].join('\n');

    const res = detectWritingBlock(markdown, 'Write a professional follow-up email to Alex about Q4 roadmap');
    expect(res.isWritingBlock).toBe(true);
    expect(res.artifactType).toBe('email');
    expect(res.introText).toContain("Here's a professional follow-up email draft");
    expect(res.writingContent).toContain('**Subject:** Follow-Up on Q4 Product Roadmap Alignment');
    expect(res.writingContent).toContain('Dear Alex,');
    expect(res.writingContent).not.toContain('Let me know if you would like a shorter');
    expect(res.outroText).toContain('Let me know if you would like a shorter');
    expect(res.title).toBe('Follow-Up on Q4 Product Roadmap Alignment');
  });

  it('detects a ChatGPT-style AI fix prompt card and keeps the heading above the Writing Block', () => {
    const markdown = [
      'Fix prompt for your AI coding agent',
      '',
      '# FIX LOCATION DETECTION & GOOGLE MAPS INTEGRATION',
      '',
      'Analyze and permanently fix the location detection and Google Maps rendering bugs.',
      '',
      'IMPORTANT: Preserve the existing UI, UX, layout, animations, colors, typography, map card design and responsiveness. Do not redesign anything.',
      '',
      '1. Fix Incorrect Location Detection',
      '- Correctly identify cities, states and countries.',
      '- Validate latitude and longitude against the resolved location.',
    ].join('\n');

    const res = detectWritingBlock(markdown, 'Write a fix prompt for my AI coding agent for Google Maps');
    expect(res.isWritingBlock).toBe(true);
    expect(res.artifactType).toBe('prompt');
    expect(res.introText).toBe('Fix prompt for your AI coding agent');
    expect(res.writingContent).toContain('# FIX LOCATION DETECTION & GOOGLE MAPS INTEGRATION');
    expect(res.writingContent).not.toMatch(/^Fix prompt for your AI coding agent/);
  });

  it('detects formal proposals, reports, essays, and LinkedIn posts', () => {
    const proposal = [
      'Here is your project proposal:',
      '',
      '# Cloud Migration Proposal',
      '',
      '## Executive Summary',
      'Migrating core analytics services to managed cloud infrastructure will cut operational overhead by 38% while improving uptime SLA to 99.95%.',
      '',
      '## Timeline & Deliverables',
      '- Phase 1: Architecture assessment and security review.',
      '- Phase 2: Staging migration and load testing.',
    ].join('\n');

    const proposalRes = detectWritingBlock(proposal, 'Draft a project proposal for cloud migration');
    expect(proposalRes.isWritingBlock).toBe(true);
    expect(proposalRes.artifactType).toBe('proposal');

    const linkedIn = [
      'Excited to share that our engineering team just shipped real-time offline sync for mobile web users!',
      '',
      'Over the past three months, we focused on sub-100ms responsiveness, resilient retry queues, and zero data loss during flaky commutes.',
      '',
      'Huge thanks to everyone who tested early builds and shared thoughtful feedback. #engineering #webdev',
    ].join('\n');

    const socialRes = detectWritingBlock(linkedIn, 'Write a LinkedIn post announcing our offline sync launch');
    expect(socialRes.isWritingBlock).toBe(true);
    expect(socialRes.artifactType).toBe('social_post');
  });

  it('detects content-driven emails even without an explicit writing prompt', () => {
    const email = [
      'Subject: Interview Confirmation — Senior Frontend Engineer',
      '',
      'Hi Jordan,',
      '',
      'We are pleased to confirm your technical interview scheduled for Thursday at 2:00 PM IST. You will meet with two engineers to walk through architecture and UI performance.',
      '',
      'Warm regards,',
      'Hiring Team',
    ].join('\n');

    const res = detectWritingBlock(email, 'Can you help with this?');
    expect(res.isWritingBlock).toBe(true);
    expect(res.artifactType).toBe('email');
  });

  it('does NOT wrap greetings, general Q&A explanations, or code responses in a Writing Block', () => {
    expect(detectWritingBlock('Hello! How can I help you today?', 'Hello').isWritingBlock).toBe(false);

    const qaExplanation = [
      'Photosynthesis is the biological process by which plants, algae, and certain bacteria convert light energy into chemical energy.',
      '',
      'During the light-dependent reactions in the thylakoid membranes, chlorophyll absorbs sunlight and splits water molecules, releasing oxygen and producing ATP and NADPH.',
      '',
      'In the Calvin cycle, those energy carriers convert carbon dioxide into glucose.',
    ].join('\n');
    expect(detectWritingBlock(qaExplanation, 'Explain how photosynthesis works').isWritingBlock).toBe(false);

    const codeAnswer = [
      'Here is a clean TypeScript implementation of binary search:',
      '',
      '```typescript',
      'export function binarySearch(arr: number[], target: number): number {',
      '  let left = 0;',
      '  let right = arr.length - 1;',
      '  while (left <= right) {',
      '    const mid = Math.floor((left + right) / 2);',
      '    if (arr[mid] === target) return mid;',
      '    if (arr[mid] < target) left = mid + 1;',
      '    else right = mid - 1;',
      '  }',
      '  return -1;',
      '}',
      '```',
      '',
      'Time complexity is O(log n) and space complexity is O(1).',
    ].join('\n');
    expect(detectWritingBlock(codeAnswer, 'Write a TypeScript binary search function').isWritingBlock).toBe(false);
  });

  it('supports explicit fenced writing/document blocks', () => {
    const fenced = [
      'Here is the announcement:',
      '',
      '```writing',
      '# Scheduled Maintenance Notice',
      '',
      'We will perform a brief database upgrade this Sunday from 2:00 AM to 2:30 AM UTC. All services will automatically resume afterward.',
      '```',
    ].join('\n');

    const res = detectWritingBlock(fenced, 'Give me something short');
    expect(res.isWritingBlock).toBe(true);
    expect(res.introText).toBe('Here is the announcement:');
    expect(res.writingContent).toContain('# Scheduled Maintenance Notice');
  });
});

describe('Real Message Editing & Conversation Branching', () => {
  it('updates the edited user message in-place, preserves id/timestamp, and truncates subsequent turns', () => {
    const originalTimestamp = '2026-11-23T14:00:00.000Z';
    const conversation = [
      { id: 'u1', role: 'user', content: 'Tell me about Delhi', timestamp: originalTimestamp },
      { id: 'a1', role: 'assistant', content: 'Delhi is the capital of India.', timestamp: '2026-11-23T14:00:05.000Z' },
      { id: 'u2', role: 'user', content: 'What about Mumbai?', timestamp: '2026-11-23T14:01:00.000Z' },
      { id: 'a2', role: 'assistant', content: 'Mumbai is Maharashtra capital.', timestamp: '2026-11-23T14:01:05.000Z' },
    ];

    const branch = applyUserMessageEditBranch(
      conversation,
      'u1',
      'Tell me about Tokyo instead',
      '2026-11-23T14:05:00.000Z'
    );

    expect(branch.editedIndex).toBe(0);
    expect(branch.isFirstUserMessage).toBe(true);
    expect(branch.updatedMessages).toHaveLength(1);
    expect(branch.editedMessage?.id).toBe('u1');
    expect(branch.editedMessage?.timestamp).toBe(originalTimestamp);
    expect(branch.editedMessage?.content).toBe('Tell me about Tokyo instead');
    expect(branch.editedMessage?.metadata?.edited).toBe(true);
    expect(branch.editedMessage?.metadata?.previousContent).toBe('Tell me about Delhi');
    expect(branch.removedMessageIds).toEqual(['a1', 'u2', 'a2']);
  });

  it('branches cleanly when editing a later user message without disturbing earlier turns', () => {
    const conversation = [
      { id: 'u1', role: 'user', content: 'First prompt', timestamp: '2026-11-23T14:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: 'First reply', timestamp: '2026-11-23T14:00:05.000Z' },
      { id: 'u2', role: 'user', content: 'Second prompt', timestamp: '2026-11-23T14:01:00.000Z' },
      { id: 'a2', role: 'assistant', content: 'Second reply', timestamp: '2026-11-23T14:01:05.000Z' },
    ];

    const branch = applyUserMessageEditBranch(conversation, 'u2', 'Updated second prompt');

    expect(branch.isFirstUserMessage).toBe(false);
    expect(branch.updatedMessages).toHaveLength(3);
    expect(branch.updatedMessages[0].id).toBe('u1');
    expect(branch.updatedMessages[1].id).toBe('a1');
    expect(branch.updatedMessages[2].id).toBe('u2');
    expect(branch.updatedMessages[2].content).toBe('Updated second prompt');
    expect(branch.removedMessageIds).toEqual(['a2']);
  });

  it('preserves attached image prefixes when editing user prompt text', () => {
    const raw = '[Attached Image: photo.png]\n[IMAGE_DATA_URL:data:image/png;base64,AAAA]\nWhat is in this photo?';
    const merged = preserveUserMessageAttachments(raw, 'Describe the colors in this photo');
    expect(merged).toContain('[Attached Image: photo.png]');
    expect(merged).toContain('[IMAGE_DATA_URL:data:image/png;base64,AAAA]');
    expect(merged.endsWith('Describe the colors in this photo')).toBe(true);
  });

  it('safely returns untouched history when messageId is missing or text is blank', () => {
    const list = [{ id: 'u1', role: 'user', content: 'Hello' }];
    expect(applyUserMessageEditBranch(list, 'missing', 'New').editedMessage).toBeNull();
    expect(applyUserMessageEditBranch(list, 'u1', '   ').editedMessage).toBeNull();
  });
});

describe('MessageContextMenu Positioning & Timestamp Formatting', () => {
  it('formats Today, Yesterday, and older dates cleanly', () => {
    const now = new Date(2026, 10, 23, 20, 0, 0); // Nov 23, 2026
    const todayMsg = new Date(2026, 10, 23, 19, 46, 0);
    const yesterdayMsg = new Date(2026, 10, 22, 18, 15, 0);
    const olderMsg = new Date(2026, 10, 10, 9, 30, 0);

    expect(formatMessageContextTimestamp(todayMsg, now)).toMatch(/^Today, /);
    expect(formatMessageContextTimestamp(yesterdayMsg, now)).toMatch(/^Yesterday, /);
    expect(formatMessageContextTimestamp(olderMsg, now)).toMatch(/Nov 10,/);
  });

  it('clamps menu coordinates within viewport boundaries and flips above near bottom edge', () => {
    const mobileViewport = { width: 375, height: 667 };
    const menuSize = { width: 236, height: 240 };

    // Near right + bottom edge -> must flip above and stay >= 12px from edges
    const bottomRight = clampMenuPosition(
      {
        x: 365,
        y: 620,
        rect: { top: 580, bottom: 625, left: 220, right: 365, width: 145, height: 45 },
        align: 'right',
      },
      menuSize,
      mobileViewport,
      12
    );

    expect(bottomRight.placement).toBe('above');
    expect(bottomRight.left).toBeGreaterThanOrEqual(12);
    expect(bottomRight.left + menuSize.width).toBeLessThanOrEqual(mobileViewport.width - 12);
    expect(bottomRight.top).toBeGreaterThanOrEqual(12);
    expect(bottomRight.top + menuSize.height).toBeLessThanOrEqual(mobileViewport.height - 12);

    // Near top-left -> stays below and inside left margin
    const topLeft = clampMenuPosition(
      {
        x: 4,
        y: 40,
        rect: { top: 20, bottom: 60, left: 4, right: 160, width: 156, height: 40 },
        align: 'left',
      },
      menuSize,
      mobileViewport,
      12
    );

    expect(topLeft.placement).toBe('below');
    expect(topLeft.left).toBeGreaterThanOrEqual(12);
    expect(topLeft.top).toBeGreaterThanOrEqual(60);
  });
});

describe('Native Share Helper (shareTextContent)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses navigator.share when available and returns shared', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: shareMock, clipboard: { writeText: vi.fn() } });

    const outcome = await shareTextContent({ title: 'Deku AI', text: 'Sample prompt' });
    expect(outcome).toBe('shared');
    expect(shareMock).toHaveBeenCalledWith({ title: 'Deku AI', text: 'Sample prompt' });
  });

  it('returns cancelled without error when user dismisses native share sheet (AbortError)', async () => {
    const abortErr = Object.assign(new Error('Share canceled'), { name: 'AbortError' });
    const shareMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('navigator', { share: shareMock, clipboard: { writeText: vi.fn() } });

    const outcome = await shareTextContent({ title: 'Deku AI', text: 'Sample prompt' });
    expect(outcome).toBe('cancelled');
  });

  it('falls back to clipboard copy when navigator.share is unavailable', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } });

    const outcome = await shareTextContent({ title: 'Deku AI', text: 'Fallback share text' });
    expect(outcome).toBe('copied');
    expect(writeTextMock).toHaveBeenCalledWith('Fallback share text');
  });
});

describe('Long-Press Gesture Thresholds, Scroll Cancellation & Safety', () => {
  it('uses a native-feeling long-press delay between 450ms and 550ms', () => {
    expect(DEFAULT_LONG_PRESS_DELAY_MS).toBeGreaterThanOrEqual(450);
    expect(DEFAULT_LONG_PRESS_DELAY_MS).toBeLessThanOrEqual(550);
    expect(DEFAULT_LONG_PRESS_MOVE_THRESHOLD_PX).toBeGreaterThanOrEqual(8);
  });

  it('cancels long-press when finger moves beyond scroll threshold while tolerating tiny jitter', () => {
    const start = { x: 120, y: 300 };
    // Tiny micro-movement during stationary hold does NOT cancel
    expect(shouldCancelLongPressForMove(start, { x: 123, y: 304 })).toBe(false);
    expect(shouldCancelLongPressForMove(start, { x: 130, y: 310 })).toBe(false);
    // Vertical scroll gesture cancels immediately
    expect(shouldCancelLongPressForMove(start, { x: 121, y: 315 })).toBe(true);
    // Horizontal swipe cancels immediately
    expect(shouldCancelLongPressForMove(start, { x: 138, y: 301 })).toBe(true);
    // Null start safely returns false
    expect(shouldCancelLongPressForMove(null, { x: 200, y: 400 })).toBe(false);
  });

  it('ignores interactive targets like buttons and links to prevent conflicts', () => {
    const buttonTarget = { closest: (sel: string) => (sel.includes('button') ? {} : null) } as unknown as EventTarget;
    const textTarget = { closest: () => null } as unknown as EventTarget;
    expect(isInteractiveTarget(buttonTarget)).toBe(true);
    expect(isInteractiveTarget(textTarget)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });

  it('prevents finger-lift synthetic clicks from closing the menu while allowing genuine outside taps', () => {
    // 1. Finger lifted after long-press (no press started on backdrop, within orphan release suppression window)
    expect(
      shouldDismissBackdropClick({
        now: 1520,
        openedAt: 1000,
        pressStartedOnBackdrop: false,
        suppressUntil: 1950,
      })
    ).toBe(false);

    // 2. Rapid ghost click immediately after opening (within grace window)
    expect(
      shouldDismissBackdropClick({
        now: 1120,
        openedAt: 1000,
        pressStartedOnBackdrop: false,
        suppressUntil: 0,
      })
    ).toBe(false);

    // 3. Genuine fresh tap/click outside on backdrop ALWAYS dismisses immediately
    expect(
      shouldDismissBackdropClick({
        now: 1120,
        openedAt: 1000,
        pressStartedOnBackdrop: true,
        suppressUntil: 1950,
      })
    ).toBe(true);

    // 4. Programmatic/accessibility backdrop click after grace & suppression windows dismisses
    expect(
      shouldDismissBackdropClick({
        now: 2200,
        openedAt: 1000,
        pressStartedOnBackdrop: false,
        suppressUntil: 1950,
      })
    ).toBe(true);
  });
});

describe('Component Architecture & Wiring Verification', () => {
  const root = process.cwd();

  it('contains all required modular components with opaque light/dark theme support and keyboard navigation', () => {
    const requiredFiles = [
      'src/components/agent/MessageContextMenu.tsx',
      'src/components/agent/MessageEditController.tsx',
      'src/components/agent/WritingBlock.tsx',
      'src/components/agent/WritingBlockHeader.tsx',
      'src/components/agent/WritingBlockActions.tsx',
      'src/lib/writingDetector.ts',
      'src/lib/messageBranching.ts',
      'src/lib/messageShare.ts',
    ];

    for (const rel of requiredFiles) {
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }

    const menuSrc = fs.readFileSync(path.join(root, 'src/components/agent/MessageContextMenu.tsx'), 'utf8');
    expect(menuSrc).toContain('Copy');
    expect(menuSrc).toContain('Select text');
    expect(menuSrc).toContain('Edit message');
    expect(menuSrc).toContain('Share prompt');
    // Solid opaque surface (no transparent bleed-through) and top-level z-index
    expect(menuSrc).toContain('manus-context-menu-backdrop');
    expect(menuSrc).toContain('manus-context-menu-card');
    expect(menuSrc).toContain('manus-select-text-backdrop');
    expect(menuSrc).toContain('manus-select-text-card');
    expect(menuSrc).toContain('bg-white border-black/[0.08]');
    expect(menuSrc).toContain('dark:bg-[#1A1A1D]');
    expect(menuSrc).toContain('z-[9990]');
    expect(menuSrc).toContain('z-[9991]');
    // Guard against Tailwind 3.3.5 invalid opacity steps that compile to nothing
    expect(menuSrc).not.toContain('bg-black/45');
    expect(menuSrc).not.toContain('bg-black/55');
    // Keyboard & Back dismissal
    expect(menuSrc).toContain('ArrowDown');
    expect(menuSrc).toContain('ArrowUp');
    expect(menuSrc).toContain('popstate');
    expect(menuSrc).toContain('BrowserBack');
    // Desktop right-click + mouse & touch hold support + scroll capture cancellation + backdrop release guard
    expect(menuSrc).toContain('useMessageLongPressController');
    expect(menuSrc).toContain('attachScrollCancellation');
    expect(menuSrc).toContain('lastTouchAtRef');
    expect(menuSrc).toContain('shouldDismissBackdropClick');
    expect(menuSrc).toContain('onContextMenu');
    expect(menuSrc).toContain('onMouseDown');
    expect(menuSrc).toContain('onTouchStart');

    // Touch CSS guard & guaranteed opaque context menu surface rules
    const cssSrc = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
    expect(cssSrc).toContain('@media (pointer: coarse), (hover: none), (any-pointer: coarse)');
    expect(cssSrc).toContain('-webkit-touch-callout: none !important;');
    expect(cssSrc).toContain('.manus-context-menu-backdrop');
    expect(cssSrc).toContain('.manus-context-menu-card');
    expect(cssSrc).toContain('.dark .manus-context-menu-card');
    expect(cssSrc).toContain('isolation: isolate;');

    const writingSrc = fs.readFileSync(path.join(root, 'src/components/agent/WritingBlock.tsx'), 'utf8');
    expect(writingSrc).toContain('dark:bg-[#1E1E21]');
    expect(writingSrc).toContain('WritingBlockHeader');
    expect(writingSrc).toContain('MarkdownRenderer');
  });

  it('wires user-only long-press, pressed/selected feedback, three-dot menu, and WritingBlock cleanly', () => {
    const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
    expect(appSrc).toContain('onEditMessage={editMessage}');

    const hookSrc = fs.readFileSync(path.join(root, 'src/hooks/useAgentTask.ts'), 'utf8');
    expect(hookSrc).toContain('const editMessage = useCallback');
    expect(hookSrc).toContain('applyUserMessageEditBranch');
    expect(hookSrc).toContain('deleteMessagesByIds');

    const chatViewSrc = fs.readFileSync(path.join(root, 'src/components/agent/ChatView.tsx'), 'utf8');
    expect(chatViewSrc).toContain('useMessageLongPressController');
    expect(chatViewSrc).toContain('getUserMessageGestureProps');
    expect(chatViewSrc).toContain('data-testid="user-message-menu-btn"');
    expect(chatViewSrc).toContain('data-long-press-state=');
    expect(chatViewSrc).toContain("WebkitTouchCallout: 'none'");
    // Assistant messages MUST NOT trigger the user-message long-press menu
    expect(chatViewSrc).not.toContain('assistantLongPressHandlers');
    expect(chatViewSrc).not.toContain('assistant-message-menu-btn');
    expect(chatViewSrc).toContain('<MessageContextMenu');
    expect(chatViewSrc).toContain('<MessageEditController');
    expect(chatViewSrc).toContain('<WritingBlock');
    expect(chatViewSrc).toContain('detectWritingBlock');

    const myAiSrc = fs.readFileSync(path.join(root, 'src/components/chat/MyAIChat.tsx'), 'utf8');
    expect(myAiSrc).toContain('useMessageLongPressController');
    expect(myAiSrc).toContain("msg.role === 'user' && msg.content");
    expect(myAiSrc).toContain('data-long-press-state=');
    expect(myAiSrc).toContain('<MessageContextMenu');
    expect(myAiSrc).toContain('<MessageEditController');
    expect(myAiSrc).toContain('<WritingBlock');
  });
});
