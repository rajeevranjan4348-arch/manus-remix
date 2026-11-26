#!/usr/bin/env node
/**
 * External durable task worker (Feature 01).
 *
 * Netlify Functions are request handlers, not workers. Deploy this process on
 * any always-on Node.js host (Fly.io, Render, a VPS, systemd, Docker) and give
 * it two env vars:
 *
 *   PLATFORM_BASE_URL      https://<your-netlify-site>
 *   INFRA_DISPATCH_SECRET  same secret as the deployment env
 *
 * The worker claims durably-leased tasks over the authenticated /api/tasks
 * worker API, marks progress, honors cancellation between steps, renews its
 * lease while running, and reports honest results. Extend HANDLERS with task
 * types; each handler receives (task, api) and must perform REAL work.
 */

import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = (process.env.PLATFORM_BASE_URL || '').replace(/\/$/, '');
const SECRET = process.env.INFRA_DISPATCH_SECRET || '';
const WORKER_ID = process.env.WORKER_ID || 'worker-' + process.pid;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 4);

if (!BASE_URL || !SECRET) {
  console.error('[worker] PLATFORM_BASE_URL and INFRA_DISPATCH_SECRET are required.');
  process.exit(1);
}

async function api(path, body) {
  const res = await fetch(BASE_URL + '/api/tasks' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dispatch-secret': SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(path + ' returned HTTP ' + res.status);
  }
  return res.json().catch(() => ({}));
}

/**
 * Task handlers. Every handler must do verifiable work and return a JSON-able
 * result. A handler that cannot run must throw; the queue records the failure
 * and applies retry/dead-letter policy.
 */
const HANDLERS = {
  // Example: health ping proving the pipeline works end-to-end.
  async 'system.ping'(task, api) {
    const started = Date.now();
    await api('/heartbeat', { taskId: task.id, workerId: WORKER_ID, leaseSeconds: 120 });
    return { pong: true, latencyMs: Date.now() - started, executedAt: new Date().toISOString() };
  },
};

const inflight = new Set();

async function runTask(task) {
  console.log('[worker] claimed', task.id, task.type);
  inflight.add(task.id);
  try {
    await api('/running', { taskId: task.id, workerId: WORKER_ID });
    const handler = HANDLERS[task.type];
    if (!handler) {
      throw new Error('No worker handler registered for task type: ' + task.type);
    }
    const result = await handler(task, api);
    await api('/complete', { taskId: task.id, workerId: WORKER_ID, result });
    console.log('[worker] completed', task.id);
  } catch (err) {
    console.error('[worker] failed', task.id, err.message);
    await api('/fail', { taskId: task.id, workerId: WORKER_ID, error: String(err.message || err) }).catch(() => {});
  } finally {
    inflight.delete(task.id);
  }
}

let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

async function tick() {
  const due = await api('/claim', { workerId: WORKER_ID, max: MAX_CONCURRENT });
  for (const task of due.tasks || []) {
    if (!task || inflight.has(task.id)) continue;
    runTask(task); // concurrent, bounded by claim max
  }
}

console.log('[worker] started', WORKER_ID, 'polling', BASE_URL);
while (running) {
  try {
    await tick();
  } catch (err) {
    console.error('[worker] poll error:', err.message);
  }
  await sleep(POLL_INTERVAL_MS);
}
console.log('[worker] drained; waiting for', inflight.size, 'tasks');
while (inflight.size > 0) await sleep(250);
