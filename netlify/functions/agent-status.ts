/**
 * Read-only readiness endpoint for the Deku AI agent.
 *
 * This reports configuration presence, not proof that a third-party service is healthy
 * or that a capability is fully implemented. It deliberately never returns secret values.
 */
const configured = (...names: string[]) => names.some((name) => Boolean(process.env[name]?.trim()));

export default async (req: Request) => {
  const requestId = req.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Request-ID': requestId,
  };

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({
      error: 'Use GET to inspect capability readiness.',
      code: 'METHOD_NOT_ALLOWED',
      requestId,
    }), { status: 405, headers });
  }

  const env = {
    gemini: configured('GEMINI_API_KEY'),
    anthropic: configured('ANTHROPIC_API_KEY'),
    openai: configured('OPENAI_API_KEY'),
    openrouter: configured('OPENROUTER_API_KEY', 'OPENROUTER_CHAT_API_KEY', 'OPENROUTER_WORK_API_KEY'),
    webSearch: configured('FIRECRAWL_API_KEY', 'AGENT_REACH_BRIDGE_URL'),
    agentReachToken: configured('AGENT_REACH_BRIDGE_TOKEN'),
    database: configured('DATABASE_URL', 'POSTGRES_URL', 'FIREBASE_PROJECT_ID'),
    embeddings: configured('OPENAI_API_KEY', 'VOYAGE_API_KEY', 'GEMINI_API_KEY'),
    browserRuntime: configured('BROWSERLESS_URL', 'BROWSERBASE_API_KEY', 'BROWSER_RUNTIME_URL', 'PLAYWRIGHT_WS_ENDPOINT'),
    sandboxRuntime: configured('E2B_API_KEY', 'DAYTONA_API_KEY', 'SANDBOX_RUNTIME_URL'),
    backgroundWorker: configured('BACKGROUND_WORKER_URL', 'QSTASH_TOKEN'),
    workerSecret: Boolean((process.env.BACKGROUND_WORKER_SECRET || '').trim().length >= 16),
    policyGatewaySecret: Boolean((process.env.POLICY_GATEWAY_SECRET || '').trim().length >= 32),
    scheduler: configured('SCHEDULER_ENDPOINT', 'SCHEDULER_SECRET', 'QSTASH_TOKEN', 'UPSTASH_REDIS_REST_URL'),
    notifications: configured('FCM_SERVER_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'UPSTASH_REDIS_REST_URL'),
    githubToken: configured('GITHUB_TOKEN', 'GH_TOKEN'),
  };

  const hasAnyModel = env.gemini || env.anthropic || env.openai || env.openrouter;

  const features = [
    { id: 1, name: 'Autonomous AI agent', status: hasAnyModel ? 'configured_not_verified' : 'blocked', note: 'Model responses are configured; verify live provider calls via /api/multi-agent/health.' },
    { id: 2, name: 'Real-time web research', status: env.webSearch && env.gemini ? 'partial' : 'needs_configuration', note: 'A search provider and model key are needed; configuration presence does not guarantee provider health.' },
    { id: 3, name: 'Coding agent and GitHub', status: env.sandboxRuntime || env.githubToken ? 'configured_not_verified' : 'needs_configuration', note: 'Isolated sandbox provider and/or GitHub credentials are detected only by presence; live provider health must be checked via /api/sandbox/health?live=true.' },
    { id: 4, name: 'Files and projects workspace', status: env.sandboxRuntime ? 'configured_not_verified' : 'partial', note: 'Workspace-confined sandbox filesystem API is available when an isolated sandbox provider is configured.' },
    { id: 5, name: 'Live task timeline', status: 'partial', note: 'Task phase tracking is wired in Feature 01 (/api/tasks/*); live UI streaming depends on active execution.' },
    { id: 6, name: 'Long-term memory', status: env.database ? 'needs_verification' : 'needs_storage_configuration', note: 'Persistent storage configuration alone does not verify per-user isolation or memory CRUD.' },
    { id: 7, name: 'Skills system', status: 'configured_not_verified', note: 'Server-backed skills catalog, versioning, integrity checks, and sandboxed execution are wired at /api/skills/*.' },
    { id: 8, name: 'MCP and app connectors', status: 'needs_verification', note: 'Each connector needs real OAuth/credential storage, scopes, and revocation tests.' },
    { id: 9, name: 'Browser automation', status: env.browserRuntime ? 'configured_not_verified' : 'needs_browser_runtime', note: 'Isolated browser session engine is wired; live browser provider health must be checked via /api/browser/health?live=true.' },
    { id: 10, name: 'Voice assistant', status: 'partial', note: 'Browser/native permissions and speech support vary by device and must be tested at runtime.' },
    { id: 11, name: 'Android companion', status: 'partial', note: 'Capacitor configuration exists; native permissions and device actions require Android build/device verification.' },
    { id: 12, name: 'Scheduled agents', status: env.scheduler ? 'configured_not_verified' : 'needs_scheduler', note: 'Persistent cron/timezone scheduler is wired at /api/scheduler/*; external cron trigger requires SCHEDULER_SECRET.' },
    { id: 13, name: 'Background task execution', status: env.backgroundWorker && env.workerSecret ? 'configured_not_verified' : 'needs_worker_configuration', note: 'Durable cloud task queue is wired at /api/tasks/*; external worker dispatch requires BACKGROUND_WORKER_URL and BACKGROUND_WORKER_SECRET (or QSTASH_TOKEN).' },
    { id: 14, name: 'Reliable response engine', status: 'partial', note: 'Request validation, fallback handling, and stream error handling exist; regression tests are still required.' },
    { id: 15, name: 'Security center', status: env.policyGatewaySecret ? 'configured_not_verified' : 'needs_secret_configuration', note: 'Fail-closed POLICY_GATEWAY_SECRET enforcement, user policies, revocation, and audit logging are wired at /api/permissions/*.' },
    { id: 16, name: 'Parallel multi-agent execution', status: hasAnyModel ? 'configured_not_verified' : 'needs_configuration', note: 'DAG multi-agent runtime with 9 roles, budgets, and QA review is wired at /api/multi-agent/*.' },
    { id: 17, name: 'Intelligent model router', status: hasAnyModel ? 'partial' : 'needs_configuration', note: 'Backend emits verified provider and model execution metadata per response.' },
    { id: 18, name: 'Task checkpoints and recovery', status: env.database ? 'needs_verification' : 'needs_storage_configuration', note: 'Durable checkpoints and lease expiration recovery are implemented; verify against target storage.' },
    { id: 19, name: 'Knowledge base and retrieval', status: env.database && env.embeddings ? 'needs_verification' : 'needs_storage_or_embedding_configuration', note: 'Storage and embedding configuration do not prove indexing, retrieval, or tenant isolation.' },
    { id: 20, name: 'AI evaluation and regression tests', status: 'not_verified', note: 'Automated evaluation results are not inferred from source presence.' },
    { id: 21, name: 'Real tool execution framework', status: 'partial', note: 'Sandbox, terminal, filesystem, preview, and browser tools are registered; external runtime availability depends on provider credentials.' },
    { id: 22, name: 'User approval and permissions manager', status: env.policyGatewaySecret ? 'configured_not_verified' : 'needs_secret_configuration', note: 'Durable single-use approval tokens, revocation, user policies, and server-side audit are wired at /api/permissions/*.' },
    { id: 23, name: 'Observability and diagnostics', status: 'partial', note: 'Request IDs and redacted operational errors are available in the agent endpoint; metrics and health checks remain to be verified.' },
    { id: 24, name: 'Notifications and task updates', status: env.notifications ? 'configured_not_verified' : 'needs_configuration', note: 'Durable in-app notifications are wired at /api/tasks/notifications; push delivery requires FCM credentials.' },
    { id: 25, name: 'Agent configuration and management', status: 'partial', note: 'Environment-based model configuration exists; authenticated capability management and audit are wired.' },
  ];

  return new Response(JSON.stringify({
    ok: true,
    identity: {
      product: 'Deku AI',
      role: 'Independent AI workspace assistant',
    },
    requestId,
    generatedAt: new Date().toISOString(),
    note: 'Readiness reflects source-level and environment-variable indicators only. It is not a live provider health check and does not mean a feature is complete.',
    providers: {
      geminiConfigured: env.gemini,
      anthropicConfigured: env.anthropic,
      openaiConfigured: env.openai,
      openrouterConfigured: env.openrouter,
      webSearchProviderConfigured: env.webSearch,
      agentReachBridgeTokenConfigured: env.agentReachToken,
      databaseConfigured: env.database,
      embeddingsProviderConfigured: env.embeddings,
      sandboxRuntimeConfigured: env.sandboxRuntime,
      browserRuntimeConfigured: env.browserRuntime,
      backgroundWorkerConfigured: env.backgroundWorker,
      workerSecretConfigured: env.workerSecret,
      policyGatewaySecretConfigured: env.policyGatewaySecret,
      schedulerConfigured: env.scheduler,
      notificationProviderConfigured: env.notifications,
      githubTokenConfigured: env.githubToken,
    },
    features,
  }), { status: 200, headers });
};
