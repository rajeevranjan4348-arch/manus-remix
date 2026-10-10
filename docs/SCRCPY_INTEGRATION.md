# scrcpy integration for Manus Remix

This change prepares a safe integration boundary for the official **scrcpy** project; it does not bundle or relicense scrcpy binaries.

- Upstream: https://github.com/Genymobile/scrcpy
- License: Apache-2.0 (review upstream license/notices before redistributing binaries)
- Upstream currently runs on a host computer (Linux, Windows, or macOS), connects to Android over USB or TCP/IP, and uses ADB/USB debugging for normal control. It is not a browser-only Android API and does not itself provide a Netlify-hosted remote-control service.
- Official prerequisites and platform instructions: https://github.com/Genymobile/scrcpy#readme

## Intended architecture

`Manus Remix UI (unchanged) → authenticated Netlify/server API → private, user-operated scrcpy host bridge → ADB/scrcpy → explicitly paired Android device`

The host bridge must be installed and operated separately on a trusted computer or local network. Netlify functions cannot launch a native scrcpy process on the user's phone or access a user's USB device directly.

## Bridge contract

The server-side client in `server/android/scrcpy-bridge.ts` expects a separately implemented, authenticated bridge exposing:

- `GET /v1/status`
- `POST /v1/sessions` to request a session
- `DELETE /v1/sessions/:sessionId` to stop one
- `POST /v1/sessions/:sessionId/input` for an explicitly approved input action

These are Manus Remix adapter endpoints, **not** built-in scrcpy HTTP endpoints. Do not expose the bridge directly to the public internet. Put it behind TLS, authentication, device pairing, rate limits, and an allowlist. Keep its bearer token in server-side environment variables only.

## Safety and product requirements

- Keep the existing UI unchanged until the integration is tested end to end.
- Pair a device deliberately and display connection status.
- Require a fresh, explicit user approval before starting a session or sending touch/text/key input; never let model-generated plans silently control a device.
- Reject unknown actions and invalid session IDs. Do not provide arbitrary shell/ADB command execution through this API.
- Stop sessions on disconnect and provide a visible stop control.
- Never log bearer tokens or sensitive screen contents.
- Test on a non-sensitive device first.

## Netlify configuration

Set these only in the Netlify server environment, never in client-side `VITE_*` variables:

- `SCRCPY_BRIDGE_URL`: private HTTPS URL for the separately deployed bridge.
- `SCRCPY_BRIDGE_TOKEN`: long random bearer token shared with that bridge.

The adapter fails closed when configuration is missing. This documentation/client adapter alone does not enable control until a compatible host bridge and authenticated server routes are implemented and tested.
