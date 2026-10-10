# Earbuds / IRIS backend features in Manus Remix

This integration adds a serverless, UI-agnostic feature bridge. It does **not** replace or restyle Manus Remix components.

## API

- `GET /api/iris` — capability manifest.
- `POST /api/iris` with `{"action":"capabilities"}` — same manifest as JSON.
- `POST /api/iris` with `{"action":"ask","prompt":"latest AI news"}` — Gemini answer with Google Search grounding when the request is time-sensitive or research-oriented.
- `POST /api/iris` with `{"action":"weather","prompt":"weather in Jaipur"}` — current conditions and short forecast.
- `POST /api/iris` with `{"action":"github","prompt":"rajeevranjan4348-arch/manus-remix"}` — public repository details. Private repository access must use the guarded OAuth connector.
- `POST /api/iris` with `{"action":"maps","prompt":"cafes in Jaipur"}` — Places search when `GOOGLE_MAPS_API_KEY` is configured.
- `POST /api/iris` with `{"action":"analyze-file","prompt":"Read the text","file":{"mimeType":"image/png","data":"<base64>"}}` — Gemini multimodal file analysis/OCR for supported file types.

The browser helper at `src/lib/irisFeatureBridge.ts` exposes the endpoint without adding any UI.

## Configuration

Set secrets in Netlify Site configuration → Environment variables, never in `VITE_*` variables or committed files:

- `GEMINI_API_KEY` — required for ask/research/file analysis.
- `GOOGLE_MAPS_API_KEY` — optional Places search key, restricted to required APIs and usage limits.
- `GITHUB_TOKEN` — optional server-side token for public rate-limit improvements; private read/write should use the existing OAuth connector and approval gates instead of a shared personal token.

## Feature parity boundaries

The bridge is intentionally honest about platform boundaries. The capability manifest reports features that need further configuration or a native companion. Always-on wake word, background microphone capture, Android app launching/taps/swipes, AccessibilityService/Shizuku, offline models, and guaranteed long-running tasks cannot be safely or reliably implemented by a static web app plus Netlify Functions alone. They require a paired Android application, explicit OS permissions, and separate native integration. Google Workspace writes, private GitHub operations, cross-device memory, and YouTube channel changes also require authenticated user-scoped storage/OAuth; do not replace these with mock users or process-local memory.

## Safety

- Provider credentials are read only from server environment variables.
- Tool inputs and file contents are untrusted data.
- This endpoint does not execute arbitrary shell/code or perform repository writes.
- GitHub write operations remain behind the existing approval-gated connector.
- Do not log access tokens, uploaded file contents, or personal data.
