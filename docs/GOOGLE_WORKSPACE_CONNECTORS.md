# Google Workspace Connectors

This feature uses the existing chat @-mention picker and Connectors Store. The chat layout is unchanged.

## Use in chat

Type `@` and choose an app, or type one of these tags:

- `@calendar` — upcoming events in the primary calendar (today through the next seven days).
- `@gmail` — five recent inbox messages with sender, subject and snippet.
- `@drive` — recent Drive file metadata.
- `@docs` / `@sheets` — recent Drive items, including their MIME types; this is file discovery, not full-text indexing of every document.
- `@tasks` — pending Google Tasks.
- `@workspace` — combines Calendar, Gmail, Drive and Tasks.

The client fetches only the connector context requested by the user and adds that context to the current prompt. Connector selection in the Store is saved in browser local storage. When Google API requests fail, the chat now surfaces the error instead of silently presenting an empty result as a successful fetch.

## Required Google Cloud setup

The repository cannot enable Google APIs or approve an OAuth consent screen on behalf of the app owner. Configure these once in the Google Cloud project used by `firebase-applet-config.json`:

1. Enable Google Calendar API, Gmail API, Google Drive API, Google Tasks API, Google Docs API and Google Sheets API for the project.
2. Configure the OAuth consent screen, authorized test users (if in Testing), and the app's authorized domains.
3. In Firebase Authentication, enable Google as a sign-in provider and add the deployed site's domain to Authorized domains.
4. Ensure the Google OAuth client used by Firebase permits the requested Workspace scopes. Google may require verification for sensitive/restricted scopes, particularly Gmail and broad Drive access.
5. Deploy the app and use **Connect Google Workspace** in Connectors Store. Accept only the permissions needed for the apps you intend to use.

## Security and scope

- OAuth access tokens are held in memory by the current client auth implementation; they are not written to local storage.
- Google API calls are made by the signed-in browser session to Google's APIs. Never put OAuth client secrets or refresh tokens in Vite variables or frontend code.
- Reading Calendar/Gmail/Drive/Tasks is separate from write actions. Any future email sending, event creation, or file mutation should require an explicit confirmation step before the API call.
- Access depends on the signed-in Google account, API enablement, consent-screen status, and granted scopes. A successful Firebase sign-in alone does not guarantee every Workspace API is authorized.
- The app should not claim that a connector ran unless its API call succeeded.

## Netlify

The current read connectors run in the browser, so they do not require a new Netlify function or secret. The app still uses the existing `netlify.toml` build and SPA routing. If moving Google API calls server-side later, use a proper OAuth authorization-code flow and server-side token storage; do not forward a browser token into logs.
