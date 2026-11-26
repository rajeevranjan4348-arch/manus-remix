/**
 * Netlify Serverless Function: Feature 01 Durable Cloud Background Agent & Task Queue
 * Routes: /api/tasks/* and /.netlify/functions/tasks/*
 */

import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import {
  defaultAutonomousOrchestrator,
  type AutonomousInfrastructureOrchestrator,
} from '../../server/infrastructure/autonomousOrchestrator';
import { MultiAgentEngineError } from '../../server/multiAgent/multiAgentEngine';
import {
  BackgroundTaskEngineError,
  defaultBackgroundTaskEngine,
  type BackgroundTaskEngine,
  type BackgroundTaskStatus,
} from '../../server/queue/backgroundTaskEngine';
import type { DurableRequestContext } from '../../server/sandbox/durableStore';
import { SandboxEngineError } from '../../server/sandbox/sandboxEngine';
import { redactSensitiveExecutionText } from '../../server/sandbox/security';
import { SkillsEngineError } from '../../server/skills/skillsEngine';
import { verifyBearerToken } from '../../src/middleware/auth';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return undefined;
  const token = auth.slice(7).trim();
  if (!token || token.startsWith('guest_')) return undefined;
  return token;
}

async function readJsonBody(
  req: Request,
  maxBytes = 128 * 1024,
): Promise<
  | { ok: true; data: any; raw: string; response?: undefined }
  | { ok: false; data?: undefined; raw?: undefined; response: Response }
> {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return {
      ok: false,
      response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds allowed limit.' }, 413),
    };
  }
  if (!raw.trim()) return { ok: true, data: {}, raw };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Expected JSON object body.' }, 400),
      };
    }
    return { ok: true, data: parsed, raw };
  } catch {
    return {
      ok: false,
      response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON body.' }, 400),
    };
  }
}

function mapTaskError(err: unknown): Response {
  if (err instanceof BackgroundTaskEngineError || err instanceof MultiAgentEngineError) {
    return jsonResponse(
      { ok: false, code: err.code, error: redactSensitiveExecutionText(err.message) },
      err.statusCode,
    );
  }
  if (err instanceof SandboxEngineError || err instanceof SkillsEngineError) {
    return jsonResponse(
      {
        ok: false,
        code: err.code,
        error: redactSensitiveExecutionText(err.message),
        ...(err.challenge ? { requiresApproval: true, challenge: err.challenge } : {}),
      },
      err.statusCode,
    );
  }
  const msg = err instanceof Error ? err.message : 'Unexpected background task error.';
  return jsonResponse({ ok: false, code: 'TASK_ENGINE_ERROR', error: redactSensitiveExecutionText(msg) }, 500);
}

export async function handleTasksRequest(
  req: Request,
  engine: BackgroundTaskEngine = defaultBackgroundTaskEngine,
  orchestrator: AutonomousInfrastructureOrchestrator = defaultAutonomousOrchestrator,
): Promise<Response> {
  const url = new URL(req.url);
  const subPath =
    url.pathname
      .replace(/^\/\.netlify\/functions\/tasks/, '')
      .replace(/^\/api\/tasks/, '') || '/';

  // 1. Authenticated external worker routes (HMAC-SHA256 x-worker-signature or x-worker-secret)
  if (subPath.startsWith('/worker/')) {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'POST required for worker routes.' }, 405);
    }
    const parsed = await readJsonBody(req, 256 * 1024);
    if (!parsed.ok) return parsed.response;

    if (!engine.verifyWorkerRequest(parsed.raw, req.headers)) {
      return jsonResponse(
        {
          ok: false,
          code: 'WORKER_UNAUTHORIZED',
          error: 'Valid HMAC x-worker-signature or x-worker-secret is required (BACKGROUND_WORKER_SECRET >= 16 chars).',
        },
        401,
      );
    }

    const body = parsed.data;
    try {
      if (subPath === '/worker/claim') {
        const task = await engine.claimNextTask(String(body.workerId || ''), {
          leaseMs: typeof body.leaseMs === 'number' ? body.leaseMs : undefined,
          userId: typeof body.userId === 'string' ? body.userId : undefined,
        });
        return jsonResponse({ ok: true, task });
      }
      if (subPath === '/worker/heartbeat') {
        if (!body.userId || !body.taskId || !body.workerId) {
          return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'userId, taskId, and workerId are required.' }, 400);
        }
        const res = await engine.renewTaskLease(
          { userId: String(body.userId) },
          String(body.taskId),
          String(body.workerId),
          typeof body.leaseMs === 'number' ? body.leaseMs : undefined,
        );
        return jsonResponse({ ok: true, ...res });
      }
      if (subPath === '/worker/progress') {
        if (!body.userId || !body.taskId || !body.workerId) {
          return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'userId, taskId, and workerId are required.' }, 400);
        }
        const task = await engine.updateTaskProgress(
          { userId: String(body.userId) },
          {
            taskId: String(body.taskId),
            workerId: String(body.workerId),
            phase: body.phase,
            progress: typeof body.progress === 'number' ? body.progress : undefined,
            message: typeof body.message === 'string' ? body.message : undefined,
            metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
          },
        );
        return jsonResponse({ ok: true, task });
      }
      if (subPath === '/worker/complete') {
        if (!body.userId || !body.taskId || !body.workerId) {
          return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'userId, taskId, and workerId are required.' }, 400);
        }
        const task = await engine.completeTask(
          { userId: String(body.userId) },
          {
            taskId: String(body.taskId),
            workerId: String(body.workerId),
            result: body.result ?? {},
            summary: typeof body.summary === 'string' ? body.summary : undefined,
          },
        );
        return jsonResponse({ ok: true, task });
      }
      if (subPath === '/worker/fail') {
        if (!body.userId || !body.taskId || !body.error) {
          return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'userId, taskId, and error are required.' }, 400);
        }
        const task = await engine.failTask(
          { userId: String(body.userId) },
          {
            taskId: String(body.taskId),
            workerId: typeof body.workerId === 'string' ? body.workerId : undefined,
            error: String(body.error),
            retryable: typeof body.retryable === 'boolean' ? body.retryable : true,
          },
        );
        return jsonResponse({ ok: true, task });
      }
      if (subPath === '/worker/recover') {
        const recovery = await engine.recoverExpiredLeases();
        return jsonResponse({ ok: true, ...recovery });
      }
      return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Unknown worker route.' }, 404);
    } catch (err) {
      return mapTaskError(err);
    }
  }

  // 2. User-authenticated routes
  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401);
  }

  const rl = await checkSharedRateLimit(`tasks:${decoded.uid}`, 60, 60);
  if (!rl.allowed) {
    return jsonResponse({ ok: false, code: 'RATE_LIMITED', error: 'Rate limit exceeded for tasks API.' }, 429);
  }

  const ctx: DurableRequestContext = {
    userId: decoded.uid,
    authToken: extractBearerToken(req),
  };

  try {
    if (req.method === 'GET' && subPath === '/health') {
      return jsonResponse({ ok: true, ...engine.getHealth(ctx) });
    }

    if (req.method === 'GET' && (subPath === '/list' || subPath === '/')) {
      const status = (url.searchParams.get('status') || undefined) as BackgroundTaskStatus | undefined;
      const limit = Number(url.searchParams.get('limit') || '50');
      const tasks = await engine.listTasks(ctx, { status, limit: Number.isFinite(limit) ? limit : 50 });
      return jsonResponse({ ok: true, tasks });
    }

    if (req.method === 'GET' && subPath === '/get') {
      const taskId = url.searchParams.get('taskId') || '';
      if (!taskId) return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'taskId query parameter is required.' }, 400);
      const task = await engine.getTask(ctx, taskId);
      if (!task) return jsonResponse({ ok: false, code: 'TASK_NOT_FOUND', error: 'Task not found.' }, 404);
      return jsonResponse({ ok: true, task });
    }

    if (req.method === 'GET' && subPath === '/history') {
      const taskId = url.searchParams.get('taskId') || '';
      if (!taskId) return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'taskId query parameter is required.' }, 400);
      const task = await engine.getTask(ctx, taskId);
      if (!task) return jsonResponse({ ok: false, code: 'TASK_NOT_FOUND', error: 'Task not found.' }, 404);
      return jsonResponse({ ok: true, taskId: task.taskId, status: task.status, phase: task.phase, history: task.history });
    }

    if (req.method === 'GET' && subPath === '/notifications') {
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
      const limit = Number(url.searchParams.get('limit') || '50');
      const notifications = await engine.listNotifications(ctx, {
        unreadOnly,
        limit: Number.isFinite(limit) ? limit : 50,
      });
      return jsonResponse({ ok: true, notifications });
    }

    if (req.method === 'POST' && subPath === '/notifications/read') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.notificationId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'notificationId is required.' }, 400);
      }
      const notification = await engine.markNotificationRead(ctx, parsed.data.notificationId);
      if (!notification) return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Notification not found.' }, 404);
      return jsonResponse({ ok: true, notification });
    }

    if (req.method === 'POST' && subPath === '/create') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (body.userId !== undefined && body.userId !== ctx.userId) {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', error: 'Task owner does not match authenticated user.' }, 403);
      }
      const created = await engine.enqueueTask(ctx, {
        title: String(body.title || ''),
        prompt: String(body.prompt || ''),
        type: body.type,
        priority: body.priority,
        payload: body.payload,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
        maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
      });
      return jsonResponse({ ok: true, ...created }, created.deduplicated ? 200 : 201);
    }

    if (req.method === 'POST' && subPath === '/cancel') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.taskId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'taskId is required.' }, 400);
      }
      const task = await engine.cancelTask(
        ctx,
        parsed.data.taskId,
        typeof parsed.data.reason === 'string' ? parsed.data.reason : undefined,
      );
      return jsonResponse({ ok: true, task });
    }

    if (req.method === 'POST' && subPath === '/retry') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      if (typeof parsed.data.taskId !== 'string') {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'taskId is required.' }, 400);
      }
      const task = await engine.retryTask(ctx, parsed.data.taskId);
      return jsonResponse({ ok: true, task });
    }

    if (req.method === 'POST' && subPath === '/orchestrate/coding') {
      const parsed = await readJsonBody(req, 256 * 1024);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (!body.projectId || !body.objective || !Array.isArray(body.filesToWrite)) {
        return jsonResponse(
          { ok: false, code: 'BAD_REQUEST', error: 'projectId, objective, and filesToWrite[] are required.' },
          400,
        );
      }
      const result = await orchestrator.runAutonomousCodingPipeline(ctx, {
        projectId: String(body.projectId),
        objective: String(body.objective),
        runtime: body.runtime,
        filesToWrite: body.filesToWrite,
        testCommand: typeof body.testCommand === 'string' ? body.testCommand : undefined,
        previewCommand: typeof body.previewCommand === 'string' ? body.previewCommand : undefined,
        previewPort: typeof body.previewPort === 'number' ? body.previewPort : undefined,
        verifyInBrowser: Boolean(body.verifyInBrowser),
        approvalTokens: body.approvalTokens,
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (req.method === 'POST' && subPath === '/orchestrate/scheduled-research') {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
      if (!body.topic) {
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'topic is required.' }, 400);
      }
      const result = await orchestrator.runScheduledResearchPipeline(ctx, {
        scheduleId: typeof body.scheduleId === 'string' ? body.scheduleId : undefined,
        scheduleName: typeof body.scheduleName === 'string' ? body.scheduleName : undefined,
        topic: String(body.topic),
        timeZone: typeof body.timeZone === 'string' ? body.timeZone : 'UTC',
        cronExpression: typeof body.cronExpression === 'string' ? body.cronExpression : undefined,
        runAt: typeof body.runAt === 'string' ? body.runAt : undefined,
      });
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ ok: false, code: 'NOT_FOUND', error: 'Route not found in tasks API.' }, 404);
  } catch (err) {
    return mapTaskError(err);
  }
}

export default async (req: Request) => handleTasksRequest(req);
