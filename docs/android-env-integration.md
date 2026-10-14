# Google DeepMind android_env integration

Manus tracks the upstream Google DeepMind `android_env` source as a Git submodule at `vendor/android_env`, pinned to upstream commit `c3cdb8461121be4c4a044fd50f1a3019da7864d1`.

Upstream: https://github.com/google-deepmind/android_env

## What is included

- Upstream AndroidEnv source reference (Git submodule).
- A Netlify serverless gateway at `/.netlify/functions/android-env` that verifies Firebase ID tokens, limits the task payload, restricts access to a paired UID, requires explicit confirmation, and forwards tasks to a separately hosted worker over HTTPS.
- The existing Android-control endpoint remains a separate companion-device integration. AndroidEnv is not a replacement for the native companion bridge.

## Important runtime distinction

`android_env` is a Python research environment for Android interaction and reinforcement-learning agents. It is not a browser-side JavaScript package and does not, by itself, make a Netlify-hosted website control a user's phone. It normally needs a compatible Python runtime and Android Emulator/ADB setup. This gateway does not run Python, start an emulator, or install an Android app.

## Worker contract

Configure these server-side Netlify environment variables:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: service-account JSON used only by the server to verify Firebase ID tokens.
- `ANDROID_ENV_ALLOWED_UID`: Firebase UID permitted to use the worker. If omitted, the gateway falls back to `ANDROID_CONTROL_ALLOWED_UID`.
- `ANDROID_ENV_WORKER_URL`: HTTPS base URL for your privately operated worker.
- `ANDROID_ENV_WORKER_TOKEN`: bearer token shared with the worker; never expose it to client code.

The gateway sends `POST /v1/tasks` with JSON `{ "task": "...", "requestedBy": "..." }`. The client must send `POST /.netlify/functions/android-env` with a Firebase ID token and JSON `{ "task": "...", "confirmed": true }`. Task text is limited to 2,000 characters; requests time out after 25 seconds. The worker must independently authenticate the bearer token, validate task instructions, enforce action allowlists, and return JSON. Treat model-generated instructions as untrusted input and never execute arbitrary shell commands.

## Security and deployment

- Do not expose ADB, emulator ports, or an unauthenticated worker to the public internet.
- Keep all worker credentials in server-side environment variables; never use `VITE_*` for secrets.
- Use a private network or authenticated HTTPS gateway to connect the worker.
- Require confirmation for actions that change device state, open apps, enter data, or can affect other people.
- Add rate limiting and audit logging at the worker/gateway layer before production use.
- Netlify can host the web app and gateway, but AndroidEnv itself should run in a separate compatible Python/Android runtime.

## Checkout

Clone Manus with submodules enabled:

```bash
git clone --recurse-submodules https://github.com/rajeevranjan4348-arch/manus-remix.git
```

For an existing checkout:

```bash
git submodule update --init --recursive
```

## MacroDroid

MacroDroid is an optional on-device adapter, not part of AndroidEnv and not automatically connected by this repository change. Create and test device macros separately on the phone, grant only the permissions needed for each macro, and keep a visible confirmation step for calls, messages, purchases, or other consequential actions.

## Upstream license

Review the upstream repository's LICENSE and preserve its notices when building or redistributing derived work.
