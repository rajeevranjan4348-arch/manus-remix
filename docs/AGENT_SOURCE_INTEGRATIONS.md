# Manus Remix — Agent Source Repository Integration Plan

This file tracks the upstream source projects requested for Manus Remix and defines how to integrate them without replacing the existing React/Vite UI.

> **Important:** A repository URL in this manifest is not the same as importing its source code or activating its features. Each project must be reviewed for its license, dependency/runtime requirements, security model, and compatibility before being vendored or deployed. Do not copy every project into the browser bundle.

## Requested upstream projects

| Capability | Upstream repository | Intended integration |
|---|---|---|
| Autonomous coding agent | https://github.com/All-Hands-AI/OpenHands | Run as an isolated coding-agent service; expose a narrow authenticated Manus API |
| Software engineering agent | https://github.com/SWE-agent/SWE-agent | Optional coding-task worker, isolated from the web app |
| Android environment / agent research | https://github.com/google-deepmind/android_env | Existing submodule: `vendor/android_env`; use as a separate research/runtime dependency, not as a browser feature |
| Android UI automation | https://github.com/appium/appium | Separate device automation service; require explicit user approval for consequential actions |
| Multi-agent orchestration | https://github.com/langchain-ai/langgraph | Backend orchestration layer for durable, resumable agent workflows |
| Multi-agent framework | https://github.com/crewAIInc/crewAI | Optional alternative; select one primary orchestration framework rather than duplicating both without a reason |
| Deep research | https://github.com/Alibaba-NLP/DeepResearch | Isolated research worker; audit model/runtime dependencies before enabling |
| Research workflow | https://github.com/langchain-ai/open_deep_research | Research workflow option; compare with the other research worker before choosing a default |
| Live weather data | https://github.com/open-meteo/open-meteo | Use the documented API/service for live weather; do not assume the upstream repository itself is a hosted API |
| Interactive maps | https://github.com/maplibre/maplibre-gl-js | Frontend map library, loaded only in the relevant map experience |
| Image / media generation workflows | https://github.com/Comfy-Org/ComfyUI | Separate media-generation server; credentials and job execution stay server-side |
| Long-term agent memory | https://github.com/mem0ai/mem0 | Backend memory adapter with per-user isolation, retention controls, and deletion support |
| Browser agent | https://github.com/browser-use/browser-use | Isolated browser worker; authenticated actions require approval and audit logs |
| Browser automation / testing | https://github.com/microsoft/playwright | Use for controlled browser tasks and automated end-to-end tests |
| Agent observability | https://github.com/langfuse/langfuse | Optional self-hosted or managed tracing/evaluation backend; redact secrets and personal data |
| Test runner | https://github.com/vitest-dev/vitest | Keep as the existing Vite-compatible unit test runner |

## Integration rules

1. Preserve the existing Manus Remix React/TypeScript UI and current responsive behavior. Add capabilities behind existing chat/work/connector flows; do not replace screens.
2. Keep Python/long-running workers (coding, research, browser automation, ComfyUI, Android automation) outside Netlify request handlers. Netlify endpoints should authenticate, validate, enqueue/dispatch jobs, stream status where supported, and return actionable failures.
3. Keep API keys and service credentials on the server. Never put secrets in `VITE_*` variables or ship them in client bundles.
4. Require authenticated per-user authorization for every job and connector. Use explicit approval for device control, file writes, repository pushes, purchases, messages, and other consequential actions.
5. Add timeouts, cancellation, rate limits, structured logs, retry limits, and safe error states. Avoid automatic unbounded retries.
6. Pin upstream versions/commits, preserve each upstream license and notices, review transitive dependencies, and scan for known vulnerabilities before adding source.
7. Keep tests for the existing app passing. Add adapter tests and end-to-end tests before enabling any worker in production.
8. Do not expose internal agent chain-of-thought. Show user-facing plans, tool activity, results, and citations instead.

## Implementation status

- [x] Confirmed the Manus Remix repository and its `main` branch.
- [x] Confirmed `vendor/android_env` is already declared in `.gitmodules`.
- [x] Recorded upstream source links and integration boundaries.
- [ ] Import/pin the remaining upstream repositories as reviewed dependencies or submodules.
- [ ] Implement and configure backend adapters and worker deployments.
- [ ] Configure secrets in the deployment environment (never commit secret values).
- [ ] Run type-check, unit tests, production build, and integration tests.
- [ ] Verify Netlify deployment and each external worker independently.

This document is an integration manifest only. It does **not** claim that the listed source repositories have all been imported, that their features are implemented, or that deployment/tests have passed.
