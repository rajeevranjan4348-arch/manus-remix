/**
 * Read-only readiness endpoint for the Manus agent.
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
    webSearch: configured('FIRECRAWL_API_KEY', 'AGENT_REACH_BRIDGE_URL'),
    agentReachToken: configured('AGENT_REACH_BRIDGE_TOKEN'),
    database: configured('DATABASE_URL', 'POSTGRES_URL', 'FIREBASE_PROJECT_ID'),
    embeddings: configured('OPENAI_API_KEY', 'VOYAGE_API_KEY', 'GEMINI_API_KEY'),
    browserRuntime: configured('BROWSERLESS_URL', 'PLAYWRIGHT_WS_ENDPOINT'),
    scheduler: configured('SCHEDULER_ENDPOINT', 'QSTASH_TOKEN', 'UPSTASH_REDIS_REST_URL'),
    notifications: configured('FCM_SERVER_KEY', 'FIREBASE_SERVICE_ACCOUNT'),
    githubToken: configured('GITHUB_TOKEN', 'GH_TOKEN'),
  };

  const features = [
    { id: 1, name: 'Autonomous AI agent', status: env.gemini ? 'partial' : 'blocked', note: 'Model responses are configured; verified multi-step tool orchestration is not confirmed by this endpoint.' },
    { id: 2, name: 'Real-time web research', status: env.webSearch && env.gemini ? 'partial' : 'needs_configuration', note: 'A search provider and model key are needed; configuration presence does not guarantee provider health.' },
    { id: 3, name: 'Coding agent and GitHub', status: env.githubToken ? 'configured_not_verified' : 'needs_configuration', note: 'A server-side GitHub token is detected only by presence; repository authorization and write actions require separate verification.' },
    { id: 4, name: 'Files and projects workspace', status: 'partial', note: 'Existing UI/file flows require end-to-end storage and format validation.' },
    { id: 5, name: 'Live task timeline', status: 'partial', note: 'Existing timeline components are present; live events must be connected to real task execution.' },
    { id: 6, name: 'Long-term memory', status: env.database ? 'needs_verification' : 'needs_storage_configuration', note: 'Persistent storage configuration alone does not verify per-user isolation or memory CRUD.' },
    { id: 7, name: 'Skills system', status: 'needs_verification', note: 'Registry, permissions, and execution handlers require end-to-end verification.' },
    { id: 8, name: 'MCP and app connectors', status: 'needs_verification', note: 'Each connector needs real OAuth/credential storage, scopes, and revocation tests.' },
    { id: 9, name: 'Browser automation', status: env.browserRuntime ? 'configured_not_verified' : 'needs_browser_runtime', note: 'A browser runtime endpoint is not proof that a secure automation workflow is working.' },
    { id: 10, name: 'Voice assistant', status: 'partial', note: 'Browser/native permissions and speech support vary by device and must be tested at runtime.' },
    { id: 11, name: 'Android companion', status: 'partial', note: 'Capacitor configuration exists; native permissions and device actions require Android build/device verification.' },
    { id: 12, name: 'Scheduled agents', status: env.scheduler ? 'configured_not_verified' : 'needs_scheduler', note: 'Persistent scheduling requires a configured scheduler and durable task state.' },
    { id: 13, name: 'Background task execution', status: env.scheduler && env.database ? 'configured_not_verified' : 'needs_queue_and_storage', note: 'A durable queue, worker, retries, and idempotency must be verified.' },
    { id: 14, name: 'Reliable response engine', status: 'partial', note: 'Request validation, fallback handling, and stream error handling exist; regression tests are still required.' },
    { id: 15, name: 'Security center', status: 'partial', note: 'Server-side key use and request validation exist; authentication, rate limiting, audit, and authorization need deployment-level review.' },
    { id: 16, name: 'Parallel multi-agent execution', status: 'not_verified', note: 'Parallel orchestration and conflict handling are not verified.' },
    { id: 17, name: 'Intelligent model router', status: env.gemini ? 'partial' : 'needs_configuration', note: 'Gemini fallback candidates exist; provider capability, cost, and latency routing are not verified.' },
    { id: 18, name: 'Task checkpoints and recovery', status: env.database ? 'needs_verification' : 'needs_storage_configuration', note: 'Durable checkpoints and idempotent resume are not verified.' },
    { id: 19, name: 'Knowledge base and retrieval', status: env.database && env.embeddings ? 'needs_verification' : 'needs_storage_or_embedding_configuration', note: 'Storage and embedding configuration do not prove indexing, retrieval, or tenant isolation.' },
    { id: 20, name: 'AI evaluation and regression tests', status: 'not_verified', note: 'Automated evaluation results are not inferred from source presence.' },
    { id: 21, name: 'Real tool execution framework', status: 'partial', note: 'Web-search paths exist; a general schema-validated, permissioned tool registry needs verification.' },
    { id: 22, name: 'User approval and permissions manager', status: 'not_verified', note: 'Approval persistence, expiry, and execution-time revalidation are not verified.' },
    { id: 23, name: 'Observability and diagnostics', status: 'partial', note: 'Request IDs and redacted operational errors are available in the agent endpoint; metrics and health checks remain to be verified.' },
    { id: 24, name: 'Notifications and task updates', status: env.notifications ? 'configured_not_verified' : 'needs_configuration', note: 'Notification provider configuration is not proof of delivery or permission.' },
    { id: 25, name: 'Agent configuration and management', status: 'partial', note: 'Environment-based model configuration exists; authenticated capability management and audit are not verified.' },
  ];

  return new Response(JSON.stringify({
    ok: true,
    requestId,
    generatedAt: new Date().toISOString(),
    note: 'Readiness reflects source-level and environment-variable indicators only. It is not a live provider health check and does not mean a feature is complete.',
    providers: {
      geminiConfigured: env.gemini,
      webSearchProviderConfigured: env.webSearch,
      agentReachBridgeTokenConfigured: env.agentReachToken,
      databaseConfigured: env.database,
      embeddingsProviderConfigured: env.embeddings,
      browserRuntimeConfigured: env.browserRuntime,
      schedulerConfigured: env.scheduler,
      notificationProviderConfigured: env.notifications,
      githubTokenConfigured: env.githubToken,
    },
    features,
  }), { status: 200, headers });
};
