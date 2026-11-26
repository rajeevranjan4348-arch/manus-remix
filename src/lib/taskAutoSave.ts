/**
 * Periodic Active-Task Auto-Save Controller for Firestore
 *
 * Continuously persists active running task progress (streamed output, step states,
 * phase, prompt metadata, and completed tool calls) to Firestore on a configurable
 * periodic interval AND immediately on tab backgrounding / unexpected tab close
 * (`visibilitychange`, `pagehide`, `beforeunload`).
 *
 * Design guarantees:
 * - Zero redundant writes: deterministic snapshot fingerprinting skips unchanged ticks.
 * - Single-flight concurrency control: coalesces rapid triggers so writes never overlap.
 * - Monotonic run epochs: stopping/completing a task immediately invalidates stale timers.
 * - Adaptive quota backoff: backs off interval on Firestore `resource-exhausted` errors.
 * - Local + Firestore dual durability: synchronous localStorage backup ensures zero loss
 *   even if the tab terminates before an async network write finishes.
 */

import {
  taskCheckpoint,
  type CheckpointStatus,
  type CompletedToolCallRecord,
  type SaveCheckpointParams,
  type SaveCheckpointResult,
  type TaskCheckpoint,
} from './taskCheckpoint';
import { saveActiveTaskProgressToFirestore } from './firestoreService';
import { observability } from './observability';

export interface ActiveTaskStepSnapshot {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  trace?: string[];
}

export interface ActiveTaskAutoSaveSnapshot {
  taskId: string;
  conversationId?: string;
  userId?: string;
  title?: string;
  prompt?: string;
  mode?: 'chat' | 'work';
  outputFormat?: string;
  chartType?: string;
  projectId?: string | null;
  phase?: string;
  steps: ActiveTaskStepSnapshot[];
  accumulatedResult: string;
  completedToolCalls?: CompletedToolCallRecord[];
  assistantMessageId?: string;
  userMessageId?: string;
  messageCount?: number;
  createdAt?: string;
  extraState?: Record<string, unknown>;
}

export type AutoSaveTriggerReason =
  | 'initial'
  | 'interval'
  | 'milestone'
  | 'visibilitychange'
  | 'pagehide'
  | 'beforeunload'
  | 'manual'
  | 'unmount';

export interface ActiveTaskAutoSaveOptions {
  /** Base periodic auto-save interval in milliseconds (default: 8000ms). */
  intervalMs?: number;
  /** Minimum delay between milestone flushes in milliseconds (default: 1500ms). */
  milestoneThrottleMs?: number;
  /** Maximum backoff interval on Firestore quota errors (default: 60000ms). */
  maxBackoffIntervalMs?: number;
  /** Supplies the latest active task snapshot on demand (avoids stale React closures). */
  getSnapshot: () => ActiveTaskAutoSaveSnapshot | null;
  /** Optional custom checkpoint saver (for dependency injection in tests). */
  checkpointSaver?: (params: SaveCheckpointParams) => Promise<SaveCheckpointResult>;
  /** Optional custom sync checkpoint saver for emergency unload events. */
  checkpointSyncSaver?: (params: SaveCheckpointParams) => TaskCheckpoint;
  /** Optional custom conversation progress mirror saver (for tests). */
  conversationProgressSaver?: typeof saveActiveTaskProgressToFirestore;
  /** Optional token warmer before periodic/unload saves. */
  warmAuthToken?: () => Promise<void>;
}

export interface RecoveredTaskState {
  checkpoint: TaskCheckpoint;
  steps: ActiveTaskStepSnapshot[];
  partialContent: string;
  prompt?: string;
  title?: string;
  outputFormat?: string;
  chartType?: string;
  mode?: 'chat' | 'work';
  assistantMessageId?: string;
  savedAt: string;
}

const DEFAULT_INTERVAL_MS = 8_000;
const DEFAULT_MILESTONE_THROTTLE_MS = 1_500;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

export function computeActiveTaskFingerprint(
  snapshot: ActiveTaskAutoSaveSnapshot,
  status: CheckpointStatus = 'in_progress'
): string {
  const stepsSig = (snapshot.steps || [])
    .map((s) => `${s.id}:${s.status}:${(s.trace || []).length}`)
    .join(',');
  const content = snapshot.accumulatedResult || '';
  const contentHead = content.slice(0, 64);
  const contentTail = content.length > 64 ? content.slice(-64) : '';
  const toolCount = snapshot.completedToolCalls?.length || 0;
  return [
    snapshot.taskId,
    status,
    snapshot.phase || '',
    snapshot.title || '',
    stepsSig,
    String(content.length),
    contentHead,
    contentTail,
    String(toolCount),
    String(snapshot.messageCount || 0),
  ].join('|');
}

function resolveStepProgress(steps: ActiveTaskStepSnapshot[]): {
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
} {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { stepIndex: 0, totalSteps: 1, stepLabel: 'Processing active task' };
  }
  const runningIdx = steps.findIndex((s) => s.status === 'running');
  if (runningIdx !== -1) {
    return {
      stepIndex: runningIdx,
      totalSteps: steps.length,
      stepLabel: steps[runningIdx].label || `Step ${runningIdx + 1}`,
    };
  }
  let lastCompletedIdx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'completed') {
      lastCompletedIdx = i;
      break;
    }
  }
  if (lastCompletedIdx !== -1) {
    return {
      stepIndex: lastCompletedIdx,
      totalSteps: steps.length,
      stepLabel: steps[lastCompletedIdx].label || `Step ${lastCompletedIdx + 1}`,
    };
  }
  return {
    stepIndex: 0,
    totalSteps: steps.length,
    stepLabel: steps[0].label || 'Starting task',
  };
}

export class ActiveTaskAutoSaveController {
  private readonly baseIntervalMs: number;
  private readonly milestoneThrottleMs: number;
  private readonly maxBackoffIntervalMs: number;
  private readonly getSnapshot: () => ActiveTaskAutoSaveSnapshot | null;
  private readonly checkpointSaver: (params: SaveCheckpointParams) => Promise<SaveCheckpointResult>;
  private readonly checkpointSyncSaver: (params: SaveCheckpointParams) => TaskCheckpoint;
  private readonly conversationProgressSaver: typeof saveActiveTaskProgressToFirestore;
  private readonly warmAuthToken: () => Promise<void>;

  private isRunning = false;
  private runEpoch = 0;
  private currentIntervalMs: number;
  private intervalTimer: ReturnType<typeof setTimeout> | null = null;
  private milestoneTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;
  private lastSavedFingerprint = '';
  private saveSequence = 0;
  private inFlightPromise: Promise<boolean> | null = null;
  private pendingResyncReason: AutoSaveTriggerReason | null = null;
  private listenersAttached = false;

  constructor(options: ActiveTaskAutoSaveOptions) {
    this.baseIntervalMs = Math.max(1_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.milestoneThrottleMs = Math.max(250, options.milestoneThrottleMs ?? DEFAULT_MILESTONE_THROTTLE_MS);
    this.maxBackoffIntervalMs = Math.max(
      this.baseIntervalMs,
      options.maxBackoffIntervalMs ?? DEFAULT_MAX_BACKOFF_MS
    );
    this.currentIntervalMs = this.baseIntervalMs;
    this.getSnapshot = options.getSnapshot;
    this.checkpointSaver =
      options.checkpointSaver ?? ((params) => taskCheckpoint.saveCheckpointAsync(params));
    this.checkpointSyncSaver =
      options.checkpointSyncSaver ?? ((params) => taskCheckpoint.saveCheckpoint(params));
    this.conversationProgressSaver =
      options.conversationProgressSaver ?? saveActiveTaskProgressToFirestore;
    this.warmAuthToken = options.warmAuthToken ?? (() => taskCheckpoint.warmAuthToken());
  }

  public get active(): boolean {
    return this.isRunning;
  }

  public get flushCount(): number {
    return this.saveSequence;
  }

  /**
   * Begins periodic Firestore auto-saving and attaches page lifecycle guards
   * (`visibilitychange`, `pagehide`, `beforeunload`).
   */
  public start(options?: { immediate?: boolean }): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runEpoch += 1;
    this.currentIntervalMs = this.baseIntervalMs;
    this.lastSavedFingerprint = '';
    this.pendingResyncReason = null;

    void this.warmAuthToken();
    this.attachLifecycleListeners();

    if (options?.immediate !== false) {
      void this.flush('initial', { force: false });
    }
    this.scheduleNextTick();
  }

  /**
   * Schedules a throttled milestone auto-save when important state changes occur
   * (e.g., step transitions, phase updates, or first streamed tokens).
   */
  public triggerMilestoneSave(): void {
    if (!this.isRunning) return;
    const elapsed = Date.now() - this.lastFlushAt;
    if (elapsed >= this.milestoneThrottleMs && !this.inFlightPromise) {
      void this.flush('milestone');
      return;
    }
    if (this.milestoneTimer !== null) return;
    const delay = Math.max(100, this.milestoneThrottleMs - elapsed);
    const epoch = this.runEpoch;
    this.milestoneTimer = setTimeout(() => {
      this.milestoneTimer = null;
      if (!this.isRunning || epoch !== this.runEpoch) return;
      void this.flush('milestone');
    }, delay);
  }

  /**
   * Executes a deduplicated auto-save flush to Firestore (checkpoint + conversation progress).
   */
  public async flush(
    reason: AutoSaveTriggerReason = 'manual',
    options?: { force?: boolean; statusOverride?: CheckpointStatus; keepalive?: boolean }
  ): Promise<boolean> {
    const epoch = this.runEpoch;
    const isEmergencyUnload =
      reason === 'pagehide' || reason === 'beforeunload' || reason === 'unmount';

    if (!this.isRunning && !options?.force && !isEmergencyUnload) {
      return false;
    }

    const snapshot = this.getSnapshot();
    if (!snapshot || !snapshot.taskId) {
      return false;
    }

    const status: CheckpointStatus =
      options?.statusOverride ?? (isEmergencyUnload ? 'interrupted' : 'in_progress');
    const fingerprint = computeActiveTaskFingerprint(snapshot, status);

    if (!options?.force && fingerprint === this.lastSavedFingerprint) {
      return false;
    }

    // Emergency unload path: run synchronous local + fire-and-forget Firestore/keepalive write
    // immediately even if another async flush is in flight.
    if (isEmergencyUnload) {
      const payload = this.buildCheckpointParams(snapshot, status, reason, true);
      this.checkpointSyncSaver(payload);
      this.lastSavedFingerprint = fingerprint;
      this.lastFlushAt = Date.now();
      this.saveSequence += 1;
      void this.conversationProgressSaver({
        taskId: snapshot.taskId,
        title: snapshot.title || 'Active Task',
        prompt: snapshot.prompt,
        mode: snapshot.mode,
        outputFormat: snapshot.outputFormat,
        chartType: snapshot.chartType,
        projectId: snapshot.projectId,
        status: 'running',
        steps: snapshot.steps,
        partialContent: snapshot.accumulatedResult,
        createdAt: snapshot.createdAt,
      }).catch(() => {});
      return true;
    }

    if (this.inFlightPromise) {
      this.pendingResyncReason = reason;
      return this.inFlightPromise;
    }

    const runFlush = async (): Promise<boolean> => {
      try {
        if (!this.isRunning && !options?.force) return false;
        const latestSnapshot = this.getSnapshot();
        if (!latestSnapshot || !latestSnapshot.taskId) return false;
        if (epoch !== this.runEpoch && !options?.force) return false;

        const latestFingerprint = computeActiveTaskFingerprint(latestSnapshot, status);
        if (!options?.force && latestFingerprint === this.lastSavedFingerprint) {
          return false;
        }

        const params = this.buildCheckpointParams(
          latestSnapshot,
          status,
          reason,
          Boolean(options?.keepalive)
        );
        const result = await this.checkpointSaver(params);

        // If task finished/stopped while the async write was in-flight, do not advance interval/state
        if (epoch !== this.runEpoch && !options?.force) {
          return false;
        }

        if (result.quotaExceeded) {
          this.currentIntervalMs = Math.min(
            this.maxBackoffIntervalMs,
            this.currentIntervalMs * 2
          );
          observability.log({
            level: 'warning',
            category: 'recovery',
            message: `Firestore auto-save quota backoff increased to ${this.currentIntervalMs}ms for task ${latestSnapshot.taskId}`,
          });
          return false;
        }

        // Mirror active task progress to `/conversations/{taskId}` as well
        await this.conversationProgressSaver({
          taskId: latestSnapshot.taskId,
          title: latestSnapshot.title || 'Active Task',
          prompt: latestSnapshot.prompt,
          mode: latestSnapshot.mode,
          outputFormat: latestSnapshot.outputFormat,
          chartType: latestSnapshot.chartType,
          projectId: latestSnapshot.projectId,
          status: status === 'failed' ? 'error' : status === 'completed' ? 'completed' : 'running',
          steps: latestSnapshot.steps,
          partialContent: latestSnapshot.accumulatedResult,
          createdAt: latestSnapshot.createdAt,
        });

        this.currentIntervalMs = this.baseIntervalMs;
        this.lastSavedFingerprint = latestFingerprint;
        this.lastFlushAt = Date.now();
        this.saveSequence += 1;
        return true;
      } catch (err) {
        console.warn('[TaskAutoSave] Periodic save notice:', (err as any)?.message || err);
        return false;
      } finally {
        this.inFlightPromise = null;
        if (this.pendingResyncReason && this.isRunning && epoch === this.runEpoch) {
          const nextReason = this.pendingResyncReason;
          this.pendingResyncReason = null;
          void this.flush(nextReason);
        }
      }
    };

    this.inFlightPromise = runFlush();
    return this.inFlightPromise;
  }

  /**
   * Stops periodic auto-saving immediately, detaches browser lifecycle listeners,
   * and invalidates any pending timers or in-flight writes.
   */
  public stop(options?: { flushInterrupted?: boolean }): void {
    const wasRunning = this.isRunning;
    if (wasRunning && options?.flushInterrupted) {
      void this.flush('unmount', { force: true, statusOverride: 'interrupted', keepalive: true });
    }

    this.isRunning = false;
    this.runEpoch += 1;
    this.pendingResyncReason = null;

    if (this.intervalTimer !== null) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.milestoneTimer !== null) {
      clearTimeout(this.milestoneTimer);
      this.milestoneTimer = null;
    }

    this.detachLifecycleListeners();
  }

  private scheduleNextTick(): void {
    if (!this.isRunning) return;
    if (this.intervalTimer !== null) {
      clearTimeout(this.intervalTimer);
    }
    const epoch = this.runEpoch;
    this.intervalTimer = setTimeout(async () => {
      this.intervalTimer = null;
      if (!this.isRunning || epoch !== this.runEpoch) return;
      await this.flush('interval');
      if (this.isRunning && epoch === this.runEpoch) {
        this.scheduleNextTick();
      }
    }, this.currentIntervalMs);
  }

  private buildCheckpointParams(
    snapshot: ActiveTaskAutoSaveSnapshot,
    status: CheckpointStatus,
    reason: AutoSaveTriggerReason,
    keepalive: boolean
  ): SaveCheckpointParams {
    const { stepIndex, totalSteps, stepLabel } = resolveStepProgress(snapshot.steps);
    const savedAt = new Date().toISOString();
    return {
      taskId: snapshot.taskId,
      conversationId: snapshot.conversationId || snapshot.taskId,
      userId: snapshot.userId,
      stepIndex,
      totalSteps,
      stepLabel,
      status,
      completedToolCalls: snapshot.completedToolCalls || [],
      accumulatedResult: snapshot.accumulatedResult || '',
      keepalive,
      stateSnapshot: {
        title: snapshot.title || '',
        prompt: (snapshot.prompt || '').slice(0, 10_000),
        mode: snapshot.mode || 'chat',
        outputFormat: snapshot.outputFormat || '',
        chartType: snapshot.chartType || '',
        projectId: snapshot.projectId || '',
        phase: snapshot.phase || 'tool-calling',
        steps: snapshot.steps || [],
        assistantMessageId: snapshot.assistantMessageId || '',
        userMessageId: snapshot.userMessageId || '',
        messageCount: snapshot.messageCount || 0,
        autoSaveReason: reason,
        autoSaveSequence: this.saveSequence + 1,
        savedAt,
        ...(snapshot.extraState || {}),
      },
    };
  }

  private handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && this.isRunning) {
      void this.flush('visibilitychange', { force: false, statusOverride: 'in_progress', keepalive: true });
    }
  };

  private handlePageHide = (): void => {
    if (this.isRunning) {
      void this.flush('pagehide', { force: true, statusOverride: 'interrupted', keepalive: true });
    }
  };

  private handleBeforeUnload = (): void => {
    if (this.isRunning) {
      void this.flush('beforeunload', { force: true, statusOverride: 'interrupted', keepalive: true });
    }
  };

  private attachLifecycleListeners(): void {
    if (this.listenersAttached) return;
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', this.handlePageHide);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
    this.listenersAttached = true;
  }

  private detachLifecycleListeners(): void {
    if (!this.listenersAttached) return;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', this.handlePageHide);
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }
    this.listenersAttached = false;
  }
}

/**
 * Extracts recoverable task state from an unfinished Firestore/local checkpoint
 * after an unexpected browser tab close or crash.
 */
export function extractRecoveredTaskState(
  checkpoint: TaskCheckpoint | null | undefined
): RecoveredTaskState | null {
  if (!checkpoint || !checkpoint.taskId) return null;
  if (!taskCheckpoint.verifyCheckpointIntegrity(checkpoint)) return null;
  if (checkpoint.status === 'completed') return null;

  const snap = checkpoint.stateSnapshot || {};
  const rawSteps = Array.isArray(snap.steps) ? snap.steps : [];
  const steps: ActiveTaskStepSnapshot[] = rawSteps
    .filter((s: any) => s && typeof s.label === 'string')
    .map((s: any, idx: number) => ({
      id: String(s.id ?? idx + 1),
      label: String(s.label),
      status: s.status === 'running' ? 'completed' : (s.status || 'completed'),
      trace: Array.isArray(s.trace) ? s.trace.map(String) : [],
    }));

  const partialContent = typeof checkpoint.accumulatedResult === 'string'
    ? checkpoint.accumulatedResult.trim()
    : '';

  if (!partialContent && steps.length === 0 && !snap.prompt) {
    return null;
  }

  return {
    checkpoint,
    steps,
    partialContent,
    prompt: typeof snap.prompt === 'string' && snap.prompt.trim() ? snap.prompt : undefined,
    title: typeof snap.title === 'string' && snap.title.trim() ? snap.title : undefined,
    outputFormat: typeof snap.outputFormat === 'string' && snap.outputFormat ? snap.outputFormat : undefined,
    chartType: typeof snap.chartType === 'string' && snap.chartType ? snap.chartType : undefined,
    mode: snap.mode === 'work' ? 'work' : snap.mode === 'chat' ? 'chat' : undefined,
    assistantMessageId:
      typeof snap.assistantMessageId === 'string' && snap.assistantMessageId
        ? snap.assistantMessageId
        : undefined,
    savedAt: String(snap.savedAt || checkpoint.timestamp || new Date().toISOString()),
  };
}
