import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RuntimeConfig } from './config.js';
import type { OctokitLike } from './github.js';
import { registerActionTools } from './tools/actions.js';
import { registerBranchTools } from './tools/branches.js';
import { registerFileTools } from './tools/files.js';
import { registerIssueAndPullRequestTools } from './tools/issues-prs.js';
import { registerRepositoryTools } from './tools/repositories.js';

export interface CreateServerOptions {
  config: RuntimeConfig;
  octokit: OctokitLike;
}

export function createMcpServer({ config, octokit }: CreateServerOptions): McpServer {
  const server = new McpServer({ name: 'cue-github-mcp', version: '1.0.0' });
  registerRepositoryTools(server, octokit, config);
  registerFileTools(server, octokit, config);
  registerBranchTools(server, octokit, config);
  registerIssueAndPullRequestTools(server, octokit, config);
  registerActionTools(server, octokit, config);
  return server;
}
