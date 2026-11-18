import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

function ruleBlock(start: string, end: string): string {
  const startIndex = rules.indexOf(start);
  const endIndex = rules.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing rule block: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing rule block terminator: ${end}`).toBeGreaterThan(startIndex);
  return rules.slice(startIndex, endIndex);
}

describe('Firestore security rules contract', () => {
  it('keeps a default-deny catch-all before explicit collection grants', () => {
    expect(rules).toContain("match /{document=**} {");
    expect(rules).toContain('allow read, write: if false;');
  });

  it('binds user, project, conversation, and message IDs to their paths', () => {
    const users = ruleBlock('match /users/{userId}', 'match /projects/{projectId}');
    const projects = ruleBlock('match /projects/{projectId}', 'match /conversations/{conversationId}');
    const conversations = ruleBlock('match /conversations/{conversationId}', '\n    }\n  }\n}');

    expect(users).toContain('incoming().id == userId');
    expect(users).toContain('incoming().id == existing().id');
    expect(projects).toContain('incoming().id == projectId');
    expect(projects).toContain('incoming().id == existing().id');
    expect(conversations).toContain('incoming().id == conversationId');
    expect(conversations).toContain('incoming().id == messageId');
    expect(conversations).toContain('incoming().conversationId == conversationId');
    expect(conversations).toContain('incoming().conversationId == existing().conversationId');
  });

  it('prevents creation timestamps from changing on updates', () => {
    expect(rules).toContain("incoming().createdAt == existing().createdAt");
    expect(rules).toContain("incoming().created_at == existing().created_at");
    expect(rules).toContain("incoming().timestamp == existing().timestamp");
    expect(rules).toContain("('createdAt' in existing()) || ('createdAt' in incoming() && incoming().createdAt == existing().createdAt)");
  });

  it('requires checkpoint ownership, path task identity, bounded fields, and immutable identity fields', () => {
    const checkpoints = ruleBlock('match /checkpoints/{checkpointId}', 'match /projects/{projectId}');
    const checkpointValidator = ruleBlock('function isValidCheckpoint(', 'function isValidCheckpointTransition');

    expect(checkpoints).toContain('isValidCheckpoint(incoming(), userId, checkpointId)');
    expect(checkpointValidator).toContain('data.taskId == checkpointId');
    expect(checkpointValidator).toContain('data.userId == ownerId');
    expect(checkpointValidator).toContain('data.completedToolCalls.size() <= 100');
    expect(checkpointValidator).toContain('data.accumulatedResult.size() <= 500000');
    expect(checkpoints).toContain('incoming().id == existing().id');
    expect(checkpoints).toContain('incoming().taskId == existing().taskId');
    expect(checkpoints).toContain('incoming().conversationId == existing().conversationId');
    expect(checkpoints).toContain('incoming().userId == existing().userId');
  });

  it('makes completed checkpoints terminal and prevents invalid terminal-state reversion', () => {
    const checkpoints = ruleBlock('function isValidCheckpointTransition()', 'match /test/connection');

    expect(checkpoints).toContain("existing().status == 'completed' && incoming().status == 'completed'");
    expect(checkpoints).toContain("existing().status == 'failed' && incoming().status in ['failed', 'completed']");
    expect(checkpoints).toContain("existing().status == 'interrupted' && incoming().status in ['interrupted', 'failed', 'completed']");
  });

  it('protects completed conversations from reopening or changing immutable content', () => {
    const conversationUpdate = ruleBlock('function isValidConversationUpdate()', 'function isValidMessage');
    const messages = ruleBlock('match /messages/{messageId}', '\n      }\n    }\n  }\n}');

    expect(conversationUpdate).toContain("incoming().status == 'completed'");
    expect(conversationUpdate).toContain('incoming().title == existing().title');
    expect(conversationUpdate).toContain('incoming().mode == existing().mode');
    expect(conversationUpdate).toContain('incoming().createdAt == existing().createdAt');
    expect(conversationUpdate).toContain('incoming().result == existing().result');
    expect(conversationUpdate).toContain("('steps' in existing()) || ('steps' in incoming() && incoming().steps == existing().steps)");
    expect(conversationUpdate).toContain("('messages' in existing()) || ('messages' in incoming() && incoming().messages == existing().messages)");
    expect(messages).toContain("data.status != 'completed'");
  });

  it('does not use shallow JavaScript self-comparisons as emulator substitutes', () => {
    expect(rules).not.toContain('authUid === targetUserId');
    expect(rules).not.toContain('projectOwnerId === requestingUserId');
    expect(rules).not.toContain('allowedStatuses.includes(tamperedStatus)');
  });
});
