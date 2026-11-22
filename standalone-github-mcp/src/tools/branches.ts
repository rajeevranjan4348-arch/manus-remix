import { z } from 'zod';
import type { RuntimeConfig } from '../config.js';
import { assertAllowedRepo, githubRequest, GitHubToolError } from '../github.js';
import { approvalPhraseSchema, requireApproval, withToolErrors } from './common.js';

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const repoShape = {
  owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  repo: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
};
function validateBranchName(name: string): string {
  const branch = name.replace(/^refs\/heads\//, '');
  if (!branch || branch.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.') || branch.includes('@{') || branch.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    throw new GitHubToolError('Branch name is invalid under Git ref naming rules.', 'INVALID_BRANCH');
  }
  return branch;
}

export function registerBranchTools(server: any, octokit: any, config: RuntimeConfig) {
  server.registerTool('github_list_branches', {
    title: 'List GitHub branches',
    description: 'List branches for an allowed repository with commit summary and pagination.',
    inputSchema: { ...repoShape, protectedOnly: z.boolean().optional(), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(30) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, protectedOnly, page, perPage }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.repos.listBranches({ owner, repo, protected: protectedOnly, page, per_page: perPage }), { retries: config.githubReadRetries });
    return data.map((branch: any) => ({ name: branch.name, protected: branch.protected, commitSha: branch.commit?.sha, commitUrl: branch.commit?.url }));
  }));

  server.registerTool('github_create_branch', {
    title: 'Create GitHub branch (approval required)',
    description: 'Create a branch from a branch, tag, or commit SHA in an allowed repository. Show the new branch name and source ref before explicit approval.',
    inputSchema: { ...repoShape, branchName: z.string().min(1).max(240), sourceRef: z.string().min(1).max(255), approvalPhrase: approvalPhraseSchema },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, branchName, sourceRef, approvalPhrase }) => {
    assertAllowedRepo(owner, repo, config);
    const validBranch = validateBranchName(branchName);
    const args = { owner, repo, branchName: validBranch, sourceRef };
    requireApproval('github_create_branch', `${owner}/${repo}:${validBranch} <- ${sourceRef}`, args, approvalPhrase);
    const { data: source } = await githubRequest(() => octokit.rest.git.getRef({ owner, repo, ref: sourceRef.startsWith('refs/') ? sourceRef.replace(/^refs\//, '') : `heads/${sourceRef}` }), { retries: config.githubReadRetries });
    const { data } = await githubRequest(() => octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${validBranch}`, sha: source.object.sha }), { retryable: false });
    return { branch: data.ref.replace(/^refs\/heads\//, ''), commitSha: data.object.sha, url: data.url };
  }));

  server.registerTool('github_compare_branches', {
    title: 'Compare GitHub branches',
    description: 'Compare a base and head ref and return commits plus changed-file summaries. Uses GitHub compare semantics (base...head).',
    inputSchema: { ...repoShape, baseRef: z.string().min(1).max(255), headRef: z.string().min(1).max(255), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(50) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, baseRef, headRef, page, perPage }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${baseRef}...${headRef}`, page, per_page: perPage }), { retries: config.githubReadRetries });
    return { status: data.status, aheadBy: data.ahead_by, behindBy: data.behind_by, baseCommit: data.base_commit?.sha, mergeBase: data.merge_base_commit?.sha, totalCommits: data.total_commits, commits: (data.commits || []).map((commit: any) => ({ sha: commit.sha, message: commit.commit?.message, author: commit.author?.login || commit.commit?.author?.name, date: commit.commit?.author?.date, htmlUrl: commit.html_url })), files: (data.files || []).map((file: any) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes, patch: typeof file.patch === 'string' ? file.patch.slice(0, 10000) : undefined })) };
  }));

  server.registerTool('github_list_commits', {
    title: 'List GitHub commits',
    description: 'List commits on a branch/ref, optionally restricted to a path. Read-only.',
    inputSchema: { ...repoShape, ref: z.string().max(255).optional(), path: z.string().max(500).optional(), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(30) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, ref, path, page, perPage }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.repos.listCommits({ owner, repo, sha: ref, path, page, per_page: perPage }), { retries: config.githubReadRetries });
    return data.map((commit: any) => ({ sha: commit.sha, message: commit.commit?.message, author: commit.author?.login || commit.commit?.author?.name, date: commit.commit?.author?.date, htmlUrl: commit.html_url }));
  }));

  server.registerTool('github_get_commit', {
    title: 'Inspect GitHub commit',
    description: 'Read commit metadata and bounded changed-file summaries from an allowed repository.',
    inputSchema: { ...repoShape, ref: z.string().min(1).max(255), maxFiles: z.number().int().min(1).max(100).default(50) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, ref, maxFiles }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.repos.getCommit({ owner, repo, ref }), { retries: config.githubReadRetries });
    const files = (data.files || []).slice(0, maxFiles).map((file: any) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes, patch: typeof file.patch === 'string' ? file.patch.slice(0, 10000) : undefined }));
    return { sha: data.sha, htmlUrl: data.html_url, message: data.commit?.message, author: data.author?.login || data.commit?.author?.name, date: data.commit?.author?.date, parents: (data.parents || []).map((parent: any) => parent.sha), files, filesTruncated: (data.files || []).length > files.length };
  }));
}
