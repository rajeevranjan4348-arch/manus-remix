import { describe, it, expect } from 'vitest';
import {
  SseStreamDiagnosticsTracker,
  SSE_HANG_THRESHOLD_MS,
  extractEventIdFromPayload,
} from '../src/lib/sseStreamDiagnostics';

describe('SSE Stream Diagnostics Tracker & 5-Second Hang Watchdog', () => {
  it('monitors SSE connection state transitions from idle -> connecting -> streaming -> completed', () => {
    const tracker = new SseStreamDiagnosticsTracker(5000);
    expect(tracker.getSnapshot(1000).connectionState).toBe('idle');

    const connSnap = tracker.recordConnecting({
      requestId: 'req_101',
      taskId: 'task_101',
      endpoint: '/api/gemini/stream',
      nowMs: 1000,
    });
    expect(connSnap.connectionState).toBe('connecting');
    expect(connSnap.activeRequestId).toBe('req_101');
    expect(connSnap.logs).toHaveLength(1);
    expect(connSnap.logs[0].eventId).toBe('conn_init_req_101');

    const chunkSnap = tracker.recordEventChunk({
      requestId: 'req_101',
      eventId: 'evt_delta_1',
      eventType: 'text-delta',
      payloadChunk: JSON.stringify({ type: 'text-delta', delta: 'Hello world' }),
      nowMs: 1120,
    });
    expect(chunkSnap.connectionState).toBe('streaming');
    expect(chunkSnap.logs).toHaveLength(2);
    expect(chunkSnap.logs[1].eventId).toBe('evt_delta_1');
    expect(chunkSnap.logs[1].deltaSinceLastFrameMs).toBe(120);
    expect(chunkSnap.logs[1].payloadChunk).toContain('Hello world');

    const doneSnap = tracker.recordStreamCompleted({
      requestId: 'req_101',
      finishReason: 'stop',
      nowMs: 1450,
    });
    expect(doneSnap.connectionState).toBe('completed');
    expect(doneSnap.isHungOverThreshold).toBe(false);
  });

  it('extracts event IDs from nested agent-activity or SSE payload chunks when explicit eventId is omitted', () => {
    const raw = JSON.stringify({
      type: 'agent-activity',
      event: {
        eventId: 'evt_srv_999',
        seq: 4,
        title: 'Understanding the question',
      },
    });
    expect(extractEventIdFromPayload(raw)).toBe('evt_srv_999');

    const tracker = new SseStreamDiagnosticsTracker(5000);
    const snap = tracker.recordEventChunk({
      requestId: 'req_202',
      eventType: 'agent-activity',
      payloadChunk: raw,
      nowMs: 2000,
    });
    expect(snap.logs[0].eventId).toBe('evt_srv_999');
  });

  it('detects when the SSE connection hangs for more than 5 seconds (5000ms) and triggers stalled state for Restart Stream button', () => {
    const tracker = new SseStreamDiagnosticsTracker(SSE_HANG_THRESHOLD_MS);
    tracker.recordConnecting({
      requestId: 'req_hang_test',
      nowMs: 10000,
    });

    // At +4900ms (4.9s), connection is still within threshold
    const beforeThreshold = tracker.evaluateWatchdog(14900);
    expect(beforeThreshold.isHungOverThreshold).toBe(false);
    expect(beforeThreshold.connectionState).toBe('connecting');
    expect(beforeThreshold.silenceDurationMs).toBe(4900);

    // At +5100ms (5.1s), connection exceeds 5000ms hang threshold -> transitions to 'stalled'
    const afterThreshold = tracker.evaluateWatchdog(15100);
    expect(afterThreshold.isHungOverThreshold).toBe(true);
    expect(afterThreshold.connectionState).toBe('stalled');
    expect(afterThreshold.silenceDurationMs).toBe(5100);

    // Clicking 'Restart Stream' increments restartCount, logs stream-restart event, and resets silence timer
    const restarted = tracker.recordRestartRequested(15200);
    expect(restarted.connectionState).toBe('restarting');
    expect(restarted.restartCount).toBe(1);
    expect(restarted.silenceDurationMs).toBe(0);
    expect(restarted.isHungOverThreshold).toBe(false);
    expect(restarted.logs[restarted.logs.length - 1].eventType).toBe('stream-restart');
  });
});
