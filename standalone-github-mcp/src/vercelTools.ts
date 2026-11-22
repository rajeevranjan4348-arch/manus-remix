import type { McpServer as McpServerV2 } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { RuntimeConfig } from './config.js';
import type { OctokitLike } from './github.js';
import { registerActionTools } from './tools/actions.js';
import { registerBranchTools } from './tools/branches.js';
import { registerFileTools } from './tools/files.js';
import { registerIssueAndPullRequestTools } from './tools/issues-prs.js';
import { registerRepositoryTools } from './tools/repositories.js';

interface LegacyToolDefinition {
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean };
  [key: string]: unknown;
}

/**
 * Reuse the v1 tool handlers in a v2 server by adapting their raw Zod shape
 * definitions to v2's full Zod-object schema API. This Vercel adapter is
 * intentionally read-only; the existing v1 elicitation-based writes are not
 * compatible with Vercel's stateless MCP handler and remain disabled here.
 */
export function registerVercelReadOnlyTools(
  server: McpServerV2,
  octokit: OctokitLike,
  config: RuntimeConfig,
): void {
  if (config.enableWriteTools) {
    throw new Error('The Vercel MCP endpoint is read-only; write tools must remain disabled.');
  }

  const adapter = {
    registerTool(name: string, definition: LegacyToolDefinition, handler: (...args: any[]) => unknown) {
      if (definition.annotations?.readOnlyHint !== true) {
        throw new Error(`Refusing to register non-read-only Vercel tool: ${name}`);
      }
      const rawSchema = definition.inputSchema;
      const inputSchema = rawSchema && typeof (rawSchema as { safeParse?: unknown }).safeParse === 'function'
        ? rawSchema
        : rawSchema
          ? z.object(rawSchema as Record<string, z.ZodType>)
          : undefined;
      const normalizedDefinition = {
        ...definition,
        ...(inputSchema ? { inputSchema } : {}),
      };
      server.registerTool(name, normalizedDefinition as any, handler as any);
    },
  };

  registerRepositoryTools(adapter, octokit, config);
  registerFileTools(adapter, octokit, config);
  registerBranchTools(adapter, octokit, config);
  registerIssueAndPullRequestTools(adapter, octokit, config);
  registerActionTools(adapter, octokit, config);
}
