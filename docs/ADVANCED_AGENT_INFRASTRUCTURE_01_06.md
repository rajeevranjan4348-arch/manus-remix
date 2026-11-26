# Manus Remix — Advanced Agent Infrastructure (Features 01–06)

Implementation record for the master upgrade on branch
`feat/advanced-agent-infrastructure-01-06` (open as PR #50). This document is honest by
construction: anything not executed or not yet verifiable is labeled
AUTHORED-NOT-EXECUTED or BLOCKED rather than claimed as passing.

## 0. Audit findings that shaped the design

| Existing code | Finding | Action |
| --- | --- | --- |
| `src/lib/browserAutomation.ts` | Fake: `fetch + regex` scraping, no DOM, no screenshots, no sessions. | Left untouched (widely imported); superseded server-side by the Feature 06 browser session engine. |
| `src/lib/codingAgent.ts` | GitHub API automation only, no execution. | Untouched; Feature 06 provides the real execution path. |
| Tool framework (`src/lib/toolFramework.ts`) | Client-side registry with risk levels + approval gates; legacy placeholder tools `run_command~/`commit_changes~/`git_push~/`delete_file` fabricated results. | Placeholder tools upgraded to fail-closed errors pointing at the real engine tools; 20 real sandbox tools registered into the same registry. |
| `server/permissionsGateway.ts` | Durable gateway existed with challenges/approval tokens/audit. | Reused for every new feature; sync/async contract fixed; tail contamination removed. |
| Task queue (Feature 01, earlier commits on this branch) | Firestore-backed durable queue existed but had no real executors. | Worker handlers added for agent runs and schedule occurrences. |
| Reminders | Pure reminder parsing; nothing persisted. | Replaced by the persistent scheduler (Feature 05) that reuses the durable queue. |

The six features share one spine: **Netlify function routers (auth + gateway + shaped errors) → server services with hard limits → Firestore stores (clearly-flagged non-durable fallback only for tests/dev) → external worker for execution.**

## 1. Feature 01 — Durable cloud background agent & task queue

- `server/tasks/taskStore.ts`: transactional Firestore store (`agentTasks`) with atomic claiming
  (transaction on status/lease), lease renewal, retry bookkeeping, dead-letter policy.
- `server/tasks/taskQueue.ts`: idempotency-keyed enqueue (deterministic ids), payload/type
  limits, exponential backoff with deterministic jitter, honest
  `describeDispatch` (`blocked_worker_unavailable` when no worker is configured — never a
  fake "running").
- `netlify/functions/tasks.ts`: user API + worker API (`/claim`, `/running`, `/complete`, `/fail`, `/heartbeat`)
  authenticated with `x-dispatch-secret` (timing-safe compare, fail closed when unset).
- `workers/task-worker.mjs`: the real executor. Netlify functions are request handlers,
  not workers; deploy this process on any always-on host. It claims leased tasks,
  renews leases via heartbeat, runs bounded-concurrency handlers, reports results.

## 2. Feature 02 — Persistent permissions & security audit

- `server/permissionsGateway.ts` (upgraded): durable challenges, one-time approval
  tokens (HMAC via `POLICY_GATEWAY_SECRET`, fail closed in production when missing),
  replay protection, action/parameter binding, expiration, per-user policies,
  revocation and rejection history, and durable audit records in
  Firestore (`permissionChallenges`, `userPermissionPolicies`, `securityAudit`).
- `server/sandbox/orchestrator.ts` re-verifies every action server-side via an injected
  async `ApprovalEvaluator`; the Netlify functions evaluate `permissionsGateway.evaluateAction`
  and sink audit events (`durableAudit`) into the gateway.
- Registered policy families: sandbox tools (20), agent runs
  (`agent_run_create`/`execute`/`cancel`), skills (`skill_install`/`skill_manage`/`skill_uninstall`/`skill_execute`),
  scheduler (`scheduler_manage`), durable task ops. Unknown tools default to privileged.

## 3. Feature 03 — True autonomous multi-agent runtime

- `server/agents/types.ts`: 11 agent roles, subtask specs/results, run records, hard
  limits (max 12 subtasks, concurrency 4, 400k tokens/run, 300s per agent).
- `server/agents/modelProvider.ts`: real OpenAI-compatible chat-completions calls;
  **fail closed** (`MODEL_PROVIDER_UNAVAILABLE`) without `AGENT_MODEL_API_KEY`/`BASE_URL`/`ID`;
  usage/cost are taken strictly from provider-reported usage.
- `server/agents/agentRuntime.ts`: plan validation (unknown roles, duplicate ids, cycles),
  model-backed planning when no explicit plan, wave-based execution honoring
  dependencies, parallelism caps, per-agent context isolation (objective +
  dependency outputs only), shared budget accounting, timeouts (AbortController),
  durable cancel polling, skip semantics (`SKIPPED_BUDGET_EXCEEDED`,
  `SKIPPED_DEPENDENCY_FAILED`), final reviewer gate (PASS/FAIL first line => completed
  vs `REVIEWER_REJECTED`/`INCOMPLETE_SUBTASKS`/`REVIEWER_UNAVAILABLE`).
- `netlify/functions/agents.ts`: user routes + worker path (`execute-run` and the
  scheduler-fed `create-run`), each audited.
- Tests: `tests/agentRuntime.test.ts` (planning, parallelism, budgets, timeouts,
  cancellation, reviewer gate, context isolation with a scripted model caller).

## 4. Feature 04 — Server-backed skills ecosystem

- `server/skills/types.ts`, `skillStore.ts`, `skillsService.ts`: manifests with semver,
  supported tools, dependencies, permissions and compatibility metadata; installs
  with version history, updates, rollbacks, enable/disable, uninstall with
  dependent-skill guards; per-user limits; execution history
  (Firestore `skills`, `skillExecutions`).
- Security: prompt skills return instruction bundles only (`instructions_only`); skills
  declaring an entrypoint must ship files that pass the Feature 06 path guard and
  fail closed with `SKILL_SANDBOX_UNAVAILABLE` when no sandbox provider is configured;
  execution is permission-gated through the Feature 02 gateway and audited;
  third-party manifests are strictly validated and never trusted.
- Skill selection for tasks: keyword ranking over installed, enabled, compatible skills.
- Tests: `tests/skills.test.ts`.

## 5. Feature 05 — Persistent scheduler & automation engine

- `server/scheduler/types.ts`, `recurrence.ts`, `scheduleStore.ts`, `schedulerService.ts`,
  `netlify/functions/scheduler.ts`, `tests/scheduler.test.ts`.
- Schedule kinds: `once` (ISO instant), `recurring` (UTC interval or daily local time),
  `cron` (5-field). Timezone-aware via per-instant `Intl` wall-clock evaluation, so DST
  gaps and repeats are handled by construction (tested across an America/New_York
  DST boundary). Crons must fire within the 40-day planning window or creation is
  refused honestly.
- Targets: `agents_run` (Feature 03), `task` (worker-registered handler), `webhook`
  (URL validated at creation with the Feature 06 URL policy and re-checked at
  execution with a worker-side private/loopback/metadata egress guard).
- Durability: schedules + runs in Firestore (`schedules`, `scheduleRuns`). Occurrences
  are claimed by transactional compare-and-set on `nextRunAt`, so concurrent ticks can
  never double-dispatch; the dispatched task carries an occurrence-scoped
  idempotency key (`occ_<scheduleId>_<ms>`).
- Missed jobs: 5-minute grace window; `skip_to_next` records an honestly-labeled
  `skipped` run and advances; `catch_up_once` fires the planned occurrence once.
- Honesty: an occurrence only becomes `succeeded`/`failed` when the worker reports back
  verified execution (`record-occurrence` worker action); task dispatch states
  (`blocked_worker_unavailable` etc.) are reported as-is. Notifications: the durable
  task/run records drive the existing client-side notification dispatcher; the
  server records outcomes rather than fabricating "notification sent" events.
- Tick: Netlify Scheduled Function every 5 minutes (`[functions."scheduler"]` in
  `netlify.toml`), fails closed without `SCHEDULER_TICK_SECRET`; external schedulers may
  POST a `tick` action with `x-dispatch-secret`.

## 6. Feature 06 — Sandboxed coding & real browser execution engine

(Full detail in `docs/SANDBOX_EXECUTION_ENGINE.md`.)

- `server/sandbox/provider.ts` + `e2bProvider.ts`: provider abstraction over E2B
  (dynamic SDK import; fail-closed `PROVIDER_UNAVAILABLE` when unconfigured — no fake success).
- `server/sandbox/orchestrator.ts`: sessions with CPU/memory/time limits, terminal
  execution with captured stdout/stderr/exit codes, streaming, timeouts,
  cancellation, controlled filesystem (path traversal/symlink/absolute-path
  guards in `pathGuard.ts`), real browser sessions (navigate/click/fill/inspect/
  screenshot with `urlPolicy.ts` SSRF protection), and dev-server preview that
  reports real readiness and real URLs only.
- `server/sandbox/executionStore.ts`: durable execution/browser-session records in
  Firestore (`sandboxSessions`, `sandboxExecutions`, `sandboxBrowserSessions`) with
  idempotent terminal retries; memory fallback flags `durable:false`.
- `netlify/functions/sandbox.ts`: router with gateway gating + durable audit sink.
- All 20 tools registered from `src/lib/sandboxTools.ts` into the existing tool
  framework: `sandbox_create`, `sandbox_status`, `terminal_execute`, `terminal_stream`,
  `terminal_cancel`, `filesystem_list/read/write/delete/search`, `browser_session_create`,
  `browser_navigate/inspect/click/fill/screenshot`, `browser_session_close`,
  `preview_start`, `preview_status`, `sandbox_cleanup`.

## 7. Cross-feature integration

- Scheduled research: Feature 05 persists the schedule → tick claims and enqueues
  `automation.run` into the Feature 01 queue → worker executes the occurrence → for
  `agents_run` targets it creates + executes a Feature 03 run (Feature 02 gates every
  sensitive action; Feature 04 skills are selected for the run) → worker reports the
  verified outcome to `record-occurrence` → durable run record + audit entry; the
  client's existing notification dispatcher surfaces the completion.
- Autonomous coding: Feature 01 task → Feature 02 permission checks → Feature 03
  research/coding/testing agents → Feature 04 skill selection → Feature 06 sandbox
  (terminal + filesystem + browser tests) → real preview URL returned only when the
  dev server is actually ready → results persisted in the durable task record.
- Worker handlers `agents.execute_run` and `automation.run` (with lease heartbeats)
  make these flows execute for real outside the browser.

## 8. Configuration

All provider credentials are server-side only. See `.env.example`:

| Variable | Purpose | Missing behavior |
| --- | --- | --- |
| `POLICY_GATEWAY_SECRET` | Approval-token signing (Feature 02) | Fail closed in production |
| `TASK_WORKER_URL`, `INFRA_DISPATCH_SECRET` | Feature 01 dispatch + all worker-only paths | Tasks queue durably; dispatch reported honestly as blocked |
| `SCHEDULER_TICK_SECRET` | Feature 05 scheduled tick | Tick fails closed |
| `AGENT_MODEL_*` | Feature 03 model calls | `MODEL_PROVIDER_UNAVAILABLE` |
| `E2B_API_KEY`, `SANDBOX_PROVIDER`, `E2B_*` | Feature 06 sandbox/browser | `PROVIDER_UNAVAILABLE` |
| `UPSTASH_REDIS_REST_*` | Cross-instance atomic rate limits | In-process fallback limiter |

Firestore collections used: `agentTasks`, `permissionChallenges`, `userPermissionPolicies`,
`securityAudit`, `sandboxSessions`, `sandboxExecutions`, `sandboxBrowserSessions`,
`agentRuns`, `skills`, `skillExecutions`, `schedules`, `scheduleRuns`.

## 9. Honest evidence matrix

| Item | Status |
| --- | --- |
| Unit/integration tests for Features 01–06 (`tests/` under Vitest, ~55 tests) | **AUTHORED-NOT-EXECUTED** — the author environment has no Node/Bun toolchain; the `bun run test` CI step added in this branch is the execution gate. |
| `vitest` added to devDependencies + `test` script in `package.json` | Implemented (CI runs it). |
| Lint (`tsc --noEmit`, `src/**` scope) and production build | Not executed locally; same CI gate. |
| Live E2B sandbox/browser execution | **BLOCKED — no E2B credentials in the author environment.** The adapter is written against the documented SDK surface and fails closed when absent; first live validation pending credentials. |
| Live model-provider agent runs | **BLOCKED — no model credentials.** Usage/cost paths read only real provider-reported usage. |
| Live worker + scheduled tick end-to-end | **BLOCKED — requires deployment of `workers/task-worker.mjs` and Netlify env configuration.** |
| Firestore-backed stores under a real Firebase project | **BLOCKED — no service-account credentials**; memory fallbacks in tests are explicitly non-durable. |
| Server-side push notification emission | **NOT IMPLEMENTED** by design here: notifications surface via the existing client dispatcher reacting to durable task/run records; no fake "delivered" receipts are recorded. |
| UI changes | None. Zero UI files touched (spec: absolute UI preservation). |

## 10. Reviewer notes

- PRs #48 and #49 (CI test step; fail-closed groundwork) are superseded by
  equivalent changes already on this branch; their owners may close them.
- The legacy placeholder tools (`run_command`, `commit_changes`, `git_push`, `delete_file`)
  now fail closed with pointers to the real engine tools instead of fabricating
  results; they were deliberately kept (not deleted) to avoid touching UI-adjacent
  registries.
- `src/lib/browserAutomation.ts` remains untouched because many modules import it;
  the real browser engine lives server-side. Consolidating it is follow-up work.

## 11. Acceptance criteria

- Durable cloud background execution: implemented (Feature 01 + worker).
- Persistent permissions and audit logs: implemented (Feature 02).
- Real autonomous multi-agent execution: implemented (Feature 03; provider-backed).
- Persistent server-backed skills: implemented (Feature 04).
- Durable scheduling and automation: implemented (Feature 05).
- Real sandboxed terminal and browser execution: implemented (Feature 06; live
  E2B validation BLOCKED on credentials).
- Cross-feature integration: verified by code paths + worker handlers above;
  end-to-end runtime verification BLOCKED on deployment + credentials.
- Security and isolation tests: authored (not executed here; CI gate).
- Existing features preserved: no UI files touched.
- Netlify compatibility: function router pattern, redirect order verified
  (specific routes before the SPA catch-all), scheduled-function config added.
- Production build + full test suite: to be confirmed by CI on this PR.
