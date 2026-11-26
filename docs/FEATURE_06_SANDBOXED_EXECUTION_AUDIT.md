# Feature 06 — Sandboxed Coding & Real Browser Execution

## Repository audit (main)

Audited the repository tree and the existing execution integration points before implementation.

### Existing components to reuse

- `src/lib/toolFramework.ts`: central tool registry, schemas, risk levels, validation and dispatch.
- `src/lib/browserAutomation.ts`: existing HTTP page-fetch/HTML extraction path and approval integration. This is **not** a real browser: it has no browser process, DOM runtime, screenshots, cookies, page interaction or isolated session.
- `src/lib/codingAgent.ts`: GitHub repository/file operations. This is not a local project workspace or terminal runtime.
- `server/permissionsGateway.ts` and `netlify/functions/permissions.ts`: authenticated permission challenge and approval routes. The gateway currently keeps challenges and audit entries in process memory, so it is not durable across serverless instances.
- `netlify/functions/checkpoints.ts`: authenticated checkpoint API backed by the existing persistence integration; inspect its storage adapter before reusing it for sandbox lifecycle records.
- `netlify/functions/agent.ts`: authenticated model request/SSE endpoint. Netlify functions must remain request handlers, not be treated as long-running workers.
- `netlify/functions/agent-status.ts`: source/configuration readiness report; it explicitly distinguishes configured from verified.
- `netlify.toml`: existing Netlify function routing/build configuration.

### Critical findings

1. There is no verified isolated sandbox provider integration or sandbox lifecycle service in the inspected source.
2. There is no real terminal execution provider. The existing `run_command` tool returned a fabricated exit code of zero without executing a process.
3. The existing `delete_file`, `commit_changes` and `git_push` tool handlers also returned success-shaped placeholder results rather than performing their advertised operations.
4. Browser automation currently uses server-side `fetch` and regular-expression HTML extraction. It is not a browser session and cannot satisfy interactive browser requirements.
5. The existing browser URL check blocks a few literal hostnames only; it is not a complete DNS/IP/redirect-aware SSRF boundary.
6. Provider environment-variable presence is not proof of a healthy runtime. Real provider credentials and end-to-end provider tests are not available from repository source.
7. The current permission gateway's in-memory challenge/audit maps are not durable across serverless restarts. Do not use them as durable authorization records for sandbox execution without migrating persistence and atomic single-use token consumption.
8. The repository currently has no Playwright, Browserbase, E2B or equivalent isolated runtime SDK dependency in its package manifest.

## Changes in this branch

- Replaced fabricated success responses in the existing shell, delete-file, commit and push tool handlers with explicit fail-closed errors. They no longer claim a command ran, a file was deleted, or a commit/push succeeded when no runtime operation took place.
- Documented server-only sandbox and browser provider configuration variables in `.env.example`.
- Extended the readiness endpoint to report sandbox and browser provider configuration separately, while preserving the distinction between configured and verified.
- No existing UI files were modified.

## Provider configuration

The branch documents these server-only variables:

- `SANDBOX_PROVIDER`, `E2B_API_KEY`, `E2B_TEMPLATE_ID`
- `SANDBOX_MAX_EXECUTION_SECONDS`, `SANDBOX_IDLE_TIMEOUT_SECONDS`
- `SANDBOX_MAX_MEMORY_MB`, `SANDBOX_MAX_CPU_COUNT`, `SANDBOX_MAX_DISK_MB`
- `BROWSER_PROVIDER`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`

Do not prefix these secrets with `VITE_`. Do not expose them to browser bundles.

## Acceptance status

| Capability | Status | Evidence / blocker |
|---|---|---|
| Isolated sandbox create/status/cleanup | Not implemented | No provider adapter or credentials verified |
| Real terminal execution/stream/cancel | Not implemented | Fake success removed; no sandbox runtime |
| Workspace filesystem API | Not implemented | No isolated filesystem provider or ownership-bound workspace store |
| Interactive browser sessions/screenshots | Not implemented | Existing fetch-based inspector is not a browser |
| Live development preview | Not implemented | No verified sandbox process/port tunnel |
| Durable sandbox/task records | Not implemented | Requires durable storage schema and atomic lifecycle updates |
| Durable approvals/audit | Not implemented | Existing gateway uses process-local Maps |
| Netlify build/test verification | Blocked | Connector-only repository access cannot run the project's test/build commands |
| Real provider integration tests | Blocked | Provider credentials are not available for this run |

## Required next implementation phase

1. Select and provision the sandbox provider (for example, E2B or a managed container runtime) and a separate browser provider (for example, Browserbase or Browserless).
2. Implement server-only provider interfaces and runtime capability probes; never run user commands inside Netlify functions.
3. Persist workspace ownership, provider session IDs, task state, idempotency keys, approvals and audit events in Firestore using server-side Admin SDK authorization and transactional updates.
4. Implement workspace-root path validation, symlink defenses, quotas and per-operation ownership checks inside the sandbox service.
5. Implement browser egress controls that validate DNS resolutions and every redirect/request, block loopback/private/link-local/metadata ranges, and isolate cookies/storage per session.
6. Register real tool handlers only after provider calls and authorization are implemented; missing configuration must return an explicit unavailable error.
7. Add emulator/unit/integration tests, run the complete test suite and production build, inspect the full diff, then open a draft PR with truthful test evidence.

**Important:** This branch is an audited safety foundation, not completion of Feature 06. No real sandbox, terminal, browser or preview capability is claimed operational.
