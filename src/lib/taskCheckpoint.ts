/**
 * Task Checkpoints and Recovery Manager for Manus AI
 * 
 * Persists intermediate execution states, completed tool calls,
 * and allows resuming interrupted agent tasks from the last verified checkpoint
 * across session refreshes and service interruptions by revalidating state.
 */

import { observability } from './observability';
import { db, auth } from './firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  conversationId: string;
  userId?: string;
  stepIndex: number;
  totalSteps?: number;
  stepLabel: string;
  status?: 'in_progress' | 'completed' | 'interrupted' | 'failed';
  completedToolCalls: Array<{ toolName: string; args: any; outputSummary: string; executedAt?: string }>;
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

const STORAGE_KEY_PREFIX = 'manus_checkpoint_';

export class TaskCheckpointService {
  private memoryCache = new Map<string, TaskCheckpoint>();

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
   * Save a verified step checkpoint across memory, browser storage, server and Firestore
   */
  public saveCheckpoint(params: {
    taskId: string;
    conversationId: string;
    userId?: string;
    stepIndex: number;
    totalSteps?: number;
    stepLabel: string;
    status?: 'in_progress' | 'completed' | 'interrupted' | 'failed';
    completedToolCalls?: Array<{ toolName: string; args: any; outputSummary: string; executedAt?: string }>;
    accumulatedResult?: string;
    stateSnapshot?: Record<string, any>;
  }): TaskCheckpoint {
    const completedToolCalls = params.completedToolCalls || [];
    const accumulatedResult = params.accumulatedResult || '';
    const status = params.status || 'in_progress';
    const id = `chk_${params.taskId}_step_${params.stepIndex}`;

    const checksum = this.computeChecksum({
      taskId: params.taskId,
      stepIndex: params.stepIndex,
      completedToolCallsCount: completedToolCalls.length,
      accumulatedResultLength: accumulatedResult.length,
      status,
    });

    const checkpoint: TaskCheckpoint = {
      id,
      taskId: params.taskId,
      conversationId: params.conversationId,
      userId: params.userId || auth?.currentUser?.uid || 'usr_manus_default',
      stepIndex: params.stepIndex,
      totalSteps: params.totalSteps || 5,
      stepLabel: params.stepLabel,
      status,
      completedToolCalls,
      accumulatedResult,
      stateSnapshot: params.stateSnapshot,
      checksum,
      timestamp: new Date().toISOString(),
    };

    // 1. Sync memory cache
    this.memoryCache.set(params.taskId, checkpoint);

    // 2. Sync browser localStorage for instant recovery across page refreshes
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${params.taskId}`, JSON.stringify(checkpoint));
      } catch {}
    }

    // 3. Sync to server-side durable checkpoint store (non-blocking)
    if (typeof fetch !== 'undefined') {
      fetch('/api/checkpoints/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkpoint),
      }).catch(() => {});
    }

    // 4. Sync to Firestore if authenticated user exists
    const currentUid = auth?.currentUser?.uid;
    if (currentUid && db) {
      const docRef = doc(db, 'users', currentUid, 'checkpoints', params.taskId);
      setDoc(docRef, checkpoint, { merge: true }).catch((err) => {
        console.warn('[TaskCheckpoint] Firestore sync notice:', err);
      });
    }

    observability.log({
      level: 'info',
      category: 'recovery',
      message: `Saved durable checkpoint for task ${params.taskId} at step ${params.stepIndex} (${params.stepLabel}) [${checksum}]`,
    });

    return checkpoint;
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
   * Asynchronously fetch checkpoint from Firestore or server if not present in memory
   */
  public async fetchDurableCheckpoint(taskId: string): Promise<TaskCheckpoint | null> {
    const local = this.getLatestCheckpoint(taskId);
    if (local) return local;

    // Check Firestore
    const currentUid = auth?.currentUser?.uid;
    if (currentUid && db) {
      try {
        const docRef = doc(db, 'users', currentUid, 'checkpoints', taskId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data() as TaskCheckpoint;
          this.memoryCache.set(taskId, data);
          return data;
        }
      } catch {}
    }

    // Check Server API
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch(`/api/checkpoints/${encodeURIComponent(taskId)}`);
        if (res.ok) {
          const payload = await res.json();
          if (payload.checkpoint) {
            this.memoryCache.set(taskId, payload.checkpoint);
            return payload.checkpoint;
          }
        }
      } catch {}
    }

    return null;
  }

  /**
   * Revalidate checkpoint state and determine resumption feasibility
   * Ensures data integrity, prevents re-execution of completed steps, and reconstructs execution state.
   */
  public revalidateAndResume(taskId: string, userId?: string): RevalidationResult {
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
    const expectedChecksum = this.computeChecksum({
      taskId: cp.taskId,
      stepIndex: cp.stepIndex,
      completedToolCallsCount: (cp.completedToolCalls || []).length,
      accumulatedResultLength: (cp.accumulatedResult || '').length,
      status: cp.status,
    });

    if (cp.checksum !== expectedChecksum) {
      observability.log({
        level: 'warning',
        category: 'recovery',
        message: `Checkpoint checksum mismatch for task ${taskId}: expected ${expectedChecksum}, got ${cp.checksum}`,
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
   * Mark task as completed and cleanly update or remove checkpoint
   */
  public markTaskCompleted(taskId: string): void {
    const cp = this.getLatestCheckpoint(taskId);
    if (cp) {
      cp.status = 'completed';
      this.saveCheckpoint(cp);
    }
  }

  /**
   * Clear checkpoint after task cleanly finishes
   */
  public clearCheckpoint(taskId: string): void {
    this.memoryCache.delete(taskId);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}${taskId}`);
      } catch {}
    }

    const currentUid = auth?.currentUser?.uid;
    if (currentUid && db) {
      const docRef = doc(db, 'users', currentUid, 'checkpoints', taskId);
      deleteDoc(docRef).catch(() => {});
    }

    if (typeof fetch !== 'undefined') {
      fetch(`/api/checkpoints/${encodeURIComponent(taskId)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

export const taskCheckpoint = new TaskCheckpointService();
