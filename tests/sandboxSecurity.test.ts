import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  SandboxService,
  UrlPolicyError,
  assertBrowserUrlAllowed,
  DEFAULT_SANDBOX_LIMITS,
} from '../server/sandbox/sandboxService';
import { InMemoryDurableStore, setDefaultDurableStoreForTests } from '../server/durable/store';

const SANDBOX_REGISTRY_COLLECTION = 'system_sandbox_workspaces';

type ProviderHandler = (path: string, body: Record<string, any>) => Record<string, any>;

function startFakeProvider(handler: ProviderHandler): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: Record<string, any> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        } catch {
          body = {};
        }
        res.setHeader('Content-Type', 'application/json');
        try {
          const payload = handler(req.url ?? '', body);
          res.end(JSON.stringify(payload ?? {}));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'provider error' }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const BLOCKED_URLS = [
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://0.0.0.0',
  'https://metadata.google.internal/computeMetadata/v1/',
  'https://metadata.goog/computeMetadata/v1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.1.2.3/internal',
  'https://192.168.1.50/admin',
  'http://172.16.0.1',
  'https://172.31.255.255',
  'http://100.100.1.1',
  'http://instance-data/latest',
  'https://printer.local',
  'https://vault.internal',
  'ftp://example.com/file',
  'file:///etc/passwd',
  'not a url at all',
];

const PUBLIC_URL = 'https://example.com/some/page';
const ENV_KEYS = ['SANDBOX_PROVIDER_URL', 'SANDBOX_PROVIDER_TOKEN', 'WORKER_SANDBOX_URL', 'WORKER_API_TOKEN'];

describe('Feature 06: Sandboxed coding & real browser execution', () => {
  let service: SandboxService;
  const savedEnv: Record<string, string | undefined> = {};
  const createdServers: Server[] = [];

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    setDefaultDurableStoreForTests(new InMemoryDurableStore());
    service = new SandboxService();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    for (const server of createdServers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    createdServers.length = 0;
  });

  it('blocks private-network, loopback, metadata, and internal hosts while allowing public URLs', () => {
    for (const blocked of BLOCKED_URLS) {
      expect(() => assertBrowserUrlAllowed(blocked)).toThrow(UrlPolicyError);
    }
    const url = assertBrowserUrlAllowed(PUBLIC_URL);
    expect(url.hostname).toBe('example.com');
    expect(url.protocol).toBe('https:');
  });

  it('blocks IPv6 loopback and ULA addresses', () => {
    for (const host of ['http://[::1]:5000', 'http://[fd00::1]', 'http://[fe80::1]', 'http://[fc00::dead]']) {
      expect(() => assertBrowserUrlAllowed(host)).toThrow(UrlPolicyError);
    }
  });

  it('fails closed: every sandbox operation is explicitly unavailable without a provider', async () => {
    expect(service.isConfigured()).toBe(false);
    expect(service.unavailableReason()).toBeTruthy();

    const created = await service.createSandbox({ userId: 'usr_a', purpose: 'test' });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe('unavailable');
      expect(created.reason).toContain('provider');
    }

    const status = await service.status('sbx_missing', 'usr_a');
    expect(status.ok).toBe(false);
    const exec = await service.terminalExecute({ sandboxId: 'sbx_missing', userId: 'usr_a', command: 'ls' });
    expect(exec.ok).toBe(false);
    const list = await service.fsList('sbx_missing', 'usr_a', '/');
    expect(list.ok).toBe(false);
    const read = await service.fsRead('sbx_missing', 'usr_a', '/app/main.py');
    expect(read.ok).toBe(false);
    const write = await service.fsWrite('sbx_missing', 'usr_a', '/app/main.py', 'x');
    expect(write.ok).toBe(false);
    const del = await service.fsDelete('sbx_missing', 'usr_a', '/app/main.py');
    expect(del.ok).toBe(false);
    const search = await service.fsSearch('sbx_missing', 'usr_a', 'findme');
    expect(search.ok).toBe(false);
    const session = await service.browserSessionCreate({ sandboxId: 'sbx_missing', userId: 'usr_a', url: PUBLIC_URL });
    expect(session.ok).toBe(false);
    const preview = await service.previewStart('sbx_missing', 'usr_a', { command: 'npm run dev', port: 5173 });
    expect(preview.ok).toBe(false);
    const cleanup = await service.cleanup('sbx_missing', 'usr_a');
    expect(cleanup.ok).toBe(false);
  });

  it('never fabricates a preview URL when the dev server never reports readiness', async () => {
    const { server, url } = await startFakeProvider((path) => {
      if (path.startsWith('/sandbox/create')) return { sandboxId: 'sbx_preview', workdir: '/workspace', provider: 'fake' };
      if (path.startsWith('/preview/start')) return { readiness: 'starting' };
      return {};
    });
    createdServers.push(server);
    process.env.SANDBOX_PROVIDER_URL = url;
    process.env.SANDBOX_PROVIDER_TOKEN = 'test-provider-token';

    const created = await service.createSandbox({ userId: 'usr_preview', purpose: 'preview test' });
    expect(created.ok).toBe(true);
    const preview = await service.previewStart('sbx_preview', 'usr_preview', { command: 'npm run dev', port: 5173 });
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.reason).toContain('readiness');
      expect(JSON.stringify(preview)).not.toMatch(/previewUrl/);
    }
  }, 20_000);

  it('returns a real preview URL only when the provider verifies readiness', async () => {
    const { server, url } = await startFakeProvider((path) => {
      if (path.startsWith('/sandbox/create')) return { sandboxId: 'sbx_dev', workdir: '/workspace', provider: 'fake' };
      if (path.startsWith('/preview/start')) return { previewUrl: 'http://127.0.0.1:41773', readiness: 'ready' };
      if (path.startsWith('/preview/status')) return { status: 'ready', previewUrl: 'http://127.0.0.1:41773' };
      return {};
    });
    createdServers.push(server);
    process.env.SANDBOX_PROVIDER_URL = url;
    process.env.SANDBOX_PROVIDER_TOKEN = 'test-provider-token';

    const created = await service.createSandbox({ userId: 'usr_dev', purpose: 'dev server' });
    expect(created.ok).toBe(true);
    const preview = await service.previewStart('sbx_dev', 'usr_dev', { command: 'npm run dev', port: 5173 });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.previewUrl).toBe('http://127.0.0.1:41773');
      expect(preview.readiness).toBe('ready');
    }
    const status = await service.previewStatus('sbx_dev', 'usr_dev');
    expect(status.ok).toBe(true);
  });

  it('executes terminal commands through the provider contract with captured output', async () => {
    const { server, url } = await startFakeProvider((path, body) => {
      if (path.startsWith('/sandbox/create')) return { sandboxId: 'sbx_term', workdir: '/workspace', provider: 'fake' };
      if (path.startsWith('/sandbox/exec')) {
        expect(body.command).toBeTruthy();
        return { sandboxId: 'sbx_term', stdout: 'hello from sandbox\n', stderr: '', exitCode: 0 };
      }
      return {};
    });
    createdServers.push(server);
    process.env.SANDBOX_PROVIDER_URL = url;
    process.env.SANDBOX_PROVIDER_TOKEN = 'test-provider-token';

    await service.createSandbox({ userId: 'usr_term', purpose: 'terminal' });
    const chunks: Array<{ stream: string; text: string }> = [];
    const exec = await service.terminalExecute({
      sandboxId: 'sbx_term',
      userId: 'usr_term',
      command: 'echo hello from sandbox',
      onOutput: (chunk) => chunks.push(chunk),
    });
    expect(exec.ok).toBe(true);
    if (exec.ok) {
      expect(exec.result.stdout).toContain('hello from sandbox');
      expect(exec.result.exitCode).toBe(0);
    }
    expect(chunks.some((c) => c.stream === 'stdout' && c.text.includes('hello'))).toBe(true);

    const emptyCommand = await service.terminalExecute({ sandboxId: 'sbx_term', userId: 'usr_term', command: '   ' });
    expect(emptyCommand.ok).toBe(false);
  });

  it('enforces durable workspace ownership: other users cannot touch a workspace', async () => {
    const { server, url } = await startFakeProvider((path) => {
      if (path.startsWith('/sandbox/create')) return { sandboxId: 'sbx_owned', workdir: '/workspace', provider: 'fake' };
      if (path.startsWith('/sandbox/status')) return { status: 'running' };
      if (path.startsWith('/sandbox/exec')) return { sandboxId: 'sbx_owned', stdout: 'secret', stderr: '', exitCode: 0 };
      return {};
    });
    createdServers.push(server);
    process.env.SANDBOX_PROVIDER_URL = url;
    process.env.SANDBOX_PROVIDER_TOKEN = 'test-provider-token';

    const store = new InMemoryDurableStore();
    setDefaultDurableStoreForTests(store);
    const owned = new SandboxService();
    const created = await owned.createSandbox({ userId: 'usr_owner', purpose: 'owned' });
    expect(created.ok).toBe(true);

    const strangerStatus = await owned.status('sbx_owned', 'usr_attacker');
    expect(strangerStatus.ok).toBe(false);
    expect(strangerStatus.ok === false ? strangerStatus.reason : '').toContain('ownership');

    const strangerExec = await owned.terminalExecute({
      sandboxId: 'sbx_owned',
      userId: 'usr_attacker',
      command: 'cat /etc/passwd',
    });
    expect(strangerExec.ok).toBe(false);
    expect(strangerExec.ok === false ? strangerExec.reason : '').toContain('ownership');

    const registryDoc = await store.get(SANDBOX_REGISTRY_COLLECTION, 'sbx_owned');
    expect(registryDoc!.userId).toBe('usr_owner');

    const ownerStatus = await owned.status('sbx_owned', 'usr_owner');
    expect(ownerStatus.ok).toBe(true);
  });

  it('enforces the public-web URL policy through the browser path even when a provider is configured', async () => {
    const { server, url } = await startFakeProvider((path) => {
      if (path.startsWith('/sandbox/create')) return { sandboxId: 'sbx_browser', workdir: '/workspace', provider: 'fake' };
      if (path.startsWith('/browser/session/create')) return { session: { sessionId: 'sess_1', status: 'active' } };
      return {};
    });
    createdServers.push(server);
    process.env.SANDBOX_PROVIDER_URL = url;
    process.env.SANDBOX_PROVIDER_TOKEN = 'test-provider-token';

    await service.createSandbox({ userId: 'usr_browser', purpose: 'browser' });
    for (const blocked of BLOCKED_URLS.slice(0, 8)) {
      const session = await service.browserSessionCreate({ sandboxId: 'sbx_browser', userId: 'usr_browser', url: blocked });
      expect(session.ok).toBe(false);
      expect(session.ok === false ? session.code : '').toBe('blocked');
    }
  });

  it('validates file-size limits before contacting the provider', async () => {
    process.env.SANDBOX_PROVIDER_URL = 'http://127.0.0.1:1';
    process.env.SANDBOX_PROVIDER_TOKEN = 'test-provider-token';
    const bigContent = 'x'.repeat(5 * 1024 * 1024);
    const result = await service.fsWrite('sbx_any', 'usr_a', '/app/big.txt', bigContent);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('limit');
  });

  it('defines hard sandbox resource limits', () => {
    expect(DEFAULT_SANDBOX_LIMITS.cpuCores).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.memoryMb).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.diskMb).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.timeoutMs).toBeGreaterThan(0);
  });
});
