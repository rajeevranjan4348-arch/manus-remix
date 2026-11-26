/**
 * Agent tool registration: sandboxed coding & browser execution (Feature 06).
 *
 * Registers the execution tools with the existing tool framework so the agent
 * can select them automatically, honouring the approval gates. All execution
 * happens server-side, inside the isolated sandbox provider; these handlers
 * only relay to /api/sandbox with the user's verified identity.
 */

import type { ToolDefinition } from './toolFramework';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

type RegistryLike = { register(tool: ToolDefinition): void };

interface SandboxApiResponse {
  ok?: boolean;
  code?: string;
  error?: string;
  durable?: boolean;
  [key: string]: any;
}

async function sandboxApi(action: string, payload: Record<string, any> = {}): Promise<{ status: number; data: SandboxApiResponse }> {
  const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
  const res = await fetch('/api/sandbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  let data: SandboxApiResponse = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: 'Unreadable response from sandbox service.' };
  }
  return { status: res.status, data };
}

function providerUnavailable(data: SandboxApiResponse): string {
  const detail = String(data.error || 'Sandbox execution is not configured on this deployment.');
  return `SANDBOX_UNAVAILABLE: ${detail}`;
}

function toToolOutput(result: { status: number; data: SandboxApiResponse }, successSummary: string) {
  if (result.status === 503) {
    return { success: false, error: providerUnavailable(result.data), summary: 'Sandbox provider is not configured or not healthy.' };
  }
  if (result.status === 401) {
    return { success: false, error: 'AUTHENTICATION_REQUIRED', summary: 'Sign in again to use sandbox tools.' };
  }
  if (result.status === 403) {
    const code = String(result.data.code || 'APPROVAL_REQUIRED');
    return {
      success: false,
      error: code === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED' : 'APPROVAL_REQUIRED',
      data: result.data.challenge ? { challenge: result.data.challenge } : undefined,
      summary: code === 'PERMISSION_DENIED'
        ? 'This action was denied by the permission policy.'
        : 'User approval is required before this sandbox action can proceed.',
    };
  }
  if (result.status === 429) {
    return { success: false, error: 'SANDBOX_LIMIT_REACHED', summary: 'Too many concurrent sandboxes. Clean one up and retry.' };
  }
  if (!result.data.ok) {
    return { success: false, error: String(result.data.code || 'SANDBOX_ERROR'), data: result.data, summary: String(result.data.error || 'Sandbox operation failed.') };
  }
  return { success: true, data: result.data, summary: successSummary };
}

export function registerSandboxTools(registry: RegistryLike): void {
  const requestSession = {
    sessionId: { type: 'string' as const, description: 'Sandbox session id (returned by sandbox_create)', required: true },
  };

  const requestSessionAndBrowser = {
    ...requestSession,
    browserSessionId: { type: 'string' as const, description: 'Browser session id (returned by browser_session_create)', required: true },
  };

  registry.register({
    name: 'sandbox_create',
    displayName: 'Create Isolated Sandbox',
    description: 'Create a new isolated workspace sandbox for coding tasks. Returns a durable session id. Requires user approval.',
    category: 'coding',
    riskLevel: 'privileged',
    parameters: {
      runtime: { type: 'string', description: 'Runtime environment', enum: ['node', 'typescript', 'javascript', 'python', 'html-css', 'react-vite', 'next', 'custom'], default: 'node' },
      workspaceLabel: { type: 'string', description: 'Short human-readable label for the workspace (max 100 chars)' },
    },
    handler: async (args) => {
      const result = await sandboxApi('create', {
        runtime: args.runtime || 'node',
        workspaceLabel: typeof args.workspaceLabel === 'string' ? args.workspaceLabel : undefined,
      });
      if (result.data.ok && result.data.session) {
        return toToolOutput(result, `Sandbox ${result.data.session.sessionId} is ready (${result.data.session.runtime})`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'sandbox_status',
    displayName: 'Check Sandbox Status',
    description: 'Get the status, limits and metadata of a sandbox session you created.',
    category: 'coding',
    riskLevel: 'read-only',
    parameters: { ...requestSession },
    handler: async (args) => {
      const result = await sandboxApi('status', { sessionId: args.sessionId });
      return toToolOutput(result, 'Sandbox status retrieved.');
    },
  });

  registry.register({
    name: 'terminal_execute',
    displayName: 'Execute Terminal Command',
    description: 'Run a real terminal command inside the isolated sandbox. Captures stdout, stderr and the exit code. Install dependencies and build projects here. Requires user approval.',
    category: 'coding',
    riskLevel: 'sensitive',
    parameters: {
      ...requestSession,
      command: { type: 'string', description: 'Shell command to execute inside the sandbox (never on the host)', required: true },
      cwd: { type: 'string', description: 'Working directory relative to the workspace root' },
      timeoutSeconds: { type: 'number', description: 'Command timeout in seconds (max 600, default 120)' },
      idempotencyKey: { type: 'string', description: 'Optional key so retries return the original result instead of re-executing' },
    },
    handler: async (args) => {
      const result = await sandboxApi('exec', {
        sessionId: args.sessionId,
        command: args.command,
        cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
        timeoutSeconds: typeof args.timeoutSeconds === 'number' ? args.timeoutSeconds : undefined,
        idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined,
      });
      if (result.data.ok && result.data.execution) {
        const ex = result.data.execution;
        return toToolOutput(result, `Command finished (${ex.status}) with exit code ${ex.exitCode}. stdout ${ex.stdout ? ex.stdout.length + ' chars' : 'empty'}, stderr ${ex.stderr ? ex.stderr.length + ' chars' : 'empty'}`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'terminal_stream',
    displayName: 'Poll Terminal Execution',
    description: 'Retrieve the current stdout, stderr and status of a terminal execution, including for still-running commands.',
    category: 'coding',
    riskLevel: 'read-only',
    parameters: {
      executionId: { type: 'string', description: 'Execution id returned by terminal_execute', required: true },
    },
    handler: async (args) => {
      const result = await sandboxApi('exec-status', { executionId: args.executionId });
      if (result.data.ok && result.data.execution) {
        const ex = result.data.execution;
        return toToolOutput(result, `Execution ${ex.executionId} is ${ex.status} (exit ${ex.exitCode}).`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'terminal_cancel',
    displayName: 'Cancel Terminal Execution',
    description: 'Cancel a queued or running terminal command inside the sandbox.',
    category: 'coding',
    riskLevel: 'moderate',
    parameters: {
      executionId: { type: 'string', description: 'Execution id to cancel', required: true },
    },
    handler: async (args) => {
      const result = await sandboxApi('exec-cancel', { executionId: args.executionId });
      return toToolOutput(result, 'Cancellation requested.');
    },
  });

  registry.register({
    name: 'filesystem_list',
    displayName: 'List Workspace Files',
    description: 'List files and folders in a directory of an authorized sandbox workspace.',
    category: 'filesystem',
    riskLevel: 'read-only',
    parameters: {
      ...requestSession,
      path: { type: 'string', description: 'Workspace-relative directory (default: workspace root)' },
    },
    handler: async (args) => {
      const result = await sandboxApi('fs-list', { sessionId: args.sessionId, path: typeof args.path === 'string' ? args.path : '' });
      if (result.data.ok && Array.isArray(result.data.entries)) {
        return toToolOutput(result, `${result.data.entries.length} entries listed.`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'filesystem_read',
    displayName: 'Read Workspace File',
    description: 'Read the contents of a file inside an authorized sandbox workspace.',
    category: 'filesystem',
    riskLevel: 'read-only',
    parameters: {
      ...requestSession,
      path: { type: 'string', description: 'Workspace-relative file path', required: true },
    },
    handler: async (args) => {
      const result = await sandboxApi('fs-read', { sessionId: args.sessionId, path: args.path });
      return toToolOutput(result, `File ${args.path} read (${result.data.size || 0} bytes).`);
    },
  });

  registry.register({
    name: 'filesystem_write',
    displayName: 'Write Workspace File',
    description: 'Create or update a file inside an authorized sandbox workspace. Requires user approval.',
    category: 'filesystem',
    riskLevel: 'sensitive',
    parameters: {
      ...requestSession,
      path: { type: 'string', description: 'Workspace-relative file path', required: true },
      content: { type: 'string', description: 'Full file content to write', required: true },
      createDirectories: { type: 'boolean', description: 'Create missing parent directories (default true)' },
    },
    handler: async (args) => {
      const result = await sandboxApi('fs-write', { sessionId: args.sessionId, path: args.path, content: String(args.content || ''), createDirectories: args.createDirectories !== false });
      return toToolOutput(result, `File ${args.path} written (${result.data.size || 0} bytes).`);
    },
  });

  registry.register({
    name: 'filesystem_delete',
    displayName: 'Delete Workspace Path',
    description: 'Delete a file or directory inside an authorized sandbox workspace. Destructive and irreversible. Requires user approval.',
    category: 'filesystem',
    riskLevel: 'destructive',
    parameters: {
      ...requestSession,
      path: { type: 'string', description: 'Workspace-relative path to delete (the workspace root itself cannot be deleted)', required: true },
    },
    handler: async (args) => {
      const result = await sandboxApi('fs-delete', { sessionId: args.sessionId, path: args.path });
      return toToolOutput(result, `Deleted ${args.path}.`);
    },
  });

  registry.register({
    name: 'filesystem_search',
    displayName: 'Search Workspace Files',
    description: 'Search file contents inside an authorized sandbox workspace. Returns matching file paths.',
    category: 'filesystem',
    riskLevel: 'read-only',
    parameters: {
      ...requestSession,
      query: { type: 'string', description: 'Text to search for', required: true },
    },
    handler: async (args) => {
      const result = await sandboxApi('fs-search', { sessionId: args.sessionId, query: args.query });
      if (result.data.ok && Array.isArray(result.data.matches)) {
        return toToolOutput(result, `${result.data.matches.length} matching files found.`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'browser_session_create',
    displayName: 'Start Isolated Browser Session',
    description: 'Launch a real isolated browser session (separate cookies and storage) for inspecting and interacting with websites.',
    category: 'browser',
    riskLevel: 'moderate',
    parameters: { ...requestSession },
    handler: async (args) => {
      const result = await sandboxApi('browser-create', { sessionId: args.sessionId });
      if (result.data.ok && result.data.browserSessionId) {
        return toToolOutput(result, `Browser session ${result.data.browserSessionId} started.`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'browser_navigate',
    displayName: 'Navigate Browser Session',
    description: 'Navigate an isolated browser session to an authorized public URL. Localhost, private networks and cloud metadata endpoints are blocked. Requires user approval.',
    category: 'browser',
    riskLevel: 'sensitive',
    parameters: {
      ...requestSessionAndBrowser,
      url: { type: 'string', description: 'Public HTTP(S) URL to navigate to', required: true },
      timeoutMs: { type: 'number', description: 'Navigation timeout in ms (default 20000)' },
    },
    handler: async (args) => {
      const result = await sandboxApi('browser-navigate', { sessionId: args.sessionId, browserSessionId: args.browserSessionId, url: args.url, timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined });
      if (result.data.ok && result.data.url) {
        return toToolOutput(result, `Loaded "${result.data.title || 'page'}" at ${result.data.url}`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'browser_inspect',
    displayName: 'Inspect Page Elements',
    description: 'Inspect the DOM of the current page in an isolated browser session: links, buttons, inputs and text content.',
    category: 'browser',
    riskLevel: 'read-only',
    parameters: {
      ...requestSessionAndBrowser,
      selector: { type: 'string', description: 'Optional CSS selector to scope the inspection' },
      limit: { type: 'number', description: 'Maximum elements to return (default 60, max 200)' },
    },
    handler: async (args) => {
      const result = await sandboxApi('browser-inspect', {
        sessionId: args.sessionId, browserSessionId: args.browserSessionId,
        selector: typeof args.selector === 'string' ? args.selector : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
      if (result.data.ok && Array.isArray(result.data.elements)) {
        return toToolOutput(result, `${result.data.elements.length} elements inspected.`);
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'browser_click',
    displayName: 'Click Page Element',
    description: 'Click a button or link on the current page of an isolated browser session. Requires user approval.',
    category: 'browser',
    riskLevel: 'sensitive',
    parameters: {
      ...requestSessionAndBrowser,
      selector: { type: 'string', description: 'CSS selector of the element to click', required: true },
    },
    handler: async (args) => {
      const result = await sandboxApi('browser-click', { sessionId: args.sessionId, browserSessionId: args.browserSessionId, selector: args.selector });
      if (result.data.ok) return toToolOutput(result, `Clicked ${args.selector}. Current URL: ${result.data.urlAfter || 'unchanged'}`);
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'browser_fill',
    displayName: 'Fill Form Fields',
    description: 'Fill one or more form fields on the current page. Values are entered only inside the isolated sandbox browser. Requires user approval.',
    category: 'browser',
    riskLevel: 'sensitive',
    parameters: {
      ...requestSessionAndBrowser,
      fields: { type: 'array', description: 'Array of { selector, value, type } objects (max 25)', required: true },
    },
    handler: async (args) => {
      const fields = Array.isArray(args.fields) ? args.fields.slice(0, 25) : [];
      const result = await sandboxApi('browser-fill', { sessionId: args.sessionId, browserSessionId: args.browserSessionId, fields });
      if (result.data.ok) return toToolOutput(result, `Filled ${result.data.filled || 0} of ${fields.length} fields.`);
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'browser_screenshot',
    displayName: 'Capture Browser Screenshot',
    description: 'Capture a real screenshot of the current page in an isolated browser session. Returned as an image data URL.',
    category: 'browser',
    riskLevel: 'read-only',
    parameters: { ...requestSessionAndBrowser },
    handler: async (args) => {
      const result = await sandboxApi('browser-screenshot', { sessionId: args.sessionId, browserSessionId: args.browserSessionId });
      if (result.data.ok && result.data.dataUrl) return toToolOutput(result, 'Screenshot captured.');
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'browser_session_close',
    displayName: 'Close Browser Session',
    description: 'Close an isolated browser session and release its resources.',
    category: 'browser',
    riskLevel: 'moderate',
    parameters: { ...requestSessionAndBrowser },
    handler: async (args) => {
      const result = await sandboxApi('browser-close', { sessionId: args.sessionId, browserSessionId: args.browserSessionId });
      return toToolOutput(result, 'Browser session closed.');
    },
  });

  registry.register({
    name: 'preview_start',
    displayName: 'Start Development Preview',
    description: 'Install dependencies and start a dev server inside the sandbox, then verify readiness and return the real preview URL. Never fabricates URLs. Requires user approval.',
    category: 'coding',
    riskLevel: 'sensitive',
    parameters: {
      ...requestSession,
      installCommand: { type: 'string', description: 'Dependency installation command (default: npm install)' },
      startCommand: { type: 'string', description: 'Dev server start command (default: npm run dev -- --host 0.0.0.0)' },
      cwd: { type: 'string', description: 'Project directory within the workspace' },
      port: { type: 'number', description: 'Port the dev server listens on (default 3000)' },
    },
    handler: async (args) => {
      const result = await sandboxApi('preview-start', {
        sessionId: args.sessionId,
        installCommand: typeof args.installCommand === 'string' ? args.installCommand : undefined,
        startCommand: typeof args.startCommand === 'string' ? args.startCommand : undefined,
        cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
        port: typeof args.port === 'number' ? args.port : undefined,
      });
      if (result.data.ok && result.data.ready && result.data.url) {
        return toToolOutput(result, `Preview is live at ${result.data.url}`);
      }
      if (result.data.ok && result.data.ready === false) {
        return { success: false, error: 'PREVIEW_NOT_READY', data: result.data, summary: String(result.data.details || 'Dev server did not become ready.') };
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'preview_status',
    displayName: 'Check Preview Status',
    description: 'Check whether the sandbox dev server is still live and get its real URL.',
    category: 'coding',
    riskLevel: 'read-only',
    parameters: {
      ...requestSession,
      port: { type: 'number', description: 'Port to probe (default 3000)' },
    },
    handler: async (args) => {
      const result = await sandboxApi('preview-status', { sessionId: args.sessionId, port: typeof args.port === 'number' ? args.port : undefined });
      if (result.data.ok) {
        return toToolOutput(result, result.data.ready ? `Preview live at ${result.data.url}` : 'Preview server is not reachable.');
      }
      return toToolOutput(result, '');
    },
  });

  registry.register({
    name: 'sandbox_cleanup',
    displayName: 'Terminate Sandbox',
    description: 'Terminate a sandbox session, stop its processes and release resources. Irreversible. Requires user approval.',
    category: 'coding',
    riskLevel: 'destructive',
    parameters: { ...requestSession },
    handler: async (args) => {
      const result = await sandboxApi('cleanup', { sessionId: args.sessionId });
      return toToolOutput(result, 'Sandbox terminated and cleaned up.');
    },
  });
}
