import crypto from 'crypto';

export interface ServerCheckpointData {
  id: string;
  taskId: string;
  conversationId: string;
  userId: string;
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  status: 'in_progress' | 'completed' | 'interrupted' | 'failed';
  completedToolCalls: Array<{ toolName: string; args: any; outputSummary: string; executedAt?: string }>;
  accumulatedResult: string;
  stateSnapshot?: Record<string, any>;
  checksum: string;
  timestamp: string;
  resumedAt?: string;
}

// In-memory durable checkpoint store on server runtime
const checkpointStore = new Map<string, ServerCheckpointData>();

const jsonResponse = (data: any, status = 200) => new Response(JSON.stringify(data), {
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

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/checkpoints/, '').replace(/^\/api\/checkpoints/, '');

  // 1. POST /save: Save or update durable checkpoint
  if (req.method === 'POST' && (path === '/save' || path === '' || path === '/')) {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
    }

    if (!body || typeof body.taskId !== 'string' || typeof body.stepIndex !== 'number') {
      return jsonResponse({ error: 'taskId and stepIndex are required fields.', code: 'INVALID_CHECKPOINT' }, 400);
    }

    const taskId = body.taskId.slice(0, 128);
    const stepIndex = Math.max(0, Math.floor(body.stepIndex));
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 128) : 'default';
    const userId = typeof body.userId === 'string' ? body.userId.slice(0, 128) : 'usr_default';
    const totalSteps = typeof body.totalSteps === 'number' ? Math.max(1, body.totalSteps) : 5;
    const stepLabel = typeof body.stepLabel === 'string' ? body.stepLabel.slice(0, 300) : `Step ${stepIndex}`;
    const status = ['in_progress', 'completed', 'interrupted', 'failed'].includes(body.status) ? body.status : 'in_progress';
    const completedToolCalls = Array.isArray(body.completedToolCalls) ? body.completedToolCalls.slice(0, 50) : [];
    const accumulatedResult = typeof body.accumulatedResult === 'string' ? body.accumulatedResult.slice(0, 500000) : '';
    const stateSnapshot = (body.stateSnapshot && typeof body.stateSnapshot === 'object') ? body.stateSnapshot : {};

    const checkpoint: ServerCheckpointData = {
      id: `chk_${taskId}_step_${stepIndex}`,
      taskId,
      conversationId,
      userId,
      stepIndex,
      totalSteps,
      stepLabel,
      status,
      completedToolCalls,
      accumulatedResult,
      stateSnapshot,
      checksum: calculateChecksum({ taskId, stepIndex, completedToolCalls, accumulatedResult, status }),
      timestamp: new Date().toISOString(),
    };

    checkpointStore.set(taskId, checkpoint);

    return jsonResponse({
      success: true,
      checkpoint,
    });
  }

  // 2. GET /:taskId or GET /get?taskId=...
  if (req.method === 'GET') {
    const taskId = url.searchParams.get('taskId') || path.replace(/^\//, '').split('/')[0];
    if (!taskId) {
      return jsonResponse({ error: 'taskId is required.', code: 'MISSING_TASK_ID' }, 400);
    }

    const cp = checkpointStore.get(taskId);
    if (!cp) {
      return jsonResponse({ exists: false, checkpoint: null });
    }

    // Verify integrity
    const expectedChecksum = calculateChecksum(cp);
    const isValid = cp.checksum === expectedChecksum;

    return jsonResponse({
      exists: true,
      isValid,
      checkpoint: cp,
    });
  }

  // 3. POST /revalidate: Revalidate checkpoint state and determine resume feasibility
  if (req.method === 'POST' && path === '/revalidate') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Malformed JSON payload.', code: 'BAD_REQUEST' }, 400);
    }

    const taskId = typeof body?.taskId === 'string' ? body.taskId.slice(0, 128) : '';
    if (!taskId) {
      return jsonResponse({ error: 'taskId string is required.', code: 'MISSING_TASK_ID' }, 400);
    }

    const cp = checkpointStore.get(taskId);
    if (!cp) {
      return jsonResponse({
        canResume: false,
        reason: 'No saved checkpoint found for this task ID.',
        checkpoint: null,
      });
    }

    const expectedChecksum = calculateChecksum(cp);
    if (cp.checksum !== expectedChecksum) {
      return jsonResponse({
        canResume: false,
        reason: 'Checkpoint integrity verification failed (tampering or state corruption detected).',
        checkpoint: null,
      });
    }

    if (cp.status === 'completed') {
      return jsonResponse({
        canResume: false,
        reason: 'Task is already fully completed.',
        checkpoint: cp,
      });
    }

    const nextStepIndex = cp.stepIndex + 1;
    cp.resumedAt = new Date().toISOString();
    checkpointStore.set(taskId, cp);

    return jsonResponse({
      canResume: true,
      reason: `Checkpoint revalidated successfully. Ready to resume at step ${nextStepIndex} of ${cp.totalSteps}.`,
      nextStepIndex,
      checkpoint: cp,
    });
  }

  // 4. DELETE /:taskId or DELETE /delete?taskId=...
  if (req.method === 'DELETE') {
    const taskId = url.searchParams.get('taskId') || path.replace(/^\//, '').split('/')[0];
    if (!taskId) {
      return jsonResponse({ error: 'taskId is required.', code: 'MISSING_TASK_ID' }, 400);
    }

    checkpointStore.delete(taskId);
    return jsonResponse({ success: true, message: `Checkpoint for task ${taskId} removed.` });
  }

  return jsonResponse({ error: 'Route not found.', code: 'NOT_FOUND' }, 404);
};
