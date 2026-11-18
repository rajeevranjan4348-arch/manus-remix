import crypto from 'crypto';
import { verifyBearerToken } from '../../src/middleware/auth';

export interface ServerCheckpointData {
  id: string;
  taskId: string;
  conversationId: string;
  userId: string;
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  status: 'in_progress' | 'completed' | 'interrupted' | 'failed';
  completedToolCalls: Array<{ toolName: string; args: Record<string, unknown>; outputSummary: string; executedAt?: string }>;
  accumulatedResult: string;
  stateSnapshot?: Record<string, unknown>;
  checksum: string;
  timestamp: string;
  resumedAt?: string;
}

// Serverless memory is only a best-effort cache; Firestore remains the durable client store.
// The key is always derived from verified identity, never from a caller-supplied user ID.
const checkpointStore = new Map<string, ServerCheckpointData>();
const statuses = ['in_progress', 'completed', 'interrupted', 'failed'] as const;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);

const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  },
});

function calculateChecksum(cp: Partial<ServerCheckpointData>): string {
  const content = `${cp.taskId}:${cp.stepIndex}:${(cp.completedToolCalls || []).length}:${(cp.accumulatedResult || '').length}:${cp.status}`;
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
}

function storeKey(userId: string, taskId: string): string {
  return `${userId}:${taskId}`;
}

async function parseBody(req: Request): Promise<{ body?: any; response?: Response }> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
    return { response: jsonResponse({ error: 'Payload exceeds the 1MB limit.', code: 'PAYLOAD_TOO_LARGE' }, 413) };
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { response: jsonResponse({ error: 'Expected a JSON object.', code: 'INVALID_PAYLOAD' }, 400) };
    }
    return { body };
  } catch {
    return { response: jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400) };
  }
}

function hasValidToolCalls(value: unknown): value is ServerCheckpointData['completedToolCalls'] {
  return Array.isArray(value) && value.length <= 50 && value.every((call) =>
    Boolean(call) && typeof call === 'object' && !Array.isArray(call) &&
    typeof call.toolName === 'string' && call.toolName.trim().length > 0 && call.toolName.length <= 100 &&
    call.args !== null && typeof call.args === 'object' && !Array.isArray(call.args) &&
    typeof call.outputSummary === 'string' && call.outputSummary.length <= 5000 &&
    (call.executedAt === undefined || (typeof call.executedAt === 'string' && call.executedAt.length <= 64))
  );
}

export default async (req: Request) => {
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401);
  }
  const userId = decodedToken.uid;
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/checkpoints/, '').replace(/^\/api\/checkpoints/, '');

  // POST /save: Save or update the authenticated user's checkpoint.
  if (req.method === 'POST' && (path === '/save' || path === '' || path === '/')) {
    const parsed = await parseBody(req);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (body.userId !== undefined && body.userId !== userId) {
      return jsonResponse({ error: 'Checkpoint owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
    }
    if (!validId(body.taskId) || typeof body.stepIndex !== 'number' || !Number.isInteger(body.stepIndex) || body.stepIndex < 0 || body.stepIndex > 10000) {
      return jsonResponse({ error: 'A valid taskId and non-negative integer stepIndex are required.', code: 'INVALID_CHECKPOINT' }, 400);
    }
    const taskId = body.taskId;
    const conversationId = body.conversationId === undefined ? 'default' : body.conversationId;
    if (!validId(conversationId)) {
      return jsonResponse({ error: 'conversationId must be a valid ID.', code: 'INVALID_CHECKPOINT' }, 400);
    }
    const totalSteps = body.totalSteps === undefined ? 5 : body.totalSteps;
    if (!Number.isInteger(totalSteps) || totalSteps < 1 || totalSteps > 10000 || body.stepIndex > totalSteps) {
      return jsonResponse({ error: 'totalSteps must be between 1 and 10000 and not less than stepIndex.', code: 'INVALID_CHECKPOINT' }, 400);
    }
    const status = body.status === undefined ? 'in_progress' : body.status;
    if (!statuses.includes(status)) {
      return jsonResponse({ error: 'Invalid checkpoint status.', code: 'INVALID_CHECKPOINT' }, 400);
    }
    if (body.completedToolCalls !== undefined && !hasValidToolCalls(body.completedToolCalls)) {
      return jsonResponse({ error: 'completedToolCalls contains invalid or oversized entries.', code: 'INVALID_CHECKPOINT' }, 400);
    }
    if (body.accumulatedResult !== undefined && (typeof body.accumulatedResult !== 'string' || body.accumulatedResult.length > 500000)) {
      return jsonResponse({ error: 'accumulatedResult must be a string under 500,000 characters.', code: 'INVALID_CHECKPOINT' }, 400);
    }
    if (body.stepLabel !== undefined && (typeof body.stepLabel !== 'string' || body.stepLabel.length > 300)) {
      return jsonResponse({ error: 'stepLabel must be a string under 300 characters.', code: 'INVALID_CHECKPOINT' }, 400);
    }
    const stateSnapshot = body.stateSnapshot === undefined ? {} : body.stateSnapshot;
    if (!stateSnapshot || typeof stateSnapshot !== 'object' || Array.isArray(stateSnapshot) || JSON.stringify(stateSnapshot).length > 100000) {
      return jsonResponse({ error: 'stateSnapshot must be an object under 100KB.', code: 'INVALID_CHECKPOINT' }, 400);
    }

    const key = storeKey(userId, taskId);
    const existing = checkpointStore.get(key);
    if (existing?.status === 'completed' && status !== 'completed') {
      return jsonResponse({ error: 'A completed checkpoint cannot be reopened.', code: 'TERMINAL_STATE' }, 409);
    }
    if (existing && body.stepIndex < existing.stepIndex) {
      return jsonResponse({ error: 'A checkpoint cannot move to an earlier step.', code: 'STALE_CHECKPOINT' }, 409);
    }

    const completedToolCalls = body.completedToolCalls || [];
    const accumulatedResult = body.accumulatedResult || '';
    const checkpoint: ServerCheckpointData = {
      id: `chk_${taskId}`,
      taskId,
      conversationId,
      userId,
      stepIndex: body.stepIndex,
      totalSteps,
      stepLabel: body.stepLabel || `Step ${body.stepIndex}`,
      status,
      completedToolCalls,
      accumulatedResult,
      stateSnapshot,
      checksum: calculateChecksum({ taskId, stepIndex: body.stepIndex, completedToolCalls, accumulatedResult, status }),
      timestamp: new Date().toISOString(),
    };
    checkpointStore.set(key, checkpoint);
    return jsonResponse({ success: true, checkpoint });
  }

  // GET /:taskId or GET /?taskId=...: only look up records scoped to the verified user.
  if (req.method === 'GET') {
    const taskId = url.searchParams.get('taskId') || path.replace(/^\//, '').split('/')[0];
    if (!validId(taskId)) {
      return jsonResponse({ error: 'A valid taskId is required.', code: 'MISSING_TASK_ID' }, 400);
    }
    const cp = checkpointStore.get(storeKey(userId, taskId));
    if (!cp) return jsonResponse({ exists: false, checkpoint: null });
    const isValid = cp.checksum === calculateChecksum(cp);
    return jsonResponse({ exists: true, isValid, checkpoint: cp });
  }

  // POST /revalidate: Revalidate only a checkpoint owned by the authenticated user.
  if (req.method === 'POST' && path === '/revalidate') {
    const parsed = await parseBody(req);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (body.userId !== undefined && body.userId !== userId) {
      return jsonResponse({ error: 'Checkpoint owner does not match the authenticated user.', code: 'FORBIDDEN' }, 403);
    }
    const taskId = body.taskId;
    if (!validId(taskId)) return jsonResponse({ error: 'A valid taskId is required.', code: 'MISSING_TASK_ID' }, 400);
    const key = storeKey(userId, taskId);
    const cp = checkpointStore.get(key);
    if (!cp) return jsonResponse({ canResume: false, reason: 'No saved checkpoint found for this task ID.', checkpoint: null });
    if (cp.checksum !== calculateChecksum(cp)) {
      return jsonResponse({ canResume: false, reason: 'Checkpoint integrity verification failed.', checkpoint: null });
    }
    if (cp.status === 'completed') {
      return jsonResponse({ canResume: false, reason: 'Task is already fully completed.', checkpoint: cp });
    }
    const nextStepIndex = cp.stepIndex + 1;
    cp.resumedAt = new Date().toISOString();
    checkpointStore.set(key, cp);
    return jsonResponse({ canResume: true, reason: `Checkpoint revalidated successfully. Ready to resume at step ${nextStepIndex} of ${cp.totalSteps}.`, nextStepIndex, checkpoint: cp });
  }

  // DELETE /:taskId: deletion is limited to the authenticated user's own checkpoint.
  if (req.method === 'DELETE') {
    const taskId = url.searchParams.get('taskId') || path.replace(/^\//, '').split('/')[0];
    if (!validId(taskId)) return jsonResponse({ error: 'A valid taskId is required.', code: 'MISSING_TASK_ID' }, 400);
    checkpointStore.delete(storeKey(userId, taskId));
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'Route not found.', code: 'NOT_FOUND' }, 404);
};
