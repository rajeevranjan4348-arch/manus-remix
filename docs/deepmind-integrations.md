# Google DeepMind integrations in Manus Remix

## UI preservation

This integration is backend-only. It does not change React components, layout, styles, themes, routes, animations, or existing chat behavior. The capability registry is available at:

`GET /.netlify/functions/deepmind-capabilities`

The endpoint returns integration metadata and whether the required environment variable names are configured. It never returns secret values. A configured flag is not a health check.

## Repository strategy

The upstream projects are not one installable library. Their code, licenses, hardware requirements, and runtimes differ. Manus Remix therefore tracks the upstream projects as capability integrations rather than copying unrelated source trees into the Vite bundle.

| Upstream project | Manus Remix integration | Runtime boundary |
| --- | --- | --- |
| [AndroidEnv](https://github.com/google-deepmind/android_env) | Existing submodule at `vendor/android_env` and guarded Android bridge | Python worker + Android SDK/ADB + emulator/device |
| [Science Skills](https://github.com/google-deepmind/science-skills) | Skill-registry integration point | Allowlisted skill files; scripts only in an isolated worker |
| [Gemma](https://github.com/google-deepmind/gemma) | Optional model-provider integration point | Separately hosted inference endpoint and model compute |
| [WeatherNext](https://github.com/google-deepmind/weathernext) | Forecast-provider integration point | Dedicated model/data pipeline; existing Open-Meteo service remains intact |
| [MuJoCo](https://github.com/google-deepmind/mujoco) | Simulation worker integration point | Native/Python worker |
| [Acme](https://github.com/google-deepmind/acme) | Reinforcement-learning worker integration point | Isolated Python runtime |
| [OpenSpiel](https://github.com/google-deepmind/open_spiel) | Game-theory/planning worker integration point | Python/C++ worker |
| [Sonnet](https://github.com/google-deepmind/sonnet) | Optional research dependency | Python model environment |
| [Haiku](https://github.com/google-deepmind/dm-haiku) | Optional JAX research dependency | Python/JAX model environment |
| [AlphaFold 3](https://github.com/google-deepmind/alphafold3) | Optional specialized research worker | Dedicated GPU/HPC deployment and model parameters |

## Configuration

Only set environment variables for services that have actually been deployed:

- `ANDROIDENV_BRIDGE_URL` and `ANDROID_CONTROL_TOKEN`: trusted Android bridge. The token must remain server-side.
- `DEEPMIND_SKILLS_DIR`: directory of reviewed skill definitions available to a server-side registry.
- `GEMMA_BASE_URL` and `GEMMA_API_KEY`: compatible, separately hosted Gemma inference service.
- `WEATHERNEXT_API_URL`: deployed WeatherNext inference service.
- `DEEPMIND_SIMULATION_WORKER_URL`: deployed MuJoCo worker.
- `DEEPMIND_RL_WORKER_URL`: deployed Acme worker.
- `DEEPMIND_GAME_WORKER_URL`: deployed OpenSpiel worker.
- `DEEPMIND_BIOLOGY_WORKER_URL`: deployed AlphaFold 3 pipeline.

Do not set a URL to a GitHub repository and expect it to behave as an inference API. Do not put secrets in `VITE_*` variables, browser code, committed environment files, or logs.

## Safety and execution policy

1. Keep device control, code execution, scientific scripts, and model workers off the public Netlify function runtime.
2. Require authenticated server-side requests and explicit approval for consequential Android actions or external writes.
3. Run uploaded code and third-party skill scripts in an isolated, resource-limited worker with a strict allowlist.
4. Validate request schemas, apply timeouts and output-size limits, and avoid returning raw worker errors to users.
5. Do not report a capability as operational until a real health check and an end-to-end test succeed.

## Netlify compatibility

The existing `netlify.toml`, `package.json`, and frontend are intentionally unchanged. The new function only returns static integration metadata. Long-running Python, emulator, GPU, and native simulation workloads require separately deployed workers because they do not fit a standard static-site build or short-lived serverless function.
