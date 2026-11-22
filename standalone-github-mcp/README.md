# Cue GitHub MCP server

A TypeScript MCP server for GitHub built with the official Model Context Protocol SDK and Octokit. It supports local stdio and authenticated Streamable HTTP, with server-side GitHub PAT or GitHub App credentials, an exact repository allowlist for hosted use, Firebase user authentication, bounded request/pagination sizes, rate limits, approval-gated writes, health checks, and structured request logs.

The server uses GitHub's REST API directly. It does not execute repository code, workflows, or shell commands. Workflow dispatch is an explicit approved tool call; merely reading workflow logs never executes a workflow.

## Run locally over stdio

Node.js 20+ is required. From this directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Set `MCP_TRANSPORT=stdio`, then configure either a fine-grained PAT (`GITHUB_TOKEN`) or a GitHub App installation (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`). Use a dedicated test account/repository when exercising write tools. Do not put GitHub credentials in a Cue client config; the local MCP process reads them from its environment.

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
2. Configure `FIREBASE_PROJECT_ID`, workload identity or `FIREBASE_SERVICE_ACCOUNT_JSON`, `MCP_ALLOWED_FIREBASE_UIDS`, exact `MCP_ALLOWED_HOSTS`, and exact GitHub repository names in `GITHUB_ALLOWED_REPOS`.
3. Configure either a PAT or GitHub App secret on the hosting platform. For PATs, select only the allowed repositories and grant only the minimum permissions needed. For GitHub Apps, install only into the required repositories and grant only required permissions.
4. Configure Upstash Redis REST credentials for distributed per-user rate limiting in production. Startup fails closed if production HTTP mode lacks them.
5. Publish `/mcp` for MCP Streamable HTTP and `/health` for liveness. Configure the Cue MCP client with the HTTPS `/mcp` endpoint and a Firebase ID-token bearer credential. The server allows only Firebase UIDs configured in `MCP_ALLOWED_FIREBASE_UIDS`.
6. Configure `MCP_ALLOWED_ORIGINS` only for trusted browser-based MCP clients. Wildcard origins are rejected. Native clients without an `Origin` header are accepted; if an Origin is present, it must exactly match the list.

### GitHub identity and tenant boundary

In hosted mode, all approved requests use the configured GitHub PAT or GitHub App installation identity. This service does not claim that each Firebase user has a separate GitHub identity. `MCP_ALLOWED_FIREBASE_UIDS` limits which Cue users may use the service, and `GITHUB_ALLOWED_REPOS` limits the exact repositories visible/manageable through it. For individual per-user GitHub accounts, deploy a token broker that stores each user's OAuth/App installation credentials in durable encrypted storage and bind each Firebase UID to its own credential; this server intentionally does not store tokens in browser storage or in model context.

`GITHUB_ALLOWED_REPOS` is mandatory in HTTP mode and applies to reads as well as writes. To create a repository in hosted mode, pre-add its exact expected `owner/name` to the allowlist; it becomes usable only when the exact name matches. `github_create_repository` is limited to the configured credential's authenticated user and is not available with GitHub App installation credentials; organization creation/admin is intentionally not exposed. Forks must target an allowlisted destination repository; personal forks require PAT mode, while GitHub App mode requires an explicit allowlisted organization target.

## Approval model

All state-changing tools are marked non-read-only and require an operation-specific `approvalPhrase`. The phrase is bound to the exact tool arguments, including the repository, branch/path, content/body, and action inputs. The MCP host must show the user the exact target and proposed effect and only send the phrase after explicit approval. This argument is a protocol safeguard, not proof that a human clicked; because the expected phrase is deterministic, an MCP client can derive it from the returned error and retry. Therefore this server does **not** enforce human approval by itself. Cue must add a trusted confirmation gate before this endpoint is exposed to an agent; the existing MCP settings UI is not a verified approval bridge for this server. Do not enable write tools in production until that gate is implemented and tested. Destructive and execution-triggering operations are further flagged with MCP annotations. GitHub permissions remain the final enforcement boundary.

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

- The local `npm test` suite uses mocks; live GitHub, Firebase, Redis, hosting health, OAuth/App installation scopes, and Cue's approval gate must be independently configured and staged. The app currently has a separate GitHub connector and settings-only MCP server list; this standalone endpoint is not yet connected to Cue's agent tool registry.
- Session state is process-local to the MCP server. Deploy one instance with sticky routing for a session, or implement a shared MCP session store before horizontal scaling. Restarts invalidate existing sessions; clients should reinitialize.
- GitHub code search is subject to GitHub's indexing/access rules, and workflow-log access depends on Actions permissions. Raw log output is size-limited and common credential patterns are redacted, but this cannot guarantee removal of arbitrary, encoded, or project-specific secrets; always treat logs as sensitive.
- Actions log downloads use a temporary GitHub redirect; cross-origin credential handling has not been live-validated and must be verified in staging before production log access is enabled.
- GitHub App installation tokens may not support personal repository creation; the server returns an explicit error rather than fabricating success.
