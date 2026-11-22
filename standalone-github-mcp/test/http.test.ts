import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { createMcpHttpServer } from '../src/http.js';
import { readConfig } from '../src/config.js';

function hostedTestConfig() {
  return readConfig({
    NODE_ENV: 'test',
    MCP_TRANSPORT: 'http',
    GITHUB_TOKEN: 'test-token-not-a-secret',
    FIREBASE_PROJECT_ID: 'cue-app-project-123',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'cue-app-project-123', client_email: 'mcp@example.iam.gserviceaccount.com', private_key: 'placeholder' }),
    MCP_ALLOWED_FIREBASE_UIDS: 'cue-user-1',
    GITHUB_ALLOWED_REPOS: 'owner/repo',
    MCP_ALLOWED_HOSTS: 'mcp.test',
    MCP_ALLOWED_ORIGINS: 'https://cue.example',
  });
}

function rawRequest(port: number, method: string, path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, method, path, headers: { Connection: 'close', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('Streamable HTTP enforces host/origin/auth, serves unauthenticated health, and accepts trusted CORS preflight', async () => {
  const config = hostedTestConfig();
  const server = createMcpHttpServer({ config, octokit: { rest: {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const allowedHost = `127.0.0.1:${address.port}`;
  config.allowedHosts.add(allowedHost);

  try {
    const preflight = await rawRequest(address.port, 'OPTIONS', '/mcp', {
      Host: allowedHost,
      Origin: 'https://cue.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,mcp-session-id',
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://cue.example');

    const untrustedHost = await rawRequest(address.port, 'POST', '/mcp', { Host: 'attacker.example', 'Content-Type': 'application/json' }, '{}');
    assert.equal(untrustedHost.statusCode, 403);

    const untrustedOrigin = await rawRequest(address.port, 'POST', '/mcp', { Host: allowedHost, Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, '{}');
    assert.equal(untrustedOrigin.statusCode, 403);

    const unauthenticated = await rawRequest(address.port, 'POST', '/mcp', { Host: allowedHost, 'Content-Type': 'application/json' }, '{}');
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(JSON.parse(unauthenticated.body).code, 'UNAUTHENTICATED');

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(health.status, 200);
    const payload = await health.json() as any;
    assert.equal(payload.ok, true);
    assert.equal(JSON.stringify(payload).includes('test-token-not-a-secret'), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
