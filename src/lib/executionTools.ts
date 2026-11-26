/**
 * Feature 06 (+01) client-side tool registration for the existing
 * ToolRegistryService. These tools call the authenticated Netlify endpoints
 * that front the durable worker and sandbox provider; no results are faked
 * client-side and unavailable providers surface an explicit unavailable state.
 */

import { toolRegistry } from './toolFramework';
import { callSandboxApi, callTasksApi } from './sandboxClient';
import type { ToolExecutionContext } from './toolFramework';

export function registerExecutionTools(): void {
  const register = (def: Parameters<typeof toolRegistry.register>[0]) => toolRegistry.register(def);

  register({
    name: 'sandbox_create',
    displayName: 'Create Sandbox',
    description: 'Create an isolated execution workspace with CPU, memory and time limits for an authorized coding task.',
    category: 'coding',
    riskLevel: 'moderate',
    parameters: {
      runtimes: { type: 'array', description: 'Runtimes required (node, python, react, vite, nextjs...)' },
      purpose: { type: 'string', description: 'What the sandbox will be used for' },
    },
    handler: async (args, context) => callSandboxApi('sandbox_create', args, context),
  });

  register({
    name: 'sandbox_status',
    displayName: 'Sandbox Status',
    description: 'Report liveness and metadata of an existing sandbox workspace.',
    category: 'coding',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Sandbox identifier', required: true } },
    handler: async (args, context) => callSandboxApi('sandbox_status', args, context),
  });

  register({
    name: 'terminal_execute',
    displayName: 'Execute Terminal Command',
    description: 'Run a real shell command inside the isolated sandbox (never on the host) and capture stdout/stderr and the exit code.',
    category: 'coding',
    riskLevel: 'privileged',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      command: { type: 'string', description: 'Command to execute', required: true },
      cwd: { type: 'string', description: 'Working directory inside the sandbox' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
    },
    handler: async (args, context) => callSandboxApi('terminal_execute', args, context),
  });

  register({
    name: 'terminal_stream',
    displayName: 'Stream Terminal Output',
    description: 'Live stdout/stderr streaming from a running sandbox process.',
    category: 'coding',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true } },
    handler: async (args, context) => callSandboxApi('terminal_stream', args, context),
  });

  register({
    name: 'terminal_cancel',
    displayName: 'Cancel Terminal Process',
    description: 'Kill a running process inside the sandbox.',
    category: 'coding',
    riskLevel: 'moderate',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      pid: { type: 'number', description: 'Process id to cancel', required: true },
    },
    handler: async (args, context) => callSandboxApi('terminal_cancel', args, context),
  });

  register({
    name: 'filesystem_list',
    displayName: 'List Sandbox Files',
    description: 'List files and directories in the sandbox workspace.',
    category: 'filesystem',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, dir: { type: 'string', description: 'Directory to list' } },
    handler: async (args, context) => callSandboxApi('filesystem_list', args, context),
  });

  register({
    name: 'filesystem_read',
    displayName: 'Read Sandbox File',
    description: 'Read a file inside the sandbox workspace with path-traversal protection.',
    category: 'filesystem',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, path: { type: 'string', description: 'File path', required: true } },
    handler: async (args, context) => callSandboxApi('filesystem_read', args, context),
  });

  register({
    name: 'filesystem_write',
    displayName: 'Write Sandbox File',
    description: 'Create or modify a file inside the sandbox workspace.',
    category: 'filesystem',
    riskLevel: 'privileged',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      path: { type: 'string', description: 'File path', required: true },
      content: { type: 'string', description: 'File content', required: true },
    },
    handler: async (args, context) => callSandboxApi('filesystem_write', args, context),
  });

  register({
    name: 'filesystem_delete',
    displayName: 'Delete Sandbox File',
    description: 'Delete a file inside the sandbox workspace.',
    category: 'filesystem',
    riskLevel: 'destructive',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, path: { type: 'string', description: 'File path', required: true } },
    handler: async (args, context) => callSandboxApi('filesystem_delete', args, context),
  });

  register({
    name: 'filesystem_search',
    displayName: 'Search Sandbox Files',
    description: 'Search file contents within the sandbox workspace.',
    category: 'filesystem',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, query: { type: 'string', description: 'Search text', required: true } },
    handler: async (args, context) => callSandboxApi('filesystem_search', args, context),
  });

  register({
    name: 'browser_session_create',
    displayName: 'Open Browser Session',
    description: 'Start an isolated real browser session at a public URL. Private-network and metadata targets are blocked by policy.',
    category: 'browser',
    riskLevel: 'privileged',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, url: { type: 'string', description: 'Public URL to open', required: true } },
    handler: async (args, context) => callSandboxApi('browser_session_create', args, context),
  });

  register({
    name: 'browser_navigate',
    displayName: 'Navigate Browser',
    description: 'Drive the active browser session to a new public page.',
    category: 'browser',
    riskLevel: 'privileged',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      sessionId: { type: 'string', description: 'Browser session id', required: true },
      url: { type: 'string', description: 'Public URL to navigate to', required: true },
    },
    handler: async (args, context) => callSandboxApi('browser_navigate', args, context),
  });

  register({
    name: 'browser_inspect',
    displayName: 'Inspect Page',
    description: 'Inspect the DOM, title and console errors of the active browser page.',
    category: 'browser',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, sessionId: { type: 'string', description: 'Browser session id', required: true } },
    handler: async (args, context) => callSandboxApi('browser_inspect', args, context),
  });

  register({
    name: 'browser_click',
    displayName: 'Click Element',
    description: 'Click an element inside the active browser session.',
    category: 'browser',
    riskLevel: 'privileged',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      sessionId: { type: 'string', description: 'Browser session id', required: true },
      selector: { type: 'string', description: 'CSS selector', required: true },
    },
    handler: async (args, context) => callSandboxApi('browser_click', args, context),
  });

  register({
    name: 'browser_fill',
    displayName: 'Fill Form Fields',
    description: 'Fill form fields inside the active browser session.',
    category: 'browser',
    riskLevel: 'privileged',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      sessionId: { type: 'string', description: 'Browser session id', required: true },
      values: { type: 'object', description: 'Map of selector to value', required: true },
    },
    handler: async (args, context) => callSandboxApi('browser_fill', args, context),
  });

  register({
    name: 'browser_screenshot',
    displayName: 'Capture Screenshot',
    description: 'Capture a screenshot of the active browser page.',
    category: 'browser',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, sessionId: { type: 'string', description: 'Browser session id', required: true } },
    handler: async (args, context) => callSandboxApi('browser_screenshot', args, context),
  });

  register({
    name: 'browser_session_close',
    displayName: 'Close Browser Session',
    description: 'Close the browser session and release its resources.',
    category: 'browser',
    riskLevel: 'safe',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true }, sessionId: { type: 'string', description: 'Browser session id', required: true } },
    handler: async (args, context) => callSandboxApi('browser_session_close', args, context),
  });

  register({
    name: 'preview_start',
    displayName: 'Start Live Preview',
    description: 'Install dependencies and start a real dev server in the sandbox; returns the verified preview URL when the server reports readiness.',
    category: 'coding',
    riskLevel: 'privileged',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      command: { type: 'string', description: 'Dev server command', required: true },
      port: { type: 'number', description: 'Dev server port', required: true },
    },
    handler: async (args, context) => callSandboxApi('preview_start', args, context),
  });

  register({
    name: 'preview_status',
    displayName: 'Preview Status',
    description: 'Report current preview readiness and URL for the sandbox.',
    category: 'coding',
    riskLevel: 'read-only',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true } },
    handler: async (args, context) => callSandboxApi('preview_status', args, context),
  });

  register({
    name: 'sandbox_cleanup',
    displayName: 'Destroy Sandbox',
    description: 'Terminate all sandbox processes and delete the transient workspace.',
    category: 'coding',
    riskLevel: 'destructive',
    parameters: { sandboxId: { type: 'string', description: 'Target sandbox', required: true } },
    handler: async (args, context) => callSandboxApi('sandbox_cleanup', args, context),
  });

  register({
    name: 'delete_file',
    displayName: 'Delete Sandbox File',
    description: 'Delete a file inside an isolated sandbox workspace (durable execution path).',
    category: 'filesystem',
    riskLevel: 'destructive',
    parameters: {
      sandboxId: { type: 'string', description: 'Target sandbox', required: true },
      path: { type: 'string', description: 'File path inside the sandbox', required: true },
    },
    handler: async (args, context) => callSandboxApi('filesystem_delete', args, context),
  });

  register({
    name: 'enqueue_background_task',
    displayName: 'Create Background Task',
    description: 'Create a durable background task that continues after the browser is closed and survives reloads/restarts.',
    category: 'system',
    riskLevel: 'moderate',
    parameters: {
      type: { type: 'string', description: 'Task type (research, coding, automation...)', required: true },
      payload: { type: 'object', description: 'Task payload' },
      idempotencyKey: { type: 'string', description: 'Stable key preventing duplicate execution' },
      priority: { type: 'number', description: 'Higher runs first' },
    },
    handler: async (args, context) => callTasksApi('enqueue', args),
  });

  register({
    name: 'task_status',
    displayName: 'Task Status',
    description: 'Read durable task status and execution history.',
    category: 'system',
    riskLevel: 'read-only',
    parameters: { taskId: { type: 'string', description: 'Task id', required: true } },
    handler: async (args) => callTasksApi('get', args),
  });
}
