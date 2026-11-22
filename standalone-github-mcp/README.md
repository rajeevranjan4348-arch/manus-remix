# Cue GitHub MCP server

A TypeScript GitHub MCP server with two hosting paths: local/persistent Node.js using MCP SDK v1, and a separate stateless Vercel Function using MCP SDK v2. Both use server-side GitHub credentials, Firebase user authentication in hosted mode, exact repository allowlists, bounded inputs, distributed rate limits, structured logs, and tested GitHub API handlers. State-changing tools are disabled by default.

The server uses GitHub's REST API directly. It does not run repository code, workflows, shell commands, or scripts. Reading Actions history never executes a workflow. Workflow dispatch exists only in the persistent Node server and remains disabled by default.

## Run locally over stdio

Node.js 22+ is required. From this directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Set `MCP_TRANSPORT=stdio`, then configure either a fine-grained PAT (`GITHUB_TOKEN`) or a GitHub App installation (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`). Writes are off unless `MCP_ENABLE_WRITE_TOOLS=true`; only enable them with an MCP client that presents and handles a human form-approval request. Use a dedicated test account/repository when exercising writes. Do not put GitHub credentials in a Cue client config; the local MCP process reads them from its environment.

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

## Deploy the read-only endpoint to Vercel

The Vercel route is a separate Next.js App Router application rooted at `standalone-github-mcp`. Create a separate Vercel project for this directory; do not change the existing Cue app project. The Vercel configuration uses Node.js 22, `mcp-handler@2`, and `@modelcontextprotocol/server@2`. It provides a stateless Streamable HTTP endpoint at `/api/mcp` and a small landing page at `/`.

Set the Vercel project root directory to `standalone-github-mcp`. The included `vercel.json` selects the Next.js framework, `npm run build:vercel`, and a maximum Function duration of 300 seconds. Enable Vercel system environment variables so the route can allow the exact deployment and production hostnames from `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`—wildcards are not used.

Configure these environment values in Vercel's secret settings:

- `NODE_ENV=production`, `MCP_TRANSPORT=http`, and `MCP_ENABLE_WRITE_TOOLS=false`.
- Exactly one GitHub credential method: either a fine-grained `GITHUB_TOKEN`, or the complete GitHub App triplet `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_INSTALLATION_ID`.
- `FIREBASE_PROJECT_ID`, a matching Firebase Admin service-account JSON value in `FIREBASE_SERVICE_ACCOUNT_JSON`, one or more allowed Firebase IDs in `MCP_ALLOWED_FIREBASE_UIDS`, and an exact `owner/repo` allowlist in `GITHUB_ALLOWED_REPOS`.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for distributed production rate limiting. The route fails closed if the limiter is missing or unavailable.
- Optional exact `MCP_ALLOWED_ORIGINS` values for browser-based clients. Native clients without an `Origin` header do not need this setting. `MCP_ALLOWED_HOSTS` may be used for additional exact hosts; Vercel's generated deployment and production hostnames are also checked exactly.

After a successful deployment, the endpoint URL is `https://<project-domain>/api/mcp`. Configure a compatible remote MCP client with that URL and a Firebase ID-token bearer credential. Never put the GitHub PAT, GitHub App private key, Firebase service-account JSON, or Upstash token in the MCP client configuration.

Vercel Hobby is a free plan with included monthly usage quotas, including a 300-second Function duration. If an included quota is exhausted, Vercel may pause or limit usage; this setup does not select a paid plan. See [Vercel Hobby](https://vercel.com/docs/plans/hobby) and [Function limits](https://vercel.com/docs/functions/limitations).

The Vercel route is intentionally read-only. It does not expose any state-changing tool, even if `MCP_ENABLE_WRITE_TOOLS` is set to true. The current write-approval implementation uses the older session-based MCP server-initiated elicitation flow; Vercel's v2 handler is stateless, so that approval path cannot be reused unchanged. The newer MCP multi-round-trip approval flow requires its own signed request-state and replay-protection implementation before Vercel writes can be enabled.

## Persistent Node.js HTTP (alternative)

For the existing stateful HTTP transport, build and run the supplied Docker image or `npm run build && npm start` with `MCP_TRANSPORT=http`. Configure `FIREBASE_PROJECT_ID`, matching `FIREBASE_SERVICE_ACCOUNT_JSON`, `MCP_ALLOWED_FIREBASE_UIDS`, exact `MCP_ALLOWED_HOSTS`, and `GITHUB_ALLOWED_REPOS`; configure one GitHub PAT or GitHub App credential method; and add Upstash Redis REST credentials for distributed production rate limiting. Publish `/mcp` for MCP Streamable HTTP and `/health` for liveness. Requests require a Firebase ID-token bearer credential, and the server accepts only allowlisted Firebase IDs.

This transport stores MCP sessions in process memory. Use a persistent single instance or sticky routing for each session; restarts invalidate sessions, and this v1 transport is not suitable for ordinary serverless Functions. Its state-changing tools remain omitted unless `MCP_ENABLE_WRITE_TOOLS=true` and use client-mediated form elicitation that fails closed.

## GitHub identity and tenant boundary

Hosted requests use the configured GitHub PAT or GitHub App installation identity. This service does not claim each Firebase user has a separate GitHub identity. `MCP_ALLOWED_FIREBASE_UIDS` limits which Cue users may invoke it, while `GITHUB_ALLOWED_REPOS` limits the exact repositories visible/manageable through it. For per-user GitHub accounts, deploy a token broker that stores each user's OAuth/App installation credentials in durable encrypted storage and binds each Firebase ID to its own credential; this server intentionally does not store tokens in browser storage or model context.

`GITHUB_ALLOWED_REPOS` is mandatory in hosted mode and applies to reads as well as writes. To create a repository through the persistent Node server, pre-add its exact expected `owner/name` to the allowlist; it becomes usable only when the exact name matches. `github_create_repository` is limited to the configured credential's authenticated user and is not available with GitHub App installation credentials; organization creation/admin is intentionally not exposed. Forks must target an allowlisted destination repository; personal forks require PAT mode, while GitHub App mode requires an explicit allowlisted organization target.

## Approval model

State-changing tools are omitted from the MCP catalog unless `MCP_ENABLE_WRITE_TOOLS=true`. In the persistent v1 server, each enabled write handler requests a form containing the exact tool, target, and arguments; the server proceeds only after the client returns `action: accept` and `approved: true`. Missing elicitation support, timeout, decline, invalid responses, or oversized approval details all fail closed. The old deterministic `approvalPhrase` was removed because a client could derive it from an error response.

Form elicitation is a protocol request, not proof that a particular client displayed a trustworthy prompt. Cue's active agent path and MCP settings screen have not been verified to connect to this server or display an approval UI. Keep hosted writes disabled until the intended Cue client is wired to the endpoint and the approval experience is tested end to end. Destructive and execution-triggering operations are marked with MCP annotations, and GitHub permissions remain the final enforcement boundary.

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

On the persistent Node server, `GET /health` reports liveness/configuration presence only; it never returns secrets or probes GitHub/Firebase. The Vercel project root page only identifies the service and endpoint. All hosted MCP requests require Firebase authentication and an allowlisted Firebase ID; responses are not cached. Structured logs contain request IDs, request methods, status/outcome, and safe error codes, but omit arguments and credentials. GitHub reads use bounded retries/backoff for 429/5xx; write calls are not automatically retried to avoid duplicate side effects. Production rate limiting uses Upstash and fails closed if the limiter is unavailable.

## Tool catalog

Tool names use a stable `github_` prefix: repository search/list/get/create/fork/archive; directory browsing, file reading, code search, file create/update/delete, file diff, and structure analysis; branch list/create/compare and commit inspection; issue list/search/create/detail/comments; pull-request create/review/diff/review-comment; workflow run listing/status/logs/failure monitoring/dispatch. The Vercel route exposes only the read-only subset. See `docs/GITHUB_MCP_TOOLS.md` for the complete argument/approval catalog.

## Limitations to verify before production traffic

- The local test suite uses mocks; live GitHub, Firebase, Upstash, hosting health, GitHub token/App scopes, and Cue's active agent integration must be independently configured and staged. The app currently has a separate GitHub connector with mock fallbacks and a settings-only MCP server list; this standalone endpoint is not connected to Cue's active agent tool registry.
- The Vercel route uses the stateless MCP v2 handler and has no server-side MCP sessions. It is read-only until a separate multi-round-trip approval implementation, signed state validation, and replay prevention are tested.
- GitHub code search is subject to GitHub's indexing/access rules, and workflow-log access depends on Actions permissions. Raw log output is size-limited and common credential patterns are redacted, but that cannot guarantee removal of arbitrary, encoded, or project-specific secrets; always treat logs as sensitive.
- Actions log downloads use a temporary GitHub redirect; cross-origin credential handling has not been live-validated and must be verified in staging before production log access is enabled.
- GitHub App installation tokens may not support personal repository creation; the persistent Node server returns an explicit error rather than fabricating success.
