# External task worker (Feature 01)

Netlify functions enqueue durable tasks in Firestore; they never execute them.
This directory contains the separately deployed worker that claims and runs them.

## Deploy

Any always-on Node 18+ host:

1. Set `PLATFORM_BASE_URL` to the deployed site URL and `INFRA_DISPATCH_SECRET`
   to the same server secret.
2. `node workers/task-worker.mjs` (or containerize it).
3. Register handlers for your task types in the `HANDLERS` map. Until a handler
   exists for a type, the worker fails the task honestly and the queue applies
   retry/dead-letter policy.

## Guarantees

- Atomic claiming via Firestore transactions (no double execution).
- Leases renewed by heartbeat; expired leases are requeued by the API `/recover` sweep.
- Duplicate delivery is safe: handlers should tolerate re-execution; results are
  recorded once per task.
- With no worker configured, tasks stay durably queued and the API reports
  `blocked_worker_unavailable` honestly.
