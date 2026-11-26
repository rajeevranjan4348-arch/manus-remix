/**
 * Feature 03 API: real provider-backed multi-agent runtime.
 *
 * Bounded inline execution with strict budgets (used when the request size
 * stays within serverless limits), alternatively persisted as a durable task
 * (Feature 01) when a worker is configured. Either way, results come from
 * actual provider calls with real usage metadata — never fabricated.
 */
import { verifyBearerToken } from '../../src/middleware/auth';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import {
  AgentRuntimeService,
  AgentRole,
  AGENT_ROLE_DEFINITIONS,
  SubTaskSpec,
  createGeminiModelClient,
  getGeminiApiKey,
} from '../../server/agentRuntime/agentRuntime';
import { durableTaskQueue } from '../../server/taskQueue/durableTaskQueue';
import { workerConfigured } from '../../server/taskQueue/workerDispatch';
import { permissionsGateway } from '../../server/permissionsGateway';

const jsonResponse = (data: unknown, status = 200, requestId: string = crypto.randomUUID()) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Request-ID': requestId,
    },
  });

const VALID_ROLES = Object.keys(AGENT_ROLE_DEFINITIONS) as AgentRole[];
const INLINE_MAX_AGENTS = 4;

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405, requestId);
  }
  const decodedToken = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decodedToken?.uid) {
    return jsonResponse({ ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' }, 401, requestId);
  }
  const userId = decodedToken.uid;
  const rateCheck = await checkSharedRateLimit(`agent-runtime:${userId}`, 10, 60);
  if (!rateCheck.allowed) {
    return jsonResponse({ ok: false, error: 'Too many agent runtime requests.', code: 'RATE_LIMITED' }, 429, requestId);
  }
  const parsed = await parseJsonBodyLimited(req, 512 * 1024);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error, code: parsed.code }, parsed.status, requestId);
  }
  const body: any = parsed.value;

  const objective = typeof body.objective === 'string' ? body.objective.trim().slice(0, 4000) : '';
  if (!objective) {
    return jsonResponse({ ok: false, error: 'An objective string is required.', code: 'INVALID_OBJECTIVE' }, 400, requestId);
  }

  const plan: SubTaskSpec[] = Array.isArray(body.plan)
    ? body.plan
        .slice(0, 12)
        .map((t: any, i: number) => ({
          id: typeof t?.id === 'string' ? t.id.slice(0, 64) : `sub_${i}`,
          role: VALID_ROLES.includes(t?.role) ? t.role : 'analysis',
          goal: typeof t?.goal === 'string' && t.goal.trim() ? String(t.goal).slice(0, 2000) : objective.slice(0, 500),
          dependsOn: Array.isArray(t?.dependsOn) ? t.dependsOn.slice(0, 6).map((d: any) => String(d).slice(0, 64)) : [],
          context: typeof t?.context === 'string' ? String(t.context).slice(0, 4000) : undefined,
        }))
    : [];

  if (plan.length === 0) {
    return jsonResponse({ ok: false, error: 'A plan array with at least one subtask is required.', code: 'INVALID_PLAN' }, 400, requestId);
  }
  if (plan.length > INLINE_MAX_AGENTS) {
    return jsonResponse(
      {
        ok: false,
        error: `Inline execution is capped at ${INLINE_MAX_AGENTS} agents. Queue larger missions via the durable task queue (action: "queue_mission").`,
        code: 'PLAN_TOO_LARGE',
      },
      400,
      requestId,
    );
  }

  const apiKey = getGeminiApiKey();
  const mode = body.mode === 'queue_mission' ? 'queue_mission' : 'inline';

  if (mode === 'queue_mission') {
    try {
      const { created, task } = await durableTaskQueue.enqueue({
        userId,
        type: 'agent.mission',
        payload: { objective, plan },
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.slice(0, 200) : undefined,
        timeoutMs: 30 * 60 * 1000,
      });
      return jsonResponse(
        {
          ok: true,
          mode: 'durable',
          taskId: task.id,
          created,
          workerConfigured: workerConfigured(),
          status: task.status,
        },
        202,
        requestId,
      );
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: 'Durable mission queue is unavailable.',
          detail: (error instanceof Error ? error.message : '').slice(0, 300),
          code: 'DURABLE_STORE_UNAVAILABLE',
        },
        503,
        requestId,
      );
    }
  }

  if (!apiKey) {
    return jsonResponse(
      {
        ok: false,
        error: 'No model provider credentials are configured for inline agent execution.',
        code: 'PROVIDER_UNAVAILABLE',
      },
      503,
      requestId,
    );
  }

  const runtime = new AgentRuntimeService();
  const modelClient = createGeminiModelClient(apiKey);

  try {
    const result = await runtime.execute(
      {
        userId,
        objective,
        subTaskPlan: plan,
        context: typeof body.context === 'string' ? body.context.slice(0, 8000) : undefined,
        budget: {
          maxAgents: INLINE_MAX_AGENTS,
          maxConcurrency: Math.min(3, plan.length),
          perAgentTimeoutMs: 60_000,
          maxTotalTokens: 200_000,
        },
      },
      // Tool calls are disabled for inline mode unless explicitly granted and approved.
      { grants: undefined as any } as any,
    );
    return jsonResponse(
      {
        ok: result.status !== 'failed',
        status: result.status,
        executionId: result.executionId,
        subTaskResults: result.subTaskResults.map((r) => ({
          subTaskId: r.subTaskId,
          role: r.role,
          status: r.status,
          output: r.output ? r.output.slice(0, 8000) : '',
          validationStatus: r.validationStatus ?? null,
          tokens: r.runRecord.totalTokens,
        })),
        reviewer: result.reviewerRun
          ? {
              status: result.reviewerRun.status,
              verdict: result.reviewerRun.validationStatus,
              output: result.reviewerRun.output?.slice(0, 8000) ?? null,
            }
          : null,
        totals: result.totals,
        durationMs: result.durationMs,
        evidence: result.evidence,
        requestId,
      },
      200,
      requestId,
    );
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: 'Agent runtime execution failed.',
        detail: (error instanceof Error ? error.message : 'unknown').slice(0, 300),
        code: 'AGENT_RUNTIME_FAILED',
      },
      500,
      requestId,
    );
  }
};
