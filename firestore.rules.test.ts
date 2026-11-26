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

  it('allows a safe edited-turn reopen while protecting identity and clearing stale run output', () => {
    const conversationUpdate = ruleBlock('function isValidConversationUpdate()', 'function isValidMessage');
    const messages = ruleBlock('match /messages/{messageId}', '\n      }\n    }\n  }\n}');

    expect(conversationUpdate).toContain("incoming().status in ['completed', 'running']");
    expect(conversationUpdate).toContain('incoming().title == existing().title');
    expect(conversationUpdate).toContain('incoming().mode == existing().mode');
    expect(conversationUpdate).toContain('incoming().createdAt == existing().createdAt');
    expect(conversationUpdate).toContain("(incoming().status == 'running' && !('result' in incoming()))");
    expect(conversationUpdate).toContain("(incoming().status == 'completed' && (!('result' in existing()) || ('result' in incoming() && incoming().result == existing().result)))");
    expect(conversationUpdate).toContain("(incoming().status == 'running' && !('steps' in incoming()))");
    expect(conversationUpdate).toContain("(incoming().status == 'completed' && (!('steps' in existing()) || ('steps' in incoming() && incoming().steps == existing().steps)))");
    expect(conversationUpdate).toContain("('messages' in existing()) || ('messages' in incoming() && incoming().messages == existing().messages)");
    expect(messages).toContain("data.status != 'completed'");
  });

  it('does not use shallow JavaScript self-comparisons as emulator substitutes', () => {
    expect(rules).not.toContain('authUid === targetUserId');
    expect(rules).not.toContain('projectOwnerId === requestingUserId');
    expect(rules).not.toContain('allowedStatuses.includes(tamperedStatus)');
  });

  it('enforces strict user ownership, immutability, and append-only audit logs for sandbox and browser subcollections', () => {
    const sandboxes = ruleBlock('match /sandboxes/{sandboxId}', 'match /executions/{executionId}');
    const executions = ruleBlock('match /executions/{executionId}', 'match /browser_sessions/{sessionId}');
    const browserSessions = ruleBlock('match /browser_sessions/{sessionId}', 'match /approvals/{challengeId}');
    const approvals = ruleBlock('match /approvals/{challengeId}', 'match /audit_logs/{auditId}');
    const auditLogs = ruleBlock('match /audit_logs/{auditId}', 'match /idempotency/{keyId}');

    expect(sandboxes).toContain('isOwner(userId)');
    expect(sandboxes).toContain('isValidSandbox(incoming(), userId, sandboxId)');
    expect(sandboxes).toContain("!(existing().status in ['stopped', 'expired'])");

    expect(executions).toContain('isValidExecution(incoming(), userId, executionId)');
    expect(executions).toContain('allow delete: if false;');

    expect(browserSessions).toContain('isValidBrowserSession(incoming(), userId, sessionId)');
    expect(browserSessions).toContain("!(existing().status in ['closed', 'expired'])");

    expect(approvals).toContain('isValidApproval(incoming(), userId, challengeId)');
    expect(approvals).toContain('incoming().parametersHash == existing().parametersHash');
    expect(approvals).toContain("!(existing().status in ['consumed', 'rejected', 'expired'])");

    expect(auditLogs).toContain('isValidAuditLog(incoming(), userId, auditId)');
    expect(auditLogs).toContain('allow update, delete: if false;');
  });

  it('enforces ownership, immutability, and append-only run histories for Features 01-05 subcollections', () => {
    const policies = ruleBlock('match /permission_policies/{policyId}', 'match /background_tasks/{taskId}');
    const tasks = ruleBlock('match /background_tasks/{taskId}', 'match /multi_agent_runs/{runId}');
    const multiAgent = ruleBlock('match /multi_agent_runs/{runId}', 'match /skills/{skillId}');
    const skills = ruleBlock('match /skills/{skillId}', 'match /skill_executions/{executionId}');
    const skillExecs = ruleBlock('match /skill_executions/{executionId}', 'match /schedules/{scheduleId}');
    const schedules = ruleBlock('match /schedules/{scheduleId}', 'match /schedule_runs/{runId}');
    const scheduleRuns = ruleBlock('match /schedule_runs/{runId}', 'match /notifications/{notificationId}');
    const notifications = ruleBlock('match /notifications/{notificationId}', 'match /projects/{projectId}');

    expect(policies).toContain('isValidPermissionPolicy(incoming(), userId, policyId)');
    expect(tasks).toContain('isValidBackgroundTask(incoming(), userId, taskId)');
    expect(tasks).toContain('allow delete: if false;');
    expect(multiAgent).toContain('isValidMultiAgentRun(incoming(), userId, runId)');
    expect(multiAgent).toContain('allow delete: if false;');
    expect(skills).toContain('isValidInstalledSkill(incoming(), userId, skillId)');
    expect(skillExecs).toContain('allow update, delete: if false;');
    expect(schedules).toContain("existing().status != 'cancelled' || incoming().status == 'cancelled'");
    expect(scheduleRuns).toContain('allow update, delete: if false;');
    expect(notifications).toContain('isValidNotification(incoming(), userId, notificationId)');
  });
});
