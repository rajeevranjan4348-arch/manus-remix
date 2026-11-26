/**
 * External durable worker for Manus Remix agent infrastructure.
 *
 * Deployment: run this process on an always-on host (VM, container platform,
 * Fly.io, Railway, Render, k8s, etc.). It is intentionally NOT a Netlify
 * Function: serverless request handlers cannot be durable workers.
 *
 * Responsibilities
 * - Poll-and-claim durable tasks from Firestore (Feature 01) with leases.
 * - Execute bounded task handlers (research / coding missions, scheduled jobs).
 * - Provide the real sandbox/terminal/filesystem/browser contract consumed by
 *   Feature 06 (`SANDBOX_PROVIDER_URL` points at this worker's HTTP ingress).
 *
 * Required environment:
 *   WORKER_API_TOKEN          shared secret (also used by server -> worker calls)
 *   FIREBASE_SERVICE_ACCOUNT  optional; or Application Default Credentials
 *   GEMINI_API_KEY            for provider-backed agent handlers
 *   WORKER_PORT               HTTP port (default 8787)
 *   PLAYWRIGHT_BROWSERS_PATH  optional; enables real browser sessions when
 *                             playwright is installed in the worker image.
 *
 * Security posture: commands run inside per-sandbox temporary directories with
 * resource/time limits enforced via timeout + process kill. Browser navigation
 * enforces the same public-web URL policy as the server layer.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const WORKER_ID = `worker_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const PORT = Number(process.env.WORKER_PORT || 8787);
const MAX_CONCURRENT_TASKS = Number(process.env.WORKER_MAX_CONCURRENT_TASKS || 5);
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);

interface SandboxWorkspace {
  sandboxId: string;
  userId: string;
  workdir: string;
  createdAt: number;
  processes: Map<number, ChildProcess>;
  servers: Map<number, ChildProcess>;
  previewUrl?: string;
  previewPort?: number;
}

const sandboxes = new Map<string, SandboxWorkspace>();

function truthyEnv(name: string): string | undefined {
  const value = (process.env[name] || '').trim();
  return value || undefined;
}

function assertWorkerAuth(req: http.IncomingMessage): boolean {
  const expected = truthyEnv('WORKER_API_TOKEN');
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length !== expected.length || token.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Public-web-only URL policy (mirrors server/sandbox/sandboxService.ts). */
function assertUrlAllowed(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Blocked protocol ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  const blocked = ['localhost', 'metadata.google.internal', 'metadata.goog'];
  if (blocked.includes(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error(`Blocked host ${host}`);
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, , d] = ipv4.slice(1).map(Number);
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || d === undefined) {
      throw new Error('Blocked private or metadata address');
    }
  }
  return url;
}

async function createSandbox(body: any): Promise<{ sandboxId: string; workdir: string; expiresAt: string; provider: string }> {
  const sandboxId = `sbx_${crypto.randomBytes(6).toString('hex')}`;
  const workdir = path.join(os.tmpdir(), 'manus-sandboxes', sandboxId);
  await fs.mkdir(workdir, { recursive: true });
  const limits = body?.limits ?? {};
  const expiresAt = new Date(Date.now() + Math.min(3600, Number(limits.timeoutMs) / 1000 || 600) * 1000).toISOString();
  sandboxes.set(sandboxId, {
    sandboxId,
    userId: String(body?.userId ?? ''),
    workdir,
    createdAt: Date.now(),
    processes: new Map(),
    servers: new Map(),
  });
  setTimeout(() => {
    void destroySandbox(sandboxId);
  }, Number(limits.timeoutMs) || 600_000);
  return { sandboxId, workdir, expiresAt, provider: 'external-worker' };
}

async function destroySandbox(sandboxId: string): Promise<boolean> {
  const sbx = sandboxes.get(sandboxId);
  if (!sbx) return false;
  for (const proc of new Set([...sbx.processes.values(), ...sbx.servers.values()])) {
    try {
      proc.kill('SIGKILL');
    } catch {}
  }
  sandboxes.delete(sandboxId);
  try {
    await fs.rm(sbx.workdir, { recursive: true, force: true });
  } catch {}
  return true;
}

function execInSandbox(
  sbx: SandboxWorkspace,
  command: string,
  timeoutMs: number,
  onOutput?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; pid?: number; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, args, {
      cwd: sbx.workdir,
      env: {
        PATH: process.env.PATH,
        HOME: sbx.workdir,
        PATH_SANDBOX: sbx.workdir,
        TERM: 'dumb',
        SANDBOX_ID: sbx.sandboxId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const limit = 4 * 1024 * 1024;

    child.stdout?.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      if (stdout.length < limit) stdout += text;
      onOutput?.({ stream: 'stdout', text });
    });
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      if (stderr.length < limit) stderr += text;
      onOutput?.({ stream: 'stderr', text });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {}
    }, Math.max(1000, timeoutMs));

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      sbx.processes.delete(child.pid ?? 0);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        pid: child.pid,
        durationMs: Date.now() - started,
      });
    });

    if (child.pid) sbx.processes.set(child.pid, child);
  });
}

function requireSandbox(sandboxId: string, userId: string): SandboxWorkspace {
  const sbx = sandboxes.get(sandboxId);
  if (!sbx) throw new Error('sandbox not found');
  if (sbx.userId !== userId) throw new Error('workspace ownership check failed');
  return sbx;
}

async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

async function startPreview(sbx: SandboxWorkspace, command: string, port: number, readinessTimeoutMs: number): Promise<{ previewUrl?: string; readiness: string }> {
  const child = spawn('/bin/bash', ['-lc', command], { cwd: sbx.workdir, stdio: ['ignore', 'ignore', 'pipe'] });
  if (child.pid) sbx.servers.set(child.pid, child);
  const ready = await waitForServer(port, readinessTimeoutMs);
  if (!ready || !child.pid) {
    try {
      child.kill('SIGKILL');
    } catch {}
    if (child.pid) sbx.servers.delete(child.pid);
    return { readiness: ready ? 'ready' : 'failed' };
  }
  const previewHost = truthyEnv('WORKER_PREVIEW_PUBLIC_HOST');
  const previewUrl = previewHost ? `https://${previewHost}/preview/${sbx.sandboxId}/` : `http://127.0.0.1:${port}/`;
  sbx.previewUrl = previewUrl;
  sbx.previewPort = port;
  return { previewUrl, readiness: 'ready' };
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  if (!assertWorkerAuth(req)) {
    send(res, 401, { ok: false, error: 'Worker token required.', requestId });
    return;
  }
  let body: any = {};
  try {
    body = await readBody(req);
  } catch (error) {
    send(res, 400, { ok: false, error: (error as Error).message, requestId });
    return;
  }

  try {
    switch (req.url?.split('?')[0]) {
      case '/health':
        send(res, 200, { ok: true, workerId: WORKER_ID, sandboxes: sandboxes.size, provider: 'external-worker', requestId });
        return;
      case '/sandbox/create':
        send(res, 201, await createSandbox(body));
        return;
      case '/sandbox/status': {
        const sbx = sandboxes.get(body.sandboxId);
        if (!sbx || sbx.userId !== body.userId) {
          send(res, 404, { ok: false, error: 'sandbox not found', requestId });
          return;
        }
        send(res, 200, { sandboxId: sbx.sandboxId, workdir: sbx.workdir, processes: [...sbx.processes.keys()], previewUrl: sbx.previewUrl ?? null });
        return;
      }
      case '/sandbox/exec': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const result = await execInSandbox(sbx, String(body.command ?? ''), Number(body.timeoutMs) || 60_000, undefined);
        send(res, 200, result);
        return;
      }
      case '/sandbox/kill': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const child = sbx.processes.get(Number(body.pid));
        if (!child) {
          send(res, 404, { ok: false, error: 'process not found', requestId });
          return;
        }
        child.kill('SIGKILL');
        send(res, 200, { ok: true });
        return;
      }
      case '/sandbox/destroy': {
        const destroyed = await destroySandbox(body.sandboxId);
        send(res, 200, { ok: destroyed });
        return;
      }
      case '/fs/list': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const target = path.resolve(sbx.workdir, '.' + path.resolve('/', String(body.dir ?? '/'))).replace(sbx.workdir, '/');
        const entries = await fs.readdir(path.join(sbx.workdir, target), { withFileTypes: true });
        send(res, 200, { entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file' })) });
        return;
      }
      case '/fs/read': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const rel = path.resolve(sbx.workdir, '.' + path.resolve('/', String(body.path ?? '')));
        if (!rel.startsWith(sbx.workdir)) throw new Error('path traversal blocked');
        const stat = await fs.lstat(rel);
        if (stat.isSymbolicLink()) throw new Error('symlink escape blocked');
        if (stat.size > 4 * 1024 * 1024) throw new Error('file exceeds sandbox limit');
        const content = await fs.readFile(rel, 'utf8');
        send(res, 200, { content, size: stat.size });
        return;
      }
      case '/fs/write': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const rel = path.resolve(sbx.workdir, '.' + path.resolve('/', String(body.path ?? '')));
        if (!rel.startsWith(sbx.workdir)) throw new Error('path traversal blocked');
        await fs.mkdir(path.dirname(rel), { recursive: true });
        await fs.writeFile(rel, String(body.content ?? ''), { encoding: 'utf8' });
        send(res, 200, { ok: true });
        return;
      }
      case '/fs/delete': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const rel = path.resolve(sbx.workdir, '.' + path.resolve('/', String(body.path ?? '')));
        if (!rel.startsWith(sbx.workdir) || rel === sbx.workdir) throw new Error('path traversal blocked');
        await fs.rm(rel, { recursive: true, force: true });
        send(res, 200, { ok: true });
        return;
      }
      case '/fs/search': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const matches: Array<{ file: string; preview: string }> = [];
        const query = String(body.query ?? '').toLowerCase();
        await walk(sbx.workdir, async (file) => {
          if (matches.length > 100) return;
          try {
            const content = await fs.readFile(file, 'utf8');
            const index = content.toLowerCase().indexOf(query);
            if (query && index >= 0) {
              matches.push({ file: path.relative(sbx.workdir, file), preview: content.slice(Math.max(0, index - 40), index + 80) });
            }
          } catch {}
        });
        send(res, 200, { matches });
        return;
      }
      case '/browser/session/create':
      case '/browser/session/navigate': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const url = assertUrlAllowed(String(body.url ?? ''));
        const result = await browserOperation(sbx, async (pw: any, context: any) => {
          const page = context.pages()[0] ?? (await context.newPage());
          const consoleErrors: string[] = [];
          page.on('console', (msg: any) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
          });
          await page.goto(url.toString(), { waitUntil: 'load', timeout: Number(body.timeoutMs) || 30_000 });
          return {
            sessionId: sbx.sandboxId,
            url: url.toString(),
            title: await page.title(),
            consoleErrors,
          };
        });
        send(res, result.status, result.payload);
        return;
      }
      case '/browser/session/inspect': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const result = await browserOperation(sbx, async (pw: any, context: any) => {
          const page = context.pages()[0];
          if (!page) throw new Error('no active session');
          return {
            sessionId: sbx.sandboxId,
            url: page.url(),
            title: await page.title(),
            dom: (await page.content()).slice(0, 200_000),
            consoleErrors: [],
          };
        });
        send(res, result.status, result.payload);
        return;
      }
      case '/browser/session/click': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const result = await browserOperation(sbx, async (pw: any, context: any) => {
          const page = context.pages()[0];
          if (!page) throw new Error('no active session');
          await page.click(String(body.selector));
          return { sessionId: sbx.sandboxId, url: page.url(), title: await page.title(), consoleErrors: [] };
        });
        send(res, result.status, result.payload);
        return;
      }
      case '/browser/session/fill': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const result = await browserOperation(sbx, async (pw: any, context: any) => {
          const page = context.pages()[0];
          if (!page) throw new Error('no active session');
          for (const [selector, value] of Object.entries(body.values ?? {})) {
            await page.fill(String(selector), String(value));
          }
          return { sessionId: sbx.sandboxId, url: page.url(), title: await page.title(), consoleErrors: [] };
        });
        send(res, result.status, result.payload);
        return;
      }
      case '/browser/session/screenshot': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const result = await browserOperation(sbx, async (pw: any, context: any) => {
          const page = context.pages()[0];
          if (!page) throw new Error('no active session');
          const buffer = await page.screenshot({ type: 'png' });
          return { base64: buffer.toString('base64'), contentType: 'image/png' };
        });
        send(res, result.status, result.payload);
        return;
      }
      case '/browser/session/close': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const ext = sbx as SandboxWorkspaceExt;
        ext.browsers?.forEach((entry: any) => {
          try {
            entry.browser?.close?.();
          } catch {}
        });
        ext.browsers?.clear();
        send(res, 200, { ok: true });
        return;
      }
      case '/preview/start': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        const result = await startPreview(sbx, String(body.command ?? ''), Number(body.port), Number(body.readinessTimeoutMs) || 60_000);
        send(res, 200, result);
        return;
      }
      case '/preview/status': {
        const sbx = requireSandbox(body.sandboxId, body.userId);
        send(res, 200, { status: sbx.previewUrl ? 'ready' : 'not_started', previewUrl: sbx.previewUrl });
        return;
      }
      default:
        send(res, 404, { ok: false, error: 'unknown route', requestId });
    }
  } catch (error) {
    send(res, 400, { ok: false, error: (error as Error).message, requestId });
  }
});

// Extended per-sandbox state for browser sessions.
interface SandboxWorkspaceExt extends SandboxWorkspace {
  browsers?: Map<string, any>;
}

async function browserOperation(
  sbx: SandboxWorkspace,
  op: (pw: any, context: any) => Promise<any>,
): Promise<{ status: number; payload: any }> {
  let playwright: any;
  try {
    // The worker image must install playwright separately from the web app.
    const playwrightSpecifier = 'playwright';
    playwright = (await import(playwrightSpecifier)) as any;
  } catch {
    return { status: 503, payload: { ok: false, error: 'playwright is not installed in the worker image', unavailable: true } };
  }
  const ext = sbx as SandboxWorkspaceExt;
  ext.browsers ??= new Map();
  let context = ext.browsers.get(sbx.sandboxId)?.context;
  if (!context) {
    const browser = await playwright.chromium.launch({ args: ['--no-sandbox'] });
    context = await browser.newContext();
    ext.browsers.set(sbx.sandboxId, { browser, context });
  }
  const payload = await op(playwright, context);
  return { status: 200, payload };
}

async function walk(dir: string, visitor: (file: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, visitor);
    else await visitor(full);
  }
}

// ---------------------------------------------------------------------------
// Durable task loop (Feature 01): poll, claim, heartbeat, execute, finalize.
// ---------------------------------------------------------------------------

async function taskLoop(): Promise<void> {
  if (!truthyEnv('WORKER_API_TOKEN')) return;
  let queueModule: any;
  let runtimeModule: any;
  let schedulerModule: any;
  try {
    queueModule = await import('../server/taskQueue/durableTaskQueue');
    runtimeModule = await import('../server/agentRuntime/agentRuntime');
    schedulerModule = await import('../server/scheduler/scheduleEngine');
  } catch {
    console.error('[Worker] Durable modules unavailable; task loop disabled.');
    return;
  }
  const queue = queueModule.durableTaskQueue as any;
  const runtime = runtimeModule.agentRuntime as any;
  const scheduler = schedulerModule.scheduleEngine as any;
  const { dispatchTaskReady } = await import('../server/taskQueue/workerDispatch');

  console.log(`[Worker] ${WORKER_ID} polling every ${POLL_INTERVAL_MS}ms (max ${MAX_CONCURRENT_TASKS} concurrent)`);

  while (true) {
    try {
      await queue.recoverInterrupted();
      const inFlight = new Set<string>();
      const runClaimed = async (task: any) => {
        if (!task) return;
        inFlight.add(task.id);
        try {
          await queue.markRunning({ taskId: task.id, workerId: WORKER_ID });
          if (task.type === 'agent.mission') {
            const apiKey = truthyEnv('GEMINI_API_KEY');
            if (!apiKey) {
              await queue.fail({ taskId: task.id, workerId: WORKER_ID, error: 'GEMINI_API_KEY is not configured for agent missions.' });
              return;
            }
            const modelClient = runtimeModule.createGeminiModelClient(apiKey);
            const result = await runtime.execute(
              {
                userId: task.userId,
                objective: task.payload?.objective ?? '',
                subTaskPlan: task.payload?.plan ?? [],
              },
              modelClient,
            );
            await queue.complete({ taskId: task.id, workerId: WORKER_ID, result });
          } else if (String(task.type).startsWith('schedule.')) {
            const apiKey = truthyEnv('GEMINI_API_KEY');
            if (!apiKey) {
              await queue.fail({ taskId: task.id, workerId: WORKER_ID, error: 'GEMINI_API_KEY is not configured for scheduled jobs.' });
              await scheduler.acknowledgeRunCompletion({ runId: task.payload?.runId, userId: task.userId, status: 'failed', error: 'provider unavailable' });
              return;
            }
            const modelClient = runtimeModule.createGeminiModelClient(apiKey);
            const result = await runtime.execute(
              {
                userId: task.userId,
                objective: task.payload?.objective ?? task.payload?.prompt ?? 'Scheduled task',
                subTaskPlan: [{ id: 'main', role: 'research', goal: task.payload?.prompt ?? 'Execute scheduled job', dependsOn: [] }],
              },
              modelClient,
            );
            await queue.complete({ taskId: task.id, workerId: WORKER_ID, result });
            const runId = task.payload?.runId;
            await scheduler.acknowledgeRunCompletion({
              runId,
              userId: task.userId,
              status: result.status === 'completed' ? 'completed' : 'failed',
              resultSummary: result.totals ? `agents=${result.subTaskResults.length} tokens=${result.totals.totalTokens}` : undefined,
              error: result.status === 'completed' ? undefined : 'agent runtime returned partial/failed',
            });
          } else {
            await queue.fail({ taskId: task.id, workerId: WORKER_ID, error: `No handler registered for task type '${task.type}'.`, retry: false });
          }
        } catch (error) {
          await queue.fail({ taskId: task.id, workerId: WORKER_ID, error: (error as Error).message }).catch(() => undefined);
        } finally {
          inFlight.delete(task.id);
        }
      };

      while (inFlight.size < MAX_CONCURRENT_TASKS) {
        const task = await queue.claimNext({ workerId: WORKER_ID, maxConcurrentTasks: MAX_CONCURRENT_TASKS });
        if (!task) break;
        void runClaimed(task);
      }
    } catch (error) {
      console.error('[Worker] task loop error:', (error as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Worker] ${WORKER_ID} listening on :${PORT}`);
});

void taskLoop();
