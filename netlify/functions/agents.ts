/**
 * Netlify function: autonomous multi-agent runtime (Feature 03).
 *
 * Authenticated router in front of the agent runtime. Identities come only
 * from the verified Firebase bearer token; worker callbacks below authenticate
 * with the shared dispatch secret (Feature 01 integration). Every mutating
 * action passes the durable permission gateway (Feature 02). Run records are
 * durable (Firestore 'agentRuns') with an honest non-durable fallback flag.
 */

import crypto from 'crypto';
import { verifyBearerToken } from '../../src/middleware/auth';
import { permissionsGateway } from '../../server/permissionsGateway';
import { resolveAgentStore } from '../../server/agents/agentStore';
import { AgentRuntimeService, validatePlan } from '../../server/agents/agentRuntime';
import { resolveModelProvider } from '../../server/agents/modelProvider';
import { enqueueTask, describeDispatch } from '../../server/tasks/taskQueue';
import type { SubtaskSpec } from '../../server/agents/types';

/* Feature 02 integration: agent runtime actions are registered gateway policies. */
const AGENT_POLICIES = [
  { toolName: 'agent_run_create', displayName: 'Create Agent Run', category: 'system' as const, riskLevel: 'privileged' as const, description: 'Creates and schedules an autonomous multi-agent run.', consequences: ['Spawns model-backed sub-agents that consume tokens.'] },
  { toolName: 'agent_run_execute', displayName: 'Execute Agent Run', category: 'system' as const, riskLevel: 'privileged' as const, description: 'Executes a multi-agent run through real model providers.', consequences: ['Runs autonomous agents; consumes provider tokens.'] },
  { toolName: 'agent_run_cancel', displayName: 'Cancel Agent Run', category: 'system' as const, riskLevel: 'sensitive' as const, description: 'Cancels a running multi-agent run.', consequences: ['In-flight agent work is stopped.'] },
];
for (const p of AGENT_POLICIES) {
  permissionsGateway.registerPolicy({ ...p, requiresConfirmation: true });
}

const jsonResponse = (data: unknown, status = 200, requestId = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': requestId,
    },
  });

const MAX_BODY_BYTES = 512 * 1024;

async function parseBody(req: Request): Promise<{ body?: Record<string, unknown>; response?: Response }> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds the limit.' }, 413) };
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { response: jsonResponse({ ok: false, code: 'INVALID_PAYLOAD', error: 'Expected a JSON object.' }, 400) };
    }
    return { body: body as Record<string, unknown> };
  } catch {
    return { response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON payload.' }, 400) };
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function mapError(err: any): { status: number; body: Record<string, unknown> } {
  const status = Number(err?.status) || 500;
  const code = String(err?.code || 'INTERNAL_ERROR');
  if (status >= 400 && status < 500) {
    return { status, body: { ok: false, code, error: String(err?.message || 'Request failed.'), ...(err?.challenge ? { challenge: err.challenge } : {}) } };
  }
  return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', error: 'Unexpected error in the agent runtime.' } };
}

async function buildRuntime(): Promise<AgentRuntimeService> {
  const store = await resolveAgentStore();
  return new AgentRuntimeService(store);
}

function str(value: unknown, name: string, min = 1, max = 512): string {
  const out = typeof value === 'string' ? value.trim() : '';
  if (out.length < min || out.length > max) {
    throw Object.assign(new Error(name + ' must be between ' + min + ' and ' + max + ' characters.'), { code: 'INVALID_ARGUMENTS', status: 400 });
  }
  return out;
}

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Use GET for reads or POST with an action.' }, 405, requestId);
  }

  /* ---------- Worker callback path (Feature 01 dispatch) ---------- */
  const workerSecret = req.headers.get('x-dispatch-secret');
  if (workerSecret !== null) {
    const expected = (process.env.INFRA_DISPATCH_SECRET || '').trim();
    if (!expected) {
      return jsonResponse({ ok: false, code: 'SECRET_NOT_CONFIGURED', error: 'Dispatch secret is not configured; worker callbacks fail closed.' }, 503, requestId);
    }
    if (!timingSafeEqualStr(workerSecret, expected)) {
      return jsonResponse({ ok: false, code: 'UNAUTHENTICATED_WORKER', error: 'Invalid dispatch secret.' }, 401, requestId);
    }
    const parsed = await parseBody(req);
    if (parsed.response) return parsed.response;
    const body = parsed.body as Record<string, unknown>;
    const workerAction = String(body.action || '');
    if (!['execute-run', 'create-run'].includes(workerAction)) {
      return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Workers may only create or execute runs.' }, 400, requestId);
    }
    try {
      const runtime = await buildRuntime();
      const userIdForRun = str(body.userId, 'userId', 1, 128);
      // 'create-run' is used by the Feature 05 scheduler for agents_run targets:
      // the schedule's creation was already permission-gated (scheduler_manage),
      // so the worker may initiate this run; the audit below records it.
      let record;
      if (workerAction === 'create-run') {
        const objective = str(body.objective, 'objective', 1, 4000);
        const created = await runtime.createRun(userIdForRun, objective);
        record = await runtime.executeRun(userIdForRun, created.runId);
      } else {
        record = await runtime.executeRun(userIdForRun, str(body.runId, 'runId', 4, 80));
      }
      await permissionsGateway.recordAuditEvent({
        userId: record.userId,
        category: 'tool_execution',
        toolName: 'agent_run_execute',
        status: record.status === 'completed' ? 'allowed' : 'denied',
        reason: 'Worker executed agent run ' + record.runId + ' with status ' + record.status,
        target: record.runId,
      }).catch(() => {});
      return jsonResponse({ ok: record.status === 'completed', run: record }, 200, requestId);
    } catch (err: any) {
      const mapped = mapError(err);
      return jsonResponse(mapped.body, mapped.status, requestId);
    }
  }

  /* ---------- Authenticated user path ---------- */
  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401, requestId);
  }
  const userId = decoded.uid;

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action') || '';
      const runtime = await buildRuntime();
      if (action === 'get-run') {
        const run = await runtime.getRun(userId, url.searchParams.get('runId') || '');
        if (!run) return jsonResponse({ ok: false, code: 'RUN_NOT_FOUND', error: 'Agent run not found for this user.' }, 404, requestId);
        return jsonResponse({ ok: true, run }, 200, requestId);
      }
      if (action === 'list-runs') {
        const status = url.searchParams.get('status') || undefined;
        const limit = Number(url.searchParams.get('limit') || 50);
        const runs = await runtime.listRuns(userId, { status, limit: Number.isFinite(limit) ? limit : 50 });
        return jsonResponse({ ok: true, runs }, 200, requestId);
      }
      if (action === 'provider-health') {
        const resolved = resolveModelProvider();
        const store = await resolveAgentStore();
        return jsonResponse({
          ok: true,
          modelProvider: { available: resolved.available, reason: resolved.reason, providerId: resolved.config?.provider, modelId: resolved.config?.modelId },
          storeDurable: store.durable,
        }, 200, requestId);
      }
      return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
    }

    const parsed = await parseBody(req);
    if (parsed.response) return parsed.response;
    const body = parsed.body as Record<string, unknown>;
    const action = String(body.action || '');
    const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken.slice(0, 2048) : undefined;

    if (action === 'create-run') {
      const objective = str(body.objective, 'objective', 1, 4000);
      const subtasks = Array.isArray(body.subtasks) && body.subtasks.length > 0
        ? (body.subtasks as SubtaskSpec[])
        : undefined;
      if (subtasks) {
        const validation = validatePlan(subtasks);
        if (!validation.valid) {
          return jsonResponse({ ok: false, code: 'INVALID_PLAN', error: validation.error }, 400, requestId);
        }
      }
      const decision = await permissionsGateway.evaluateAction({
        toolName: 'agent_run_create',
        args: { objective, subtaskCount: subtasks ? subtasks.length : 0 },
        userId,
        approvalToken,
      });
      if (!decision.allowed) {
        return jsonResponse({ ok: false, code: decision.requiresApproval ? 'APPROVAL_REQUIRED' : 'PERMISSION_DENIED', error: decision.reason, ...(decision.challenge ? { challenge: decision.challenge } : {}) }, 403, requestId);
      }

      const runtime = await buildRuntime();
      const budgets = body.budgets && typeof body.budgets === 'object' ? body.budgets as Record<string, number> : undefined;
      const run = await runtime.createRun(userId, objective, subtasks, {
        taskId: typeof body.taskId === 'string' ? body.taskId.slice(0, 80) : undefined,
        budgets: budgets ? { maxTokens: Number(budgets.maxTokens), timeoutSeconds: Number(budgets.timeoutSeconds) } : undefined,
      });

      const mode = String(body.execute || 'dispatch');
      if (mode === 'sync') {
        const executed = await runtime.executeRun(userId, run.runId);
        return jsonResponse({ ok: executed.status === 'completed', run: executed }, executed.status === 'completed' ? 200 : 422, requestId);
      }
      if (mode === 'dispatch') {
        let enqueued = null as unknown;
        try {
          const result = await enqueueTask({
            userId,
            type: 'agents.execute_run',
            payload: { runId: run.runId, userId },
            idempotencyKey: 'agent-run-' + run.runId,
            timeoutSeconds: 900,
            maxAttempts: 3,
          });
          enqueued = { taskId: result.task.id, idempotent: result.idempotent, ...describeDispatch(result.dispatch) };
        } catch (err: any) {
          enqueued = { enqueued: false, execution: 'blocked_worker_unavailable', reason: String(err?.message || 'enqueue failed') };
        }
        return jsonResponse({ ok: true, run, dispatch: enqueued }, 202, requestId);
      }
      return jsonResponse({
        ok: true,
        run,
        nextStep: 'Run is queued. Call execute-run with approval, or dispatch it through the durable task queue.',
      }, 202, requestId);
    }

    if (action === 'execute-run') {
      const runId = str(body.runId, 'runId', 4, 80);
      const decision = await permissionsGateway.evaluateAction({
        toolName: 'agent_run_execute',
        args: { runId },
        userId,
        approvalToken,
      });
      if (!decision.allowed) {
        return jsonResponse({ ok: false, code: decision.requiresApproval ? 'APPROVAL_REQUIRED' : 'PERMISSION_DENIED', error: decision.reason, ...(decision.challenge ? { challenge: decision.challenge } : {}) }, 403, requestId);
      }
      const runtime = await buildRuntime();
      const run = await runtime.executeRun(userId, runId);
      return jsonResponse({ ok: run.status === 'completed', run }, run.status === 'completed' ? 200 : 422, requestId);
    }

    if (action === 'cancel-run') {
      const runId = str(body.runId, 'runId', 4, 80);
      const decision = await permissionsGateway.evaluateAction({
        toolName: 'agent_run_cancel',
        args: { runId },
        userId,
        approvalToken,
      });
      if (!decision.allowed) {
        return jsonResponse({ ok: false, code: decision.requiresApproval ? 'APPROVAL_REQUIRED' : 'PERMISSION_DENIED', error: decision.reason, ...(decision.challenge ? { challenge: decision.challenge } : {}) }, 403, requestId);
      }
      const runtime = await buildRuntime();
      const run = await runtime.cancelRun(userId, runId);
      if (!run) return jsonResponse({ ok: false, code: 'RUN_NOT_FOUND', error: 'Agent run not found for this user.' }, 404, requestId);
      return jsonResponse({ ok: true, run }, 200, requestId);
    }

    return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
  } catch (err: any) {
    const mapped = mapError(err);
    return jsonResponse(mapped.body, mapped.status, requestId);
  }
};
