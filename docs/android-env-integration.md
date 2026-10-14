# Google DeepMind android_env integration

Manus tracks the upstream Google DeepMind `android_env` source as a Git submodule at `vendor/android_env`, pinned to upstream commit `c3cdb8461121be4c4a044fd50f1a3019da7864d1`.

Upstream: https://github.com/google-deepmind/android_env

## What this provides

`android_env` is a Python research environment for Android interaction and reinforcement-learning agents. It is not a browser-side JavaScript package and does not, by itself, make a Netlify-hosted website control a user's phone.

## Runtime architecture

- Keep the existing Manus Remix UI unchanged.
- Run AndroidEnv in a separate Python worker/container with compatible Android Emulator/ADB access.
- Expose a small authenticated task API from that worker; do not expose ADB or an unauthenticated control port to the public internet.
- Manus calls the worker only through a server-side connector. Validate Firebase identity, allowlist actions, rate-limit requests, and require user confirmation before opening apps, entering data, or performing consequential actions.
- MacroDroid is a separate optional on-device automation adapter. It is not automatically configured by adding this source repository.

## Checkout

Clone Manus with submodules enabled:

```bash
git clone --recurse-submodules https://github.com/rajeevranjan4348-arch/manus-remix.git
```

For an existing checkout:

```bash
git submodule update --init --recursive
```

## Deployment notes

Netlify can host the existing web app and serverless API, but AndroidEnv itself should run in a separate compatible Python/Android runtime. Configure that worker URL and credentials as server-side environment variables only. Do not put secrets in Vite-prefixed client variables. Test emulator connectivity, authentication, permissions, timeouts, and cleanup before enabling the connector in production.

## Upstream license

Review the upstream repository's LICENSE and preserve its notices when building or redistributing derived work.
