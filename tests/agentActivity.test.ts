import { describe, expect, it } from 'vitest';
import {
  makeResearchActivities,
  makeResearchActivity,
  mergeAgentActivityEvent,
  parseAgentActivityEvent,
  summarizeToolActivity,
} from '../src/lib/agentActivity';

describe('agent activity events', () => {
  it('redacts credential-like text and clips untrusted activity fields', () => {
    const activity = parseAgentActivityEvent({
      taskId: 'task_1',
      eventId: 'evt_1',
      activityId: 'req_1:tool:read_file',
      title: 'Reading a file',
      description: 'Authorization: Bearer test.secret.token',
      toolName: 'read_file',
      status: 'running',
      timestamp: new Date().toISOString(),
      details: 'password=do-not-store-this-value',
    });

    expect(activity).not.toBeNull();
    expect(activity?.description).not.toContain('test.secret.token');
    expect(activity?.details).not.toContain('do-not-store-this-value');
    expect(activity?.title.length).toBeLessThanOrEqual(90);
  });

  it('rejects malformed activity events', () => {
    expect(parseAgentActivityEvent({ taskId: 'task_1', status: 'running' })).toBeNull();
  });

  it('keeps raw research prompt details out of activity descriptions', () => {
    const activities = makeResearchActivities({
      stage: 'searching_sources',
      detail: 'Searching for private project codename amber-fox and token=secret-value',
    }, 'task_1', 'req_1', 1);

    expect(JSON.stringify(activities)).not.toContain('amber-fox');
    expect(JSON.stringify(activities)).not.toContain('secret-value');
  });

  it('maps source-search progress into a completed, deduplicated activity', () => {
    const started = makeResearchActivity({ stage: 'searching_sources' }, 'task_1', 'req_1', 1);
    const completed = makeResearchActivities({
      stage: 'reading_information',
      detail: 'Extracted 4 candidate source(s) and live telemetry',
    }, 'task_1', 'req_1', 2).find(activity => activity.activityId === 'req_1:rtie:searching_sources');

    expect(started?.status).toBe('running');
    expect(completed?.status).toBe('completed');
    expect(completed?.resultSummary).toBe('4 candidate source(s) returned.');

    const withStarted = mergeAgentActivityEvent([], started);
    const withCompleted = mergeAgentActivityEvent(withStarted, completed);
    const replayed = mergeAgentActivityEvent(withCompleted, completed);
    expect(withCompleted).toHaveLength(1);
    expect(withCompleted[0].status).toBe('completed');
    expect(replayed).toHaveLength(1);
    expect(replayed[0].status).toBe('completed');
  });

  it('does not let a delayed running event move a completed activity backward', () => {
    const completed = {
      taskId: 'task_1',
      eventId: 'evt_complete',
      activityId: 'req_1:model',
      title: 'Generating AI response',
      description: 'The response stream finished successfully.',
      toolName: 'ai-model',
      status: 'completed' as const,
      timestamp: new Date().toISOString(),
    };
    const delayedRunning = { ...completed, eventId: 'evt_late', status: 'running' as const };
    const result = mergeAgentActivityEvent([completed], delayedRunning);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('completed');
  });

  it('does not let a late success event overwrite a cancelled activity', () => {
    const cancelled = {
      taskId: 'task_1',
      eventId: 'evt_cancelled',
      activityId: 'req_1:model',
      title: 'Generating AI response',
      description: 'Generation was stopped by the user.',
      toolName: 'ai-model',
      status: 'cancelled' as const,
      timestamp: new Date().toISOString(),
    };
    const lateSuccess = { ...cancelled, eventId: 'evt_late_success', status: 'completed' as const };
    const result = mergeAgentActivityEvent([cancelled], lateSuccess);

    expect(result[0].status).toBe('cancelled');
  });

  it('reports real test totals without exposing the command or raw tool output', () => {
    const summary = summarizeToolActivity(
      'run_terminal_cmd',
      { command: 'npm test -- --reporter=dot' },
      'Tests 17 passed (17)\n2 skipped',
      'completed'
    );

    expect(summary.title).toBe('Running automated tests');
    expect(summary.resultSummary).toBe('Tests: 17 passed, 0 failed, 2 skipped.');
    expect(JSON.stringify(summary)).not.toContain('npm test');

    const failedSummary = summarizeToolActivity(
      'run_terminal_cmd',
      { command: 'vitest run' },
      'Tests 2 passed, 1 failed, 3 skipped',
      'failed'
    );
    expect(failedSummary.resultSummary).toBe('Tests: 2 passed, 1 failed, 3 skipped.');
  });

  it('classifies TypeScript and build checks only when the terminal command matches', () => {
    expect(summarizeToolActivity('run_terminal_cmd', { command: 'npm run lint' }, '', 'completed')).toMatchObject({
      title: 'Running TypeScript validation',
      resultSummary: 'No TypeScript errors were reported.',
    });
    expect(summarizeToolActivity('run_terminal_cmd', { command: 'npm run build' }, '', 'completed')).toMatchObject({
      title: 'Running build verification',
      resultSummary: 'The build command completed successfully.',
    });
  });
});
