import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { RuntimeConfig } from '../src/config.js';
import { readConfig } from '../src/config.js';
import { createMcpServer } from '../src/server.js';

type TestClientOptions = { elicitationAction?: 'accept' | 'decline' | 'cancel' };

export function testConfig(overrides: NodeJS.ProcessEnv = {}): RuntimeConfig {
  return readConfig({
    NODE_ENV: 'test',
    MCP_TRANSPORT: 'stdio',
    GITHUB_TOKEN: 'test-token-not-a-secret',
    ...overrides,
  });
}

export async function createTestClient(config: RuntimeConfig, octokit: any, options: TestClientOptions = {}) {
  const server = createMcpServer({ config, octokit });
  const client = new Client(
    { name: 'cue-github-mcp-test', version: '1.0.0' },
    options.elicitationAction ? { capabilities: { elicitation: { form: {} } } } : undefined,
  );
  const elicitationRequests: any[] = [];
  if (options.elicitationAction) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      elicitationRequests.push(request.params);
      if (options.elicitationAction === 'accept') return { action: 'accept', content: { approved: true } };
      return { action: options.elicitationAction };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    elicitationRequests,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export function parseToolText(result: any): any {
  const text = result.content?.find((item: any) => item.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error('MCP tool returned no text content.');
  return JSON.parse(text);
}
