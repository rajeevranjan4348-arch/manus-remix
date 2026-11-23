import { describe, expect, it } from 'vitest';
import { replaceEditedUserTurn } from '../src/lib/messageEditing';
import { isStandaloneWritingArtifact } from '../src/lib/writingBlockClassifier';
import { replaceVisibleUserMessageContent } from '../src/components/agent/ChatView';
import { shouldCancelMessageContextLongPress } from '../src/components/agent/MessageContextMenu';
import fs from 'node:fs';
import path from 'node:path';

const fixtureMessages = [
  { id: 'user-1', role: 'user', content: 'Earlier question', timestamp: '2026-01-01T10:00:00.000Z' },
  { id: 'assistant-1', role: 'assistant', content: 'Earlier answer', timestamp: '2026-01-01T10:00:01.000Z' },
  { id: 'user-2', role: 'user', content: 'Old request', timestamp: '2026-01-01T10:01:00.000Z' },
  { id: 'assistant-2', role: 'assistant', content: 'Old response', timestamp: '2026-01-01T10:01:01.000Z' },
];

describe('edited message branch behavior', () => {
  it('keeps earlier history and the edited message identity, then returns the superseded tail', () => {
    const result = replaceEditedUserTurn(fixtureMessages, 'user-2', 'Updated request', '2026-01-01T10:02:00.000Z');
    expect(result).not.toBeNull();
    expect(result?.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-2']);
    expect(result?.messages[2]).toMatchObject({
      id: 'user-2',
      role: 'user',
      content: 'Updated request',
      timestamp: '2026-01-01T10:01:00.000Z',
      metadata: { editedAt: '2026-01-01T10:02:00.000Z', editCount: 1 },
    });
    expect(result?.removedMessages.map((message) => message.id)).toEqual(['assistant-2']);
  });

  it('does not edit assistant messages, missing IDs, empty edits, or unchanged text', () => {
    expect(replaceEditedUserTurn(fixtureMessages, 'assistant-2', 'new')).toBeNull();
    expect(replaceEditedUserTurn(fixtureMessages, 'missing', 'new')).toBeNull();
    expect(replaceEditedUserTurn(fixtureMessages, 'user-2', '   ')).toBeNull();
    expect(replaceEditedUserTurn(fixtureMessages, 'user-2', 'Old request')).toBeNull();
  });

  it('reuses an unchanged prompt when regenerating without incrementing its edit metadata', () => {
    const result = replaceEditedUserTurn(fixtureMessages, 'user-2', 'Old request', undefined, true);
    expect(result?.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-2']);
    expect(result?.editedMessage).toMatchObject({ id: 'user-2', content: 'Old request', timestamp: '2026-01-01T10:01:00.000Z' });
    expect(result?.editedMessage.metadata).toBeUndefined();
    expect(result?.removedMessages.map((message) => message.id)).toEqual(['assistant-2']);
  });

  it('replaces visible prompt text without removing an embedded image payload', () => {
    const raw = '[Attached Image: photo.png]\n[IMAGE_DATA_URL:data:image/png;base64,abc123]\nWhat is in this image?';
    expect(replaceVisibleUserMessageContent(raw, 'Describe the colors.')).toBe(
      '[Attached Image: photo.png]\n[IMAGE_DATA_URL:data:image/png;base64,abc123]\nDescribe the colors.'
    );
  });
});

describe('writing artifact classification', () => {
  it('recognizes a standalone requested email draft', () => {
    const output = 'Subject: Project update\n\nHi Priya,\n\nI wanted to share a concise update on our current milestones and confirm the next steps for the team. The latest review is complete, and the remaining tasks are scheduled for this week.\n\nBest,\nRajeev';
    expect(isStandaloneWritingArtifact('Draft a professional email about our project update.', output)).toBe(true);
  });

  it('keeps ordinary explanations and code responses out of Writing Blocks', () => {
    expect(isStandaloneWritingArtifact('Explain how to write a report.', 'A report usually begins by defining its purpose and intended audience.')).toBe(false);
    expect(isStandaloneWritingArtifact('Write a Python function that formats an email address.', '```python\ndef format_email(value):\n    return value.strip().lower()\n```')).toBe(false);
    expect(isStandaloneWritingArtifact('What is a project proposal?', 'A project proposal explains the work, budget, risks, and expected outcomes.')).toBe(false);
    expect(isStandaloneWritingArtifact('Write a message to my manager explaining remote work.', 'You could say: I wanted to ask whether I could work remotely on Friday. I can stay reachable, join all meetings, and finish the deliverables on schedule. Please let me know if that works for the team.')).toBe(false);
  });

  it('cancels a touch long-press after movement but tolerates small finger drift', () => {
    expect(shouldCancelMessageContextLongPress({ x: 10, y: 10 }, { x: 16, y: 12 })).toBe(false);
    expect(shouldCancelMessageContextLongPress({ x: 10, y: 10 }, { x: 21, y: 10 })).toBe(true);
    expect(shouldCancelMessageContextLongPress(null, { x: 50, y: 50 })).toBe(false);
  });

  it('exposes reusable, accessible message and writing actions', () => {
    const root = path.resolve(__dirname, '../src/components/agent');
    const menu = fs.readFileSync(path.join(root, 'MessageContextMenu.tsx'), 'utf8');
    const card = fs.readFileSync(path.join(root, 'WritingBlock.tsx'), 'utf8');
    expect(menu).toContain('data-testid="message-context-menu"');
    expect(menu).toContain('Share prompt');
    expect(menu).toContain('Select text');
    expect(menu).toContain('onPointerDown={handlePointerDown}');
    expect(menu).toContain('onPointerMove={handlePointerMove}');
    expect(card).toContain('data-testid="writing-block-copy"');
    expect(card).toContain('data-testid="writing-block-share"');
    expect(card).toContain('MarkdownRenderer');
  });
});
