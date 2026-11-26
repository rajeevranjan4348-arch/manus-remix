/**
 * Feature 06 API: sandboxed coding & real browser execution.
 *
 * Routes the Feature 06 tool surface to the external sandbox provider with
 * server-side ownership and SSRF enforcement. Missing provider credentials
 * produce an explicit `unavailable` status — never fake success.
 */
import { verifyBearerToken } from '../../src/middleware/auth';
import { checkSharedRateLimit } from '../../server/distributedRateLimiter';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';
import { sandboxService } from '../../server/sandbox/sandboxService';
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

/** Tools that must clear the durable permission gateway before execution. */
const SENSITIVE_ACTIONS = new Set([
  'terminal_execute',
  'filesystem_write',
  'filesystem_delete',
  'browser_session_create',
  'browser_navigate',
  'browser_click',
  'browser_fill',
  'preview_start',
  'sandbox_cleanup',
]);

const SAFE_ACTIONS = new Set([
  'sandbox_create',
  'sandbox_status',
  'terminal_stream',
  'terminal_cancel',
  'filesystem_list',
  'filesystem_read',
  'filesystem_search',
  'browser_inspect',
  'browser_screenshot',
  'browser_session_close',
  'preview_status',
]);

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
  const rateCheck = await checkSharedRateLimit(`sandbox:${userId}`, 60, 60);
  if (!rateCheck.allowed) {
    return jsonResponse({ ok: false, error: 'Too many requests.', code: 'RATE_LIMITED' }, 429, requestId);
  }
  const parsed = await parseJsonBodyLimited(req, 4 * 1024 * 1024);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error, code: parsed.code }, parsed.status, requestId);
  }
  const body: any = parsed.value;
  const action = typeof body.action === 'string' ? body.action : '';

  if (!SENSITIVE_ACTIONS.has(action) && !SAFE_ACTIONS.has(action)) {
    return jsonResponse({ ok: false, error: 'Unknown sandbox action.', code: 'UNKNOWN_ACTION' }, 400, requestId);
  }

  if (SENSITIVE_ACTIONS.has(action)) {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: action,
      args: body.args ?? body,
      userId,
      target: typeof body.sandboxId === 'string' ? body.sandboxId.slice(0, 128) : undefined,
      requestId,
    });
    if (!evaluation.allowed) {
      const status = evaluation.unavailable ? 503 : 200;
      return jsonResponse(
        {
          ok: false,
          code: evaluation.unavailable ? 'AUTHORIZATION_UNAVAILABLE' : 'APPROVAL_REQUIRED',
          reason: evaluation.reason,
          requiresApproval: !evaluation.unavailable,
          challenge: evaluation.challenge ?? null,
        },
        status,
        requestId,
      );
    }
  }

  const sandboxId = typeof body.sandboxId === 'string' ? body.sandboxId.slice(0, 128) : '';
  const args = body.args ?? {};

  try {
    switch (action) {
      case 'sandbox_create': {
        const result = await sandboxService.createSandbox({
          userId,
          runtimes: Array.isArray(args.runtimes) ? args.runtimes.slice(0, 5) : undefined,
          purpose: typeof args.purpose === 'string' ? args.purpose : undefined,
          limits: args.limits && typeof args.limits === 'object' ? args.limits : undefined,
        });
        if (!result.ok) {
          return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        }
        return jsonResponse({ ok: true, sandbox: result.sandbox, requestId }, 201, requestId);
      }
      case 'sandbox_status': {
        const result = await sandboxService.status(sandboxId, userId);
        if (!result.ok) {
          return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        }
        return jsonResponse({ ok: true, status: result.status, requestId }, 200, requestId);
      }
      case 'terminal_execute': {
        const result = await sandboxService.terminalExecute({
          sandboxId,
          userId,
          command: String(args.command ?? ''),
          cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
          timeoutMs: Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : undefined,
        });
        if (!result.ok) {
          return jsonResponse(
            {
              ok: false,
              code: result.code,
              error: result.reason,
              state: 'terminal_execution_unavailable',
            },
            503,
            requestId,
          );
        }
        return jsonResponse({ ok: true, result: result.result, requestId }, 200, requestId);
      }
      case 'terminal_stream': {
        return jsonResponse(
          {
            ok: false,
            error: 'Terminal streaming requires an active persistent connection to the sandbox provider over WebSocket; polling terminal_execute captures stdout/stderr/exit codes instead. Configure the sandbox provider for live streaming.',
            code: 'NOT_IMPLEMENTED_LIVE_WS',
          },
          501,
          requestId,
        );
      }
      case 'terminal_cancel': {
        const result = await sandboxService.terminalCancel(sandboxId, userId, Number(args.pid));
        if (!result.ok) {
          return jsonResponse({ ok: false, code: 'TERMINAL_CANCEL_FAILED', error: result.reason }, 400, requestId);
        }
        return jsonResponse({ ok: true, requestId }, 200, requestId);
      }
      case 'filesystem_list': {
        const result = await sandboxService.fsList(sandboxId, userId, String(args.dir ?? '/workspace'));
        if (!result.ok) return jsonResponse({ ok: false, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, entries: result.entries, requestId }, 200, requestId);
      }
      case 'filesystem_read': {
        const result = await sandboxService.fsRead(sandboxId, userId, String(args.path ?? ''));
        if (!result.ok) return jsonResponse({ ok: false, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, content: result.content, requestId }, 200, requestId);
      }
      case 'filesystem_write': {
        const result = await sandboxService.fsWrite(sandboxId, userId, String(args.path ?? ''), String(args.content ?? ''));
        if (!result.ok) return jsonResponse({ ok: false, error: result.reason }, 400, requestId);
        return jsonResponse({ ok: true, requestId }, 200, requestId);
      }
      case 'filesystem_delete': {
        const result = await sandboxService.fsDelete(sandboxId, userId, String(args.path ?? ''));
        if (!result.ok) return jsonResponse({ ok: false, error: result.reason }, 400, requestId);
        return jsonResponse({ ok: true, requestId }, 200, requestId);
      }
      case 'filesystem_search': {
        const result = await sandboxService.fsSearch(sandboxId, userId, String(args.query ?? ''), typeof args.glob === 'string' ? args.glob : undefined);
        if (!result.ok) return jsonResponse({ ok: false, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, matches: result.matches, requestId }, 200, requestId);
      }
      case 'browser_session_create': {
        const result = await sandboxService.browserSessionCreate({
          sandboxId,
          userId,
          url: String(args.url ?? ''),
          timeoutMs: Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : undefined,
        });
        if (!result.ok) {
          return jsonResponse(
            {
              ok: false,
              code: result.code,
              error: result.reason,
              state: result.code === 'blocked' ? 'navigation_blocked_by_policy' : 'browser_unavailable',
            },
            503,
            requestId,
          );
        }
        return jsonResponse({ ok: true, session: result.session, requestId }, 201, requestId);
      }
      case 'browser_navigate': {
        const result = await sandboxService.browserNavigate(sandboxId, userId, String(args.sessionId ?? ''), String(args.url ?? ''));
        if (!result.ok) {
          return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        }
        return jsonResponse({ ok: true, session: result.session, requestId }, 200, requestId);
      }
      case 'browser_inspect': {
        const result = await sandboxService.browserInspect(sandboxId, userId, String(args.sessionId ?? ''));
        if (!result.ok) return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, state: result.state, requestId }, 200, requestId);
      }
      case 'browser_click': {
        const result = await sandboxService.browserClick(sandboxId, userId, String(args.sessionId ?? ''), String(args.selector ?? ''));
        if (!result.ok) return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, session: result.session, requestId }, 200, requestId);
      }
      case 'browser_fill': {
        const result = await sandboxService.browserFill(sandboxId, userId, String(args.sessionId ?? ''), args.values ?? {});
        if (!result.ok) return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, session: result.session, requestId }, 200, requestId);
      }
      case 'browser_screenshot': {
        const result = await sandboxService.browserScreenshot(sandboxId, userId, String(args.sessionId ?? ''));
        if (!result.ok) return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, screenshot: result.screenshot, requestId }, 200, requestId);
      }
      case 'browser_session_close': {
        const result = await sandboxService.browserSessionClose(sandboxId, userId, String(args.sessionId ?? ''));
        if (!result.ok) return jsonResponse({ ok: false, error: result.reason }, 400, requestId);
        return jsonResponse({ ok: true, requestId }, 200, requestId);
      }
      case 'preview_start': {
        const result = await sandboxService.previewStart(sandboxId, userId, {
          command: String(args.command ?? ''),
          port: Number(args.port ?? 0),
          readinessTimeoutMs: Number.isFinite(Number(args.readinessTimeoutMs)) ? Number(args.readinessTimeoutMs) : undefined,
        });
        if (!result.ok) {
          return jsonResponse({ ok: false, code: result.code, error: result.reason, state: 'preview_not_ready' }, 503, requestId);
        }
        return jsonResponse({ ok: true, previewUrl: result.previewUrl, readiness: 'ready', requestId }, 200, requestId);
      }
      case 'preview_status': {
        const result = await sandboxService.previewStatus(sandboxId, userId);
        if (!result.ok) return jsonResponse({ ok: false, code: result.code, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, preview: result.resp, requestId }, 200, requestId);
      }
      case 'sandbox_cleanup': {
        const result = await sandboxService.cleanup(sandboxId, userId);
        if (!result.ok) return jsonResponse({ ok: false, error: result.reason }, 503, requestId);
        return jsonResponse({ ok: true, cleanedUp: true, requestId }, 200, requestId);
      }
      default:
        return jsonResponse({ ok: false, error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, requestId);
    }
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: 'Sandbox operation failed.',
        detail: (error instanceof Error ? error.message : '').slice(0, 300),
        code: 'SANDBOX_OPERATION_FAILED',
      },
      503,
      requestId,
    );
  }
};
