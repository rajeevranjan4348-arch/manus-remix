# Natural-language Android commands

The Manus Work agent now has an explicit command parser for these examples:

- `open YouTube`
- `open WhatsApp`
- `search cats in YouTube`
- `search in Chrome for NCERT Class 9`
- `search in Spotify for lo-fi music`
- `call Mom`
- `call anyone` (the companion should open a contact chooser, not place a call)

## Execution flow
1. The agent parses only known command shapes and an allowlisted set of app package IDs.
2. Device-changing, search, and call-flow actions require an explicit confirmation prompt.
3. Netlify verifies the Firebase ID token and paired UID, validates the action and arguments, then relays to the configured HTTPS bridge.
4. The companion checks app availability and Android permissions, executes only supported actions, and returns a structured result.
5. The agent reports the bridge result; it must not claim success if the bridge is missing, offline, or rejects the action.

## Important limitations
- This change adds command parsing and server-side request validation; it does not implement a native Android companion or guarantee arbitrary in-app search works in every app.
- In-app search depends on a companion implementation for each supported app. When a stable supported search entry point is unavailable, the companion should open the app and ask the user to finish the search.
- Calling a person must open Android's contact/dialer flow and require a final user action in Android. Never silently place a call.
- MacroDroid can support user-configured routines, but must not be treated as a universal unrestricted phone-control API. Any MacroDroid workflow should be explicitly imported/enabled by the user.
- The current bridge must implement `search_in_app` and `call_contact` before these commands can work on a physical phone. Until then, the UI should report the bridge's actual unsupported-action result.
