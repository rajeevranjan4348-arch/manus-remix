/**
 * Feature 06: Sandboxed Coding & Real Browser Execution Engine — Automated Test Suite
 *
 * Tests real HTTP wire protocols against isolated local HTTP worker servers (simulating
 * external sandbox container runtime and isolated browser worker services), real temp
 * filesystem boundaries, real PNG screenshot payloads, SSE terminal streaming, durable
 * persistence across serverless cold starts, permissions gateway single-use tokens,
 * SSRF/private-network/DNS-rebinding defenses, live preview HTTP readiness checks,
 * HMAC-SHA256 signed webhooks, all 20 registered tools, and Netlify serverless routes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { InMemoryDurableStore, type DurableRequestContext } from '../server/sandbox/durableStore';
import { HttpRuntimeSandboxProvider } from '../server/sandbox/providers/httpRuntimeProvider';
import { resolveSandboxProvider, SandboxProviderError } from '../server/sandbox/providers';
import { HttpBrowserProvider } from '../server/browser/providers/httpBrowserProvider';
import { resolveBrowserProvider, BrowserProviderError } from '../server/browser/providers';
import { SandboxExecutionEngine, SandboxEngineError } from '../server/sandbox/sandboxEngine';
import { BrowserExecutionEngine, BrowserEngineError } from '../server/browser/browserEngine';
import { PermissionsGatewayService } from '../server/permissionsGateway';
import {
  sanitizeSandboxEnv,
  resolveWorkspacePath,
  validateBrowserNavigationUrl,
  redactSensitiveExecutionText,
} from '../server/sandbox/security';
import { handleSandboxRequest } from '../netlify/functions/sandbox';
import { handleBrowserRequest } from '../netlify/functions/browser';
import agentStatusHandler from '../netlify/functions/agent-status';
import { issueGuestSessionToken } from '../server/guestSessionAuth';
import { toolRegistry } from '../src/lib/toolFramework';
import { browserAutomation } from '../src/lib/browserAutomation';

// Minimal valid 1x1 PNG image bytes (real PNG signature 89 50 4E 47 0D 0A 1A 0A)
const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

interface LocalTestServer {
  server: http.Server;
  url: string;
}

async function startHttpServer(handler: http.RequestListener): Promise<LocalTestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

async function stopHttpServer(srv?: LocalTestServer): Promise<void> {
  if (!srv) return;
  await new Promise<void>((resolve) => srv.server.close(() => resolve()));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

describe('Feature 06: Sandboxed Coding & Real Browser Execution Engine', () => {
  const WORKER_API_KEY = 'test-isolated-worker-token-32bytes';
  let tempRootDir = '';
  let sandboxWorker: LocalTestServer;
  let browserWorker: LocalTestServer;
  let previewTargetServer: LocalTestServer;

  // Worker runtime test state & fault injection hooks
  const sandboxDirs = new Map<string, string>();
  const sandboxStatuses = new Map<string, string>();
  const cancelledExecutions = new Set<string>();
  let failNextExecuteWith502 = false;
  let previewReturnStatus = 200;

  // Browser worker state
  const browserSessions = new Map<
    string,
    {
      url: string;
      title: string;
      textContent: string;
      formValues: Record<string, string>;
      scrollY: number;
      consoleErrors: Array<{ level: 'error' | 'warning'; text: string; timestamp: string }>;
    }
  >();
  let simulateOpenRedirectToInternal = false;

  const mapContainerPathToTemp = (sandboxId: string, containerPath: string): string => {
    const base = sandboxDirs.get(sandboxId);
    if (!base) throw new Error('Unknown sandbox');
    const rel = containerPath.replace(/^\/workspace\/?/, '');
    const resolved = path.resolve(base, rel || '.');
    if (!resolved.startsWith(base)) {
      throw new Error('Path escape detected in worker');
    }
    return resolved;
  };

  beforeAll(async () => {
    tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manus-f06-test-'));

    // 1. Live Preview HTTP target server (verifies real HTTP readiness checks)
    previewTargetServer = await startHttpServer((_req, res) => {
      res.writeHead(previewReturnStatus, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(previewReturnStatus === 200 ? '<!doctype html><h1>Live Vite App Ready</h1>' : 'Server Error');
    });

    // 2. Real HTTP Isolated Sandbox Runtime Worker
    sandboxWorker = await startHttpServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${WORKER_API_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized worker call' }));
        return;
      }

      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = urlObj.pathname;

      try {
        if (req.method === 'GET' && pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, supportedRuntimes: ['node', 'typescript', 'python', 'vite'] }));
          return;
        }

        if (req.method === 'POST' && pathname === '/sandboxes') {
          const body = await readBody(req);
          const providerSandboxId = `psb_${crypto.randomBytes(6).toString('hex')}`;
          const dir = path.join(tempRootDir, providerSandboxId);
          await fs.mkdir(dir, { recursive: true });
          sandboxDirs.set(providerSandboxId, dir);
          sandboxStatuses.set(providerSandboxId, 'running');
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              providerSandboxId,
              workspaceRoot: '/workspace',
              status: 'running',
              image: body.image || `manus-${body.runtime || 'node'}`,
            }),
          );
          return;
        }

        const sbMatch = pathname.match(/^\/sandboxes\/([^/]+)(\/.*)?$/);
        if (!sbMatch) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }

        const psbId = decodeURIComponent(sbMatch[1]);
        const rest = sbMatch[2] || '';

        if (!sandboxDirs.has(psbId)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sandbox not found' }));
          return;
        }

        if (req.method === 'GET' && rest === '') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: sandboxStatuses.get(psbId) || 'running' }));
          return;
        }

        if (req.method === 'DELETE' && rest === '') {
          sandboxStatuses.set(psbId, 'stopped');
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === 'POST' && rest === '/terminal/execute') {
          if (failNextExecuteWith502) {
            failNextExecuteWith502 = false;
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Transient upstream gateway error' }));
            return;
          }
          const body = await readBody(req);
          const execId = `pexec_${crypto.randomBytes(5).toString('hex')}`;
          const cmd = String(body.command || '');

          if (cmd.includes('FAIL_WITH_STDERR')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                executionId: execId,
                stdout: 'partial stdout output\n',
                stderr: 'fatal: simulated non-zero failure\n',
                exitCode: 2,
              }),
            );
            return;
          }

          if (cmd.includes('LEAK_SECRET_CHECK')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                executionId: execId,
                stdout: 'key=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567 and token=sk-live-secret9999999999999999\n',
                stderr: '',
                exitCode: 0,
              }),
            );
            return;
          }

          if (cmd.includes('SIMULATE_TIMEOUT')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                executionId: execId,
                stdout: '',
                stderr: 'Command exceeded timeout limit',
                exitCode: 124,
                timedOut: true,
              }),
            );
            return;
          }

          if (cmd.includes('DEV_SERVER_CRASH')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                executionId: execId,
                stdout: '',
                stderr: 'Error: EADDRINUSE port already in use',
                exitCode: 1,
              }),
            );
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              executionId: execId,
              stdout: `executed:${cmd} cwd:${body.cwd}\n`,
              stderr: 'info-stderr-line\n',
              exitCode: body.background ? null : 0,
              chunks: [
                { stream: 'stdout', data: `executed:${cmd} cwd:${body.cwd}\n` },
                { stream: 'stderr', data: 'info-stderr-line\n' },
              ],
            }),
          );
          return;
        }

        const cancelMatch = rest.match(/^\/terminal\/([^/]+)\/cancel$/);
        if (req.method === 'POST' && cancelMatch) {
          cancelledExecutions.add(decodeURIComponent(cancelMatch[1]));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ cancelled: true }));
          return;
        }

        if (req.method === 'GET' && rest === '/files/list') {
          const target = mapContainerPathToTemp(psbId, urlObj.searchParams.get('path') || '/workspace');
          const dirents = await fs.readdir(target, { withFileTypes: true });
          const base = sandboxDirs.get(psbId)!;
          const entries = dirents.map((d) => {
            const full = path.join(target, d.name);
            const rel = path.relative(base, full).replace(/\\/g, '/');
            return {
              name: d.name,
              path: `/workspace/${rel}`,
              type: d.isDirectory() ? 'directory' : 'file',
            };
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ entries }));
          return;
        }

        if (req.method === 'GET' && rest === '/files/read') {
          const target = mapContainerPathToTemp(psbId, urlObj.searchParams.get('path') || '');
          const content = await fs.readFile(target, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content }));
          return;
        }

        if (req.method === 'POST' && rest === '/files/write') {
          const body = await readBody(req);
          const target = mapContainerPathToTemp(psbId, body.path);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, body.content, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.method === 'POST' && rest === '/files/delete') {
          const body = await readBody(req);
          const target = mapContainerPathToTemp(psbId, body.path);
          await fs.rm(target, { recursive: true, force: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.method === 'POST' && rest === '/files/mkdir') {
          const body = await readBody(req);
          const target = mapContainerPathToTemp(psbId, body.path);
          await fs.mkdir(target, { recursive: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.method === 'POST' && rest === '/files/rename') {
          const body = await readBody(req);
          const fromTarget = mapContainerPathToTemp(psbId, body.fromPath);
          const toTarget = mapContainerPathToTemp(psbId, body.toPath);
          await fs.mkdir(path.dirname(toTarget), { recursive: true });
          await fs.rename(fromTarget, toTarget);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.method === 'GET' && rest === '/files/search') {
          const base = sandboxDirs.get(psbId)!;
          const target = mapContainerPathToTemp(psbId, urlObj.searchParams.get('path') || '/workspace');
          const query = urlObj.searchParams.get('query') || '';
          const matches: Array<{ path: string; line: number; preview: string }> = [];

          const walk = async (dir: string) => {
            const items = await fs.readdir(dir, { withFileTypes: true });
            for (const item of items) {
              const full = path.join(dir, item.name);
              if (item.isDirectory()) {
                await walk(full);
              } else {
                const txt = await fs.readFile(full, 'utf8');
                txt.split('\n').forEach((line, idx) => {
                  if (line.includes(query)) {
                    matches.push({
                      path: `/workspace/${path.relative(base, full).replace(/\\/g, '/')}`,
                      line: idx + 1,
                      preview: line.trim(),
                    });
                  }
                });
              }
            }
          };
          await walk(target);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ matches }));
          return;
        }

        if (req.method === 'POST' && rest === '/files/artifact') {
          const bundle = JSON.stringify({ sandbox: psbId, format: 'workspace-bundle' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              filename: `${psbId}.json`,
              mimeType: 'application/json',
              encoding: 'base64',
              sizeBytes: Buffer.byteLength(bundle),
              contentBase64: Buffer.from(bundle).toString('base64'),
              fileCount: 1,
              createdAt: new Date().toISOString(),
            }),
          );
          return;
        }

        const previewMatch = rest.match(/^\/preview\/(\d+)$/);
        if (req.method === 'GET' && previewMatch) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ previewUrl: `${previewTargetServer.url}/?port=${previewMatch[1]}` }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unhandled worker route: ${rest}` }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'Worker error' }));
      }
    });

    // 3. Real HTTP Isolated Browser Runtime Worker
    browserWorker = await startHttpServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${WORKER_API_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized browser worker call' }));
        return;
      }

      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = urlObj.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && pathname === '/sessions') {
        const providerSessionId = `pbs_${crypto.randomBytes(6).toString('hex')}`;
        browserSessions.set(providerSessionId, {
          url: 'about:blank',
          title: '',
          textContent: '',
          formValues: {},
          scrollY: 0,
          consoleErrors: [],
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ providerSessionId }));
        return;
      }

      const sessMatch = pathname.match(/^\/sessions\/([^/]+)(\/.*)?$/);
      if (!sessMatch) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const pbsId = decodeURIComponent(sessMatch[1]);
      const rest = sessMatch[2] || '';
      const state = browserSessions.get(pbsId);
      if (!state) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      const buildPageState = () => ({
        url: state.url,
        title: state.title,
        statusCode: 200,
        textContent: state.textContent,
        headings: ['Example Domain'],
        links: [{ text: 'More information...', href: 'https://www.iana.org/domains/example' }],
        interactiveElements: [
          { tag: 'button', selector: '#learn-more', text: 'Learn More' },
          { tag: 'input', selector: 'input[name="email"]', type: 'email', name: 'email' },
          { tag: 'button', selector: '#delete-account', text: 'Delete Account' },
        ],
        consoleErrors: state.consoleErrors,
        untrustedData: true,
      });

      if (req.method === 'DELETE' && rest === '') {
        browserSessions.delete(pbsId);
        res.writeHead(204);
        res.end();
        return;
      }

      const body = await readBody(req);

      if (req.method === 'POST' && rest === '/navigate') {
        if (simulateOpenRedirectToInternal) {
          simulateOpenRedirectToInternal = false;
          state.url = 'http://169.254.169.254/latest/meta-data/';
        } else {
          state.url = body.url;
        }
        state.title = 'Example Verified Page';
        state.textContent = `Loaded real page at ${state.url}`;
        state.consoleErrors = [
          { level: 'error', text: 'Uncaught ReferenceError: analyticsBeacon is not defined', timestamp: new Date().toISOString() },
        ];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildPageState()));
        return;
      }

      if (req.method === 'POST' && rest === '/inspect') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildPageState()));
        return;
      }

      if (req.method === 'POST' && rest === '/click') {
        state.textContent += ` [clicked:${body.selector}]`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ actionSucceeded: true, pageState: buildPageState() }));
        return;
      }

      if (req.method === 'POST' && rest === '/fill') {
        state.formValues[body.selector] = body.value;
        state.textContent += ` [filled:${body.selector}]`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ actionSucceeded: true, pageState: buildPageState() }));
        return;
      }

      if (req.method === 'POST' && rest === '/scroll') {
        state.scrollY += body.direction === 'up' ? -(body.pixels || 600) : body.pixels || 600;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ actionSucceeded: true, pageState: buildPageState() }));
        return;
      }

      if (req.method === 'POST' && rest === '/wait') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ actionSucceeded: true, pageState: buildPageState() }));
        return;
      }

      if (req.method === 'POST' && rest === '/screenshot') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            sessionId: pbsId,
            url: state.url,
            title: state.title,
            mimeType: body.format === 'jpeg' ? 'image/jpeg' : 'image/png',
            dataBase64: VALID_1X1_PNG_BASE64,
            fullPage: Boolean(body.fullPage),
            capturedAt: new Date().toISOString(),
          }),
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unhandled browser route: ${rest}` }));
    });
  });

  afterAll(async () => {
    await stopHttpServer(sandboxWorker);
    await stopHttpServer(browserWorker);
    await stopHttpServer(previewTargetServer);
    if (tempRootDir) {
      await fs.rm(tempRootDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function createTestEngines(sharedStore = new InMemoryDurableStore()) {
    const gateway = new PermissionsGatewayService();
    const sandboxProvider = new HttpRuntimeSandboxProvider({
      baseUrl: sandboxWorker.url,
      apiKey: WORKER_API_KEY,
    });
    const browserProvider = new HttpBrowserProvider({
      baseUrl: browserWorker.url,
      apiKey: WORKER_API_KEY,
    });

    // Local test previewProbe hits our real local previewTargetServer HTTP server
    const localPreviewProbe = async (url: string, timeoutMs: number) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return {
          ok: res.status >= 200 && res.status < 500,
          status: res.status,
          error: res.status >= 500 ? `Preview server returned HTTP ${res.status}` : undefined,
        };
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Unreachable' };
      }
    };

    const sandboxEngine = new SandboxExecutionEngine({
      store: sharedStore,
      providerResolver: () => sandboxProvider,
      gateway,
      previewProbe: localPreviewProbe,
    });

    const browserEngine = new BrowserExecutionEngine({
      store: sharedStore,
      providerResolver: () => browserProvider,
      gateway,
      skipDnsLookup: true, // Avoid external network dependency during CI/unit tests while testing all static/IP/redirect guards
    });

    return { sharedStore, gateway, sandboxEngine, browserEngine, sandboxProvider, browserProvider };
  }

  // =========================================================================
  // 1. Sandbox Creation, Limits Clamping & Environment Sanitization
  // =========================================================================
  it('1. creates isolated sandboxes with unique IDs, clamped limits, and strips secret env vars', async () => {
    const { sandboxEngine } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_alpha' };

    const safeEnv = sanitizeSandboxEnv({
      NODE_ENV: 'development',
      GEMINI_API_KEY: 'AIzaSySecretKey',
      E2B_API_KEY: 'e2b_secret',
      FIREBASE_SERVICE_ACCOUNT: '{}',
      LD_PRELOAD: '/tmp/evil.so',
      APP_FEATURE_FLAG: 'enabled',
    });
    expect(safeEnv.NODE_ENV).toBe('development');
    expect(safeEnv.APP_FEATURE_FLAG).toBe('enabled');
    expect(safeEnv.GEMINI_API_KEY).toBeUndefined();
    expect(safeEnv.E2B_API_KEY).toBeUndefined();
    expect(safeEnv.FIREBASE_SERVICE_ACCOUNT).toBeUndefined();
    expect(safeEnv.LD_PRELOAD).toBeUndefined();

    const sb1 = await sandboxEngine.createSandbox(ctx, {
      projectId: 'proj_web_01',
      runtime: 'vite',
      limits: { cpuCores: 99, memoryMb: 999999, timeoutSec: 999999 },
      env: { APP_MODE: 'test', ANTHROPIC_API_KEY: 'sk-ant-forbidden' },
    });
    const sb2 = await sandboxEngine.createSandbox(ctx, {
      projectId: 'proj_web_01',
      runtime: 'node',
    });

    expect(sb1.sandboxId).toMatch(/^sb_/);
    expect(sb1.workspaceId).toMatch(/^ws_proj_web_01_/);
    expect(sb1.sandboxId).not.toBe(sb2.sandboxId);
    expect(sb1.workspaceId).not.toBe(sb2.workspaceId);
    expect(sb1.limits.cpuCores).toBeLessThanOrEqual(8);
    expect(sb1.limits.memoryMb).toBeLessThanOrEqual(8192);
    expect(sb1.limits.timeoutSec).toBeLessThanOrEqual(3600);
    expect(sb1.status).toBe('running');
  });

  // =========================================================================
  // 2. Cross-User Access Prevention (Tenant Isolation)
  // =========================================================================
  it('2. blocks cross-user access to sandboxes, files, terminal, preview, and browser sessions with 403', async () => {
    const { sandboxEngine, browserEngine } = createTestEngines();
    const userA: DurableRequestContext = { userId: 'usr_owner_a' };
    const userB: DurableRequestContext = { userId: 'usr_attacker_b' };

    const sb = await sandboxEngine.createSandbox(userA, { projectId: 'tenant_proj' });
    const bs = await browserEngine.createSession(userA, { projectId: 'tenant_proj' });

    await expect(sandboxEngine.getSandboxStatus(userB, sb.sandboxId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    await expect(sandboxEngine.executeTerminal(userB, { sandboxId: sb.sandboxId, command: 'ls' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    await expect(sandboxEngine.readFile(userB, sb.sandboxId, 'index.ts')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    await expect(sandboxEngine.writeFile(userB, sb.sandboxId, 'pwn.ts', 'evil')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    await expect(sandboxEngine.getPreviewStatus(userB, sb.sandboxId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    await expect(browserEngine.navigate(userB, { sessionId: bs.sessionId, url: 'https://example.com' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  // =========================================================================
  // 3. Path Traversal, Workspace Boundary & File Size Enforcement
  // =========================================================================
  it('3. blocks path traversal, absolute host paths, null bytes, root deletion, and oversized payloads', async () => {
    const { sandboxEngine } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_fs_sec' };
    const sb = await sandboxEngine.createSandbox(ctx, {
      projectId: 'fs_sec_proj',
      limits: { maxFileSizeBytes: 2048 },
    });

    for (const badPath of ['../../etc/passwd', '../secret.env', '/etc/hosts', 'src/../../etc/shadow', 'foo\0bar', 'a\\..\\..\\b']) {
      const check = resolveWorkspacePath(badPath);
      expect(check.valid).toBe(false);
      await expect(sandboxEngine.readFile(ctx, sb.sandboxId, badPath)).rejects.toMatchObject({
        code: 'INVALID_WORKSPACE_PATH',
        statusCode: 403,
      });
    }

    await expect(sandboxEngine.deleteFile(ctx, sb.sandboxId, '.')).rejects.toMatchObject({
      code: 'INVALID_WORKSPACE_PATH',
      statusCode: 403,
    });

    await expect(sandboxEngine.writeFile(ctx, sb.sandboxId, 'big.txt', 'A'.repeat(4096))).rejects.toMatchObject({
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      statusCode: 413,
    });
  });

  // =========================================================================
  // 4. Real Workspace Filesystem Operations (CRUD, Rename, Search, Structure, Artifact)
  // =========================================================================
  it('4. performs real isolated filesystem write, read, list, mkdir, rename, search, structure, artifact, and approval-gated delete', async () => {
    const { sandboxEngine, gateway, sharedStore } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_fs_ops' };
    const sb = await sandboxEngine.createSandbox(ctx, { projectId: 'fs_ops_proj' });

    await sandboxEngine.makeDirectory(ctx, sb.sandboxId, 'src/components');
    const written = await sandboxEngine.writeFile(
      ctx,
      sb.sandboxId,
      'src/components/App.tsx',
      'export const App = () => "Hello Feature06";\n',
    );
    expect(written.path).toBe('src/components/App.tsx');
    expect(written.byteLength).toBeGreaterThan(10);

    const readRes = await sandboxEngine.readFile(ctx, sb.sandboxId, 'src/components/App.tsx');
    expect(readRes.content).toContain('Hello Feature06');
    expect(readRes.untrustedData).toBe(true);

    const listRes = await sandboxEngine.listFiles(ctx, sb.sandboxId, 'src/components');
    expect(listRes.entries.some((e) => e.name === 'App.tsx' && !e.path.startsWith('/workspace'))).toBe(true);

    const searchRes = await sandboxEngine.searchFiles(ctx, sb.sandboxId, 'Feature06');
    expect(searchRes.matches.length).toBe(1);
    expect(searchRes.matches[0].path).toBe('src/components/App.tsx');
    expect(searchRes.untrustedData).toBe(true);

    await sandboxEngine.renamePath(ctx, sb.sandboxId, 'src/components/App.tsx', 'src/components/Main.tsx');
    const structure = await sandboxEngine.inspectProjectStructure(ctx, sb.sandboxId, 3);
    expect(structure.tree.some((f) => f.path === 'src/components/Main.tsx')).toBe(true);

    const artifact = await sandboxEngine.createWorkspaceArtifact(ctx, sb.sandboxId);
    expect(artifact.encoding).toBe('base64');
    expect(artifact.sizeBytes).toBeGreaterThan(0);

    // Delete MUST require explicit approval first
    let challengeId = '';
    try {
      await sandboxEngine.deleteFile(ctx, sb.sandboxId, 'src/components/Main.tsx');
      throw new Error('Expected approval error');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxEngineError);
      const sbErr = err as SandboxEngineError;
      expect(sbErr.code).toBe('APPROVAL_REQUIRED');
      expect(sbErr.challenge?.challengeId).toBeTruthy();
      challengeId = sbErr.challenge!.challengeId;
    }

    const approved = await gateway.resolveChallengeDurable(
      { challengeId, confirmed: true, userId: ctx.userId },
      ctx,
      sharedStore,
    );
    expect(approved.success).toBe(true);
    expect(approved.approvalToken).toBeTruthy();

    const deleted = await sandboxEngine.deleteFile(ctx, sb.sandboxId, 'src/components/Main.tsx', approved.approvalToken);
    expect(deleted).toEqual({ path: 'src/components/Main.tsx', deleted: true });
  });

  // =========================================================================
  // 5. Real Terminal Execution, Stdout/Stderr Separation, SSE Stream & Host-Escape Blocking
  // =========================================================================
  it('5. executes real terminal commands with stdout/stderr separation, exit codes, secret redaction, SSE streaming, and blocks host escapes', async () => {
    const { sandboxEngine } = createTestEngines();
    const guest = issueGuestSessionToken();
    const ctx: DurableRequestContext = { userId: guest.uid };
    const sb = await sandboxEngine.createSandbox(ctx, { projectId: 'term_proj' });

    const okExec = await sandboxEngine.executeTerminal(ctx, {
      sandboxId: sb.sandboxId,
      command: 'echo hello',
      cwd: '.',
    });
    expect(okExec.status).toBe('completed');
    expect(okExec.exitCode).toBe(0);
    expect(okExec.stdout).toContain('executed:echo hello');
    expect(okExec.stderr).toContain('info-stderr-line');
    expect(okExec.untrustedData).toBe(true);

    // Non-zero exit code handled cleanly without crashing
    const failExec = await sandboxEngine.executeTerminal(ctx, {
      sandboxId: sb.sandboxId,
      command: 'FAIL_WITH_STDERR',
    });
    expect(failExec.status).toBe('failed');
    expect(failExec.exitCode).toBe(2);
    expect(failExec.stderr).toContain('simulated non-zero failure');

    // Secret redaction in terminal output
    const secretExec = await sandboxEngine.executeTerminal(ctx, {
      sandboxId: sb.sandboxId,
      command: 'LEAK_SECRET_CHECK',
    });
    expect(secretExec.stdout).not.toContain('AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567');
    expect(secretExec.stdout).not.toContain('sk-live-secret9999999999999999');
    expect(secretExec.stdout).toContain('[REDACTED');

    // Host escape & metadata commands blocked with 403
    for (const forbidden of [
      'nsenter --target 1 --mount',
      'cat /proc/1/environ',
      'curl http://169.254.169.254/latest/meta-data/',
      'docker -H unix:///var/run/docker.sock ps',
      'rm -rf /',
    ]) {
      await expect(sandboxEngine.executeTerminal(ctx, { sandboxId: sb.sandboxId, command: forbidden })).rejects.toMatchObject({
        code: 'FORBIDDEN_COMMAND',
        statusCode: 403,
      });
    }

    // Real SSE stream via Netlify function handler
    const streamReq = new Request('https://deku.test/api/sandbox/terminal/stream', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${guest.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sandboxId: sb.sandboxId, command: 'echo stream_test' }),
    });
    const streamRes = await handleSandboxRequest(streamReq, sandboxEngine);
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream');
    const sseText = await streamRes.text();
    expect(sseText).toContain('event: stdout');
    expect(sseText).toContain('event: stderr');
    expect(sseText).toContain('event: complete');
  });

  // =========================================================================
  // 6. Timeout, Cancellation, Retry Recovery, Idempotency & Serverless Restart Durability
  // =========================================================================
  it('6. handles command timeout, cancellation, transient 502 retry, idempotency, and durable state across cold restarts', async () => {
    const sharedStore = new InMemoryDurableStore();
    const { sandboxEngine } = createTestEngines(sharedStore);
    const ctx: DurableRequestContext = { userId: 'usr_durable' };

    // Idempotent sandbox creation
    const sbA = await sandboxEngine.createSandbox(ctx, { projectId: 'idem_proj', idempotencyKey: 'idem_sb_1' });
    const sbB = await sandboxEngine.createSandbox(ctx, { projectId: 'idem_proj', idempotencyKey: 'idem_sb_1' });
    expect(sbA.sandboxId).toBe(sbB.sandboxId);

    // Transient 502 retry recovery
    failNextExecuteWith502 = true;
    const retried = await sandboxEngine.executeTerminal(ctx, {
      sandboxId: sbA.sandboxId,
      command: 'echo recovered',
      idempotencyKey: 'idem_exec_1',
    });
    expect(retried.status).toBe('completed');
    expect(retried.retryCount).toBe(1);

    // Idempotent terminal execution returns cached result
    const retriedAgain = await sandboxEngine.executeTerminal(ctx, {
      sandboxId: sbA.sandboxId,
      command: 'echo recovered',
      idempotencyKey: 'idem_exec_1',
    });
    expect(retriedAgain.executionId).toBe(retried.executionId);

    // Timeout status handling
    const timedOut = await sandboxEngine.executeTerminal(ctx, {
      sandboxId: sbA.sandboxId,
      command: 'SIMULATE_TIMEOUT',
      timeoutMs: 2000,
    });
    expect(timedOut.status).toBe('timed_out');

    // Cancellation
    const bg = await sandboxEngine.executeTerminal(ctx, {
      sandboxId: sbA.sandboxId,
      command: 'node server.js',
      background: true,
    });
    const cancelRes = await sandboxEngine.cancelTerminal(ctx, sbA.sandboxId, bg.executionId);
    expect(cancelRes.cancelled).toBe(true);
    expect(cancelRes.status).toBe('cancelled');

    // Simulate serverless cold start: brand-new SandboxExecutionEngine with same durable store
    const { sandboxEngine: coldStartEngine } = createTestEngines(sharedStore);
    const recoveredStatus = await coldStartEngine.getSandboxStatus(ctx, sbA.sandboxId);
    expect(recoveredStatus.sandboxId).toBe(sbA.sandboxId);
    expect(recoveredStatus.status).toBe('running');
  });

  // =========================================================================
  // 7. Isolated Browser Session Lifecycle, DOM Inspect, Click, Approval-Gated Fill, Scroll, Wait & Real PNG Screenshot
  // =========================================================================
  it('7. runs real isolated browser session actions with approval enforcement on form fills and sensitive clicks', async () => {
    const { browserEngine, gateway, sharedStore } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_browser' };

    const session = await browserEngine.createSession(ctx, { viewport: { width: 1280, height: 800 } });
    expect(session.sessionId).toMatch(/^bs_/);
    expect(session.isolatedStorage).toBe(true);

    const nav = await browserEngine.navigate(ctx, { sessionId: session.sessionId, url: 'https://example.com' });
    expect(nav.page.title).toBe('Example Verified Page');
    expect(nav.page.consoleErrors.length).toBe(1);
    expect(nav.page.untrustedData).toBe(true);

    const inspected = await browserEngine.inspect(ctx, { sessionId: session.sessionId });
    expect(inspected.page.interactiveElements.length).toBeGreaterThan(0);

    // Non-sensitive click succeeds directly
    const normalClick = await browserEngine.click(ctx, { sessionId: session.sessionId, selector: '#learn-more', label: 'Learn More' });
    expect(normalClick.actionSucceeded).toBe(true);

    // Sensitive click ("Delete Account") requires explicit approval
    let clickChallengeId = '';
    try {
      await browserEngine.click(ctx, { sessionId: session.sessionId, selector: '#delete-account', label: 'Delete Account' });
      throw new Error('Expected sensitive click approval');
    } catch (err) {
      expect(err).toBeInstanceOf(BrowserEngineError);
      expect((err as BrowserEngineError).code).toBe('APPROVAL_REQUIRED');
      clickChallengeId = (err as BrowserEngineError).challenge!.challengeId;
    }
    const clickApproved = await gateway.resolveChallengeDurable(
      { challengeId: clickChallengeId, confirmed: true, userId: ctx.userId },
      ctx,
      sharedStore,
    );
    const sensitiveClickRes = await browserEngine.click(ctx, {
      sessionId: session.sessionId,
      selector: '#delete-account',
      label: 'Delete Account',
      approvalToken: clickApproved.approvalToken,
    });
    expect(sensitiveClickRes.actionSucceeded).toBe(true);

    // Form fill ALWAYS requires explicit approval
    let fillChallengeId = '';
    try {
      await browserEngine.fill(ctx, { sessionId: session.sessionId, selector: 'input[name="email"]', value: 'user@example.com' });
      throw new Error('Expected fill approval');
    } catch (err) {
      expect((err as BrowserEngineError).code).toBe('APPROVAL_REQUIRED');
      fillChallengeId = (err as BrowserEngineError).challenge!.challengeId;
    }
    const fillApproved = await gateway.resolveChallengeDurable(
      { challengeId: fillChallengeId, confirmed: true, userId: ctx.userId },
      ctx,
      sharedStore,
    );
    const fillRes = await browserEngine.fill(ctx, {
      sessionId: session.sessionId,
      selector: 'input[name="email"]',
      value: 'user@example.com',
      approvalToken: fillApproved.approvalToken,
    });
    expect(fillRes.actionSucceeded).toBe(true);

    const scrollRes = await browserEngine.scroll(ctx, { sessionId: session.sessionId, direction: 'down', pixels: 400 });
    expect(scrollRes.actionSucceeded).toBe(true);

    const waitRes = await browserEngine.waitFor(ctx, { sessionId: session.sessionId, selector: '#learn-more' });
    expect(waitRes.actionSucceeded).toBe(true);

    // Real PNG screenshot payload verification (magic bytes 89 50 4E 47)
    const shot = await browserEngine.screenshot(ctx, { sessionId: session.sessionId, fullPage: true });
    expect(shot.mimeType).toBe('image/png');
    const pngBytes = Buffer.from(shot.dataBase64, 'base64');
    expect(pngBytes.subarray(0, 4).toString('hex')).toBe('89504e47');

    const closed = await browserEngine.closeSession(ctx, session.sessionId);
    expect(closed.status).toBe('closed');
  });

  // =========================================================================
  // 8. SSRF, Localhost, Private-Network, Cloud Metadata & Post-Redirect Blocking
  // =========================================================================
  it('8. blocks localhost, private RFC1918 networks, IPv6 loopback, cloud metadata, obfuscated IPs, file://, and internal redirects', async () => {
    const blockedUrls = [
      'http://localhost:3000',
      'http://127.0.0.1/admin',
      'http://10.0.0.5/internal',
      'http://172.16.0.1/metrics',
      'http://192.168.1.1/router',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:8080/',
      'http://[::ffff:127.0.0.1]/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://2130706433/', // Decimal 127.0.0.1
      'http://0x7f000001/', // Hex 127.0.0.1
      'http://0177.0.0.1/', // Octal 127.0.0.1
      'file:///etc/passwd',
      'javascript:alert(1)',
    ];

    for (const url of blockedUrls) {
      expect(validateBrowserNavigationUrl(url).valid).toBe(false);
      const clientBlocked = await browserAutomation.navigateAndInspect(url);
      expect(clientBlocked.success).toBe(false);
    }

    const { browserEngine } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_ssrf' };
    const session = await browserEngine.createSession(ctx);

    await expect(
      browserEngine.navigate(ctx, { sessionId: session.sessionId, url: 'http://169.254.169.254/latest/meta-data/' }),
    ).rejects.toMatchObject({ code: 'BLOCKED_NAVIGATION_TARGET', statusCode: 403 });

    // Simulate open redirect from public URL into cloud metadata endpoint
    simulateOpenRedirectToInternal = true;
    await expect(
      browserEngine.navigate(ctx, { sessionId: session.sessionId, url: 'https://public-redirect.example.com/go' }),
    ).rejects.toMatchObject({ code: 'BLOCKED_REDIRECT_TARGET', statusCode: 403 });
  });

  // =========================================================================
  // 9. Live Development Preview Startup, Real HTTP Readiness Verification & Honest Failure
  // =========================================================================
  it('9. verifies real HTTP preview readiness and never reports fake preview URLs when the server fails', async () => {
    const { sandboxEngine } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_preview' };
    const sb = await sandboxEngine.createSandbox(ctx, { projectId: 'preview_proj', runtime: 'vite' });

    // Healthy preview server -> verified HTTP 200 -> returns real previewUrl
    previewReturnStatus = 200;
    const ready = await sandboxEngine.startPreview(ctx, {
      sandboxId: sb.sandboxId,
      command: 'npm run dev -- --port 3000',
      port: 3000,
      readinessTimeoutMs: 3000,
      pollIntervalMs: 100,
    });
    expect(ready.status).toBe('ready');
    expect(ready.httpStatus).toBe(200);
    expect(ready.previewUrl).toContain(previewTargetServer.url);

    const status = await sandboxEngine.getPreviewStatus(ctx, sb.sandboxId);
    expect(status.status).toBe('ready');
    expect(status.previewUrl).toBe(ready.previewUrl);

    // Server returns HTTP 500 -> MUST report failed and NEVER emit a previewUrl
    previewReturnStatus = 500;
    const failedHttp = await sandboxEngine.startPreview(ctx, {
      sandboxId: sb.sandboxId,
      command: 'npm run dev -- --port 3000',
      port: 3000,
      readinessTimeoutMs: 1200,
      pollIntervalMs: 100,
    });
    expect(failedHttp.status).toBe('failed');
    expect(failedHttp.previewUrl).toBeUndefined();
    expect(failedHttp.httpStatus).toBe(500);

    // Server crashes immediately with exit code 1 -> MUST report failed with no previewUrl
    previewReturnStatus = 200;
    const crashed = await sandboxEngine.startPreview(ctx, {
      sandboxId: sb.sandboxId,
      command: 'DEV_SERVER_CRASH',
      port: 3000,
    });
    expect(crashed.status).toBe('failed');
    expect(crashed.previewUrl).toBeUndefined();
    expect(crashed.error).toContain('EADDRINUSE');
  });

  // =========================================================================
  // 10. Provider Resolution Failures, Unconfigured Honesty & HMAC-SHA256 Webhook Verification
  // =========================================================================
  it('10. fails honestly when providers are unconfigured/unsupported and enforces HMAC-SHA256 webhook signatures', async () => {
    expect(() => resolveSandboxProvider('unknown-vendor')).toThrowError(SandboxProviderError);
    expect(() => resolveBrowserProvider('unknown-browser')).toThrowError(BrowserProviderError);

    // When no credentials are configured in env, resolver fails honestly with 503
    if (!process.env.E2B_API_KEY && !process.env.DAYTONA_API_KEY && !process.env.SANDBOX_RUNTIME_URL) {
      expect(() => resolveSandboxProvider()).toThrowError(/No isolated sandbox provider is configured/i);
    }
    if (!process.env.BROWSERLESS_URL && !process.env.BROWSERBASE_API_KEY && !process.env.BROWSER_RUNTIME_URL) {
      expect(() => resolveBrowserProvider()).toThrowError(/No isolated browser provider is configured/i);
    }

    // HMAC-SHA256 webhook verification
    const { sandboxEngine } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_webhook' };
    const sb = await sandboxEngine.createSandbox(ctx, { projectId: 'webhook_proj' });

    const webhookSecret = 'super-secret-webhook-signing-key-2026';
    const prevSecret = process.env.SANDBOX_WEBHOOK_SECRET;
    process.env.SANDBOX_WEBHOOK_SECRET = webhookSecret;
    try {
      const payload = JSON.stringify({ event: 'sandbox.terminated', providerSandboxId: sb.providerSandboxId });
      const validSig = `sha256=${crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex')}`;

      // Missing signature rejected with 401
      const badReq = new Request('https://deku.test/api/sandbox/webhook', {
        method: 'POST',
        body: payload,
      });
      const badRes = await handleSandboxRequest(badReq, sandboxEngine);
      expect(badRes.status).toBe(401);

      // Tampered signature rejected with 401
      const tamperedReq = new Request('https://deku.test/api/sandbox/webhook', {
        method: 'POST',
        headers: { 'x-sandbox-signature': 'sha256=' + '0'.repeat(64) },
        body: payload,
      });
      const tamperedRes = await handleSandboxRequest(tamperedReq, sandboxEngine);
      expect(tamperedRes.status).toBe(401);

      // Valid HMAC signature accepted and transitions sandbox status to stopped
      const goodReq = new Request('https://deku.test/api/sandbox/webhook', {
        method: 'POST',
        headers: { 'x-sandbox-signature': validSig },
        body: payload,
      });
      const goodRes = await handleSandboxRequest(goodReq, sandboxEngine);
      expect(goodRes.status).toBe(200);
      const updated = await sandboxEngine.getSandboxStatus(ctx, sb.sandboxId, false);
      expect(updated.status).toBe('stopped');
    } finally {
      if (prevSecret === undefined) delete process.env.SANDBOX_WEBHOOK_SECRET;
      else process.env.SANDBOX_WEBHOOK_SECRET = prevSecret;
    }
  });

  // =========================================================================
  // 11. Single-Use Approval Token Security (Replay, Tampering, Denial)
  // =========================================================================
  it('11. enforces single-use approval tokens and blocks replay, argument tampering, and user denial', async () => {
    const { sandboxEngine, gateway, sharedStore } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_approvals' };
    const sb = await sandboxEngine.createSandbox(ctx, { projectId: 'approval_proj' });
    await sandboxEngine.writeFile(ctx, sb.sandboxId, 'a.txt', 'hello');
    await sandboxEngine.writeFile(ctx, sb.sandboxId, 'b.txt', 'world');

    // Trigger approval challenge for a.txt
    let challengeId = '';
    try {
      await sandboxEngine.deleteFile(ctx, sb.sandboxId, 'a.txt');
    } catch (err) {
      challengeId = (err as SandboxEngineError).challenge!.challengeId;
    }

    const approved = await gateway.resolveChallengeDurable(
      { challengeId, confirmed: true, userId: ctx.userId },
      ctx,
      sharedStore,
    );
    const token = approved.approvalToken!;

    // Tampered args (using a.txt token to delete b.txt) MUST be rejected
    await expect(sandboxEngine.deleteFile(ctx, sb.sandboxId, 'b.txt', token)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
      statusCode: 403,
    });

    // Valid use for a.txt succeeds
    const deletedA = await sandboxEngine.deleteFile(ctx, sb.sandboxId, 'a.txt', token);
    expect(deletedA.deleted).toBe(true);

    // Replay of already-consumed single-use token MUST be rejected
    await sandboxEngine.writeFile(ctx, sb.sandboxId, 'a.txt', 'recreated');
    await expect(sandboxEngine.deleteFile(ctx, sb.sandboxId, 'a.txt', token)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
      statusCode: 403,
    });

    // Denial returns no approval token
    let denyChallengeId = '';
    try {
      await sandboxEngine.deleteFile(ctx, sb.sandboxId, 'b.txt');
    } catch (err) {
      denyChallengeId = (err as SandboxEngineError).challenge!.challengeId;
    }
    const denied = await gateway.resolveChallengeDurable(
      { challengeId: denyChallengeId, confirmed: false, userId: ctx.userId },
      ctx,
      sharedStore,
    );
    expect(denied.success).toBe(true);
    expect(denied.approvalToken).toBeUndefined();
  });

  // =========================================================================
  // 12. Resource Expiration (TTL/Idle Auto-Cleanup) & Explicit Cleanup
  // =========================================================================
  it('12. automatically cleans up expired sandboxes and browser sessions with 410 and supports explicit cleanup', async () => {
    const { sandboxEngine, browserEngine, sharedStore } = createTestEngines();
    const ctx: DurableRequestContext = { userId: 'usr_lifecycle' };

    const sb = await sandboxEngine.createSandbox(ctx, { projectId: 'ttl_proj' });
    const bs = await browserEngine.createSession(ctx);

    // Expire both records in store
    const sbRec = (await sharedStore.getSandbox(ctx, sb.sandboxId))!;
    sbRec.expiresAt = new Date(Date.now() - 5000).toISOString();
    await sharedStore.saveSandbox(ctx, sbRec);

    const bsRec = (await sharedStore.getBrowserSession(ctx, bs.sessionId))!;
    bsRec.expiresAt = new Date(Date.now() - 5000).toISOString();
    await sharedStore.saveBrowserSession(ctx, bsRec);

    await expect(sandboxEngine.executeTerminal(ctx, { sandboxId: sb.sandboxId, command: 'ls' })).rejects.toMatchObject({
      code: 'SANDBOX_EXPIRED',
      statusCode: 410,
    });
    await expect(browserEngine.inspect(ctx, { sessionId: bs.sessionId })).rejects.toMatchObject({
      code: 'BROWSER_SESSION_EXPIRED',
      statusCode: 410,
    });

    // Explicit cleanup on active sandbox
    const sbActive = await sandboxEngine.createSandbox(ctx, { projectId: 'clean_proj' });
    const cleaned = await sandboxEngine.cleanupSandbox(ctx, sbActive.sandboxId);
    expect(cleaned.status).toBe('stopped');
    await expect(sandboxEngine.executeTerminal(ctx, { sandboxId: sbActive.sandboxId, command: 'ls' })).rejects.toMatchObject({
      code: 'SANDBOX_INACTIVE',
      statusCode: 409,
    });
  });

  // =========================================================================
  // 13. Tool Registry (All 20 Tools), Auth Enforcement & Netlify Routing Config
  // =========================================================================
  it('13. registers all 20 required tools, enforces 401 auth on Netlify handlers, and configures netlify.toml cleanly', async () => {
    const requiredTools = [
      'sandbox_create',
      'sandbox_status',
      'terminal_execute',
      'terminal_stream',
      'terminal_cancel',
      'filesystem_list',
      'filesystem_read',
      'filesystem_write',
      'filesystem_delete',
      'filesystem_search',
      'browser_session_create',
      'browser_navigate',
      'browser_inspect',
      'browser_click',
      'browser_fill',
      'browser_screenshot',
      'browser_session_close',
      'preview_start',
      'preview_status',
      'sandbox_cleanup',
    ];

    const registeredNames = new Set(toolRegistry.getAllTools().map((t) => t.name));
    for (const toolName of requiredTools) {
      expect(registeredNames.has(toolName)).toBe(true);
    }

    // Unauthenticated API requests MUST fail with 401
    const unauthSandbox = await handleSandboxRequest(
      new Request('https://deku.test/api/sandbox/create', { method: 'POST', body: '{}' }),
    );
    expect(unauthSandbox.status).toBe(401);

    const unauthBrowser = await handleBrowserRequest(
      new Request('https://deku.test/api/browser/session/create', { method: 'POST', body: '{}' }),
    );
    expect(unauthBrowser.status).toBe(401);

    // Health endpoints return 200 without leaking secrets
    const sbHealth = await handleSandboxRequest(new Request('https://deku.test/api/sandbox/health', { method: 'GET' }));
    expect(sbHealth.status).toBe(200);
    const brHealth = await handleBrowserRequest(new Request('https://deku.test/api/browser/health', { method: 'GET' }));
    expect(brHealth.status).toBe(200);

    // Readiness endpoint accurately reports sandbox & browser runtime keys
    const statusRes = await agentStatusHandler(new Request('https://deku.test/api/agent-status', { method: 'GET' }));
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(typeof statusJson.providers.sandboxRuntimeConfigured).toBe('boolean');
    expect(typeof statusJson.providers.browserRuntimeConfigured).toBe('boolean');

    // Verify netlify.toml includes /api/sandbox/* and /api/browser/* before SPA fallback
    const netlifyToml = await fs.readFile(path.resolve(process.cwd(), 'netlify.toml'), 'utf8');
    const sbIdx = netlifyToml.indexOf('/api/sandbox/*');
    const brIdx = netlifyToml.indexOf('/api/browser/*');
    const spaIdx = netlifyToml.indexOf('from = "/*"');
    expect(sbIdx).toBeGreaterThan(-1);
    expect(brIdx).toBeGreaterThan(-1);
    expect(sbIdx).toBeLessThan(spaIdx);
    expect(brIdx).toBeLessThan(spaIdx);

    // Verify secret redaction utility strips common token patterns
    const redacted = redactSensitiveExecutionText('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });
});
