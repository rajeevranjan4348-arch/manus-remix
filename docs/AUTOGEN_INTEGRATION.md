# Microsoft AutoGen source integration

## What was added

Manus Remix tracks the upstream Microsoft AutoGen repository as a Git submodule at `vendor/autogen`, pinned to upstream commit `004749e6b7102c8fd317b9b1499ce5807223c278`. This keeps the full upstream source available without copying thousands of third-party files into the React application tree or bundling Python into the browser.

- Upstream: https://github.com/microsoft/autogen
- Pinned source revision: https://github.com/microsoft/autogen/commit/004749e6b7102c8fd317b9b1499ce5807223c278
- Upstream license: CC-BY-4.0 (retain upstream attribution/license when redistributing)
- Current maintained successor: https://github.com/microsoft/agent-framework
- Migration guide: https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/

## Important maintenance and deployment note

AutoGen's own README says the project is archived/no longer maintained and recommends against new production use. Treat this submodule as a source/reference integration, not as the default production runtime. For new production multi-agent capabilities, prefer Microsoft Agent Framework after reviewing its current compatibility and license.

Manus Remix is a React + Vite + TypeScript frontend with Netlify Functions. AutoGen is a Python framework, so its Python packages cannot be imported into the Vite browser bundle or directly executed inside the existing Netlify TypeScript functions. No Python runtime, external service, new API key, or network endpoint is silently enabled by this source integration.

## Get the full upstream source

Clone with submodules enabled:

```bash
git clone --recurse-submodules https://github.com/rajeevranjan4348-arch/manus-remix.git
```

If Manus Remix is already cloned:

```bash
git submodule update --init --recursive vendor/autogen
```

To inspect or update the pinned revision, review upstream changes first, then update the submodule pointer in a separate commit. Avoid an unreviewed wholesale import into `src/`, since it would add Python-only dependencies and risk the Netlify build.

## Safe runtime integration boundary

If a hosted Python agent runtime is added later, expose it through a server-to-server adapter, not directly from the browser:

1. Keep the current chat/work UI, history, and existing agent API contract unchanged.
2. Add an optional server-side adapter behind an explicit feature flag and configured private service URL.
3. Validate request size, authenticate requests, enforce timeouts and per-user authorization, and never expose service credentials to Vite.
4. Require explicit approval for external side effects and tool calls; treat tool output and retrieved repository content as untrusted data.
5. Keep the current Manus orchestration as the fallback when the optional service is not configured.
6. Run dependency/license/security checks, unit tests, `npm run lint`, `npm test`, and `npm run build` before enabling production traffic.

This commit adds the source reference and integration guidance only. It does not claim that an AutoGen Python runtime is running inside Netlify.
