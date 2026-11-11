/**
 * Google DeepMind capability registry for Manus Remix.
 *
 * This catalog deliberately separates features from their heavyweight runtimes.
 * Netlify can expose capability metadata; Python/GPU/emulator workloads must run
 * on separately managed workers. Never include secret values in this file.
 */
export type DeepMindCapability = {
  id: string;
  name: string;
  upstream: string;
  purpose: string;
  integration: "existing-submodule" | "server-adapter" | "external-worker" | "optional";
  runtime: string;
  readiness: "available" | "requires-configuration" | "external-runtime-required";
  env: string[];
  uiChanges: false;
};

const capabilities: DeepMindCapability[] = [
  {
    id: "android-env",
    name: "AndroidEnv",
    upstream: "https://github.com/google-deepmind/android_env",
    purpose: "Android emulator observations and task/action loops for agent-controlled mobile workflows.",
    integration: "existing-submodule",
    runtime: "Python 3.10+, Android SDK/ADB, a connected emulator, and a task worker",
    readiness: "requires-configuration",
    env: ["ANDROIDENV_BRIDGE_URL", "ANDROID_CONTROL_TOKEN"],
    uiChanges: false,
  },
  {
    id: "science-skills",
    name: "Science Skills",
    upstream: "https://github.com/google-deepmind/science-skills",
    purpose: "Structured scientific workflows and reusable skill instructions for research agents.",
    integration: "server-adapter",
    runtime: "A server-side skill registry; individual scripts run only in an isolated worker",
    readiness: "requires-configuration",
    env: ["DEEPMIND_SKILLS_DIR"],
    uiChanges: false,
  },
  {
    id: "gemma",
    name: "Gemma",
    upstream: "https://github.com/google-deepmind/gemma",
    purpose: "Optional open-weight model inference through a separately hosted compatible inference endpoint.",
    integration: "server-adapter",
    runtime: "Self-hosted or managed inference server with model weights and adequate compute",
    readiness: "requires-configuration",
    env: ["GEMMA_BASE_URL", "GEMMA_API_KEY"],
    uiChanges: false,
  },
  {
    id: "weathernext",
    name: "WeatherNext",
    upstream: "https://github.com/google-deepmind/weathernext",
    purpose: "Research-grade weather forecasting models and datasets.",
    integration: "external-worker",
    runtime: "Separately deployed forecast pipeline/API; existing Open-Meteo weather service remains the fallback",
    readiness: "external-runtime-required",
    env: ["WEATHERNEXT_API_URL"],
    uiChanges: false,
  },
  {
    id: "mujoco",
    name: "MuJoCo",
    upstream: "https://github.com/google-deepmind/mujoco",
    purpose: "Physics simulation for robotics and embodied-agent tasks.",
    integration: "external-worker",
    runtime: "Python/native simulation worker",
    readiness: "external-runtime-required",
    env: ["DEEPMIND_SIMULATION_WORKER_URL"],
    uiChanges: false,
  },
  {
    id: "acme",
    name: "Acme",
    upstream: "https://github.com/google-deepmind/acme",
    purpose: "Research framework for reinforcement-learning agents and training loops.",
    integration: "external-worker",
    runtime: "Isolated Python training/inference worker; not a Netlify function workload",
    readiness: "external-runtime-required",
    env: ["DEEPMIND_RL_WORKER_URL"],
    uiChanges: false,
  },
  {
    id: "open-spiel",
    name: "OpenSpiel",
    upstream: "https://github.com/google-deepmind/open_spiel",
    purpose: "Game-theory, planning, and multi-agent research environments.",
    integration: "external-worker",
    runtime: "Python/C++ compatible worker",
    readiness: "external-runtime-required",
    env: ["DEEPMIND_GAME_WORKER_URL"],
    uiChanges: false,
  },
  {
    id: "sonnet",
    name: "Sonnet",
    upstream: "https://github.com/google-deepmind/sonnet",
    purpose: "Neural-network building blocks for research workloads.",
    integration: "optional",
    runtime: "Python research environment; only needed for a model that uses Sonnet",
    readiness: "external-runtime-required",
    env: [],
    uiChanges: false,
  },
  {
    id: "haiku",
    name: "Haiku",
    upstream: "https://github.com/google-deepmind/dm-haiku",
    purpose: "JAX neural-network modules for research and model development.",
    integration: "optional",
    runtime: "Python/JAX research environment",
    readiness: "external-runtime-required",
    env: [],
    uiChanges: false,
  },
  {
    id: "alphafold3",
    name: "AlphaFold 3",
    upstream: "https://github.com/google-deepmind/alphafold3",
    purpose: "Specialized biomolecular structure-prediction research pipeline.",
    integration: "optional",
    runtime: "Dedicated GPU/HPC deployment with the required model parameters and dependencies",
    readiness: "external-runtime-required",
    env: ["DEEPMIND_BIOLOGY_WORKER_URL"],
    uiChanges: false,
  },
];

export function getDeepMindCapabilities(env: Record<string, string | undefined> = process.env) {
  return capabilities.map((capability) => ({
    ...capability,
    configured: capability.env.length > 0 && capability.env.every((key) => Boolean(env[key]?.trim())),
  }));
}
