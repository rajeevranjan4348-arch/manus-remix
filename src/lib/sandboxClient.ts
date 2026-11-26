/**
 * Shared client transport for durable task and sandbox execution endpoints.
 * Used by the tool framework and registered execution tools; every call is
 * authenticated and never fabricates a successful outcome.
 */

import type { ToolExecutionContext, ToolExecutionOutput } from './toolFramework';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

export async function callSandboxApi(
  action: string,
  args: Record<string, any>,
  context: ToolExecutionContext,
): Promise<ToolExecutionOutput> {
  const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
  if (!authHeader) {
    return {
      success: false,
      error: 'Authentication required for sandboxed execution.',
      summary: 'Sandbox tool requires an authenticated session.',
    };
  }
  try {
    const response = await fetch('/api/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        action,
        sandboxId: args.sandboxId,
        args: { ...args, approvalToken: context.approvalToken },
      }),
      signal: context.signal,
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!payload.ok) {
      return {
        success: false,
        error: payload.error || payload.reason || `Sandbox action '${action}' failed (HTTP ${response.status}).`,
        summary:
          payload.code === 'APPROVAL_REQUIRED'
            ? 'User approval required.'
            : payload.state === 'terminal_execution_unavailable' || payload.code === 'NOT_CONFIGURED'
              ? 'Sandbox provider unavailable.'
              : `Sandbox action '${action}' could not be completed.`,
        data: payload.challenge ? { challenge: payload.challenge, requiresApproval: true } : undefined,
      };
    }
    return { success: true, data: payload, summary: `${action} succeeded.` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'sandbox request failed',
      summary: `Sandbox action '${action}' could not be completed.`,
    };
  }
}

export async function callTasksApi(action: string, args: Record<string, any>): Promise<ToolExecutionOutput> {
  const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
  if (!authHeader) {
    return { success: false, error: 'Authentication required for background tasks.', summary: 'Durable tasks require sign-in.' };
  }
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ action, ...args }),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!payload.ok) {
      return {
        success: false,
        error: payload.error || `Task action failed (HTTP ${response.status}).`,
        summary: 'Durable task operation failed.',
      };
    }
    return { success: true, data: payload, summary: `Task ${action} accepted (durable, survives reload).` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'task request failed', summary: 'Durable task request failed.' };
  }
}
