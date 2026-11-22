import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import type { RuntimeConfig } from './config.js';

export type OctokitLike = any;

export class GitHubToolError extends Error {
  constructor(
    message: string,
    readonly code = 'GITHUB_API_ERROR',
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'GitHubToolError';
  }
}

export function createOctokit(config: RuntimeConfig): OctokitLike {
  const common = {
    userAgent: 'cue-github-mcp/1.0',
    request: { timeout: config.githubRequestTimeoutMs },
  };
  if (config.githubAuthMode === 'pat' && config.githubToken) {
    return new Octokit({ ...common, auth: config.githubToken });
  }
  if (config.githubAppId && config.githubAppPrivateKey && config.githubAppInstallationId) {
    return new Octokit({
      ...common,
      authStrategy: createAppAuth,
      auth: {
        appId: config.githubAppId,
        privateKey: config.githubAppPrivateKey,
        installationId: config.githubAppInstallationId,
      },
    });
  }
  throw new Error('GitHub authentication is not configured.');
}

export function assertAllowedRepo(owner: string, repo: string, config: RuntimeConfig): string {
  const fullName = `${owner}/${repo}`;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new GitHubToolError('Repository must be specified as a valid owner/repo pair.', 'INVALID_REPOSITORY');
  }
  if (config.allowedRepos.size && !config.allowedRepos.has(fullName.toLowerCase())) {
    throw new GitHubToolError(`Repository ${fullName} is outside the configured repository allowlist.`, 'REPOSITORY_NOT_ALLOWED');
  }
  return fullName;
}

export function assertAllowedFullName(fullName: string, config: RuntimeConfig): string {
  const [owner, repo, extra] = fullName.split('/');
  if (!owner || !repo || extra) throw new GitHubToolError('Repository must be specified as owner/repo.', 'INVALID_REPOSITORY');
  return assertAllowedRepo(owner, repo, config);
}

export function validateRepoPath(path: string): string {
  if (typeof path !== 'string' || path.length < 1 || path.length > 500) {
    throw new GitHubToolError('Repository path must contain 1–500 characters.', 'INVALID_PATH');
  }
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.')) {
    throw new GitHubToolError('Repository paths must be relative and cannot contain traversal segments.', 'INVALID_PATH');
  }
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new GitHubToolError('Repository path contains unsupported control characters.', 'INVALID_PATH');
  return path;
}

function responseStatus(error: any): number | undefined {
  return Number.isFinite(error?.status) ? Number(error.status) : undefined;
}
function retryAfter(error: any): number | undefined {
  const headers = error?.response?.headers || {};
  const headerSeconds = Number(headers['retry-after']);
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return headerSeconds;
  const reset = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset - Math.floor(Date.now() / 1000));
  return undefined;
}
function isRateLimit(error: any): boolean {
  const headers = error?.response?.headers || {};
  return responseStatus(error) === 429 || (responseStatus(error) === 403 && (headers['x-ratelimit-remaining'] === '0' || /secondary rate limit|rate limit exceeded/i.test(String(error?.message || ''))));
}
function sanitizeErrorText(value: string): string {
  return value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s?]+\?[^\s]+/g, '[REDACTED_URL]')
    .slice(0, 500);
}

export async function githubRequest(
  operation: () => Promise<any>,
  options: { retries?: number; retryable?: boolean } = {},
): Promise<any> {
  const retries = options.retryable === false ? 0 : Math.max(0, options.retries ?? 2);
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      const status = responseStatus(error);
      const retryableStatus = status === 429 || (status !== undefined && status >= 500 && status <= 599) || isRateLimit(error);
      if (!retryableStatus || attempt >= retries) {
        const wait = retryAfter(error);
        const message = isRateLimit(error)
          ? `GitHub rate limit reached${wait === undefined ? '' : `; retry after approximately ${Math.max(1, Math.ceil(wait))} seconds`}.`
          : status === 401
            ? 'GitHub rejected the configured credential (401). Check its validity and permissions.'
            : status === 403
              ? 'GitHub denied this operation (403). Check repository access and token permissions.'
              : status === 404
                ? 'GitHub resource was not found or is not accessible to the configured credential (404).'
                : status === 409
                  ? 'GitHub reported a conflict (409); refresh the target state and retry.'
                  : status
                    ? `GitHub API request failed with HTTP ${status}: ${sanitizeErrorText(String(error?.message || 'request failed'))}`
                    : sanitizeErrorText(String(error?.message || 'GitHub API request failed.'));
        throw new GitHubToolError(message, isRateLimit(error) ? 'GITHUB_RATE_LIMITED' : status ? `GITHUB_HTTP_${status}` : 'GITHUB_API_ERROR', wait);
      }
      const suggested = retryAfter(error);
      const delayMs = Math.min(15_000, suggested === undefined ? 250 * (2 ** attempt) + Math.floor(Math.random() * 150) : suggested * 1000);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
}

export function readTextFileContent(data: any, maxChars: number): { content: string; sha: string; size: number; truncated: boolean } {
  if (Array.isArray(data) || data?.type !== 'file') {
    throw new GitHubToolError('The requested path is not a single file.', 'NOT_A_FILE');
  }
  if (data.size > 1_000_000) throw new GitHubToolError('Files larger than 1 MB are not supported by this text-reading tool.', 'FILE_TOO_LARGE');
  let content: string;
  if (data.encoding === 'base64' && typeof data.content === 'string') {
    content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  } else if (data.download_url) {
    throw new GitHubToolError('This file requires the raw download endpoint and is not available through the bounded content response.', 'FILE_CONTENT_UNAVAILABLE');
  } else {
    throw new GitHubToolError('GitHub did not return readable base64 file content.', 'FILE_CONTENT_UNAVAILABLE');
  }
  if (content.includes('\u0000')) throw new GitHubToolError('Binary files are not supported by this text-reading tool.', 'BINARY_FILE');
  const truncated = content.length > maxChars;
  return { content: truncated ? content.slice(0, maxChars) : content, sha: data.sha, size: data.size ?? Buffer.byteLength(content), truncated };
}
