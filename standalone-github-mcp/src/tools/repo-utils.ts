import { GitHubToolError, validateRepoPath } from '../github.js';

export { validateRepoPath };

export function requiredApprovalTarget(owner: string, repo: string, suffix = ''): string {
  return `${owner}/${repo}${suffix}`;
}

export function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new GitHubToolError(`${label} must be a positive integer.`, 'INVALID_ARGUMENT');
  return value;
}
