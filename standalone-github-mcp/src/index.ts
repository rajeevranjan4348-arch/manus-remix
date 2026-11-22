import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config.js';
import { createMcpHttpServer } from './http.js';
import { createOctokit } from './github.js';
import { createMcpServer } from './server.js';

export async function start(): Promise<void> {
  const config = readConfig();
  const octokit = createOctokit(config);
  if (config.transport === 'stdio') {
    const server = createMcpServer({ config, octokit });
    await server.connect(new StdioServerTransport());
    console.error('Cue GitHub MCP server started over stdio.');
    return;
  }
  const server = createMcpHttpServer({ config, octokit });
  server.listen(config.port, config.host, () => {
    console.info(JSON.stringify({ level: 'info', event: 'github_mcp_started', transport: 'streamable-http', host: config.host, port: config.port, githubAuthMode: config.githubAuthMode, allowlistedRepositoryCount: config.allowedRepos.size }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Startup failed.';
    console.error(JSON.stringify({ level: 'error', event: 'github_mcp_startup_failed', message }));
    process.exitCode = 1;
  });
}
