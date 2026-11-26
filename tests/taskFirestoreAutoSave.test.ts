import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ActiveTaskAutoSaveController,
  computeActiveTaskFingerprint,
  extractRecoveredTaskState,
  type ActiveTaskAutoSaveSnapshot,
} from '../src/lib/taskAutoSave';
import { taskCheckpoint, type SaveCheckpointParams, type TaskCheckpoint } from '../src/lib/taskCheckpoint';

function makeSnapshot(overrides: Partial<ActiveTaskAutoSaveSnapshot> = {}): ActiveTaskAutoSaveSnapshot {
  return {
    taskId: 'task_autosave_001',
    conversationId: 'task_autosave_001',
    userId: 'user_abc123',
    title: 'Quarterly Revenue Analysis',
    prompt: 'Analyze Q4 revenue trends and build a summary',
    mode: 'chat',
    outputFormat: 'report',
    phase: 'text-generation',
    steps: [
      { id: '1', label: 'Analyzing Request', status: 'completed', trace: ['Parsed intent'] },
      { id: '2', label: 'Generating Output', status: 'running', trace: ['Streaming tokens'] },
    ],
    accumulatedResult: 'Preliminary revenue summary: Q4 grew 18% YoY.',
    completedToolCalls: [
      { toolName: 'Analyzing Request', args: { stepId: '1' }, outputSummary: 'Parsed intent' },
    ],
    assistantMessageId: 'msg_assistant_001',
    userMessageId: 'msg_user_001',
    messageCount: 1,
    createdAt: '2026-11-24T20:00:00.000Z',
    ...overrides,
  };
}

describe('Periodic Active Task Auto-Save to Firestore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('auto-saves periodically on interval when active task state changes and skips unchanged ticks', async () => {
    let current = makeSnapshot({ accumulatedResult: 'Chunk 1' });
    const savedCheckpoints: SaveCheckpointParams[] = [];
    const savedConversations: any[] = [];

    const controller = new ActiveTaskAutoSaveController({
      intervalMs: 5_000,
      getSnapshot: () => current,
      warmAuthToken: async () => {},
      checkpointSaver: async (params) => {
        savedCheckpoints.push(params);
        return {
          checkpoint: taskCheckpoint.buildSanitizedCheckpoint(params),
          syncedToFirestore: true,
        };
      },
      checkpointSyncSaver: (params) => {
        savedCheckpoints.push(params);
        return taskCheckpoint.buildSanitizedCheckpoint(params);
      },
      conversationProgressSaver: async (params) => {
        savedConversations.push(params);
        return true;
      },
    });

    controller.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(savedCheckpoints).toHaveLength(1);
    expect(savedConversations).toHaveLength(1);
    expect(savedCheckpoints[0].accumulatedResult).toBe('Chunk 1');
    expect(savedCheckpoints[0].status).toBe('in_progress');

    // Advance two intervals without state changes -> deduplicated, zero extra writes
    await vi.advanceTimersByTimeAsync(10_000);
    expect(savedCheckpoints).toHaveLength(1);
    expect(savedConversations).toHaveLength(1);

    // Stream advances -> next interval tick persists updated text & progress
    current = makeSnapshot({ accumulatedResult: 'Chunk 1 + Chunk 2 streamed output' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedCheckpoints).toHaveLength(2);
    expect(savedConversations).toHaveLength(2);
    expect(savedCheckpoints[1].accumulatedResult).toBe('Chunk 1 + Chunk 2 streamed output');
    expect(savedCheckpoints[1].stateSnapshot?.autoSaveReason).toBe('interval');

    controller.stop();
  });

  it('stops periodic timers cleanly on completion so no stale ticks fire afterward', async () => {
    let current = makeSnapshot({ accumulatedResult: 'Working...' });
    const checkpointSaver = vi.fn(async (params: SaveCheckpointParams) => ({
      checkpoint: taskCheckpoint.buildSanitizedCheckpoint(params),
      syncedToFirestore: true,
    }));
    const conversationProgressSaver = vi.fn(async () => true);

    const controller = new ActiveTaskAutoSaveController({
      intervalMs: 4_000,
      getSnapshot: () => current,
      warmAuthToken: async () => {},
      checkpointSaver,
      conversationProgressSaver,
    });

    controller.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(checkpointSaver).toHaveBeenCalledTimes(1);

    controller.stop();
    expect(controller.active).toBe(false);

    // Even if snapshot mutates after stop, no periodic writes occur
    current = makeSnapshot({ accumulatedResult: 'Mutated after completion' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(checkpointSaver).toHaveBeenCalledTimes(1);
    expect(conversationProgressSaver).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately with interrupted status & keepalive on pagehide, beforeunload, and hidden visibilitychange', async () => {
    const windowListeners = new Map<string, Set<EventListener>>();
    const docListeners = new Map<string, Set<EventListener>>();
    let visibilityState = 'visible';

    const mockWindow = {
      addEventListener: (type: string, fn: EventListener) => {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        windowListeners.get(type)?.delete(fn);
      },
    };
    const mockDocument = {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: (type: string, fn: EventListener) => {
        if (!docListeners.has(type)) docListeners.set(type, new Set());
        docListeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        docListeners.get(type)?.delete(fn);
      },
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('document', mockDocument);

    try {
      let current = makeSnapshot({ accumulatedResult: 'Initial stream' });
      const asyncSaves: SaveCheckpointParams[] = [];
      const syncSaves: SaveCheckpointParams[] = [];

      const controller = new ActiveTaskAutoSaveController({
        intervalMs: 10_000,
        getSnapshot: () => current,
        warmAuthToken: async () => {},
        checkpointSaver: async (params) => {
          asyncSaves.push(params);
          return {
            checkpoint: taskCheckpoint.buildSanitizedCheckpoint(params),
            syncedToFirestore: true,
          };
        },
        checkpointSyncSaver: (params) => {
          syncSaves.push(params);
          return taskCheckpoint.buildSanitizedCheckpoint(params);
        },
        conversationProgressSaver: async () => true,
      });

      controller.start({ immediate: false });

      // 1. User switches tab away (visibilitychange -> hidden)
      visibilityState = 'hidden';
      current = makeSnapshot({ accumulatedResult: 'Stream while hiding tab' });
      docListeners.get('visibilitychange')?.forEach((fn) => fn(new Event('visibilitychange')));
      await vi.advanceTimersByTimeAsync(10);
      expect(asyncSaves).toHaveLength(1);
      expect(asyncSaves[0].status).toBe('in_progress');
      expect(asyncSaves[0].keepalive).toBe(true);

      // 2. Browser tab unexpectedly closes (pagehide)
      current = makeSnapshot({ accumulatedResult: 'Stream right before unexpected tab close' });
      windowListeners.get('pagehide')?.forEach((fn) => fn(new Event('pagehide')));
      expect(syncSaves).toHaveLength(1);
      expect(syncSaves[0].status).toBe('interrupted');
      expect(syncSaves[0].keepalive).toBe(true);
      expect(syncSaves[0].accumulatedResult).toBe('Stream right before unexpected tab close');

      // 3. Stop detaches all lifecycle listeners cleanly
      controller.stop();
      expect(windowListeners.get('pagehide')?.size ?? 0).toBe(0);
      expect(windowListeners.get('beforeunload')?.size ?? 0).toBe(0);
      expect(docListeners.get('visibilitychange')?.size ?? 0).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('backs off polling interval automatically when Firestore reports quota exhaustion', async () => {
    let callCount = 0;
    let current = makeSnapshot({ accumulatedResult: 'Step 1' });

    const controller = new ActiveTaskAutoSaveController({
      intervalMs: 5_000,
      maxBackoffIntervalMs: 20_000,
      getSnapshot: () => current,
      warmAuthToken: async () => {},
      checkpointSaver: async (params) => {
        callCount += 1;
        return {
          checkpoint: taskCheckpoint.buildSanitizedCheckpoint(params),
          syncedToFirestore: false,
          skippedReason: 'quota-exceeded',
          quotaExceeded: true,
        };
      },
      conversationProgressSaver: async () => true,
    });

    controller.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(1);

    // First interval tick still scheduled at 5s, gets quotaExceeded -> backs off to 10s, then 20s
    await vi.advanceTimersByTimeAsync(5_000);
    expect(callCount).toBe(2);

    // At +5s (total 10s since start), should NOT have fired yet because interval backed off to 20s
    current = makeSnapshot({ accumulatedResult: 'Step 2' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(callCount).toBe(2);

    // After full 20s backoff elapses, it retries
    await vi.advanceTimersByTimeAsync(15_000);
    expect(callCount).toBe(3);

    controller.stop();
  });

  it('sanitizes checkpoint payloads to strictly obey firestore.rules constraints', () => {
    const oversizedLabel = 'L'.repeat(500);
    const oversizedResult = 'R'.repeat(520_000);
    const oversizedToolCalls = Array.from({ length: 130 }, (_, idx) => ({
      toolName: `tool_${idx}`,
      args: { index: idx, optionalUndefined: undefined },
      outputSummary: 'ok',
    }));
    const oversizedSnapshot: Record<string, any> = {};
    for (let i = 0; i < 120; i++) {
      oversizedSnapshot[`key_${i}`] = i % 2 === 0 ? `val_${i}` : undefined;
    }

    const sanitized = taskCheckpoint.buildSanitizedCheckpoint({
      taskId: 'task_rules_check_1',
      conversationId: 'task_rules_check_1',
      userId: 'uid_owner_1',
      stepIndex: -5,
      totalSteps: 200_000,
      stepLabel: oversizedLabel,
      status: 'in_progress',
      completedToolCalls: oversizedToolCalls,
      accumulatedResult: oversizedResult,
      stateSnapshot: oversizedSnapshot,
    });

    expect(sanitized.id).toBe('chk_task_rules_check_1');
    expect(sanitized.taskId).toBe('task_rules_check_1');
    expect(sanitized.stepIndex).toBe(0);
    expect(sanitized.totalSteps).toBe(100_000);
    expect(sanitized.stepLabel.length).toBeLessThanOrEqual(256);
    expect(sanitized.completedToolCalls.length).toBeLessThanOrEqual(100);
    expect(sanitized.accumulatedResult.length).toBeLessThanOrEqual(500_000);
    expect(Object.keys(sanitized.stateSnapshot || {}).length).toBeLessThanOrEqual(100);
    expect(taskCheckpoint.verifyCheckpointIntegrity(sanitized)).toBe(true);
    // Ensure no undefined values survived anywhere inside stateSnapshot or tool call args
    expect(JSON.stringify(sanitized)).not.toContain('optionalUndefined');
  });

  it('recovers partial streamed content and steps from an interrupted checkpoint after tab reload', () => {
    const interruptedCp: TaskCheckpoint = taskCheckpoint.buildSanitizedCheckpoint({
      taskId: 'task_crash_recovery_42',
      conversationId: 'task_crash_recovery_42',
      userId: 'uid_owner_1',
      stepIndex: 1,
      totalSteps: 3,
      stepLabel: 'Generating Output',
      status: 'interrupted',
      accumulatedResult: 'Here is the partial analysis saved right before the tab closed...',
      stateSnapshot: {
        title: 'Market Sizing Report',
        prompt: 'Create a market sizing report for EV charging',
        mode: 'chat',
        outputFormat: 'report',
        assistantMessageId: 'msg_assistant_42',
        steps: [
          { id: '1', label: 'Analyzing Request', status: 'completed', trace: ['Done'] },
          { id: '2', label: 'Generating Output', status: 'running', trace: ['Streaming'] },
        ],
        savedAt: '2026-11-24T21:00:00.000Z',
      },
    });

    const recovered = extractRecoveredTaskState(interruptedCp);
    expect(recovered).not.toBeNull();
    expect(recovered!.partialContent).toBe(
      'Here is the partial analysis saved right before the tab closed...'
    );
    expect(recovered!.prompt).toBe('Create a market sizing report for EV charging');
    expect(recovered!.assistantMessageId).toBe('msg_assistant_42');
    expect(recovered!.steps).toHaveLength(2);
    // Running step should be settled cleanly to completed on recovery
    expect(recovered!.steps[1].status).toBe('completed');

    // Completed checkpoints should not trigger partial crash recovery
    const completedCp = taskCheckpoint.buildSanitizedCheckpoint({
      ...interruptedCp,
      status: 'completed',
    });
    expect(extractRecoveredTaskState(completedCp)).toBeNull();

    // Tampered checksum should fail integrity validation
    const tamperedCp = { ...interruptedCp, accumulatedResult: 'Tampered content' };
    expect(extractRecoveredTaskState(tamperedCp)).toBeNull();
  });

  it('computes distinct fingerprints when step progress or streamed content changes', () => {
    const base = makeSnapshot();
    const fp1 = computeActiveTaskFingerprint(base, 'in_progress');
    const fp2 = computeActiveTaskFingerprint(makeSnapshot({ accumulatedResult: base.accumulatedResult + '!' }), 'in_progress');
    const fp3 = computeActiveTaskFingerprint(
      makeSnapshot({
        steps: [
          { id: '1', label: 'Analyzing Request', status: 'completed', trace: ['Parsed intent'] },
          { id: '2', label: 'Generating Output', status: 'completed', trace: ['Done'] },
        ],
      }),
      'in_progress'
    );

    expect(fp1).not.toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });
});
