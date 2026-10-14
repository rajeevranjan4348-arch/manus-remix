# Android Companion Bridge (implementation contract)

This directory documents the device-side service required by Manus Remix. It is not yet a compiled Android APK; do not present it as installed or active.

## Required behavior
- Pair only after an explicit user action in Manus and the companion.
- Generate a short-lived one-time pairing code on the phone; exchange it over an authenticated channel and revoke it on unpair.
- Bind local-only mode to the trusted Wi-Fi/LAN. Do not bind an unauthenticated listener to all interfaces.
- For Netlify remote mode, make an outbound authenticated TLS connection to a relay; Netlify cannot connect directly to a phone's private IP.
- Check Android API availability and permission before every action.
- Return a structured result and never claim success when Android rejects an action.
- Keep an always-visible notification while long-running device control is active, with Stop and Disconnect actions where appropriate.

## HTTP contract
The relay/bridge must implement:
- `GET /health` — authenticated or minimal non-sensitive health response.
- `POST /v1/control` — accepts only the allowlisted action names already supported by `netlify/functions/android-control.ts`.
- Maximum request body: 16 KB.
- Require a high-entropy bearer token between Netlify and the bridge, plus device/user pairing on the companion side.
- Reject unknown actions, invalid package names, expired tasks, repeated request IDs, and actions lacking required user approval.

Example request:
```json
{
  "requestId": "unique-random-id",
  "action": "launch_app",
  "args": { "packageName": "com.google.android.youtube" },
  "expiresAt": "2026-10-14T20:00:00Z"
}
```

Example response:
```json
{
  "requestId": "unique-random-id",
  "ok": true,
  "status": "completed",
  "message": "App launch request completed",
  "capabilities": ["launch_app"]
}
```

## Android implementation notes
- Use native Android APIs for supported operations.
- AccessibilityService must be opt-in, explained in plain language, and disabled cleanly when the user revokes it.
- Do not attempt to bypass Android permission prompts, lock-screen protections, app sandboxing, or secure settings restrictions.
- Avoid exposing ADB over Wi-Fi as the production control interface.
- Keep tokens in Android Keystore-backed storage where feasible.
