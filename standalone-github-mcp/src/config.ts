export type TransportMode = 'stdio' | 'http';

export interface RuntimeConfig {
  transport: TransportMode;
  host: string;
  port: number;
  githubToken?: string;
  githubAppId?: number;
  githubAppPrivateKey?: string;
  githubAppInstallationId?: number;
  githubAuthMode: 'pat' | 'app';
  allowedRepos: Set<string>;
  allowedFirebaseUids: Set<string>;
  firebaseProjectId?: string;
  firebaseServiceAccountJson?: string;
  allowedHosts: Set<string>;
  allowedOrigins: Set<string>;
  maxBodyBytes: number;
  maxSessions: number;
  sessionTtlMs: number;
  rateLimitPerMinute: number;
  redisRestUrl?: string;
  redisRestToken?: string;
  githubRequestTimeoutMs: number;
  githubReadRetries: number;
  nodeEnv: string;
}

function csvSet(value: string | undefined): Set<string> {
  return new Set((value || '').split(',').map((part) => part.trim()).filter(Boolean));
}
function intEnv(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const parsed = value === undefined || value.trim() === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} must be configured.`);
  return value.trim();
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const transport = (env.MCP_TRANSPORT || 'stdio').toLowerCase();
  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error('MCP_TRANSPORT must be either "stdio" or "http".');
  }
  const pat = env.GITHUB_TOKEN?.trim() || undefined;
  const appIdRaw = env.GITHUB_APP_ID?.trim();
  const appKeyRaw = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const appInstallationRaw = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const hasAnyAppSetting = Boolean(appIdRaw || appKeyRaw || appInstallationRaw);
  const hasCompleteAppSettings = Boolean(appIdRaw && appKeyRaw && appInstallationRaw);
  if (hasAnyAppSetting && !hasCompleteAppSettings) {
    throw new Error('GitHub App authentication requires GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID together.');
  }
  if (pat && hasCompleteAppSettings) {
    throw new Error('Configure either GITHUB_TOKEN or GitHub App credentials, not both.');
  }
  if (!pat && !hasCompleteAppSettings) {
    throw new Error('Configure GITHUB_TOKEN or all required GitHub App credentials.');
  }

  const allowedRepos = new Set([...csvSet(env.GITHUB_ALLOWED_REPOS)].map((repo) => repo.toLowerCase()));
  const allowedFirebaseUids = csvSet(env.MCP_ALLOWED_FIREBASE_UIDS);
  const firebaseProjectId = env.FIREBASE_PROJECT_ID?.trim() || undefined;
  const isProduction = env.NODE_ENV === 'production';
  const allowedHosts = new Set([...csvSet(env.MCP_ALLOWED_HOSTS)].map((host) => host.toLowerCase()));
  const allowedOrigins = csvSet(env.MCP_ALLOWED_ORIGINS);
  const redisRestUrl = env.UPSTASH_REDIS_REST_URL?.trim() || undefined;
  const redisRestToken = env.UPSTASH_REDIS_REST_TOKEN?.trim() || undefined;

  if (transport === 'http') {
    required(firebaseProjectId, 'FIREBASE_PROJECT_ID');
    if (!allowedFirebaseUids.size) required(undefined, 'MCP_ALLOWED_FIREBASE_UIDS (one or more Firebase UIDs)');
    if (!allowedRepos.size) required(undefined, 'GITHUB_ALLOWED_REPOS (one or more owner/repo entries)');
    if (!allowedHosts.size) required(undefined, 'MCP_ALLOWED_HOSTS');
  }
  if (isProduction && transport === 'http' && (!redisRestUrl || !redisRestToken)) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for distributed production rate limiting.');
  }
  if (Boolean(redisRestUrl) !== Boolean(redisRestToken)) {
    throw new Error('Configure both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither.');
  }
  if (firebaseProjectId && !/^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$/.test(firebaseProjectId)) {
    throw new Error('FIREBASE_PROJECT_ID has an invalid format.');
  }
  if ([...allowedRepos].some((repo) => !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo))) {
    throw new Error('GITHUB_ALLOWED_REPOS must contain exact owner/repo values.');
  }
  if ([...allowedHosts].some((host) => host.includes('*'))) {
    throw new Error('MCP_ALLOWED_HOSTS must contain exact host names; wildcards are not allowed.');
  }
  if ([...allowedOrigins].some((origin) => origin.includes('*'))) {
    throw new Error('MCP_ALLOWED_ORIGINS must contain exact origins; wildcards are not allowed.');
  }

  const appId = appIdRaw ? Number(appIdRaw) : undefined;
  const appInstallationId = appInstallationRaw ? Number(appInstallationRaw) : undefined;
  if (appIdRaw && (!Number.isSafeInteger(appId) || (appId as number) <= 0)) throw new Error('GITHUB_APP_ID must be a positive integer.');
  if (appInstallationRaw && (!Number.isSafeInteger(appInstallationId) || (appInstallationId as number) <= 0)) throw new Error('GITHUB_APP_INSTALLATION_ID must be a positive integer.');

  return {
    transport,
    host: env.HOST?.trim() || (transport === 'stdio' ? '127.0.0.1' : '0.0.0.0'),
    port: intEnv(env.PORT, 8080, 1, 65535, 'PORT'),
    githubToken: pat,
    githubAppId: appId,
    githubAppPrivateKey: appKeyRaw?.replace(/\\n/g, '\n'),
    githubAppInstallationId: appInstallationId,
    githubAuthMode: pat ? 'pat' : 'app',
    allowedRepos,
    allowedFirebaseUids,
    firebaseProjectId,
    firebaseServiceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || undefined,
    allowedHosts,
    allowedOrigins,
    maxBodyBytes: intEnv(env.MCP_MAX_BODY_BYTES, 1024 * 1024, 1024, 10 * 1024 * 1024, 'MCP_MAX_BODY_BYTES'),
    maxSessions: intEnv(env.MCP_MAX_SESSIONS, 250, 1, 10000, 'MCP_MAX_SESSIONS'),
    sessionTtlMs: intEnv(env.MCP_SESSION_TTL_MS, 30 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000, 'MCP_SESSION_TTL_MS'),
    rateLimitPerMinute: intEnv(env.MCP_RATE_LIMIT_PER_MINUTE, 120, 10, 10000, 'MCP_RATE_LIMIT_PER_MINUTE'),
    redisRestUrl,
    redisRestToken,
    githubRequestTimeoutMs: intEnv(env.GITHUB_REQUEST_TIMEOUT_MS, 12_000, 1000, 120_000, 'GITHUB_REQUEST_TIMEOUT_MS'),
    githubReadRetries: intEnv(env.GITHUB_READ_RETRIES, 2, 0, 5, 'GITHUB_READ_RETRIES'),
    nodeEnv: env.NODE_ENV || 'development',
  };
}
