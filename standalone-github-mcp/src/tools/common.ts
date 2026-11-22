import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'approvalPhrase')
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

export function approvalPhraseFor(toolName: string, target: string, args: Record<string, unknown>): string {
  const digest = createHash('sha256').update(stableJson(args)).digest('hex').slice(0, 16);
  return `APPROVE ${toolName} ${target} ${digest}`;
}

export function requireApproval(
  toolName: string,
  target: string,
  args: Record<string, unknown>,
  provided?: string,
): void {
  const expected = approvalPhraseFor(toolName, target, args);
  if (provided !== expected) {
    throw new GitHubToolError(
      `Explicit user approval is required before this write. Show the exact operation and target (including file content or full change) to the user, then retry with approvalPhrase exactly equal to: "${expected}". The phrase binds the approval to this exact argument set. The MCP host must never invent or silently add it.`,
      'USER_APPROVAL_REQUIRED',
    );
  }
}

export const approvalPhraseSchema = z.string().min(1).max(200).optional().describe(
  'Required for state-changing operations. Only provide after the MCP host has shown the exact action and complete proposed change to the user and the user explicitly approved it. Do not infer or fabricate approval.',
);
