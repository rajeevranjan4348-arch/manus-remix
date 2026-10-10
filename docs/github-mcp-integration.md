# GitHub MCP integration for Manus Remix

This integration adds a server-side proxy at `/api/github-mcp` for the hosted GitHub MCP endpoint. It reuses the existing GitHub OAuth session cookie created by `netlify/functions/github.ts`; it does not expose the access token to browser JavaScript and does not change the UI.

## Requirements

Configure these Netlify environment variables (never commit real values):

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_SECRET` — random secret with at least 32 characters

The OAuth app callback URL must be `https://YOUR-SITE/api/github/callback`. Reconnect GitHub after changing OAuth scopes or permissions. The current OAuth flow requests `repo read:user`; actual write operations still depend on the user's GitHub permissions and the OAuth app's approved access.

## Endpoint

Send MCP JSON-RPC POST requests to `/api/github-mcp` with the user's existing GitHub session cookie. The browser should call this same-origin endpoint; it must never receive or store the GitHub access token.

Supported initial protocol methods include `tools/list` and `tools/call`. This is a proxy to GitHub's hosted MCP service, not a local copy of the Go server.

## Write safeguards

- Tool names that clearly identify read-only operations can run without extra confirmation.
- All other tools require `arguments.confirm: true`; the proxy removes that flag before forwarding the actual tool arguments.
- The tool-list response marks non-read tools as requiring confirmation.
- Unknown tool names default to confirmation-required.
- Destructive operations should still be excluded from the Manus Remix agent's automatic tool selection and handled only after showing the exact target and action to the user.
- The proxy limits JSON request bodies and disables caching.

This confirmation flag is a server-side safeguard against accidental tool invocation, but it is not a replacement for GitHub permissions or a separate approval UI. Only call write tools after the user explicitly approves the specific operation.

## Netlify

The function is deployed from `netlify/functions/github-mcp.ts`. The `/api/github-mcp` route is configured in `netlify.toml`. Keep secrets in Netlify's environment settings, never in `VITE_*` variables or committed files.

## Verification status

The files have been added to the feature branch. Build, live OAuth, hosted MCP compatibility, and deployment must be verified before merging to `main`.
