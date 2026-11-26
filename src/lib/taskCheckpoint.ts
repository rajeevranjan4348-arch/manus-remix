/**
 * Task Checkpoints and Recovery Manager for Deku AI
 *
 * Persists intermediate execution states, completed tool calls,
 * and allows resuming interrupted agent tasks from the last verified checkpoint
 * across session refreshes, unexpected tab closes, and service interruptions.
 */

import { observability } from './observability';
import { db, auth, OperationType, type FirestoreErrorInfo } from './firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

export type CheckpointStatus = 'in_progress' | 'completed' | 'interrupted' | 'failed';

export interface CompletedToolCallRecord {
  toolName: string;
  args: any;
  outputSummary: string;
  executedAt?: string;
}

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  conversationId: string;
  userId?: string;
  stepIndex: number;
  totalSteps?: number;
  stepLabel: string;
  status?: CheckpointStatus;
  completedToolCalls: CompletedToolCallRecord[];
  accumulatedResult: string;
  stateSnapshot?: Record<string, any>;
  checksum: string;
  timestamp: string;
  resumedAt?: string;
}

export interface RevalidationResult {
  canResume: boolean;
  reason: string;
  checkpoint: TaskCheckpoint | null;
  nextStepIndex: number;
  restoredContext?: string;
}

export interface SaveCheckpointParams {
  taskId: string;
  conversationId: string;
  userId?: string;
  stepIndex: number;
  totalSteps?: number;
  stepLabel: string;
  status?: CheckpointStatus;
  completedToolCalls?: CompletedToolCallRecord[];
  accumulatedResult?: string;
  stateSnapshot?: Record<string, any>;
  resumedAt?: string;
  /**
   * When true, uses `fetch(..., { keepalive: true })` with a cached ID token
   * so the checkpoint flush can survive unexpected tab closes (`pagehide`/`beforeunload`).
   */
  keepalive?: boolean;
  /**
   * When true, skips the server HTTP checkpoint mirror and only syncs local + Firestore.
   */
  firestoreOnly?: boolean;
}

export interface SaveCheckpointResult {
  checkpoint: TaskCheckpoint;
  syncedToFirestore: boolean;
  skippedReason?: string;
  quotaExceeded?: boolean;
}

const STORAGE_KEY_PREFIX = 'manus_checkpoint_';
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const MAX_ID_LENGTH = 128;
const MAX_STEP_LABEL_LENGTH = 256;
const MAX_ACCUMULATED_RESULT_LENGTH = 480_000; // Safe margin under 500,000 rule limit
const MAX_TOOL_CALLS = 100;
const MAX_SNAPSHOT_KEYS = 100;
const MAX_CHECKSUM_LENGTH = 128;
const MAX_TIMESTAMP_LENGTH = 64;

function isValidFirestoreId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    VALID_ID_REGEX.test(value)
  );
}

function getAuthenticatedFirestoreUser() {
  const currentUser = auth?.currentUser;
  if (
    !currentUser ||
    currentUser.isAnonymous ||
    !currentUser.uid ||
    String(currentUser.uid).startsWith('guest-') ||
    !isValidFirestoreId(currentUser.uid)
  ) {
    return null;
  }
  return currentUser;
}

function stripUndefinedDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => stripUndefinedDeep(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_SNAPSHOT_KEYS);
    for (const [key, val] of entries) {
      if (!key || val === undefined) continue;
      const cleaned = stripUndefinedDeep(val, depth + 1);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
    return out;
  }
  return String(value);
}

function sanitizeToolCalls(calls?: CompletedToolCallRecord[]): CompletedToolCallRecord[] {
  if (!Array.isArray(calls) || calls.length === 0) return [];
  return calls.slice(-MAX_TOOL_CALLS).map((call) => {
    const sanitized: CompletedToolCallRecord = {
      toolName: String(call?.toolName || 'tool').slice(0, 128),
      args: stripUndefinedDeep(call?.args ?? {}) ?? {},
      outputSummary: String(call?.outputSummary || '').slice(0, 2000),
    };
    if (call?.executedAt) {
      sanitized.executedAt = String(call.executedAt).slice(0, MAX_TIMESTAMP_LENGTH);
    }
    return sanitized;
  });
}

function sanitizeStateSnapshot(snapshot?: Record<string, any>): Record<string, any> | undefined {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return undefined;
  }
  const cleaned = stripUndefinedDeep(snapshot, 0) as Record<string, any> | undefined;
  if (!cleaned || Object.keys(cleaned).length === 0) {
    return undefined;
  }
  // Enforce <= 100 keys for firestore.rules isValidCheckpoint
  const keys = Object.keys(cleaned);
  if (keys.length <= MAX_SNAPSHOT_KEYS) {
    return cleaned;
  }
  const bounded: Record<string, any> = {};
  for (const key of keys.slice(0, MAX_SNAPSHOT_KEYS)) {
    bounded[key] = cleaned[key];
  }
  return bounded;
}

function clampInt(value: unknown, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(0, Math.min(100_000, num));
}

function logStructuredFirestoreError(error: unknown, operationType: OperationType, path: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code || '';
  const isPermissionError =
    code === 'permission-denied' ||
    message.toLowerCase().includes('missing or insufficient permissions') ||
    message.toLowerCase().includes('permission-denied');

  if (isPermissionError) {
    const errInfo: FirestoreErrorInfo = {
      error: message,
      authInfo: {
        userId: auth?.currentUser?.uid,
        email: auth?.currentUser?.email,
        emailVerified: auth?.currentUser?.emailVerified,
        isAnonymous: auth?.currentUser?.isAnonymous,
        tenantId: auth?.currentUser?.tenantId,
        providerInfo:
          auth?.currentUser?.providerData?.map((provider) => ({
            providerId: provider.providerId,
            email: provider.email,
          })) || [],
      },
      operationType,
      path,
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  } else {
    console.warn(`[TaskCheckpoint] Firestore ${operationType} notice (${path}):`, message);
  }
}

export class TaskCheckpointService {
  private memoryCache = new Map<string, TaskCheckpoint>();
  private lastKnownRemoteStatus = new Map<string, CheckpointStatus>();
  private cachedIdToken: { uid: string; token: string; expiresAt: number } | null = null;

  /**
   * Warm and cache the current user's Firebase ID token in memory so emergency
   * `beforeunload` / `pagehide` flushes can dispatch synchronously with `keepalive: true`.
   */
  public async warmAuthToken(): Promise<void> {
    const currentUser = getAuthenticatedFirestoreUser();
    if (!currentUser) return;
    if (
      this.cachedIdToken &&
      this.cachedIdToken.uid === currentUser.uid &&
      Date.now() < this.cachedIdToken.expiresAt
    ) {
      return;
    }
    try {
      const token = await currentUser.getIdToken();
      if (token) {
        this.cachedIdToken = {
          uid: currentUser.uid,
          token,
          expiresAt: Date.now() + 25 * 60 * 1000,
        };
      }
    } catch {
      // Non-fatal: Firestore SDK manages its own auth token
    }
  }

  /**
   * Calculate a deterministic checksum for checkpoint data integrity verification
   */
  public computeChecksum(data: {
    taskId: string;
    stepIndex: number;
    completedToolCallsCount: number;
    accumulatedResultLength: number;
    status?: string;
  }): string {
    const raw = `${data.taskId}:${data.stepIndex}:${data.completedToolCallsCount}:${data.accumulatedResultLength}:${data.status || 'in_progress'}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return `chk_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Build a schema-validated, Firestore-rules-compliant TaskCheckpoint payload.
   */
  public buildSanitizedCheckpoint(params: SaveCheckpointParams): TaskCheckpoint {
    const taskId = String(params.taskId || '').trim();
    const conversationId = String(params.conversationId || taskId).trim();
    const completedToolCalls = sanitizeToolCalls(params.completedToolCalls);
    const rawAccumulated = typeof params.accumulatedResult === 'string' ? params.accumulatedResult : '';
    const accumulatedResult =
      rawAccumulated.length > MAX_ACCUMULATED_RESULT_LENGTH
        ? rawAccumulated.slice(0, MAX_ACCUMULATED_RESULT_LENGTH)
        : rawAccumulated;
    const status: CheckpointStatus =
      params.status && ['in_progress', 'completed', 'interrupted', 'failed'].includes(params.status)
        ? params.status
        : 'in_progress';

    const stepIndex = clampInt(params.stepIndex, 0);
    const totalSteps = clampInt(params.totalSteps, Math.max(stepIndex + 1, 5));
    const stepLabel = String(params.stepLabel || 'Processing task').slice(0, MAX_STEP_LABEL_LENGTH);
    // One document per task: keep its ID stable so immutable-ID rules allow step updates.
    const id = `chk_${taskId}`.slice(0, MAX_ID_LENGTH);

    const checksum = this.computeChecksum({
      taskId,
      stepIndex,
      completedToolCallsCount: completedToolCalls.length,
      accumulatedResultLength: accumulatedResult.length,
      status,
    }).slice(0, MAX_CHECKSUM_LENGTH);

    const currentUser = getAuthenticatedFirestoreUser();
    const resolvedUserId = currentUser?.uid || params.userId || 'usr_manus_default';
    const stateSnapshot = sanitizeStateSnapshot(params.stateSnapshot);

    const checkpoint: TaskCheckpoint = {
      id,
      taskId,
      conversationId,
      userId: resolvedUserId,
      stepIndex,
      totalSteps,
      stepLabel,
      status,
      completedToolCalls,
      accumulatedResult,
      checksum,
      timestamp: new Date().toISOString().slice(0, MAX_TIMESTAMP_LENGTH),
    };

    if (stateSnapshot) {
      checkpoint.stateSnapshot = stateSnapshot;
    }
    if (params.resumedAt) {
      checkpoint.resumedAt = String(params.resumedAt).slice(0, MAX_TIMESTAMP_LENGTH);
    }

    return checkpoint;
  }

  /**
   * Persist checkpoint synchronously to local tiers (memory + localStorage)
   * and trigger non-blocking sync to Firestore + server checkpoint mirror.
   */
  public saveCheckpoint(params: SaveCheckpointParams): TaskCheckpoint {
    const checkpoint = this.buildSanitizedCheckpoint(params);
    this.persistLocalCheckpoint(checkpoint);
    void this.syncCheckpointRemote(checkpoint, params);
    return checkpoint;
  }

  /**
   * Persist checkpoint locally and await the Firestore write.
   * Used by the periodic auto-save scheduler so it can track write completion,
   * handle quota backoff, and avoid overlapping concurrent Firestore writes.
   */
  public async saveCheckpointAsync(params: SaveCheckpointParams): Promise<SaveCheckpointResult> {
    const checkpoint = this.buildSanitizedCheckpoint(params);
    this.persistLocalCheckpoint(checkpoint);
    const remote = await this.syncCheckpointRemote(checkpoint, params);
    return {
      checkpoint,
      ...remote,
    };
  }

  private persistLocalCheckpoint(checkpoint: TaskCheckpoint): void {
    // 1. Sync memory cache
    this.memoryCache.set(checkpoint.taskId, checkpoint);

    // 2. Sync browser localStorage for instant recovery across page refreshes / tab crash
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${checkpoint.taskId}`, JSON.stringify(checkpoint));
      } catch {}
    }

    observability.log({
      level: 'info',
      category: 'recovery',
      message: `Saved durable checkpoint for task ${checkpoint.taskId} at step ${checkpoint.stepIndex} (${checkpoint.stepLabel}) [${checkpoint.checksum}]`,
    });
  }

  private async syncCheckpointRemote(
    checkpoint: TaskCheckpoint,
    params: SaveCheckpointParams
  ): Promise<{ syncedToFirestore: boolean; skippedReason?: string; quotaExceeded?: boolean }> {
    const currentUser = getAuthenticatedFirestoreUser();
    if (!currentUser) {
      return { syncedToFirestore: false, skippedReason: 'unauthenticated-or-guest' };
    }

    // 3. Sync to the authenticated server-side checkpoint cache (non-blocking).
    // Uses keepalive on pagehide/beforeunload so the flush can survive tab teardown.
    if (!params.firestoreOnly && typeof fetch !== 'undefined') {
      const { userId: _clientUserId, ...serverCheckpoint } = checkpoint;
      if (params.keepalive && this.cachedIdToken && this.cachedIdToken.uid === currentUser.uid) {
        try {
          void fetch('/api/checkpoints/save', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.cachedIdToken.token}`,
            },
            body: JSON.stringify(serverCheckpoint),
            keepalive: true,
          }).catch(() => {});
        } catch {}
      } else {
        void currentUser
          .getIdToken()
          .then((idToken) => {
            this.cachedIdToken = {
              uid: currentUser.uid,
              token: idToken,
              expiresAt: Date.now() + 25 * 60 * 1000,
            };
            return fetch('/api/checkpoints/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
              body: JSON.stringify(serverCheckpoint),
              ...(params.keepalive ? { keepalive: true } : {}),
            });
          })
          .catch(() => {});
      }
    }

    // 4. Sync to Firestore if authenticated user & valid IDs exist
    if (!db) {
      return { syncedToFirestore: false, skippedReason: 'firestore-unavailable' };
    }
    if (
      !isValidFirestoreId(checkpoint.taskId) ||
      !isValidFirestoreId(checkpoint.conversationId) ||
      !isValidFirestoreId(checkpoint.id)
    ) {
      return { syncedToFirestore: false, skippedReason: 'invalid-firestore-id' };
    }

    const path = `users/${currentUser.uid}/checkpoints/${checkpoint.taskId}`;
    const docRef = doc(db, 'users', currentUser.uid, 'checkpoints', checkpoint.taskId);
    const firestorePayload: TaskCheckpoint = {
      ...checkpoint,
      userId: currentUser.uid,
    };

    try {
      // Respect firestore.rules isValidCheckpointTransition():
      // If a previous turn left this checkpoint in a non-in_progress status ('completed', 'failed', 'interrupted')
      // and a new active turn starts with 'in_progress', delete the stale checkpoint doc before recreating it.
      const prevRemoteStatus = this.lastKnownRemoteStatus.get(checkpoint.taskId);
      if (
        prevRemoteStatus &&
        prevRemoteStatus !== 'in_progress' &&
        firestorePayload.status === 'in_progress'
      ) {
        try {
          await deleteDoc(docRef);
        } catch {
          // Proceed to setDoc; if it still fails, the catch block handles it
        }
      }

      await setDoc(docRef, firestorePayload);
      this.lastKnownRemoteStatus.set(checkpoint.taskId, firestorePayload.status || 'in_progress');
      return { syncedToFirestore: true };
    } catch (err) {
      const code = String((err as any)?.code || '');
      const msg = err instanceof Error ? err.message : String(err);
      const isQuotaExceeded =
        code === 'resource-exhausted' || msg.toLowerCase().includes('quota');

      // If permission-denied happened because an older terminal checkpoint existed remotely from another session
      // and we are starting a new 'in_progress' turn, try deleting the stale doc once and recreating.
      if (
        (code === 'permission-denied' || msg.toLowerCase().includes('missing or insufficient permissions')) &&
        firestorePayload.status === 'in_progress'
      ) {
        try {
          await deleteDoc(docRef);
          await setDoc(docRef, firestorePayload);
          this.lastKnownRemoteStatus.set(checkpoint.taskId, 'in_progress');
          return { syncedToFirestore: true };
        } catch (retryErr) {
          logStructuredFirestoreError(retryErr, OperationType.WRITE, path);
          return { syncedToFirestore: false, skippedReason: 'firestore-write-failed' };
        }
      }

      logStructuredFirestoreError(err, OperationType.WRITE, path);
      return {
        syncedToFirestore: false,
        skippedReason: isQuotaExceeded ? 'quota-exceeded' : 'firestore-write-failed',
        quotaExceeded: isQuotaExceeded,
      };
    }
  }

  /**
   * Verify that a checkpoint matches its integrity checksum.
   */
  public verifyCheckpointIntegrity(cp: TaskCheckpoint | null | undefined): boolean {
    if (!cp || !cp.taskId || !cp.checksum) return false;
    const expectedChecksum = this.computeChecksum({
      taskId: cp.taskId,
      stepIndex: cp.stepIndex,
      completedToolCallsCount: (cp.completedToolCalls || []).length,
      accumulatedResultLength: (cp.accumulatedResult || '').length,
      status: cp.status,
    });
    return cp.checksum === expectedChecksum;
  }

  /**
   * Retrieve latest checkpoint for a task across local tiers
   */
  public getLatestCheckpoint(taskId: string): TaskCheckpoint | null {
    if (this.memoryCache.has(taskId)) {
      return this.memoryCache.get(taskId)!;
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${taskId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.memoryCache.set(taskId, parsed);
          return parsed;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Asynchronously fetch checkpoint from Firestore or server.
   * When `preferLatest` is true, compares local and Firestore checkpoints and returns
   * whichever valid checkpoint has the newer timestamp (critical for tab-crash & cross-device recovery).
   */
  public async fetchDurableCheckpoint(
    taskId: string,
    options?: { preferLatest?: boolean }
  ): Promise<TaskCheckpoint | null> {
    const local = this.getLatestCheckpoint(taskId);
    if (local && !options?.preferLatest) return local;

    let remote: TaskCheckpoint | null = null;

    // Check Firestore first for durable cross-tab / post-crash state
    const currentUser = getAuthenticatedFirestoreUser();
    if (currentUser && db && isValidFirestoreId(taskId)) {
      const path = `users/${currentUser.uid}/checkpoints/${taskId}`;
      try {
        const docRef = doc(db, 'users', currentUser.uid, 'checkpoints', taskId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data() as TaskCheckpoint;
          if (this.verifyCheckpointIntegrity(data)) {
            remote = data;
            if (data.status) {
              this.lastKnownRemoteStatus.set(taskId, data.status);
            }
          }
        }
      } catch (err) {
        logStructuredFirestoreError(err, OperationType.GET, path);
      }
    }

    // Fallback to Server API if not found in Firestore
    if (!remote && typeof fetch !== 'undefined' && currentUser) {
      try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch(`/api/checkpoints/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (res.ok) {
          const payload = await res.json();
          if (payload.checkpoint && this.verifyCheckpointIntegrity(payload.checkpoint)) {
            remote = payload.checkpoint as TaskCheckpoint;
          }
        }
      } catch {}
    }

    const best = this.pickNewerCheckpoint(local, remote);
    if (best) {
      this.memoryCache.set(taskId, best);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`${STORAGE_KEY_PREFIX}${taskId}`, JSON.stringify(best));
        } catch {}
      }
    }
    return best;
  }

  private pickNewerCheckpoint(
    a: TaskCheckpoint | null,
    b: TaskCheckpoint | null
  ): TaskCheckpoint | null {
    const validA = a && this.verifyCheckpointIntegrity(a) ? a : null;
    const validB = b && this.verifyCheckpointIntegrity(b) ? b : null;
    if (!validA) return validB;
    if (!validB) return validA;
    const timeA = Date.parse(validA.timestamp || '') || 0;
    const timeB = Date.parse(validB.timestamp || '') || 0;
    if (timeB > timeA) return validB;
    if (timeA > timeB) return validA;
    // Tie-breaker: prefer whichever captured more accumulated output
    return (validB.accumulatedResult?.length || 0) > (validA.accumulatedResult?.length || 0)
      ? validB
      : validA;
  }

  /**
   * Revalidate checkpoint state and determine resumption feasibility
   * Ensures data integrity, prevents re-execution of completed steps, and reconstructs execution state.
   */
  public revalidateAndResume(taskId: string, _userId?: string): RevalidationResult {
    const cp = this.getLatestCheckpoint(taskId);

    if (!cp) {
      return {
        canResume: false,
        reason: 'No saved checkpoint found for this task.',
        checkpoint: null,
        nextStepIndex: 0,
      };
    }

    // Verify integrity checksum
    if (!this.verifyCheckpointIntegrity(cp)) {
      observability.log({
        level: 'warning',
        category: 'recovery',
        message: `Checkpoint checksum mismatch for task ${taskId}`,
      });
      return {
        canResume: false,
        reason: 'Checkpoint integrity check failed: task state corrupted or modified.',
        checkpoint: null,
        nextStepIndex: 0,
      };
    }

    if (cp.status === 'completed') {
      return {
        canResume: false,
        reason: 'Task has already completed successfully.',
        checkpoint: cp,
        nextStepIndex: cp.stepIndex,
        restoredContext: cp.accumulatedResult,
      };
    }

    // Advance to next step for resumption
    const nextStepIndex = cp.stepIndex + 1;
    cp.resumedAt = new Date().toISOString();
    this.memoryCache.set(taskId, cp);

    observability.log({
      level: 'info',
      category: 'recovery',
      message: `Revalidated task ${taskId}. Resuming at step ${nextStepIndex} from step '${cp.stepLabel}'.`,
    });

    return {
      canResume: true,
      reason: `Successfully revalidated state. Resuming from step ${nextStepIndex}.`,
      checkpoint: cp,
      nextStepIndex,
      restoredContext: cp.accumulatedResult,
    };
  }

  /**
   * Mark task as completed and cleanly update checkpoint
   */
  public markTaskCompleted(taskId: string): void {
    const cp = this.getLatestCheckpoint(taskId);
    if (cp) {
      this.saveCheckpoint({
        ...cp,
        status: 'completed',
      });
    }
  }

  /**
   * Clear checkpoint after task cleanly finishes
   */
  public clearCheckpoint(taskId: string): void {
    this.memoryCache.delete(taskId);
    this.lastKnownRemoteStatus.delete(taskId);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}${taskId}`);
      } catch {}
    }

    const currentUser = getAuthenticatedFirestoreUser();
    if (currentUser && db && isValidFirestoreId(taskId)) {
      const path = `users/${currentUser.uid}/checkpoints/${taskId}`;
      const docRef = doc(db, 'users', currentUser.uid, 'checkpoints', taskId);
      deleteDoc(docRef).catch((err) => {
        logStructuredFirestoreError(err, OperationType.DELETE, path);
      });
    }

    if (typeof fetch !== 'undefined' && currentUser) {
      void currentUser
        .getIdToken()
        .then((idToken) =>
          fetch(`/api/checkpoints/${encodeURIComponent(taskId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${idToken}` },
          })
        )
        .catch(() => {});
    }
  }
}

export const taskCheckpoint = new TaskCheckpointService();
