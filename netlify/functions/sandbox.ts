/**
 * Netlify function: sandboxed coding & browser execution engine (Feature 06).
 *
 * Single authenticated router in front of the sandbox orchestrator. The
 * verified Firebase identity is the ONLY source of user identity: workspace
 * ownership and tenancy are checked against it on every operation.
 *
 * This function never executes user commands locally and never touches host
 * files. It talks exclusively to the configured isolated sandbox provider.
 */

import crypto from 'crypto';
import { verifyBearerToken } from '../../src/middleware/auth';
import { permissionsGateway } from '../../server/permissionsGateway';
import { resolveProvider, isProviderAvailable } from '../../server/sandbox/provider';
import {
  SandboxOrchestratorService,
  recordAuditEvent,
  type SandboxAuditEvent,
  type ApprovalEvaluator,
} from '../../server/sandbox/orchestrator';
import { boundsCheckLimits, resolveExecutionStore, type ExecutionStore } from '../../server/sandbox/executionStore';
import type { RuntimeId } from '../../server/sandbox/types';

/* Server-side approvals for sandbox tools, integrated with the existing gateway. */
const SANDBOX_POLICIES = [
  { toolName: 'sandbox_create', displayName: 'Create Isolated Sandbox', category: 'coding' as const, description: 'Creates a new isolated cloud sandbox with CPU, memory and lifetime limits.', consequences: ['Provisions billable compute resources for the user.', 'Runs code in an isolated cloud VM.'] },
  { toolName: 'terminal_execute', displayName: 'Execute Terminal Command', category: 'coding' as const, description: 'Runs a real terminal command inside the user\'s isolated sandbox.', consequences: ['Executes arbitrary code inside the sandbox.', 'May read and write workspace files.', 'May install packages from package registries.'] },
  { toolName: 'filesystem_write', displayName: 'Write Workspace File', category: 'filesystem' as const, description: 'Creates or updates a file inside the authorized sandbox workspace.', consequences: ['Modifies project files inside the workspace.'] },
  { toolName: 'filesystem_delete', displayName: 'Delete Workspace Path', category: 'filesystem' as const, description: 'Deletes an authorized file or folder inside the sandbox workspace.', consequences: ['Data inside the workspace is permanently removed.'] },
  { toolName: 'browser_navigate', displayName: 'Navigate Browser Session', category: 'web' as const, description: 'Navigates an isolated browser session to an authorized public URL.', consequences: ['Sends requests to an external website.', 'The site receives the sandbox browser fingerprint.'] },
  { toolName: 'browser_click', displayName: 'Click Page Element', category: 'web' as const, description: 'Clicks an element on the current page of an isolated browser session.', consequences: ['May trigger navigation or state changes on the external site.'] },
  { toolName: 'browser_fill', displayName: 'Fill Form Fields', category: 'web' as const, description: 'Fills form fields inside an isolated browser session.', consequences: ['Enters data into an external website; submission still requires approval.'] },
  { toolName: 'preview_start', displayName: 'Start Development Preview', category: 'coding' as const, description: 'Installs dependencies and starts a dev server in the sandbox, then probes readiness.', consequences: ['Installs dependencies from public registries into the sandbox.', 'Runs a live development server.'] },
  { toolName: 'sandbox_cleanup', displayName: 'Terminate Sandbox', category: 'coding' as const, description: 'Terminates a sandbox session and releases its resources.', consequences: ['All unsaved sandbox state is lost.'] },
];
for (const p of SANDBOX_POLICIES) {
  permissionsGateway.registerPolicy({
    ...p,
    riskLevel: p.toolName === 'filesystem_delete' ? 'destructive' : 'privileged',
    requiresConfirmation: true,
  });
}

/* Read-only operations allowed without confirmation, scoped to the sandbox. */
const READ_ONLY_ACTIONS = new Set([
  'status', 'list-sessions', 'fs-list', 'fs-read', 'fs-search',
  'exec-status', 'browser-inspect', 'browser-screenshot', 'preview-status', 'provider-health',
]);

interface RouteRequest {
  action: string;
  approvalToken?: string;
  [key: string]: unknown;
}

const MAX_BODY_BYTES = 6 * 1024 * 1024; // ~6MB JSON; file writes cap well below 25MB once base64 decoded
const ALLOWED_ACTIONS = new Set([
  'create', 'status', 'list-sessions', 'cleanup', 'exec', 'exec-status', 'exec-cancel',
  'fs-list', 'fs-read', 'fs-write', 'fs-delete', 'fs-move', 'fs-search',
  'browser-create', 'browser-navigate', 'browser-inspect', 'browser-click', 'browser-fill',
  'browser-scroll', 'browser-wait-for', 'browser-screenshot', 'browser-close',
  'preview-start', 'preview-status', 'provider-health', 'sweep',
]);

let orchestratorSingleton: SandboxOrchestratorService | null = null;

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

let cachedStore: ExecutionStore | null = null;

/**
 * Build the orchestrator lazily per warm instance. The Firestore-backed store
 * is attempted once; a non-durable store is used (and flagged) when Firestore
 * is unavailable so responses can honestly report durability.
 */
async function buildOrchestrator(): Promise<{ orchestrator: SandboxOrchestratorService; durable: boolean }> {
  if (!cachedStore) {
    cachedStore = await resolveExecutionStore();
  }
  if (!orchestratorSingleton) {
    const evaluator: ApprovalEvaluator = (ctx) => {
      const decision = permissionsGateway.evaluateAction({
        toolName: ctx.toolName,
        args: ctx.args,
        userId: ctx.userId,
        approvalToken: ctx.approvalToken,
      });
      return {
        allowed: decision.allowed,
        requiresApproval: decision.requiresApproval,
        riskLevel: decision.riskLevel,
        reason: decision.reason,
        challenge: decision.challenge,
      };
    };
    orchestratorSingleton = new SandboxOrchestratorService(async () => {
      const resolved = resolveProvider();
      return {
        store: cachedStore as ExecutionStore,
        provider: resolved.provider,
        audit: recordAuditEvent,
        evaluateApproval: evaluator,
      };
    });
  }
  return { orchestrator: orchestratorSingleton, durable: cachedStore.durable };
}

function mapError(err: any): { status: number; body: Record<string, unknown> } {
  const status = Number(err?.status) || 500;
  const code = String(err?.code || 'INTERNAL_ERROR');
  const safeMessage = String(err?.message || 'Unexpected error executing sandbox operation.');
  if (code === 'PROVIDER_UNAVAILABLE') {
    return { status: 503, body: { ok: false, code, error: safeMessage } };
  }
  if (status >= 400 && status < 500) {
    return { status, body: { ok: false, code, error: safeMessage, ...(err?.challenge ? { challenge: err.challenge } : {}) } };
  }
  return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', error: 'Unexpected error executing sandbox operation.' } };
}

async function parseBody(req: Request): Promise<{ body?: RouteRequest; response?: Response }> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { response: jsonResponse({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds the limit.' }, 413) };
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { response: jsonResponse({ ok: false, code: 'INVALID_PAYLOAD', error: 'Expected a JSON object.' }, 400) };
    }
    return { body: body as RouteRequest };
  } catch {
    return { response: jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed JSON payload.' }, 400) };
  }
}

function str(value: unknown, name: string, maxLen = 512): string {
  const out = typeof value === 'string' ? value : '';
  if (!out) throw Object.assign(new Error(`${name} is required.`), { code: 'INVALID_ARGUMENTS', status: 400 });
  if (out.length > maxLen) throw Object.assign(new Error(`${name} exceeds the maximum length.`), { code: 'INVALID_ARGUMENTS', status: 400 });
  return out;
}

const RUNTIMES = ['node', 'typescript', 'javascript', 'python', 'html-css', 'react-vite', 'next', 'custom'];

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Use POST with an action or GET for status reads.' }, 405, requestId);
  }

  const decoded = await verifyBearerToken(req.headers.get('authorization') || undefined);
  if (!decoded?.uid) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' }, 401, requestId);
  }
  const userId = decoded.uid;

  const url = new URL(req.url);
  if (req.method === 'GET') {
    const action = url.searchParams.get('action') || '';
    if (!ALLOWED_ACTIONS.has(action)) {
      return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
    }
    const arg = (key: string) => url.searchParams.get(key) || undefined;
    const params: Record<string, unknown> = {
      action,
      sessionId: arg('sessionId'),
      executionId: arg('executionId'),
      path: arg('path'),
      query: arg('query'),
      port: arg('port') ? Number(arg('port')) : undefined,
    };
    return handle({ userId, params, requestId });
  }

  const parsed = await parseBody(req);
  if (parsed.response) return parsed.response;
  const body = parsed.body as RouteRequest;
  const action = String(body.action || '');
  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
  }
  return handle({ userId, params: body, requestId });
};

async function handle({ userId, params, requestId }: { userId: string; params: Record<string, unknown>; requestId: string }): Promise<Response> {
  const action = String(params.action);
  const approvalToken = typeof params.approvalToken === 'string' ? params.approvalToken.slice(0, 2000) : undefined;

  // Read-only actions bypass the explicit approval gate (server-side policy allows them).
  if (!READ_ONLY_ACTIONS.has(action)) {
    const guard = await permissionsGate({ userId, action, params, approvalToken });
    if (guard) return jsonResponse(guard.body, guard.status, requestId);
  }

  try {
    const { orchestrator, durable } = await buildOrchestrator();

    const failBody = (err: any, extra: Record<string, unknown> = {}) => {
      const mapped = mapError(err);
      return jsonResponse({ ...mapped.body, durable }, mapped.status, requestId);
    };

    switch (action) {
      case 'create': {
        const runtime = (params.runtime && RUNTIMES.includes(String(params.runtime)) ? String(params.runtime) : 'node') as RuntimeId;
        const workspaceLabel = typeof params.workspaceLabel === 'string' ? params.workspaceLabel.slice(0, 100) : undefined;
        const env = params.env && typeof params.env === 'object' && !Array.isArray(params.env)
          ? Object.fromEntries(Object.entries(params.env as Record<string, unknown>)
              .filter(([k, v]) => /^MANUS_[A-Za-z0-9_]{1,60}$/.test(k) && typeof v === 'string' && (v as string).length <= 4000))
          : undefined;
        const session = await orchestrator.createSession(userId, { userId, runtime, workspaceLabel, env }, boundsCheckLimits(params.limits as any));
        return jsonResponse({ ok: true, session, durable }, 200, requestId);
      }
      case 'status': {
        const session = await orchestrator.status(userId, String(params.sessionId || ''));
        return jsonResponse({ ok: true, session, durable }, 200, requestId);
      }
      case 'list-sessions': {
        const sessions = await orchestrator.listSessions(userId);
        return jsonResponse({ ok: true, sessions, durable }, 200, requestId);
      }
      case 'cleanup': {
        const result = await orchestrator.cleanup(userId, str(params.sessionId, 'sessionId'));
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'sweep': {
        const cleaned = await orchestrator.sweepExpired(userId);
        return jsonResponse({ ok: true, cleaned, durable }, 200, requestId);
      }
      case 'exec': {
        const command = str(params.command, 'command', 4000);
        const record = await orchestrator.executeCommand(userId, str(params.sessionId, 'sessionId'), {
          command,
          cwd: typeof params.cwd === 'string' ? params.cwd : undefined,
          timeoutSeconds: typeof params.timeoutSeconds === 'number' ? params.timeoutSeconds : undefined,
          env: {},
        }, typeof params.idempotencyKey === 'string' ? params.idempotencyKey.slice(0, 120) : undefined);
        return jsonResponse({ ok: record.status !== 'failed', execution: record, durable }, 200, requestId);
      }
      case 'exec-status': {
        const record = await orchestrator.getExecution(userId, str(params.executionId, 'executionId'));
        return jsonResponse({ ok: true, execution: record, durable }, 200, requestId);
      }
      case 'exec-cancel': {
        const record = await orchestrator.cancelExecution(userId, str(params.executionId, 'executionId'));
        return jsonResponse({ ok: true, execution: record, durable }, 200, requestId);
      }
      case 'fs-list':
        return jsonResponse({ ok: true, entries: await orchestrator.fsList(userId, str(params.sessionId, 'sessionId'), typeof params.path === 'string' ? params.path : ''), durable }, 200, requestId);
      case 'fs-read': {
        const file = await orchestrator.fsRead(userId, str(params.sessionId, 'sessionId'), str(params.path, 'path'));
        return jsonResponse({ ok: true, ...file, durable }, 200, requestId);
      }
      case 'fs-write': {
        const content = str(params.content, 'content', 5_000_000);
        const result = await orchestrator.fsWrite(userId, str(params.sessionId, 'sessionId'), str(params.path, 'path'), content, params.createDirectories !== false);
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'fs-delete': {
        await orchestrator.fsDelete(userId, str(params.sessionId, 'sessionId'), str(params.path, 'path'));
        return jsonResponse({ ok: true, durable }, 200, requestId);
      }
      case 'fs-move': {
        await orchestrator.fsMove(userId, str(params.sessionId, 'sessionId'), str(params.path, 'path'), str(params.to, 'to'));
        return jsonResponse({ ok: true, durable }, 200, requestId);
      }
      case 'fs-search': {
        const result = await orchestrator.fsSearch(userId, str(params.sessionId, 'sessionId'), str(params.query, 'query', 120));
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'browser-create': {
        const result = await orchestrator.browserCreate(userId, str(params.sessionId, 'sessionId'));
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'browser-navigate': {
        const result = await orchestrator.browserNavigate(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'), str(params.url, 'url', 2048), typeof params.timeoutMs === 'number' ? params.timeoutMs : 20000);
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'browser-inspect': {
        const result = await orchestrator.browserInspect(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'), typeof params.selector === 'string' ? params.selector : undefined, typeof params.limit === 'number' ? params.limit : 60);
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'browser-click': {
        const result = await orchestrator.browserClick(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'), str(params.selector, 'selector', 500));
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'browser-fill': {
        const fields = Array.isArray(params.fields) ? params.fields : [];
        const result = await orchestrator.browserFill(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'), fields as any);
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'browser-scroll': {
        const direction = params.direction === 'up' ? 'up' : 'down';
        const pixels = typeof params.pixels === 'number' ? params.pixels : 600;
        await orchestrator.browserScroll(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'), direction, pixels);
        return jsonResponse({ ok: true, durable }, 200, requestId);
      }
      case 'browser-wait-for': {
        const condition = params.condition === 'selector' ? 'selector' : 'navigation';
        await orchestrator.browserWaitFor(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'), condition, str(params.value, 'value', 500), typeof params.timeoutMs === 'number' ? params.timeoutMs : 10000);
        return jsonResponse({ ok: true, durable }, 200, requestId);
      }
      case 'browser-screenshot': {
        const result = await orchestrator.browserScreenshot(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'));
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'browser-close': {
        await orchestrator.browserClose(userId, str(params.sessionId, 'sessionId'), str(params.browserSessionId, 'browserSessionId'));
        return jsonResponse({ ok: true, durable }, 200, requestId);
      }
      case 'preview-start': {
        const result = await orchestrator.previewStart(userId, str(params.sessionId, 'sessionId'), {
          installCommand: typeof params.installCommand === 'string' ? params.installCommand : undefined,
          startCommand: typeof params.startCommand === 'string' ? params.startCommand : undefined,
          port: typeof params.port === 'number' ? params.port : undefined,
          cwd: typeof params.cwd === 'string' ? params.cwd : undefined,
          timeoutSeconds: typeof params.timeoutSeconds === 'number' ? params.timeoutSeconds : undefined,
        });
        return jsonResponse({ ok: result.ready, ...result, durable }, 200, requestId);
      }
      case 'preview-status': {
        const result = await orchestrator.previewStatus(userId, str(params.sessionId, 'sessionId'), typeof params.port === 'number' ? params.port : 3000);
        return jsonResponse({ ok: true, ...result, durable }, 200, requestId);
      }
      case 'provider-health': {
        const resolved = resolveProvider();
        const health = isProviderAvailable(resolved)
          ? await resolved.provider.healthCheck().catch((err: any) => ({ providerId: resolved.provider.id, configured: true, available: false, detail: String(err?.message || 'health check failed'), checkedAt: new Date().toISOString() }))
          : { providerId: resolved.provider.id, configured: false, available: false, detail: resolved.reason, checkedAt: new Date().toISOString() };
        return jsonResponse({ ok: true, health, providerAvailable: isProviderAvailable(resolved), durable }, 200, requestId);
      }
      default:
        return jsonResponse({ ok: false, code: 'INVALID_ACTION', error: 'Unknown or missing action.' }, 400, requestId);
    }
  } catch (err: any) {
    const mapped = mapError(err);
    return jsonResponse({ ...mapped.body }, mapped.status, requestId);
  }
}

/** Explicit server-side permission gate mirroring the orchestrator contract. */
async function permissionsGate({ userId, action, params, approvalToken }: { userId: string; action: string; params: Record<string, unknown>; approvalToken?: string }): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const { orchestrator } = await buildOrchestrator();
  const decision = await orchestrator.ensureAllowed(TOOL_NAME_FOR_ACTION[action] || action, params, userId, approvalToken);
  if (decision.ok) return null;
  return { status: decision.status, body: { ok: false, code: decision.code, error: decision.reason, ...(decision.challenge ? { challenge: decision.challenge } : {}) } };
}

const TOOL_NAME_FOR_ACTION: Record<string, string> = {
  create: 'sandbox_create',
  cleanup: 'sandbox_cleanup',
  exec: 'terminal_execute',
  'exec-cancel': 'terminal_cancel',
  'fs-write': 'filesystem_write',
  'fs-delete': 'filesystem_delete',
  'fs-move': 'filesystem_move',
  'browser-create': 'browser_session_create',
  'browser-navigate': 'browser_navigate',
  'browser-click': 'browser_click',
  'browser-fill': 'browser_fill',
  'browser-scroll': 'browser_scroll',
  'browser-close': 'browser_session_close',
  'preview-start': 'preview_start',
};
