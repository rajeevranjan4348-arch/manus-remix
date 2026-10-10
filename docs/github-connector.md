# GitHub Connector — Netlify setup

This connector adds a server-side OAuth callback and repository-tool endpoint without changing the existing UI.

## Required Netlify environment variables

Set these in **Site configuration → Environment variables** (never use `VITE_*` for secrets):

- `GITHUB_OAUTH_CLIENT_ID`: GitHub OAuth App client ID.
- `GITHUB_OAUTH_CLIENT_SECRET`: GitHub OAuth App client secret.
- `GITHUB_OAUTH_CALLBACK_URL`: exact callback URL, e.g. `https://YOUR_SITE/.netlify/functions/github?action=callback`.
- `GITHUB_SESSION_ENCRYPTION_KEY`: base64-encoded 32-byte random key. Generate one with `openssl rand -base64 32`.

Keep these values only in Netlify's server-side environment. Never commit them or send them to the browser.

## GitHub OAuth App

Create an OAuth App under GitHub Developer Settings. Set its Authorization callback URL to the exact `GITHUB_OAUTH_CALLBACK_URL` value. The app currently requests `repo read:user` so it can access private repositories the user already has access to. Use a GitHub App with narrowly scoped installation permissions instead if your deployment needs a more restricted permission model.

## Endpoints

- Start OAuth: `/.netlify/functions/github?action=connect`
- OAuth callback: `/.netlify/functions/github?action=callback`
- Disconnect: `/.netlify/functions/github?action=disconnect`
- Tool API: `POST /.netlify/functions/github` with JSON body containing an `action`.

Supported tool actions: `profile`, `list_repositories`, `repository`, `list_files`, `read_file`, `search_code`, `issues`, `pull_requests`, `commits`, `workflow_runs`, `create_branch`, `create_file`, `create_pull_request`.

For writes, include `confirm: true` only after the user explicitly approves the exact operation. Write actions verify repository write permission before calling GitHub. This API deliberately does not merge pull requests, delete files, or modify repository settings.

Example read request:

```json
{ "action": "repository", "repository": "owner/repo" }
```

Example write request (only after user confirmation):

```json
{ "action": "create_branch", "repository": "owner/repo", "branch": "fix/issue-123", "base": "main", "confirm": true }
```

## Security and limitations

- OAuth state is random, short-lived, and validated against an HttpOnly cookie.
- The OAuth access token is encrypted with AES-256-GCM before being placed in an HttpOnly, SameSite=Lax cookie; it is never returned in JSON or passed to the model. Configure HTTPS in production.
- The cookie session expires after eight hours. Disconnect clears the cookie; revoke the OAuth grant in GitHub to invalidate the grant itself.
- Repository content, issue bodies, and pull request text must be treated as untrusted input by any AI layer.
- The current implementation does not include a persistent database or token revocation store. If centralized revocation, multi-device sessions, or long-lived installations are required, use an encrypted server-side database or GitHub App installation flow.
- A client must call these endpoints through the same origin so the HttpOnly session cookie is sent.
- Configure the existing app/tool router to call this endpoint when the user explicitly requests a GitHub action. The connector endpoint itself returns actual API results and does not fabricate successful writes.
- Build/test execution is not represented by this document; run `npm run lint` and `npm run build` in CI after configuring the required environment variables.
