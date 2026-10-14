# Manus Automation Agent

Manus automation is designed as a coordinator, not an unrestricted executor. The settings panel reports which server-side channels are configured and can create a task-specific plan.

## Channels and setup

- **Research:** configure `GEMINI_API_KEY`, `FIRECRAWL_API_KEY`, or a secured `AGENT_REACH_BRIDGE_URL`.
- **Connected apps:** the existing `/api/connectors` registry and `/api/connectors/execute` path is used only when a connector reports authenticated state.
- **BrowserAct:** BrowserAct's CLI runs in an agent runtime; it is not automatically a hosted REST API. For Netlify, configure a trusted HTTPS relay that implements the BrowserAct operations you need, and set `BROWSERACT_BRIDGE_URL` and `BROWSERACT_BRIDGE_TOKEN`. Do not expose the relay token to the browser.
- **Hugging Face:** set `HF_INFERENCE_ENDPOINT` and `HF_TOKEN` server-side if model inference is required. The status panel does not send prompts to an endpoint by itself.
- **MacroDroid / Android:** set `ANDROID_CONTROL_BRIDGE_URL`, `ANDROID_CONTROL_BRIDGE_TOKEN`, and `ANDROID_CONTROL_ALLOWED_UID`, plus the Firebase Admin service account used by the Android endpoint. A real paired companion/relay and imported MacroDroid macros are still required.
- **Brainbase:** Brainbase MCP management access does not automatically give a deployed Netlify app runtime credentials. Configure `BRAINBASE_AGENT_ENDPOINT` and `BRAINBASE_AGENT_TOKEN` only if a secure server-side delegation endpoint is intentionally provided.

## Safety and current scope

The automation status and planning endpoint is `POST /api/automation-agent` with `{ "action": "status" }` or `{ "action": "plan", "prompt": "..." }`. It does not execute a plan. Real execution must use the existing connector executor or a separately implemented authenticated adapter, with action allowlists, user/device pairing, bounded timeouts, audit logs, and confirmation gates for consequential actions. Never report a planned action as completed.

The web UI and status endpoint intentionally do not expose secret values. Keep all integration credentials in Netlify environment variables and test on a staging deploy before production.
