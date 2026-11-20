import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentActivityHub,
  redactSensitiveActivityText as serverRedact,
} from '../server/agentActivityService';
import {
  isTechnicalVerificationTask,
  runTechnicalVerification,
} from '../server/agentVerificationService';
import {
  AgentActivityTracker,
  redactSensitiveActivityText as clientRedact,
  agentActivityTracker,
} from '../src/lib/agentActivityTracker';
import { createAutonomousStreamResponse, setActiveStreamContext } from '../src/lib/blink';
import { AgentActivityFeed } from '../src/components/agent/AgentActivityFeed';

describe('Real-Time AI Agent Activity & Verification System', () => {
  beforeEach(() => {
    agentActivityTracker.clearTask('task_sse_1');
    agentActivityTracker.clearTask('task_a');
    agentActivityTracker.clearTask('task_b');
  });

  it('tracks real activity lifecycle transitions (QUEUED -> RUNNING -> COMPLETED / FAILED / CANCELLED) without duplicating eventId', () => {
    const hub = new AgentActivityHub();
    const received: any[] = [];
    const unsubscribe = hub.subscribe('task_1', (ev) => received.push(ev));

    const handle = hub.startActivity('task_1', {
      eventId: 'evt_check_auth',
      title: 'Inspecting Firebase authentication configuration',
      description: 'Checking persistence and singleton auth setup',
      toolName: 'firebase_inspector',
      category: 'auth',
      initialStatus: 'QUEUED',
    });

    handle.update({ status: 'RUNNING', description: 'Reading src/lib/firebase.ts' });
    handle.complete('Verified browserLocalPersistence singleton');
    unsubscribe();

    const snapshot = hub.getEvents('task_1');
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].eventId).toBe('evt_check_auth');
    expect(snapshot[0].status).toBe('COMPLETED');
    expect(snapshot[0].resultSummary).toContain('browserLocalPersistence');
    expect(received.map((e) => e.status)).toEqual(['QUEUED', 'RUNNING', 'COMPLETED']);

    // Verify FAILED and CANCELLED states explicitly
    const failHandle = hub.startActivity('task_1', {
      title: 'Checking database connection',
      toolName: 'cloud_sql',
      category: 'database',
    });
    failHandle.fail(new Error('Connection refused'));

    const cancelHandle = hub.startActivity('task_1', {
      title: 'Running optional build check',
      toolName: 'vite_build',
      category: 'terminal',
    });
    cancelHandle.cancel('User stopped generation');

    const finalSnapshot = hub.getEvents('task_1');
    expect(finalSnapshot).toHaveLength(3);
    expect(finalSnapshot[1].status).toBe('FAILED');
    expect(finalSnapshot[1].error).toContain('Connection refused');
    expect(finalSnapshot[2].status).toBe('CANCELLED');
  });

  it('isolates concurrent agent tasks completely and replays missed events cleanly on reconnect', () => {
    const hub = new AgentActivityHub();
    const e1 = hub.emit({
      taskId: 'task_alpha',
      eventId: 'a_1',
      title: 'Inspecting backend route wiring',
      toolName: 'file_inspector',
      status: 'RUNNING',
    });
    hub.emit({
      taskId: 'task_beta',
      eventId: 'b_1',
      title: 'Searching the web for market data',
      toolName: 'web_search',
      status: 'RUNNING',
    });
    const e2 = hub.emit({
      taskId: 'task_alpha',
      eventId: 'a_2',
      title: 'Running TypeScript validation',
      toolName: 'typescript_check',
      status: 'COMPLETED',
    });

    const alphaAll = hub.getEvents('task_alpha');
    const betaAll = hub.getEvents('task_beta');
    expect(alphaAll.map((e) => e.eventId)).toEqual(['a_1', 'a_2']);
    expect(betaAll.map((e) => e.eventId)).toEqual(['b_1']);

    // Reconnect with sinceSeq = e1.seq must only replay events after e1.seq (no duplicates!)
    const alphaReplay = hub.getEvents('task_alpha', e1.seq);
    expect(alphaReplay.map((e) => e.eventId)).toEqual(['a_2']);
    expect(alphaReplay[0].seq).toBe(e2.seq);

    // Client tracker deduplication on duplicate replayed frames
    const tracker = new AgentActivityTracker();
    tracker.ingestEvent(e1, true);
    tracker.ingestEvent(e1, true); // duplicate replay
    tracker.ingestEvent(e2, true);
    expect(tracker.getTaskActivities('task_alpha')).toHaveLength(2);
  });

  it('redacts chain-of-thought, API keys, Bearer tokens, JWTs, passwords, and env secrets on both server and client', () => {
    const sensitiveInput =
      '<think>internal chain of thought secret</think> Calling API with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaaaa.bbbbbbbbbbbb key=AIzaSyA1234567890abcdefghijk12345 sk-or-v1-abcdef1234567890abcdef password=superSecret99';

    for (const redact of [serverRedact, clientRedact]) {
      const cleaned = redact(sensitiveInput, 400);
      expect(cleaned).not.toContain('internal chain of thought');
      expect(cleaned).not.toContain('<think>');
      expect(cleaned).not.toContain('AIzaSyA1234567890');
      expect(cleaned).not.toContain('sk-or-v1-abcdef');
      expect(cleaned).not.toContain('superSecret99');
      expect(cleaned).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(cleaned).toContain('[REDACTED');
    }

    const hub = new AgentActivityHub();
    const safeEvent = hub.emit({
      taskId: 'task_sec',
      title: 'Inspecting env config api_key=sk-proj-secret123456789012345',
      description: '<think>hidden reasoning</think> Checked auth header',
      toolName: 'auth_check',
      status: 'COMPLETED',
      metadata: {
        safeCount: 3,
        accessToken: 'ya29.should-be-stripped',
        clientSecret: 'never-expose',
      },
    });
    expect(safeEvent.title).not.toContain('sk-proj-secret');
    expect(safeEvent.description).not.toContain('hidden reasoning');
    expect(safeEvent.metadata).toEqual({ safeCount: 3 });
  });

  it('runs real technical workspace inspection and honestly marks unexecuted shell checks as SKIPPED (never PASSED)', async () => {
    expect(isTechnicalVerificationTask('Fix Firebase auth session loss and check backend routes')).toBe(true);
    expect(isTechnicalVerificationTask('Hello')).toBe(false);

    const emitted: any[] = [];
    const report = await runTechnicalVerification({
      taskId: 'task_verify_honest',
      prompt: 'Inspect Firebase auth configuration and backend route wiring',
      runTypeCheck: false,
      runTests: false,
      runBuild: false,
      onActivity: (ev) => emitted.push(ev),
    });

    expect(report.affectedFiles.length).toBeGreaterThan(0);
    expect(report.affectedFiles.some((f) => f.includes('firebase'))).toBe(true);

    const tscStage = report.stages.find((s) => s.stage === 'type_check');
    const testStage = report.stages.find((s) => s.stage === 'run_tests');
    const buildStage = report.stages.find((s) => s.stage === 'build_verification');

    // Unexecuted checks MUST be marked SKIPPED and executed: false, NEVER PASSED
    expect(tscStage?.outcome).toBe('SKIPPED');
    expect(tscStage?.executed).toBe(false);
    expect(testStage?.outcome).toBe('SKIPPED');
    expect(testStage?.executed).toBe(false);
    expect(buildStage?.outcome).toBe('SKIPPED');
    expect(buildStage?.executed).toBe(false);
    expect(report.skippedCount).toBe(3);
    expect(report.passedCount).toBeGreaterThanOrEqual(4);
    expect(emitted.length).toBeGreaterThan(0);
  });

  it('forwards inline agent-activity SSE frames in createAutonomousStreamResponse without polluting response text', async () => {
    const activityEvent = {
      taskId: 'task_sse_1',
      eventId: 'evt_stream_1',
      seq: 1,
      title: 'Inspecting client Firebase authorization',
      description: 'Checking persistence configuration',
      toolName: 'file_inspector',
      status: 'RUNNING',
      timestamp: new Date().toISOString(),
    };
    const activityDoneEvent = {
      ...activityEvent,
      seq: 2,
      status: 'COMPLETED',
      resultSummary: 'Verified browserLocalPersistence',
    };

    const sseBody =
      `data: ${JSON.stringify({ type: 'agent-activity', taskId: 'task_sse_1', event: activityEvent })}\n\n` +
      `data: ${JSON.stringify({ type: 'agent-activity', taskId: 'task_sse_1', event: activityDoneEvent })}\n\n` +
      `data: ${JSON.stringify({ type: 'text-delta', delta: 'Firebase persistence is configured.' })}\n\n` +
      `data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n` +
      `data: [DONE]\n\n`;

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      setActiveStreamContext({
        requestId: 'req_act_1',
        taskId: 'task_sse_1',
        messages: [{ role: 'user', content: 'Inspect Firebase auth' }],
      });
      const response = createAutonomousStreamResponse({
        requestId: 'req_act_1',
        taskId: 'task_sse_1',
        messages: [{ role: 'user', content: 'Inspect Firebase auth' }],
      });
      const output = await response.text();
      expect(output).toContain('Firebase persistence is configured.');
      expect(output).not.toContain('Inspecting client Firebase authorization');

      const tracked = agentActivityTracker.getTaskActivities('task_sse_1');
      expect(tracked).toHaveLength(1);
      expect(tracked[0].status).toBe('COMPLETED');
      expect(tracked[0].resultSummary).toContain('browserLocalPersistence');
    } finally {
      setActiveStreamContext(null);
      globalThis.fetch = originalFetch;
    }
  });

  it('cancels active activities cleanly so interrupted tasks never leave infinite running spinners', () => {
    const tracker = new AgentActivityTracker();
    tracker.startActivity('task_cancel', {
      eventId: 'c_1',
      title: 'Running dependency checks',
      toolName: 'dependency_analyzer',
    });
    expect(tracker.getTaskActivities('task_cancel')[0].status).toBe('RUNNING');

    tracker.cancelTaskActivities('task_cancel', 'Stopped by user');
    const after = tracker.getTaskActivities('task_cancel');
    expect(after[0].status).toBe('CANCELLED');
    expect(after[0].resultSummary).toBe('Stopped by user');
  });

  it('renders AgentActivityFeed cleanly with live shimmer headline and stays invisible when empty', () => {
    const emptyMarkup = renderToStaticMarkup(
      React.createElement(AgentActivityFeed, { taskId: 't_empty', activities: [], isRunning: false })
    );
    expect(emptyMarkup).toBe('');

    const activeMarkup = renderToStaticMarkup(
      React.createElement(AgentActivityFeed, {
        taskId: 't_live',
        isRunning: true,
        activities: [
          {
            taskId: 't_live',
            eventId: 'e1',
            seq: 1,
            title: 'Inspecting backend route wiring and SSE handlers',
            description: 'Checking vite.config.ts routes',
            toolName: 'file_inspector',
            status: 'RUNNING',
            timestamp: new Date().toISOString(),
          },
        ],
      })
    );
    expect(activeMarkup).toContain('data-testid="agent-activity-feed"');
    expect(activeMarkup).toContain('Inspecting backend route wiring and SSE handlers');
    expect(activeMarkup).toContain('agent-activity-shimmer-text');
  });
});
