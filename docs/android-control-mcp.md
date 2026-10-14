# Manus Remix — Android Control MCP

## Current integration discovered
- `netlify/functions/android-control.ts` already authenticates Firebase ID tokens, restricts access to `ANDROID_CONTROL_ALLOWED_UID`, validates an action allowlist, and forwards requests to an HTTPS bridge.
- `src/lib/androidControl.ts` already parses a small set of explicit phone commands and calls `/api/android-control`.
- `netlify.toml` already routes `/api/android-control` to that Netlify Function.
- The missing runtime piece is the actual paired Android-side bridge/companion. Do not report a phone action as completed until the bridge returns success.

## Architecture
1. Manus UI / agent parses a direct, bounded command.
2. The tool router displays the proposed action and asks for confirmation for sensitive or device-changing actions.
3. Netlify Function verifies the Firebase ID token and paired UID, validates action + arguments, and relays only to the configured bridge.
4. Android companion authenticates the paired client, verifies permission and approval, executes one allowlisted action, and returns a structured result.
5. UI displays the actual result and records a minimal audit event.

## Network reality: local Wi-Fi vs Netlify
A Netlify Function cannot directly reach a phone's private LAN address. For local-only operation, the Manus client and Android companion must communicate on the same trusted Wi-Fi through a local endpoint, with HTTPS/trusted-origin and CORS considerations handled. For remote use through Netlify, the companion must establish an authenticated outbound connection to a public HTTPS relay; do not expose an ADB port or unauthenticated device-control port to the internet.

The current `ANDROID_CONTROL_BRIDGE_URL` requires HTTPS and therefore represents a reachable bridge/relay, not a private `192.168.x.x` URL.

## Initial tool registry
- `android.get_status` — report bridge status and granted capabilities.
- `android.launch_app` — launch an installed, allowlisted package.
- `android.press_home` — request home navigation where Android permits it.
- `android.volume_up` / `android.volume_down` — adjust volume within platform limits.
- `android.open_settings` — open Android Settings; do not silently alter secure settings.
- `android.toggle_flashlight` — use an explicit supported device API/companion action.
- Later, only after a user enables Accessibility Service: `android.get_screen`, `android.tap`, `android.swipe`, and `android.type_text`.

Every tool must use strict schemas, a timeout, request IDs/idempotency, bounded input sizes, and structured success/failure responses. Never expose arbitrary shell, arbitrary Intent, unrestricted package launch, or raw ADB commands to the model.

## Approval policy
- Require confirmation for sending/posting messages, purchases, deleting/modifying files, changing account/security settings, installing apps, or any action with external side effects.
- Require a visible Android permission grant for Accessibility, notifications, microphone, camera, or files when needed.
- Reject commands if the phone is locked, the companion is disconnected, permission is absent, the approval is stale, or the action is not allowlisted.
- Add a persistent Stop/Disconnect control. Cancel queued work and stop cancellable active work.
- Do not put access tokens, passwords, one-time codes, or sensitive screen contents into model context or logs.

## Netlify environment
Existing server-side settings:
- `FIREBASE_SERVICE_ACCOUNT_JSON` — Firebase Admin service account JSON.
- `ANDROID_CONTROL_ALLOWED_UID` — Firebase UID allowed to control the paired device.
- `ANDROID_CONTROL_BRIDGE_URL` — HTTPS origin of the authenticated bridge/relay.
- `ANDROID_CONTROL_BRIDGE_TOKEN` — high-entropy bridge token; server-side only.

Never prefix these with `VITE_`. Keep them in Netlify environment variables and rotate bridge credentials if exposed.

## Acceptance checklist
- [ ] Pair/unpair flow with one-time code and revocation.
- [ ] Companion heartbeat and offline state.
- [ ] Per-action schema validation and server-side allowlist.
- [ ] Explicit confirmation UI for sensitive actions.
- [ ] Android permission explanation and denial fallback.
- [ ] Duplicate request protection and action expiry.
- [ ] Stop/disconnect and audit trail.
- [ ] Test unauthenticated, wrong-UID, expired-token, offline-bridge, malformed-action and denied-permission cases.
- [ ] Verify Netlify build and live deployment before claiming production readiness.
