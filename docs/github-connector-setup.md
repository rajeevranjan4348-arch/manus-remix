# GitHub connector setup (Netlify)

The connector adds server-side GitHub OAuth, repository listing, file reading, branch creation, and file commits. Existing app UI is not modified by these backend endpoints.

## 1. Create OAuth credentials
1. Open https://github.com/settings/developers and create a new **OAuth App**.
2. Set the Homepage URL to your deployed Manus Remix site.
3. Set the Authorization callback URL to `https://YOUR-SITE/.netlify/functions/github-oauth-callback`.
4. In Netlify → Site configuration → Environment variables, add:
   - `GITHUB_CLIENT_ID` — OAuth App client ID
   - `GITHUB_CLIENT_SECRET` — OAuth App client secret
   - `GITHUB_SESSION_SECRET` — a long random secret (at least 32 random bytes)
5. Redeploy the site after setting the variables.

Do not put secrets in `VITE_*` variables, frontend files, Git commits, or screenshots. Rotate the client secret if it is ever exposed.

## 2. Endpoints
- Start OAuth: `/.netlify/functions/github-oauth-start`
- OAuth callback: `/.netlify/functions/github-oauth-callback`
- API proxy: `/.netlify/functions/github-api?action=status`
- List repositories: `/.netlify/functions/github-api?action=repos`
- Read a file: `/.netlify/functions/github-api?action=contents&repo=OWNER/REPO&path=README.md`
- Create branch: POST `/.netlify/functions/github-api?action=branch` with JSON `{ "repo": "OWNER/REPO", "branch": "feature/my-change", "base": "main" }`
- Commit/update a file: PUT `/.netlify/functions/github-api?action=file` with JSON `{ "repo": "OWNER/REPO", "path": "README.md", "content": "...", "message": "Update README", "branch": "feature/my-change" }`. When updating an existing file, supply its current `sha` to prevent conflicts.

The access token is held in an encrypted, HttpOnly, Secure cookie; it is never returned to browser JavaScript. OAuth App `repo` scope grants broad repository access for the authorizing account. For production use with multiple users, prefer a GitHub App installation flow with per-repository permissions and add explicit user authentication/CSRF protection to write operations before exposing the connector broadly.
