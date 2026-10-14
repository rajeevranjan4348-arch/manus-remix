# Manus Remix — Android Control Bridge

## Status and scope

The web application can issue authenticated, allowlisted commands through the Netlify function at `/api/android-control`. Access is restricted to the exact Firebase UID in `ANDROID_CONTROL_ALLOWED_UID`. **This is not a standalone phone-control implementation until a trusted Android companion bridge is installed, paired, and reachable.** A browser-only website cannot silently control arbitrary Android apps or system settings.

## Current allowlist

- `home`
- `flashlight_toggle`
- `volume_up`
- `volume_down`
- `open_settings`
- `launch_app` (validated package ID only)
- `status`

The Settings panel asks for user confirmation before sending each action. The server verifies Firebase ID tokens and rejects unknown actions. Do not add SMS/call sending, device unlock, OTP/password capture, hidden screen capture, or notification/clipboard reading without a separate threat model, explicit permission UX, and an audited implementation.

## Netlify configuration

Set these environment variables in Netlify:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase Admin service-account JSON, stored only as a server secret.
- `ANDROID_CONTROL_ALLOWED_UID`: exact Firebase UID authorized to control the paired device.
- `ANDROID_CONTROL_BRIDGE_URL`: HTTPS origin of the paired bridge/relay.
- `ANDROID_CONTROL_BRIDGE_TOKEN`: high-entropy bearer token accepted by the bridge.

Never use a client-side `VITE_*` variable for secrets. Deploy the function only after configuring Firebase Admin verification and the bridge.

## Bridge contract

- `GET /health` with `Authorization: Bearer <bridge token>` returns JSON such as `{ "connected": true, "deviceName": "My Android" }`.
- `POST /v1/control` with the same authorization header accepts `{ "action": "home", "args": {} }` and returns a JSON result.
- The bridge must enforce an action allowlist itself, bind commands to the paired user/device, apply Android runtime permission checks, log commands, expire stale requests, and never expose an unauthenticated LAN HTTP server.
- For a phone behind NAT, use a secure outbound connection/relay; do not expose a raw device-control port to the public internet.

## Plugin responsibilities

- **GitHub:** version and review the code.
- **MacroDroid Macro Builder:** optional on-device routines for supported actions, configured and imported by the phone owner.
- **Parallel Search / BrowserAct:** research and verify official platform documentation; BrowserAct CLI was unavailable in this execution environment.
- **Hugging Face:** model/Space discovery only; it does not grant Android OS privileges.
- **Brainbase:** optional agent orchestration; it does not replace the on-device bridge or Android permissions.

## Validation still required

Run `npm run lint`, `npm run build`, verify Firebase ID-token rejection, test bridge timeout/invalid responses, and test on a physical Android device. Production phone control is **not verified** until the companion bridge exists and end-to-end tests pass.
