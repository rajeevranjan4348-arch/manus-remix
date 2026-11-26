# Features 01–06 — Advanced Autonomous Agent Infrastructure (Implementation)

Status: implemented on branch `feat/advanced-agent-infrastructure-01-06`, delivered as an update to PR #50.
This document records what was built, how it integrates, and an honest verification matrix.

## Architecture overview

| Feature | Server module | Durable collections | Netlify functions | External runtime |
| --- | --- | --- | --- | --- |
| 01 Durable task queue | `server/taskQueue/durableTaskQueue.ts`, `server/taskQueue/workerDispatch.ts` | `system_agent_tasks`, `system_agent_task_events` | `tasks`, `tasks-worker` | External worker (`worker/index.ts`) via `WORKER_DISPATCH_URL` / QStash |
| 02 Persistent permissions & audit | `server/permissionsGateway.ts` (rewritten) | `system_permission_challenges`, `system_permission_tokens`, `system_permission_audit`, `system_permission_policies`, `system_permission_revocations` | `permissions` | — |
| 03 Multi-agent runtime | `server/agentRuntime/agentRuntime.ts` | `system_agent_runs` | `agent-runtime` | Gemini API (`GEMINI_API_KEY`) |
| 04 Server-backed skills | `server/skills/durableSkills.ts` | `system_skills_installed`, `system_skill_versions`, `system_skill_executions` | `skills` | Sandbox for code-bearing skills |
| 05 Scheduler & automation | `server/scheduler/cronTime.ts`, `server/scheduler/scheduleEngine.ts` | `system_schedules`, `system_schedule_runs`, `system_notifications` | `schedules`, `scheduler-tick` (scheduled `@hourly`) | Dispatches into Feature 01 |
| 06 Sandboxed coding & browser | `server/sandbox/sandboxService.ts` | `system_sandbox_workspaces` | `sandbox` | External worker sandbox/browser contract |

Shared foundation: `server/durable/store.ts` defines the `DurableStore` abstraction with a Firestore
backend (Firebase Admin), a memory backend for non-production/tests, and an explicit `unavailable`
backend that fails closed. All six features persist through it; production authorization refuses to
run on the memory backend.

## Feature 01 — Durable task queue

- Lifecycle: `queued → claimed → running → completed / failed / cancelled` (+ `waiting_approval`, `dead_letter`).
- Atomic claim via `transact` compare-and-set with time-bound leases; per-user concurrency cap (`WORKER_MAX_CONCURRENT_TASKS`).
- Idempotency keys prevent duplicate active tasks; retry with exponential backoff (`computeBackoffMs`), bounded attempts, permanent-failure terminal state.
- `recoverInterrupted()` requeues tasks with expired leases (safe to call repeatedly).
- Cancellation is owner-verified and confirmed by the worker.
- `tasks/worker` HTTP bridge is authenticated with a timing-safe `WORKER_API_TOKEN` comparison.
- Netlify functions accept and persist jobs but never act as long-running workers; dispatch notifies an external worker (`WORKER_DISPATCH_URL` webhook or QStash).

## Feature 02 — Persistent permissions & audit

- Challenges, approvals, tokens, policies, revocations, and audit records are durable; nothing safety-critical lives in process-local maps in production.
- One-time approval tokens are indexed durably (`system_permission_tokens`) so verification and consumption work from any instance; consumption is a transaction on the challenge document (cross-instance replay protection).
- Action + parameter binding: HMAC-based parameter hash; tampered args or a different tool fail verification atomically without mutating the challenge.
- Token and challenge expiry enforced at verification time.
- Revocation records persist and block token-bearing evaluations.
- Production fails closed when `POLICY_GATEWAY_SECRET` (<32 chars or missing) or a Firestore backend is absent; non-production may use a random ephemeral secret for local development.
- Audit captures approvals, rejections, denials, consumption, and revocations with user, tool, target, timestamp, challenge/execution IDs.

## Feature 03 — Multi-agent runtime

- Nine roles: research, coding, debugging, testing, analysis, browser, security_review, qa, documentation — each with its own system instruction, default model, tool grants, and output token cap.
- Real provider calls via `AgentModelClient` (`createGeminiModelClient` uses `@google/genai` and reports actual `usageMetadata`; totals use `usageSource: 'provider' | 'unavailable'` — usage is never invented).
- Dependency-ordered batches with bounded concurrency (`maxConcurrency`), token budgets (`maxTotalTokens`) that mark overflow as `blocked_budget`, per-agent timeouts via `AbortController`, one corrective re-run for failed validation, and a final QA reviewer pass.
- Output validation rejects empty/placeholder deliverables; a failed validation marks the subtask failed rather than "completed".
- Run records persist to `system_agent_runs`.

## Feature 04 — Skills ecosystem

- Manifest validation (semver, field bounds, protected security-tool rejection), source integrity hash, dependency resolution against installed skills + builtins.
- Install / update (strictly increasing versions) / rollback (stored version documents) / enable / disable / configure / uninstall — all durable and per-user.
- Execution honors permissions (sensitive tools require gateway approval) and runs code-bearing skills only inside an external sandbox; with no sandbox the result is `unavailable`, never a fake success.
- Execution history per user and per skill persists to `system_skill_executions`.

## Feature 05 — Scheduler & automation

- One-time (ISO instant), interval, and 5-field cron specs with IANA timezone support.
- Cron evaluation converts zone wall-clock to UTC with DST-aware expansion (double-pass wall-clock resolution).
- Ticks claim due schedules through transactions so concurrent tickers cannot double-dispatch, and enqueue into Feature 01 with idempotency keys.
- Missed-job policies: `run_once` (execute the missed job once, then continue) or `skip` beyond a 24h policy window.
- Pause / resume / edit / cancel; resume recomputes a fresh next run instead of firing stale jobs.
- Completion is only marked `verified` through `acknowledgeRunCompletion` from real task outcomes; failures write `system_notifications` records.

## Feature 06 — Sandboxed coding & browser execution

- External provider contract over HTTP (`/sandbox/create|status|exec|kill|destroy`, `/fs/*`, `/browser/session/*`, `/preview/start|status`) implemented by the bundled worker service.
- All operations enforce durable workspace ownership (`system_sandbox_workspaces`) before any provider call, including terminal execution.
- Browser sessions are public-web only: `assertBrowserUrlAllowed` blocks localhost, metadata hosts, link-local, private IPv4 ranges (10/8, 127/8, 172.16/12, 192.168/16, 100.64/10, 0/8), bracketed and bare IPv6 loopback/ULA, and `.local`/`.internal` names.
- Filesystem operations enforce a 4MB size bound; code-bearing flows never spawn host processes from untrusted skill content.
- Previews are issued only after the provider reports actual readiness; the response for a non-ready server contains no URL at all.
- Without provider credentials every operation returns an explicit `unavailable` result.

## Client integration

- `src/lib/executionTools.ts` registers `sandbox_*`, `terminal_*`, `filesystem_*`, `browser_*`, `preview_*`, `sandbox_cleanup`, `enqueue_background_task`, and `task_status` in the existing tool framework.
- `src/lib/toolFramework.ts` no longer fabricates `delete_file` success: it requires a sandbox workspace and delegates to the durable sandbox API.
- `src/lib/durableTaskMirror.ts` mirrors local queue jobs to `/api/tasks` with authentication, bounded dedupe, and honest failure logging (no fake durable confirmation).

## Netlify wiring

- Functions: `tasks`, `tasks-worker`, `agent-runtime`, `skills`, `schedules`, `scheduler-tick`, `sandbox`.
- `netlify.toml` redirects expose them under `/api/tasks`, `/api/tasks/worker`, `/api/agent/runtime`, `/api/skills`, `/api/schedules`, `/api/scheduler/tick`, `/api/sandbox`.
- `firestore.rules` deny all client access to `system_*` collections; only Firebase Admin server paths can touch them.

## Deployment prerequisites

1. `POLICY_GATEWAY_SECRET` (≥32 chars) — mandatory in production; authorization fails closed without it.
2. Firestore service credentials (`FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`).
3. Worker deployment: `npm run worker` (`worker/index.ts`) with `WORKER_API_TOKEN`, plus `WORKER_DISPATCH_URL` (or QStash `QSTASH_TOKEN`/`QSTASH_URL`) so Netlify can notify it.
4. Sandbox/browser capability: the worker image must include Playwright (`playwright` is imported dynamically and the browser endpoints return a 503 with an explicit `unavailable` flag when it is absent).
5. `GEMINI_API_KEY` for Feature 03 provider-backed execution; without it `/api/agent/runtime` answers `503 PROVIDER_UNAVAILABLE`.
6. Scheduled ticker: the `scheduler-tick` function runs on Netlify's `@hourly` schedule; point a more frequent external scheduler at `/api/scheduler/tick` for tighter dispatch latency.

## Verification matrix (honest classification)

| Area | Checks | Result |
| --- | --- | --- |
| Feature 01 queue semantics | 12 new tests: persistence, idempotency, atomic concurrent claim, priority, concurrency cap, lifecycle history, worker-only transitions, retry/backoff, lease recovery, cancellation, user isolation, backoff math | **PASS** |
| Feature 02 permissions | 12 new tests plus the 22 pre-existing gateway/security tests: durable challenges, one-time tokens, replay, expiry, cross-user isolation, tamper binding, audit, revocation, fail-closed production | **PASS** |
| Feature 03 agent runtime | 11 new tests with a fake model client: usage aggregation, role context isolation, dependency ordering, budgets, timeout abort, failed-validation propagation (implementation hardened: final-round validation failures now fail the subtask instead of reporting success) | **PASS** for model-client contract & orchestration. Live Gemini execution **BLOCKED** in CI (no `GEMINI_API_KEY`); the code path returns explicit 503 `PROVIDER_UNAVAILABLE` rather than fake output |
| Feature 04 skills | 14 new tests: manifest validation, hashes, install/update/rollback/uninstall, dependency gating, permission gating, sandbox requirement, history | **PASS** |
| Feature 05 scheduler | 13 new tests: cron parsing, timezone/DST conversion, next-run math, once-only dispatch, recurring advancement, cancel/pause, missed-job policies, verified-only completion, failure notifications | **PASS** |
| Feature 06 sandbox/browser | 10 new tests: URL policy (17 blocked targets), IPv6 policy, fail-closed unavailability for every operation, no fabricated preview, readiness-verified preview, terminal contract, ownership enforcement, file-size limits. One real vulnerability fixed: terminal execution now verifies workspace ownership | **PASS** for policy/contract/wiring. Real browser + dev-server runs **BLOCKED** without a provisioned worker image (Playwright/sandbox provider) |
| Regression: existing suite | 533 pre-existing tests: 521 pass; 12 fail **identically to `main`** (verified by diffing failing test names against a clean `main` checkout) — all are pre-existing source-assertion failures unrelated to this branch | **PASS** (no new regressions) |
| Regression: firestore rules contract | 7 tests pass after re-placing the `system_*` deny rules ahead of the conversations block | **PASS** |
| Type checking | `tsc --noEmit` over `src` (repo `lint`) passes; strict `tsc` over all new `server/`, `netlify/functions`, and `worker/` files passes | **PASS** |
| Production build | `bun run build` succeeds; `dist/index.html` emitted | **PASS** |
| Live end-to-end (worker + Firestore + real browser) | Requires provisioned credentials and worker deployment | **BLOCKED** — credentials are not available in this environment; all code paths return explicit `unavailable` states |

## Test execution

```bash
bunx vitest run                       # 605 tests: 593 pass, 12 pre-existing failures (identical to main)
bun run lint                          # tsc --noEmit over src
bun run build                         # production build
bunx vitest run tests/durableTaskQueue.test.ts \
  tests/durablePermissions.test.ts tests/agentRuntime.test.ts \
  tests/durableSkills.test.ts tests/scheduleEngine.test.ts tests/sandboxSecurity.test.ts
```
