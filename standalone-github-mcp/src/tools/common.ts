import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RuntimeConfig } from '../config.js';
import { GitHubToolError } from '../github.js';

export const repoShape = {
  owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).describe('GitHub repository owner/login.'),
  repo: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).describe('Repository name.'),
};

export function asText(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function sanitizeError(error: unknown): { code: string; message: string } {
  if (error instanceof GitHubToolError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : 'GitHub operation failed.';
  const sanitized = message
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .slice(0, 500);
  return { code: 'GITHUB_OPERATION_FAILED', message: sanitized };
}

export function withToolErrors(handler: (args: any, extra: any) => Promise<unknown>) {
  return async (args: any, extra: any) => {
    const startedAt = Date.now();
    const traceId = randomUUID();
    try {
      const result = await handler(args, extra);
      console.info(JSON.stringify({ level: 'info', event: 'github_mcp_tool', traceId, tool: extra?.requestInfo?.method || 'tool', outcome: 'success', durationMs: Date.now() - startedAt }));
      return asText(result);
    } catch (error) {
      const safe = sanitizeError(error);
      console.warn(JSON.stringify({ level: 'warn', event: 'github_mcp_tool', traceId, outcome: 'error', code: safe.code, durationMs: Date.now() - startedAt }));
      return { ...asText({ error: safe.message, code: safe.code }), isError: true };
    }
  };
}

export function registerWriteTool(server: any, config: RuntimeConfig, name: string, definition: any, handler: any): void {
  if (!config.enableWriteTools) return;
  server.registerTool(name, definition, handler);
}

const MAX_APPROVAL_DETAILS_CHARS = 120_000;

export async function requireApproval(
  server: any,
  toolName: string,
  target: string,
  args: Record<string, unknown>,
): Promise<void> {
  const details = JSON.stringify({ tool: toolName, target, arguments: args }, null, 2);
  if (details.length > MAX_APPROVAL_DETAILS_CHARS) {
    throw new GitHubToolError('The exact operation is too large to review in an MCP approval form. No changes were made.', 'APPROVAL_DETAILS_TOO_LARGE');
  }

  let result: { action: string; content?: Record<string, unknown> };
  try {
    result = await server.server.elicitInput({
      mode: 'form',
      message: `Review the exact GitHub operation below. The server proceeds only if this client returns an explicit approval.\n\n${details}`,
      requestedSchema: {
        type: 'object',
        properties: {
          approved: {
            type: 'boolean',
            title: 'Approve this exact operation',
            description: 'Select true only after reviewing the complete target and proposed arguments above.',
          },
        },
        required: ['approved'],
      },
    }, { timeout: 120_000 });
  } catch {
    throw new GitHubToolError('This MCP client did not complete a supported form-based approval request. No changes were made.', 'APPROVAL_UNAVAILABLE');
  }

  if (result.action !== 'accept' || result.content?.approved !== true) {
    throw new GitHubToolError('The operation was not explicitly approved. No changes were made.', 'APPROVAL_DENIED');
  }
}
