# GitHub connector (Netlify)

This connector adds server-side GitHub OAuth and repository APIs without exposing GitHub credentials to browser code. The UI can connect using the existing app routes or by calling the documented endpoints.

## Required Netlify environment variables

Configure these under **Site configuration → Environment variables**. Do not use `VITE_` prefixes and do not commit real values.

- `GITHUB_CLIENT_ID`: OAuth App client ID.
- `GITHUB_CLIENT_SECRET`: OAuth App client secret.
- `GITHUB_OAUTH_SECRET`: random secret of at least 32 characters used to encrypt the short-lived session cookie.

Create an OAuth App in GitHub Developer settings. Set its **Authorization callback URL** to the deployed origin plus `/api/github/callback` (for example, `https://your-site.netlify.app/api/github/callback`). Use HTTPS in production. This implementation requests `repo read:user` because repository write operations are supported; grant access only to an account and repositories you trust.

## Endpoints

- `GET /api/github/connect` — start OAuth and redirect to GitHub.
- `GET /api/github/callback?code=...&state=...` — OAuth callback; validates signed state and creates an encrypted, HttpOnly session cookie.
- `GET /api/github/status` — returns connection status and basic account details.
- `GET /api/github/repos?page=1` — list repositories accessible to the connected account.
- `GET /api/github/contents?owner=OWNER&repo=REPO&path=PATH&ref=BRANCH` — read repository content.
- `GET /api/github/search?q=QUERY` — search code the account can access.
- `POST /api/github/create-branch` — JSON body: `{ "owner", "repo", "branch", "base" }`.
- `POST /api/github/create-pull-request` — JSON body: `{ "owner", "repo", "title", "head", "base", "body", "draft", "confirm": true }`. Confirmation is required.
- `POST /api/github/disconnect` is not required; `GET /api/github/disconnect` clears the session cookie.

## Security and limitations

- GitHub tokens are encrypted in an HttpOnly, Secure, SameSite=Lax cookie; browser JavaScript cannot read the cookie.
- The cookie expires within eight hours. OAuth state is signed and short-lived.
- Never return tokens to the client or log credentials.
- This is a server API connector, not a complete visual settings panel or an automatic agent tool registration. The chat agent must explicitly call these endpoints or be wired to server-side tools before it can operate GitHub autonomously.
- Netlify deployment, OAuth callback, and live GitHub actions must be tested after adding real environment variables.
