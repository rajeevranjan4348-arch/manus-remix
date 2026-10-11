# AndroidEnv integration for Manus Remix

## UI preservation

This integration is isolated from `src/` and the React/Vite UI. It does not change UI components, styles, layout, themes, routes, or chat behavior.

## Full upstream source

The complete upstream AndroidEnv repository is included as a Git submodule at `vendor/android_env`, pinned to an upstream commit. This preserves the upstream code and history without duplicating its large Python/RL codebase in the Manus Remix repository.

Upstream: https://github.com/google-deepmind/android_env  
License: Apache-2.0

Clone with submodules enabled:

```bash
git clone --recurse-submodules https://github.com/rajeevranjan4348-arch/manus-remix.git
# If already cloned:
git submodule update --init --recursive
```

If GitHub's web file browser shows only a submodule pointer at `vendor/android_env`, that is expected. It links to the complete upstream source; the files are checked out locally by the commands above.

## What AndroidEnv provides

The upstream library includes the Android reinforcement-learning environment, ADB/device coordination, screenshot/pixel observations, touchscreen action primitives, task configuration and termination/reward components, example task/agent runners, and test suites. These are Python research/runtime features, not JavaScript frontend modules.

AndroidEnv itself does not provide a ready-to-run general-purpose trained assistant policy. A task definition and a suitable agent/policy must be configured for autonomous RL execution.

## Manus Remix device bridge

The optional FastAPI sidecar in `server/androidenv/service.py` provides a small authenticated adapter for controlled Android interaction:

- `GET /health` — service health.
- `GET /v1/device/info` — model, Android version, screen size, and density.
- `GET /v1/device/apps` — packages explicitly allowlisted for launching.
- `GET /v1/device/screenshot` — current screen as base64 PNG.
- `POST /v1/device/action` — tap, swipe, Back, Home, allowlisted key events, and allowlisted app launch.
- `POST /v1/device/text` — type up to 500 characters after explicit confirmation.

All `/v1/*` routes require `Authorization: Bearer <ANDROID_CONTROL_TOKEN>`. Mutating actions require `confirmed: true`; app launches are restricted to `ANDROID_ALLOWED_PACKAGES`. Key events are allowlisted and the API never accepts arbitrary shell commands.

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

## Netlify compatibility and remaining wiring

The existing `netlify.toml`, `package.json`, frontend source, and UI remain unchanged. Netlify cannot host a persistent Android emulator; run the Python service on a trusted machine/container with Android SDK Platform Tools and an emulator/device connected.

The sidecar API is ready to be called by a server-side connector, but this commit does not add a visible UI panel or wire chat messages to device actions. That is intentionally kept separate so the existing UI stays exactly the same. To enable full autonomous AndroidEnv task execution, deploy a dedicated worker, define task configs, connect the observation/action loop, and supply a compatible agent/policy.

## Validation checklist

Before production use, run the Manus Remix Vite build/lint and the Python service tests, then test against a disposable emulator and a non-sensitive app. Do not test device-control actions on a personal device until the action flow and permissions have been reviewed.
