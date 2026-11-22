import type { RuntimeConfig } from './config.js';

export function healthPayload(config: RuntimeConfig) {
  return {
    ok: true,
    service: 'cue-github-mcp',
    generatedAt: new Date().toISOString(),
    configuration: {
      transport: config.transport,
      githubAuthConfigured: config.githubAuthMode === 'pat' ? Boolean(config.githubToken) : Boolean(config.githubAppId && config.githubAppInstallationId),
      repositoryAllowlistConfigured: config.allowedRepos.size > 0,
      firebaseAuthConfigured: Boolean(config.firebaseProjectId),
      distributedRateLimitConfigured: Boolean(config.redisRestUrl && config.redisRestToken),
    },
  };
}
