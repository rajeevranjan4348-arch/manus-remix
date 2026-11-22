# Cue GitHub MCP server

A TypeScript MCP server for GitHub built with the official Model Context Protocol SDK and Octokit. It supports local stdio and authenticated Streamable HTTP, with server-side GitHub PAT or GitHub App credentials, an exact repository allowlist for hosted use, Firebase user authentication, bounded request/pagination sizes, rate limits, optional client-mediated write approvals, health checks, and structured request logs. State-changing tools are disabled by default.

The server uses GitHub's REST API directly. It does not execute repository code, workflows, or shell commands. Workflow dispatch is an explicit approved tool call; merely reading workflow logs never executes a workflow.

## Run locally over stdio

Node.js 20+ is required. From this directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Set `MCP_TRANSPORT=stdio`, then configure either a fine-grained PAT (`GITHUB_TOKEN`) or a GitHub App installation (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`). Writes are off unless `MCP_ENABLE_WRITE_TOOLS=true`; only turn them on with an MCP client that presents and handles human form elicitation. Use a dedicated test account/repository when exercising writes. Do not put GitHub credentials in a Cue client config; the local MCP process reads them from its environment.

Example MCP client configuration (replace paths and pass the PAT through the client's secret manager rather than inline JSON):

```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["/absolute/path/to/standalone-github-mcp/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "GITHUB_TOKEN": "<set-in-client-secret-manager>"
      }
    }
  }
}
```

## Hosted Streamable HTTP

Use a persistent Node host (Docker, Railway, Render, Fly.io, or equivalent) with a stable single instance / sticky routing for MCP sessions. Ordinary Netlify Functions are not used for this server: Streamable HTTP sessions are stateful, and a standard short-lived function is not a suitable process/session store. The repository's static Netlify app remains unchanged.

1. Build and run the supplied Docker image or `npm run build && npm start` with `MCP_TRANSPORT=http`.
2. Configure `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `MCP_ALLOWED_FIREBASE_UIDS`, exact `MCP_ALLOWED_HOSTS`, and exact GitHub repository names in `GITHUB_ALLOWED_REPOS`. The service-account credential is needed because the server checks Firebase ID-token revocation.
3. Configure either a PAT or GitHub App secret on the hosting platform. For PATs, select only the allowed repositories and grant only the minimum permissions needed. For GitHub Apps, install only into the required repositories and grant only required permissions.
4. Configure Upstash Redis REST credentials for distributed per-user rate limiting in production. Startup fails closed if production HTTP mode lacks them.
5. Publish `/mcp` for MCP Streamable HTTP and `/health` for liveness. Configure a supported MCP client with the HTTPS `/mcp` endpoint and a Firebase ID-token bearer credential. The server allows only Firebase UIDs configured in `MCP_ALLOWED_FIREBASE_UIDS`.
6. Configure `MCP_ALLOWED_ORIGINS` only for trusted browser-based MCP clients. Wildcard origins are rejected. Native clients without an `Origin` header are accepted; if an Origin is present, it must exactly match the list.

### GitHub identity and tenant boundary

In hosted mode, all approved requests use the configured GitHub PAT or GitHub App installation identity. This service does not claim that each Firebase user has a separate GitHub identity. `MCP_ALLOWED_FIREBASE_UIDS` limits which Cue users may use the service, and `GITHUB_ALLOWED_REPOS` limits the exact repositories visible/manageable through it. For individual per-user GitHub accounts, deploy a token broker that stores each user's OAuth/App installation credentials in durable encrypted storage and bind each Firebase UID to its own credential; this server intentionally does not store tokens in browser storage or in model context.

`GITHUB_ALLOWED_REPOS` is mandatory in HTTP mode and applies to reads as well as writes. To create a repository in hosted mode, pre-add its exact expected `owner/name` to the allowlist; it becomes usable only when the exact name matches. `github_create_repository` is limited to the configured credential's authenticated user and is not available with GitHub App installation credentials; organization creation/admin is intentionally not exposed. Forks must target an allowlisted destination repository; personal forks require PAT mode, while GitHub App mode requires an explicit allowlisted organization target.

## Approval model

State-changing tools are omitted from the MCP catalog unless `MCP_ENABLE_WRITE_TOOLS=true`. When enabled, each write handler asks the connected MCP client to show a form elicitation containing the exact tool, target, and complete arguments; the server proceeds only when the client returns `action: accept` and `approved: true`. Missing elicitation support, timeout, decline, invalid responses, or oversized approval details all fail closed. The old deterministic `approvalPhrase` has been removed because a client could derive it from an error response.

Form elicitation is a protocol request, not proof that a particular client displayed a trustworthy prompt. Cue's active agent path and MCP settings screen have not been verified to connect to this server or display an approval UI. Keep writes disabled in hosted deployments until the intended Cue client is wired to this endpoint and its approval experience is tested end to end. Destructive and execution-triggering operations are marked with MCP annotations, and GitHub permissions remain the final enforcement boundary.

## Render Blueprint

The repository-root `render.yaml` defines one Docker web service in Singapore, pinned to the feature branch with automatic deploys disabled. It uses the `0.5c-512mb` plan and expects deployment secrets to be entered in Render. The Blueprint is only a plan until explicitly applied; do not provision it without reviewing the plan and monthly cost. Writes remain disabled in the Blueprint configuration.

## GitHub permissions

Create a fine-grained personal access token restricted to the target repositories. Common minimum permissions:

- Metadata: read.
- Contents: read for browsing/searching; read and write for branch/file changes.
- Issues: read/write for issue management.
- Pull requests: read/write for PR creation/reviews/comments.
- Actions: read for run/log inspection; write only if dispatch is needed.
- Repository administration: write only if repository creation/archive is intentionally enabled and the account can perform those operations.

Prefer GitHub App installation credentials over a broad PAT when appropriate. Do not grant organization administration, secrets, or workflow write permissions unless the deployment needs the corresponding approved capability.

## Health, logging, and limits

`GET /health` reports liveness/configuration presence only and never returns secrets or probes GitHub/Firebase. HTTP requests require Firebase authentication and use `MCP_ALLOWED_FIREBASE_UIDS`; responses are not cached. Structured logs include request/trace IDs, operation names, outcome, and duration but omit arguments and credentials. GitHub reads use bounded retry/backoff for 429/5xx; write calls are not automatically retried to avoid duplicate side effects. Rate limits use Upstash in production and fail closed if the limiter is unavailable.

## Tool catalog

Tools are grouped with stable `github_` names: repository search/list/get/create/fork/archive; directory browsing, file reading, code search, file create/update/delete, file diff, and structure analysis; branch list/create/compare and commit inspection; issue list/search/create/detail/comments; pull-request create/review/diff/review-comment; workflow run listing/status/logs/failure monitoring/dispatch. See `docs/GITHUB_MCP_TOOLS.md` for the full argument/approval catalog.

## Limitations to verify before production traffic

- The local `npm test` suite uses mocks; live GitHub, Firebase, Redis, hosting health, OAuth/App installation scopes, and Cue's approval gate must be independently configured and staged. The app currently has a separate GitHub connector with mock fallbacks and a settings-only MCP server list; this standalone endpoint is not connected to Cue's active agent tool registry.
- Session state is process-local to the MCP server. Deploy one instance with sticky routing for a session, or implement a shared MCP session store before horizontal scaling. Restarts invalidate existing sessions; clients should reinitialize.
- GitHub code search is subject to GitHub's indexing/access rules, and workflow-log access depends on Actions permissions. Raw log output is size-limited and common credential patterns are redacted, but this cannot guarantee removal of arbitrary, encoded, or project-specific secrets; always treat logs as sensitive.
- Actions log downloads use a temporary GitHub redirect; cross-origin credential handling has not been live-validated and must be verified in staging before production log access is enabled.
- GitHub App installation tokens may not support personal repository creation; the server returns an explicit error rather than fabricating success.
