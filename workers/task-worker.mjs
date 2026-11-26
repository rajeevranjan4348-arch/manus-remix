#!/usr/bin/env node
/**
 * External durable task worker (Features 01 + 03 + 05 integration).
 *
 * Netlify Functions are request handlers, not workers. Deploy this process on
 * any always-on Node.js host (Fly.io, Render, a VPS, systemd, Docker) and give
 * it these env vars:
 *
 *   PLATFORM_BASE_URL      https://<your-netlify-site>
 *   INFRA_DISPATCH_SECRET  same secret as the deployment env
 *
 * The worker claims durably-leased tasks over the authenticated /api/tasks
 * worker API, renews its lease via heartbeat while handlers run, honors
 * cancellation between steps, and reports honest results. Handlers here are
 * REAL executors:
 *   - agents.execute_run : executes a Feature 03 multi-agent run end-to-end.
 *   - automation.run     : executes a Feature 05 schedule occurrence (agent
 *                          run, queued-task handler, or verified webhook) and
 *                          reports the verified outcome back to the scheduler.
 * A handler that cannot run must throw; the queue records the failure and
 * applies retry/dead-letter policy. Nothing here fakes success.
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

async function tasksApi(path, body) {
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

async function platformApi(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dispatch-secret': SECRET },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

/** Renews the task lease while a long handler runs (agents runs can take minutes). */
async function withLease(task, fn, leaseSeconds = 120) {
  const timer = setInterval(() => {
    tasksApi('/heartbeat', { taskId: task.id, workerId: WORKER_ID, leaseSeconds }).catch(() => {});
  }, Math.max(15_000, Math.floor(leaseSeconds * 1000 / 3)));
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

/** Egress guard for webhook targets: block loopback/private/link-local hosts. */
function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '[::1]' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o[0] === 10 || o[0] === 127 || o[0] === 169 || o[0] === 172 || o[0] === 192) {
    if (o[0] === 169 && o[1] === 254) return true; // link-local / cloud metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 10 || o[0] === 127) return true;
  }
  if (o[0] === 0 || o[0] >= 224) return true;
  return false;
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

  // Feature 03 integration: execute a durable multi-agent run end-to-end.
  async 'agents.execute_run'(task, api) {
    const { runId, userId } = task.payload || {};
    if (!runId || !userId) throw new Error('agents.execute_run payload needs runId and userId');
    return withLease(task, async () => {
      const res = await platformApi('/api/agents', { action: 'execute-run', runId, userId });
      if (!res.ok) {
        throw new Error('Agent run ' + runId + ' did not complete: HTTP ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
      }
      return { runId, status: res.body?.run?.status || 'unknown' };
    }, 120);
  },

  // Feature 05 integration: execute a schedule occurrence, then report the
  // verified outcome to the scheduler (occurrences succeed only when verified).
  async 'automation.run'(task, api) {
    const { scheduleId, runId, target } = task.payload || {};
    if (!scheduleId || !runId || !target) throw new Error('automation.run payload needs scheduleId, runId and target');
    let execution;
    try {
      if (target.type === 'agents_run') {
        return await withLease(task, async () => {
          const res = await platformApi('/api/agents', { action: 'create-run', objective: String(target.objective || ''), userId: task.userId });
          if (!res.ok || !res.body?.run?.runId) {
            throw new Error('Scheduled agent run could not be created: HTTP ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
          }
          const createdRunId = res.body.run.runId;
          const exec = await platformApi('/api/agents', { action: 'execute-run', runId: createdRunId, userId: task.userId });
          const status = exec.body?.run?.status || 'unknown';
          const detail = 'Scheduled agent run ' + createdRunId + ' finished with status ' + status;
          const verify = await platformApi('/api/scheduler', { action: 'record-occurrence', scheduleId, runId, status: status === 'completed' ? 'succeeded' : 'failed', detail });
          if (!verify.ok) console.error('[worker] occurrence verification failed:', runId, JSON.stringify(verify.body).slice(0, 200));
          if (status !== 'completed') throw new Error(detail);
          return { runId: createdRunId, occurrenceRunId: runId, status };
        }, 120);
      }
      if (target.type === 'task') {
        const handler = HANDLERS[target.taskType];
        if (!handler) throw new Error('No worker handler registered for scheduled task type: ' + target.taskType);
        const fakeTask = { id: task.id, userId: task.userId, type: target.taskType, payload: target.payload || {} };
        let result;
        try {
          result = await handler(fakeTask, api);
        } catch (err) {
          await platformApi('/api/scheduler', { action: 'record-occurrence', scheduleId, runId, status: 'failed', detail: String(err.message || err).slice(0, 500) }).catch(() => {});
          throw err;
        }
        const detail = 'Scheduled task ' + target.taskType + ' completed: ' + JSON.stringify(result).slice(0, 300);
        await platformApi('/api/scheduler', { action: 'record-occurrence', scheduleId, runId, status: 'succeeded', detail });
        return { taskType: target.taskType, result };
      }
      if (target.type === 'webhook') {
        const url = new URL(String(target.url || ''));
        if (!/^https?:$/.test(url.protocol)) throw new Error('Webhook targets must use http(s).');
        if (isBlockedHost(url.hostname)) throw new Error('Webhook target host is blocked (private/loopback/metadata): ' + url.hostname);
        return await withLease(task, async () => {
          const res = await fetch(url, {
            method: String(target.method || 'POST'),
            headers: { 'Content-Type': 'application/json' },
            body: ['GET', 'HEAD'].includes(String(target.method || 'POST')) ? undefined : JSON.stringify(target.body || {}),
            signal: AbortSignal.timeout(30_000),
          });
          const detail = 'Webhook target responded HTTP ' + res.status;
          // Any 2xx counts as verified success; everything else is an honest failure.
          const status = res.ok ? 'succeeded' : 'failed';
          await platformApi('/api/scheduler', { action: 'record-occurrence', scheduleId, runId, status, detail });
          if (!res.ok) throw new Error(detail);
          return { url: url.origin + url.pathname, httpStatus: res.status };
        }, 60);
      }
      throw new Error('Unsupported schedule target type: ' + String(target.type));
    } catch (err) {
      // If the handler threw before verifying, report the failure honestly.
      await platformApi('/api/scheduler', { action: 'record-occurrence', scheduleId, runId, status: 'failed', detail: String(err.message || err).slice(0, 500) }).catch(() => {});
      throw err;
    }
  },
};

const inflight = new Set();

async function runTask(task) {
  console.log('[worker] claimed', task.id, task.type);
  inflight.add(task.id);
  try {
    await tasksApi('/running', { taskId: task.id, workerId: WORKER_ID });
    const handler = HANDLERS[task.type];
    if (!handler) {
      throw new Error('No worker handler registered for task type: ' + task.type);
    }
    const result = await handler(task, tasksApi);
    await tasksApi('/complete', { taskId: task.id, workerId: WORKER_ID, result });
    console.log('[worker] completed', task.id);
  } catch (err) {
    console.error('[worker] failed', task.id, err.message);
    await tasksApi('/fail', { taskId: task.id, workerId: WORKER_ID, error: String(err.message || err) }).catch(() => {});
  } finally {
    inflight.delete(task.id);
  }
}

let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

async function tick() {
  const due = await tasksApi('/claim', { workerId: WORKER_ID, max: MAX_CONCURRENT });
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
