import assert from 'node:assert/strict';
import test from 'node:test';
import { registerVercelReadOnlyTools } from '../src/vercelTools.js';
import { createVercelMcpRoute, type VercelRouteDependencies } from '../src/vercelRoute.js';
import type { RuntimeConfig } from '../src/config.js';
import { testConfig } from './fixtures.js';

const serviceAccount = JSON.stringify({
  project_id: 'cue-app-project-123',
  client_email: 'mcp@example.iam.gserviceaccount.com',
  private_key: 'placeholder',
});

function routeConfig(overrides: NodeJS.ProcessEnv = {}): RuntimeConfig {
  return testConfig({
    MCP_TRANSPORT: 'http',
    FIREBASE_PROJECT_ID: 'cue-app-project-123',
    FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount,
    MCP_ALLOWED_FIREBASE_UIDS: 'cue-user-1',
    GITHUB_ALLOWED_REPOS: 'owner/repo',
    MCP_ALLOWED_HOSTS: 'mcp.test',
    MCP_ALLOWED_ORIGINS: 'https://cue.example',
    ...overrides,
  });
}

const repositoryData = {
  full_name: 'owner/repo',
  description: 'Read-only test repository',
  private: true,
  default_branch: 'main',
  visibility: 'private',
  archived: false,
  permissions: { pull: true, push: false, admin: false },
  html_url: 'https://github.com/owner/repo',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  pushed_at: '2024-01-02T00:00:00Z',
  topics: [],
  license: null,
};

function routeDependencies(config = routeConfig(), authorization = 'Bearer test-token'): VercelRouteDependencies {
  return {
    getConfig: () => config,
    authenticate: async (header) => header === authorization ? { uid: 'cue-user-1' } : null,
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 60, remaining: 119, distributed: true }),
    createOctokit: () => ({ rest: { repos: { get: async () => ({ data: repositoryData }) } } }),
  };
}

function request(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://mcp.test/api/mcp', {
  method,
  headers: {
    Host: 'mcp.test',
      ...(method === 'POST' ? {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        ...(body && typeof body === 'object' && 'method' in body ? { 'Mcp-Method': String((body as { method: unknown }).method) } : {}),
        ...(body && typeof body === 'object' && (body as { method?: unknown }).method === 'tools/call'
          && typeof (body as { params?: { name?: unknown } }).params?.name === 'string'
          ? { 'Mcp-Name': (body as { params: { name: string } }).params.name }
          : {}),
      } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

const clientMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

test('Vercel MCP adapter registers only read-only SDK v2 tools with full Zod schemas', () => {
  const config = routeConfig();
  const definitions: Array<{ name: string; definition: any; handler: unknown }> = [];
  const server = {
    registerTool(name: string, definition: any, handler: unknown) {
      definitions.push({ name, definition, handler });
    },
  } as any;

  registerVercelReadOnlyTools(server, { rest: {} }, config);
  assert.ok(definitions.length > 0);
  assert.ok(definitions.every(({ definition }) => definition.annotations?.readOnlyHint === true));
  assert.ok(definitions.every(({ definition }) => typeof definition.inputSchema?.safeParse === 'function'));
  assert.ok(!definitions.some(({ name }) => /create_|update_|delete_|archive_|fork_|review_|trigger_|dispatch/i.test(name)));

  assert.throws(() => registerVercelReadOnlyTools(server, { rest: {} }, { ...config, enableWriteTools: true }), /read-only/);
});

test('Vercel HTTP wrapper checks exact host, origin, bearer identity, request size, and CORS preflight', async () => {
  const route = createVercelMcpRoute(routeDependencies());

  const wrongHost = await route(request('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: clientMeta }, { Host: 'attacker.test', Authorization: 'Bearer test-token' }));
  assert.equal(wrongHost.status, 403);
  assert.equal((await wrongHost.json() as any).code, 'HOST_NOT_ALLOWED');

  const wrongOrigin = await route(request('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: clientMeta }, { Origin: 'https://attacker.example', Authorization: 'Bearer test-token' }));
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await wrongOrigin.json() as any).code, 'ORIGIN_NOT_ALLOWED');

  const unauthorized = await route(request('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: clientMeta }));
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json() as any).code, 'UNAUTHENTICATED');

  const tooLarge = await route(request('POST', '{}', { Authorization: 'Bearer test-token', 'Content-Length': '1048577' }));
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json() as any).code, 'BODY_TOO_LARGE');

  const preflight = await route(request('OPTIONS', undefined, { Origin: 'https://cue.example' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://cue.example');
  const allowedHeaders = preflight.headers.get('access-control-allow-headers') || '';
  assert.match(allowedHeaders, /Mcp-Method/i);
  assert.match(allowedHeaders, /Mcp-Name/i);
});

test('Vercel MCP v2 endpoint serves a stateless read-only tools/list request', async () => {
  const route = createVercelMcpRoute(routeDependencies());
  const response = await route(request('POST', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: { _meta: clientMeta },
  }, { Authorization: 'Bearer test-token' }));

  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json() as any;
  const tools = payload.result?.tools;
  assert.ok(Array.isArray(tools), JSON.stringify(payload));
  assert.ok(tools.length > 0);
  assert.ok(tools.every((tool: any) => tool.annotations?.readOnlyHint === true));
  assert.ok(!tools.some((tool: any) => /create_|update_|delete_|archive_|fork_|review_|trigger_|dispatch/i.test(tool.name)));
});

test('Vercel MCP v2 endpoint executes a bounded repository read for an allowlisted repo', async () => {
  const route = createVercelMcpRoute(routeDependencies());
  const response = await route(request('POST', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'github_get_repository',
      arguments: { owner: 'owner', repo: 'repo' },
      _meta: clientMeta,
    },
  }, { Authorization: 'Bearer test-token' }));

  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json() as any;
  assert.match(payload.result?.content?.[0]?.text || '', /owner\/repo/);
  assert.notEqual(payload.result?.isError, true);
});
