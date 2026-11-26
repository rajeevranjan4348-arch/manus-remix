# Feature 06 — Sandboxed Coding & Real Browser Execution Engine

Status: implemented on a feature branch, pending real-provider verification.
This document describes what is REAL, what is CONFIG-GATED, and what is NOT yet
verified. No capability is claimed as operational without either executed tests
or live provider credentials; see the evidence matrix at the end.

## 1. What was audited before building

| Existing area | Finding | Reused / upgraded |
| --- | --- | --- |
| src/lib/browserAutomation.ts | fetch + regex HTML scraping, no DOM, no real screenshots, always-empty interactiveElements | Kept for backwards compatibility; NOT duplicated. Real browser sessions live in the new server-side engine |
| src/lib/codingAgent.ts | GitHub API repo file automation (commit/read/diff) | Untouched; complementary to workspace execution |
| src/lib/toolFramework.ts | Client-side ToolRegistryService: risk levels, approval gates, validation, observability | New tools registered through it (one import + one call) |
| server/permissionsGateway.ts | Policy definitions, challenge/ approval tokens, audit records | Sandbox tool policies registered into the same gateway; tokens re-verified server-side |
| src/middleware/auth.ts + src/lib/firebase-admin.ts | Firebase ID token + guest session verification | Reused verbatim; user identity ONLY from the verified token |
| netlify/functions/* | Bearer-token router pattern, payload limits, JSON response hygiene, been-tested in vitest | New sandbox.ts follows the same conventions |
| netlify.toml | Redirect table + SPA catch-all | /api/sandbox routes inserted BEFORE the catch-all |
| Firestore infra | firebase-admin initialized with project ID | Durable records under sandboxSessions / sandboxExecutions / sandboxBrowserSessions |
| Existing tests | vitest suites in tests/ | New tests/sandboxEngine.test.ts follows the pattern |

## 2. Architecture

```
Agent (Work mode) 
  -> toolRegistry.executeTool('sandbox_create' | 'terminal_execute' | ...)
  -> src/lib/sandboxTools.ts            (risk levels, approval gates, validation)
  -> POST /api/sandbox (Firebase bearer token)
  -> netlify/functions/sandbox.ts       (auth, payload limits, action allowlist)
  -> server/sandbox/orchestrator.ts     (ownership, approvals, durable records, audit)
  -> server/sandbox/provider.ts         (provider abstraction, fail-closed)
  -> server/sandbox/e2bProvider.ts      (real isolated cloud sandbox + real Chromium)
Security primitives: server/sandbox/urlPolicy.ts (SSRF), server/sandbox/pathGuard.ts (traversal)
Durable store:      server/sandbox/executionStore.ts (Firestore, non-durable fallback flagged)
```

Key invariants:

- User commands NEVER run on the Netlify host. The host only relays to the provider API.
- The verified Firebase identity is the ONLY source of identity; session and execution
  records are scoped to it at write time and at read time. Cross-user access returns
  SANDBOX_NOT_FOUND (indistinguishable from nonexistence).
- Every filesystem path from the agent passes through the path guard: no absolute paths,
  no traversal, no drive letters, no NTFS streams, bounded depth and length. Terminal
  working directories get the same treatment.
- Every browser navigation passes the URL policy: loopback, private ranges, link-local,
  cloud metadata, and internal hostnames are blocked by default.
- Preview URLs are only ever returned AFTER a real HTTP probe of the provider host URL
  succeeds. Dependency or startup failures return ready:false with diagnostics. The code
  path that would fabricate a URL does not exist.
- Provider unavailability is explicit: with no SANDBOX_PROVIDER / E2B_API_KEY, every
  execution action fails with PROVIDER_UNAVAILABLE and a precise reason. Nothing pretends.

## 3. Provider abstraction and E2B adapter

SANDBOX_PROVIDER selects the vendor; today adapters: `e2b` (full: terminal, filesystem,
preview, browser) and `off`. The SDK modules are loaded dynamically, so the existing
build and deploy stay green before credentials exist. To enable for real:

```bash
npm install e2b @e2b/desktop
```

Then set on the server (Netlify env): SANDBOX_PROVIDER=e2b, E2B_API_KEY (or E2B_DOMAIN),
optional E2B_TEMPLATE / E2B_TEMPLATE_REACT_VITE / E2B_TEMPLATE_NEXT, E2B_DESKTOP_ENABLED=1.
Runtimes node/ts/js/python/html-css run on the default images; react-vite/next/custom are
disabled until their template variables are set and actually validated (do not assume).

The desktop SDK supplies the isolated Chromium (separate cookies/storage per session);
DOM interaction uses a minimal CDP-over-WebSocket client, screenshots are real PNG
captures. Browser sessions survive function restarts by persisting the desktop sandbox
id in the durable session record and re-attaching.

## 4. Durable execution & recovery

- Session, execution and browser-session records persist to Firestore (firebase-admin,
  same project as the existing functions). All state filtering is by verified userId.
- Idempotency: terminal_execute accepts an idempotencyKey; retries replay the original
  durable record instead of re-executing. The idempotency query degrades gracefully if a
  Firestore composite index is missing.
- Expiration: every record carries expiresAt and lastActiveAt; sweepExpired terminates
  lifetime- and idle-expired sandboxes opportunistically on API hits, and provider-side
  timeouts bound runaway commands.
- Non-durable fallback: if Firestore credentials are absent, the store degrades to
  in-process and every response honestly reports durable:false.
- No process-local Maps are used as durable state anywhere in the new engine.

## 5. Tool surface (all 20 registered in the existing framework)

sandbox_create, sandbox_status, terminal_execute, terminal_stream, terminal_cancel,
filesystem_list, filesystem_read, filesystem_write, filesystem_delete, filesystem_search,
browser_session_create, browser_navigate, browser_inspect, browser_click, browser_fill,
browser_screenshot, browser_session_close, preview_start, preview_status, sandbox_cleanup.

Risk levels: read-only tools (status/list/read/search/inspect/screenshot/preview_status)
run without confirmation; sensitive/privileged/destructive tools (create with concurrency
limits, execute, write, delete, navigate, click, fill, preview_start, cleanup) pass the
client approval gates AND a server-side re-verification against
server/permissionsGateway (verifyApprovalToken; unknown tools default to privileged).

UI: no Manus Remix UI was redesigned, moved, or duplicated. Capabilities surface through
the existing Work mode tool pipeline and existing approval UI. The only API changes are
additive (/api/sandbox redirect). Deleted/legacy: nothing.

## 6. Test evidence matrix (honest)

Automated suite: tests/sandboxEngine.test.ts (vitest), runnable with npm test / bun run test.

| Area | Test | Status |
| --- | --- | --- |
| SSRF policy: loopback, metadata, private IPv4/IPv6, internal hosts | 6 describe blocks, ~25 assertions | Written; run via CI/local (see note) |
| Path guard: traversal, absolute, drive letter, null byte, NTFS stream, root-escape | ~12 assertions | Written; run via CI/local (see note) |
| Cross-user isolation: userB gets SANDBOX_NOT_FOUND for userA's session | 1 test | Written; run via CI/local (see note) |
| Concurrency limits, cleanup idempotency, invalid ids/paths | 3 tests | Written; run via CI/local (see note) |
| Durable store owner scoping + idempotency replay | 3 tests | Written; run via CI/local (see note) |
| Approval required / allowed-with-token + denial audit | 2 tests | Written; run via CI/local (see note) |
| Preview honesty: real URL only after probe; install failure reports ready:false, null URL | 2 tests | Written; run via CI/local (see note) |
| All 20 tools registered with correct risk levels | 1 test | Written; run via CI/local (see note) |
| Real E2B sandbox create/exec/fs | - | BLOCKED: no E2B_API_KEY in this environment |
| Real browser navigation/interaction/screenshot | - | BLOCKED: no E2B credentials; also requires @e2b/desktop install |
| Provider failure/recovery against live vendor | - | BLOCKED: no credentials |
| Full existing suite + production build on this branch | - | PENDING: author tooling cannot execute node/bun here; CI (ci.yml) runs lint + build on the PR; run npm test manually or extend ci.yml |
| Netlify deploy compatibility | Redirects/functions follow existing pattern | PENDING first deploy |

Note (2026-11-26): this work was produced in an environment without a Node/Bun toolchain,
so the new tests were authored but NOT executed by the author. Nothing below was marked
"passed" without execution. wire ci.yml to run npm test (existing branch
feat/ci-run-full-test-suite already sketches this) before merging.

## 7. Remaining known work

- Install e2b + @e2b/desktop packages and set credentials to switch the provider from
  "implemented but unavailable" to "operational".
- Validate the SDK call surface (Sandbox.create/commands/files, Desktop screenshot, CDP)
  against a live account; the adapter feature-detects methods and fails loudly, but the
  first live run may need small adjustments.
- Extend ci.yml to run vitest so the matrix above gains green runs on every PR.
