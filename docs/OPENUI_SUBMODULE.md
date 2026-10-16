# OpenUI source import

The complete OpenUI repository is connected at `vendor/openui` as a Git submodule so its full upstream history and all 4,910 tracked tree entries remain intact without copying or overwriting Manus Remix application files.

- Source: https://github.com/rajeevranjan4348-arch/openui
- Pinned source commit at import time: `c0e6b0f9f459b777185f7d6fe35c5a90a2fb22bb`
- Upstream project documentation: https://www.openui.com/docs/getting-started

## Checkout the source

Clone Manus Remix with submodules enabled:

```bash
git clone --recurse-submodules https://github.com/rajeevranjan4348-arch/manus-remix.git
```

If you already cloned Manus Remix, initialize the source with:

```bash
git submodule update --init --recursive vendor/openui
```

OpenUI is kept isolated from the app root because it is a pnpm monorepo with its own package manager, lockfile, packages, examples, and build scripts. This import intentionally does not replace Manus Remix package.json, lockfile, Vite/Netlify configuration, UI, or runtime dependencies. Wiring OpenUI into a user-facing chat flow is a separate integration step and should be tested against the existing app before activation.
