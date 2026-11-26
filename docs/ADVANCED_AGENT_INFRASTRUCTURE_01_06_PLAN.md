# Advanced Agent Infrastructure 01–06 — Audit and Implementation Plan

**Repository:** `rajeevranjan4348-arch/manus-remix`  
**Base:** `main` at `f3830922055f07fcb29034e975d9b9ab3b290287`  
**Working branch:** `feat/advanced-agent-infrastructure-01-06`  
**Status:** Audit and implementation plan only; the six production systems are not yet accepted as complete.

## Executive assessment

The repository already contains useful building blocks, but several are browser-local prototypes or event-driven simulations rather than durable server infrastructure. The correct upgrade is to retain the current product and tool APIs while moving authoritative state and execution to authenticated server-side services.

Netlify Functions are request/dispatch boundaries, not persistent workers. Firestore is the durable application state store. Long-running work requires a separately deployed worker/provider with authenticated dispatch and leases. No provider should be marked healthy merely because environment variables exist.

## Verified current-state audit

| Feature | Existing implementation | Gap / acceptance status |
|---|---|---|
| 01 Durable task queue | `src/lib/taskQueue.ts` stores jobs in a browser Map/localStorage, dispatches browser events, waits a fixed 800 ms and marks jobs completed. | **NOT IMPLEMENTED** as a cloud worker queue. No atomic server claim, durable lease, external worker, dead-letter queue or independent execution. |
| 02 Permissions and audit | `server/permissionsGateway.ts` has useful policy classification, parameter hashing and challenge/token flows. | **NOT IMPLEMENTED** as durable authorization. Challenges and audit records are process-local Maps/arrays; a random secret fallback is generated when the production secret is missing. |
| 03 Multi-agent runtime | `src/lib/multiAgentOrchestrator.ts` plans role-labelled subtasks and calls an injected executor callback in parallel. | **PARTIAL**. It does not itself provide provider-backed agent calls, durable per-agent state, budget enforcement, cancellation, dependency graphs or independently verified provider usage. |
| 04 Skills | `src/lib/skillsSystem.ts` registers built-in handler functions and persists enable flags in localStorage. | **PARTIAL**. No durable per-user catalog, install/version/dependency lifecycle, source integrity model or sandboxed execution for untrusted code. |
| 05 Scheduler | `src/lib/scheduledAgents.ts` runs a browser interval, persists local state and a Firestore settings document, then dispatches a browser event and reports a trigger as successful. `server/scheduledTasks.ts` parses reminder intent and timezone data. | **NOT IMPLEMENTED** as a durable scheduler. Browser timer/event dispatch is not execution; no external scheduler, atomic due-job claiming or verified run history. |
| 06 Sandbox/browser | `src/lib/browserAutomation.ts` uses server/browser `fetch` and HTML extraction; it is not an interactive browser session. | **NOT IMPLEMENTED** as an isolated runtime. No verified sandbox provider, terminal process, workspace filesystem, real browser session or live preview runtime. |

### Additional architecture observations

- `netlify/functions/agent.ts` is an authenticated streaming request handler; it must remain bounded and must not become a long-running worker.
- `netlify/functions/checkpoints.ts` currently keeps a process-local Map as a best-effort cache. A client-side Firestore copy does not make that server endpoint's state authoritative or transaction-safe.
- `netlify/functions/permissions.ts` delegates to the in-memory permission singleton, so serverless instance changes can lose challenges and audit history.
- `firestore.rules` is default-deny with explicit per-collection rules. New server-owned records should be written through Firebase Admin after verified authentication; clients must not be allowed to self-approve or mutate worker state.
- Existing PR #49 is a draft for Feature 06 fail-closed groundwork. It must be reviewed and its fail-closed changes integrated without overwriting newer `main` work. It does not deliver a real sandbox/browser provider.
- Existing open PRs include CI/test workflow changes (#48), telemetry/mobile fixes (#47), streaming reliability (#46), and other backend/security work. Rebase/merge conflicts and CI results must be checked before integration.

## Target architecture

1. **Authenticated API layer (Netlify):** validate Firebase ID tokens, request schemas, ownership, body limits, idempotency keys and rate limits. Enqueue or query durable records; do not execute long-running work in request handlers.
2. **Firestore system-of-record:** user/workspace-scoped tasks, leases, task events, permission challenges, approvals, audit records, agent runs, skill installs, schedules and schedule executions. Use Admin SDK transactions for state transitions and atomic claims.
3. **External worker:** a separately deployed worker consumes claimed tasks, renews leases, executes bounded steps, persists checkpoints, honors cancellation and writes terminal states. Use provider-backed dispatch rather than browser timers.
4. **Provider adapters:** explicit interfaces for model providers, sandbox runtimes, browser sessions, scheduler/dispatch and notifications. Report `unavailable` until an actual health probe succeeds.
5. **Tool gateway:** all sensitive tool execution must verify authenticated ownership, policy, exact action/parameter binding and single-use approval server-side immediately before the action.
6. **Realtime projection:** expose persisted task events through the existing realtime/streaming architecture; progress must be derived from actual worker events and provider telemetry.

## Implementation sequence and dependencies

### Phase A — Security and persistence contracts
- Define shared Firestore record schemas and state transition invariants.
- Implement canonical parameter serialization and HMAC signing with a stable server secret. Production must fail closed when absent; development may use explicit test-only configuration.
- Add transaction-backed, owner-scoped permission challenge resolution and single-use approval consumption.
- Add immutable audit event writes with redaction and request/execution IDs.
- Add Firestore rules/tests for client read boundaries; server-only collections remain Admin SDK only.

### Phase B — Durable task dispatch
- Implement idempotent enqueue, atomic lease claim, heartbeat/lease renewal, cancellation, retry/backoff, timeout and dead-letter transitions.
- Add external worker adapter and health check. Until provisioned, enqueue may persist but execution must report `blocked: worker_unavailable`.
- Add worker recovery and duplicate-delivery tests.

### Phase C — Real agent execution
- Implement provider-backed agent adapters with isolated system instructions/context, scoped tool grants, concurrency/depth limits, cancellation and actual usage accounting.
- Persist each agent run and dependency edge; collect real outputs; require reviewer/QA evidence before completion.

### Phase D — Skills lifecycle
- Separate skill manifests from executable handlers.
- Validate manifests, semver, dependencies, compatibility and source integrity.
- Persist per-user installation/configuration/version state.
- Execute instructions through the trusted tool gateway; run code-bearing skills only in Feature 06 sandbox.

### Phase E — Durable scheduling
- Persist schedule definitions and execution records.
- Use external scheduler events to enqueue Feature 01 jobs; use transactions and idempotency for due occurrences.
- Calculate recurrence against IANA time zones, including DST ambiguity/nonexistent-time policy.
- Notify only after a persisted execution result exists.

### Phase F — Sandbox and browser providers
- Select and provision sandbox and browser providers; credentials remain server-side.
- Implement workspace ownership, path normalization, symlink containment, resource caps, process tracking, output streaming, cancellation and cleanup.
- Enforce DNS/IP/redirect-aware SSRF policy at the browser provider boundary.
- Return preview URLs only after the provider confirms server readiness.

### Phase G — Cross-feature acceptance
- Verify the autonomous coding and scheduled research flows end-to-end.
- Run unit, integration, security, TypeScript and production build checks.
- Run Netlify deploy preview and provider-backed smoke tests.
- Keep this PR draft until all required gates pass.

## Required configuration / external prerequisites

No provider credential should be committed or pasted into chat. Configure secrets in the deployment provider's secure environment settings.

- Firebase Admin service identity / supported application default credentials for server-side Firestore operations.
- Durable worker host and authenticated dispatch/heartbeat endpoint.
- Model provider credentials and usage telemetry.
- Sandbox provider account/API key and a preconfigured, resource-limited template.
- Browser session provider account/API key and project identifier.
- Durable scheduler/dispatch provider.
- Notification provider configuration if notifications leave the in-app channel.
- Stable `POLICY_GATEWAY_SECRET` (at least 32 random bytes, stored as a server secret).

## Acceptance matrix

| Gate | Status |
|---|---|
| Durable background execution | **NOT IMPLEMENTED** |
| Persistent permissions and audit | **NOT IMPLEMENTED** |
| Provider-backed multi-agent runtime | **PARTIAL** |
| Persistent server-backed skills | **PARTIAL** |
| Durable scheduler and automation | **NOT IMPLEMENTED** |
| Real sandboxed terminal and browser | **NOT IMPLEMENTED** |
| Cross-feature integration | **NOT IMPLEMENTED** |
| Security/integration tests | **NOT RUN** |
| Full test suite | **NOT RUN** |
| TypeScript check | **NOT RUN** |
| Production build | **NOT RUN** |
| Netlify/provider smoke tests | **BLOCKED — external providers/credentials not provisioned** |

## Safety and release rules

- Never run untrusted commands on the Netlify host.
- Never accept a frontend-only approval flag as authorization.
- Never treat a browser event, timer tick, generated plan, configuration flag or mock handler response as execution evidence.
- Do not change existing UI or delete working workflows as part of this backend upgrade.
- Do not merge this branch until every required acceptance gate is evidenced by CI and provider-backed tests.
