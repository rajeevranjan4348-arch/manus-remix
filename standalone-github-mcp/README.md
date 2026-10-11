# Standalone GitHub MCP Server

A standalone Model Context Protocol (MCP) server for compatible AI clients. It uses the official MCP TypeScript SDK and GitHub's REST API via Octokit.

## Features

- Read repository metadata, directory listings, text files, code search, and issues.
- Guarded write tools for issue creation, file creation/update, and pull requests.
- Optional repository allowlist using `GITHUB_ALLOWED_REPOS`.
- No token is hard-coded or sent to the model as a tool result.
- Runs as an MCP stdio process; suitable for local MCP clients that support stdio.

## Requirements

- Node.js 20+
- A GitHub token with only the permissions needed for your selected repositories.
- An MCP-compatible client that supports local stdio servers.

Create a fine-grained personal access token with the minimum required repository access. Typical permissions depend on tools enabled: Metadata read; Contents read/write for file tools; Issues read/write for issue tools; Pull requests read/write for PR tools. Do not grant organization administration or workflow permissions unless you intentionally extend this server.

## Install

From this directory:

```sh
npm install
npm run build
```

Set `GITHUB_TOKEN` in the MCP client's environment. Do not commit a real token or put it in frontend variables such as `VITE_*`.

Optional allowlist:

```sh
GITHUB_ALLOWED_REPOS=owner/repo,owner/another-repo
```

When set, repository-scoped tools and code search refuse repositories outside the list. Keep the list narrow.

## Example MCP client configuration

Use an absolute path to the built entrypoint and pass secrets through the client's environment settings (example uses placeholders):

```json
{
  "mcpServers": {
    "github-safe": {
      "command": "node",
      "args": ["/absolute/path/to/standalone-github-mcp/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "SET_THIS_IN_YOUR_LOCAL_MCP_CLIENT_SECRET_SETTINGS",
        "GITHUB_ALLOWED_REPOS": "owner/repo"
      }
    }
  }
}
```

Prefer your client's secret manager/environment UI over storing tokens in a shared config file. If a client requires the token in JSON, keep that config private and outside version control.

## Explicit write approval

Each write operation requires an operation- and target-specific phrase. The server returns the expected phrase if it is missing or incorrect. The client must show the exact proposed change to the user and only retry after explicit approval.

- Create issue: `APPROVE create_issue owner/repo:<exact-title>`
- Create/update file: `APPROVE write_file owner/repo:<path>@<branch>`
- Create pull request: `APPROVE create_pull_request owner/repo:<head>-><base>:<title>`

Replace placeholders with the exact target values. Before calling a write tool, show the repository, target, and complete proposed change, then obtain approval. This phrase is a safeguard against accidental calls, not cryptographic proof of human consent: a trusted MCP client/agent must enforce the approval interaction. Do not configure agents to automatically fabricate approval phrases.

File updates require the existing file SHA to avoid accidental blind overwrites. This server does not expose delete, merge, force-push, workflow dispatch, secrets, or organization-administration tools.

## Netlify compatibility

The existing Manus Remix Netlify app is not modified by this subproject. This MCP server uses stdio, which is appropriate for local MCP clients but is not a long-running transport for Netlify Functions. For hosted deployment, use a persistent Node host that supports MCP Streamable HTTP and add authentication, per-user authorization, rate limiting, and a proper approval UI before exposing it publicly. Do not deploy an unauthenticated write-capable endpoint.

## Verification

Build and type-check with `npm run build` and `npm run typecheck`. Live GitHub calls require a valid token and permissions. Review your client's approval UX before enabling write tools.
