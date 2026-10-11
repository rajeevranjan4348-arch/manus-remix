# AndroidEnv integration for Manus Remix

## UI preservation

This integration is isolated from `src/` and the React/Vite UI. It does not change UI components, styles, layout, themes, routes, or chat behavior.

## Upstream source

The full upstream source is referenced as a Git submodule at `vendor/android_env`, pinned to the commit recorded by the parent repository. Upstream: https://github.com/google-deepmind/android_env (Apache-2.0). Clone with submodules enabled:

```bash
git clone --recurse-submodules https://github.com/rajeevranjan4348-arch/manus-remix.git
# If already cloned:
git submodule update --init --recursive
```

The submodule keeps the upstream code intact and avoids copying a very large repository into the web app. It is not a JavaScript dependency and is not executed by Netlify's Vite build.

## Runtime architecture

AndroidEnv is a Python reinforcement-learning environment for Android emulators; it needs an emulator and Python runtime. Netlify Functions cannot host a persistent Android emulator. Run the optional FastAPI sidecar in `server/androidenv/service.py` on a trusted machine/container that has Android SDK Platform Tools (`adb`) and an emulator/device connected. The Manus Remix frontend remains on Netlify and can call the sidecar only through a configured, authenticated backend integration.

## Sidecar setup

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r server/androidenv/requirements.txt
export ANDROID_CONTROL_TOKEN='use-a-long-random-secret'
export ANDROID_ALLOWED_PACKAGES='com.example.app,com.android.settings'
export ANDROID_ADB_SERIAL='emulator-5554' # optional; omit to use adb's default device
uvicorn server.androidenv.service:app --host 127.0.0.1 --port 8787
```

Keep the service on loopback or behind a private authenticated gateway. Do not expose raw ADB or this API directly to the public internet. Keep the token server-side; never place it in `VITE_*` variables or browser code.

## API

- `GET /health` — service status, no device data.
- `GET /v1/device/screenshot` — current screen as base64 PNG.
- `POST /v1/device/action` — supported actions: `tap`, `swipe`, `back`, `home`, and `open_app`. Every action requires `confirmed: true`; app launches additionally require the package to be in `ANDROID_ALLOWED_PACKAGES`.

All `/v1/*` routes require `Authorization: Bearer <ANDROID_CONTROL_TOKEN>`. This adapter is a guarded ADB bridge, not a claim that a trained autonomous agent or an AndroidEnv task policy is already wired into chat. To use AndroidEnv's RL task API, define and load a task configuration and connect its observation/action loop in a separately deployed worker.

## Netlify compatibility and validation

The existing `netlify.toml`, `package.json`, UI source, and frontend build remain untouched. The Python service is deployed separately. Before production use, run the Vite build and lint, then test the sidecar only with a disposable emulator and a non-sensitive app.
