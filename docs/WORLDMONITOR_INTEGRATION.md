# World Monitor global news integration

This integration uses the official World Monitor service instead of copying its full application into Manus Remix.

- Upstream project: https://github.com/koala73/worldmonitor
- Live dashboard: https://www.worldmonitor.app
- REST API documentation: https://worldmonitor.app/openapi.yaml
- MCP endpoint: https://worldmonitor.app/mcp
- License: upstream source is AGPL-3.0-only. This integration calls the hosted service and does not copy or redistribute upstream source code.

## Why this approach

World Monitor is a large, separate dashboard with its own map-heavy UI, desktop app, build system and data-source requirements. Copying the whole repository into Manus Remix would risk replacing the existing UI, expanding the deployment footprint, and introducing a separate build architecture. This change adds a server-side integration scaffold while keeping the current UI untouched.

## Environment

Configure these as server-side Netlify environment variables when enabling the integration:

- `WORLDMONITOR_MCP_URL=https://worldmonitor.app/mcp`
- `WORLDMONITOR_API_KEY` (optional for discovery; required by some hosted API tools)

Never expose the API key through a `VITE_` variable or return it to the browser.

## Current scope and next steps

The client can discover available World Monitor MCP tools and invoke a named tool through the official Streamable HTTP endpoint. Tool names and input schemas must be discovered from the live service; do not hard-code assumed tool names. Before exposing this to users, wire the client into an authenticated Netlify Function, validate the requested tool against the server's current `tools/list` result, apply request timeouts/rate limits, and normalize the results into the existing chat/news flow.

This scaffold does not alter the app UI and does not claim to provide a finished news panel until that route is wired into the app.
