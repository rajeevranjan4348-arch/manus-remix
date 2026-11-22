import { z } from 'zod';
import type { RuntimeConfig } from '../config.js';
import { assertAllowedRepo, githubRequest, GitHubToolError } from '../github.js';
import { registerWriteTool, requireApproval, withToolErrors } from './common.js';

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const repoShape = {
  owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  repo: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
};

export function registerIssueAndPullRequestTools(server: any, octokit: any, config: RuntimeConfig) {
  server.registerTool('github_list_issues', {
    title: 'List GitHub issues',
    description: 'List repository issues while excluding pull requests. Supports state, labels, sorting, and pagination.',
    inputSchema: { ...repoShape, state: z.enum(['open', 'closed', 'all']).default('open'), labels: z.array(z.string().max(50)).max(20).optional(), sort: z.enum(['created', 'updated', 'comments']).default('created'), direction: z.enum(['asc', 'desc']).default('desc'), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(30) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, state, labels, sort, direction, page, perPage }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.issues.listForRepo({ owner, repo, state, labels: labels?.join(','), sort, direction, page, per_page: perPage }), { retries: config.githubReadRetries });
    return data.filter((issue: any) => !issue.pull_request).map((issue: any) => ({ number: issue.number, title: issue.title, body: issue.body?.slice(0, 5000), state: issue.state, labels: (issue.labels || []).map((label: any) => typeof label === 'string' ? label : label.name), assignees: (issue.assignees || []).map((assignee: any) => assignee.login), author: issue.user?.login, comments: issue.comments, createdAt: issue.created_at, updatedAt: issue.updated_at, htmlUrl: issue.html_url }));
  }));

  server.registerTool('github_search_issues', {
    title: 'Search GitHub issues',
    description: 'Search issues and pull requests using GitHub search syntax. In hosted mode, results are restricted to allowed repositories.',
    inputSchema: { query: z.string().min(1).max(256), repository: z.string().regex(/^[^/]+\/[^/]+$/).optional(), state: z.enum(['open', 'closed']).optional(), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(20) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ query, repository, state, page, perPage }) => {
    let q = query;
    if (repository) {
      const [owner, repo] = repository.split('/');
      assertAllowedRepo(owner!, repo!, config);
      q += ` repo:${repository}`;
    }
    if (state) q += ` state:${state}`;
    const { data } = await githubRequest(() => octokit.rest.search.issuesAndPullRequests({ q, page, per_page: perPage }), { retries: config.githubReadRetries });
    const items = data.items.filter((item: any) => config.allowedRepos.size === 0 || config.allowedRepos.has(String(item.repository_url || '').replace('https://api.github.com/repos/', '').toLowerCase()));
    return { ...(config.allowedRepos.size === 0 ? { totalCount: data.total_count, incompleteResults: data.incomplete_results } : {}), items: items.map((item: any) => ({ number: item.number, title: item.title, state: item.state, isPullRequest: Boolean(item.pull_request), author: item.user?.login, comments: item.comments, createdAt: item.created_at, updatedAt: item.updated_at, htmlUrl: item.html_url, repositoryUrl: item.repository_url })) };
  }));

  registerWriteTool(server, config, 'github_create_issue', {
    title: 'Create GitHub issue (approval required)',
    description: 'Create an issue in an allowed repository. Show the exact repository, title, body, labels, and assignees before explicit approval.',
    inputSchema: { ...repoShape, title: z.string().min(1).max(256), body: z.string().max(60000).default(''), labels: z.array(z.string().max(50)).max(20).optional(), assignees: z.array(z.string().max(100)).max(10).optional() },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, title, body, labels, assignees }) => {
    assertAllowedRepo(owner, repo, config);
    const args = { owner, repo, title, body, labels: labels || [], assignees: assignees || [] };
    await requireApproval(server, 'github_create_issue', `${owner}/${repo}:${title}`, args);
    const { data } = await githubRequest(() => octokit.rest.issues.create({ owner, repo, title, body, labels, assignees }), { retryable: false });
    return { number: data.number, title: data.title, state: data.state, htmlUrl: data.html_url, createdAt: data.created_at };
  }));

  server.registerTool('github_get_issue', {
    title: 'Read GitHub issue details',
    description: 'Read issue metadata and body for an allowed repository.',
    inputSchema: { ...repoShape, issueNumber: z.number().int().min(1).max(1_000_000_000) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, issueNumber }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.issues.get({ owner, repo, issue_number: issueNumber }), { retries: config.githubReadRetries });
    return { number: data.number, title: data.title, body: data.body, state: data.state, labels: (data.labels || []).map((label: any) => typeof label === 'string' ? label : label.name), assignees: (data.assignees || []).map((assignee: any) => assignee.login), author: data.user?.login, comments: data.comments, createdAt: data.created_at, updatedAt: data.updated_at, closedAt: data.closed_at, htmlUrl: data.html_url, isPullRequest: Boolean(data.pull_request) };
  }));

  server.registerTool('github_list_issue_comments', {
    title: 'Read GitHub issue comments',
    description: 'List comments on an issue or pull request in an allowed repository.',
    inputSchema: { ...repoShape, issueNumber: z.number().int().min(1).max(1_000_000_000), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(50) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, issueNumber, page, perPage }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.issues.listComments({ owner, repo, issue_number: issueNumber, page, per_page: perPage }), { retries: config.githubReadRetries });
    return data.map((comment: any) => ({ id: comment.id, author: comment.user?.login, body: comment.body, createdAt: comment.created_at, updatedAt: comment.updated_at, htmlUrl: comment.html_url }));
  }));

  registerWriteTool(server, config, 'github_create_pull_request', {
    title: 'Create GitHub pull request (approval required)',
    description: 'Create a pull request between repository branches. Show the exact repository, source and target branches, title, body, and draft setting before approval.',
    inputSchema: { ...repoShape, title: z.string().min(1).max(256), head: z.string().min(1).max(255), base: z.string().min(1).max(255), body: z.string().max(60000).default(''), draft: z.boolean().default(true), maintainerCanModify: z.boolean().default(true) },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, title, head, base, body, draft, maintainerCanModify }) => {
    assertAllowedRepo(owner, repo, config);
    const args = { owner, repo, title, head, base, body, draft, maintainerCanModify };
    await requireApproval(server, 'github_create_pull_request', `${owner}/${repo}:${head}->${base}:${title}`, args);
    const { data } = await githubRequest(() => octokit.rest.pulls.create({ owner, repo, title, head, base, body, draft, maintainer_can_modify: maintainerCanModify }), { retryable: false });
    return { number: data.number, title: data.title, state: data.state, draft: data.draft, htmlUrl: data.html_url, head: data.head?.ref, base: data.base?.ref };
  }));

  registerWriteTool(server, config, 'github_review_pull_request', {
    title: 'Review GitHub pull request (approval required)',
    description: 'Submit a formal review with COMMENT, APPROVE, or REQUEST_CHANGES. This changes review state; show the full review body and event before approval.',
    inputSchema: { ...repoShape, pullNumber: z.number().int().min(1).max(1_000_000_000), event: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']), body: z.string().max(60000).default('') },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, pullNumber, event, body }) => {
    assertAllowedRepo(owner, repo, config);
    if (event !== 'COMMENT' && !body.trim()) throw new GitHubToolError('An approval or change-request review must include a non-empty explanation.', 'REVIEW_BODY_REQUIRED');
    const args = { owner, repo, pullNumber, event, body };
    await requireApproval(server, 'github_review_pull_request', `${owner}/${repo}#${pullNumber}:${event}`, args);
    const { data } = await githubRequest(() => octokit.rest.pulls.createReview({ owner, repo, pull_number: pullNumber, event, body }), { retryable: false });
    return { id: data.id, state: data.state, submittedAt: data.submitted_at, htmlUrl: data.html_url, commitId: data.commit_id };
  }));

  server.registerTool('github_read_pull_request_diff', {
    title: 'Read GitHub pull request diff',
    description: 'Read changed-file summaries and bounded unified patches for a pull request in an allowed repository.',
    inputSchema: { ...repoShape, pullNumber: z.number().int().min(1).max(1_000_000_000), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(50), maxPatchChars: z.number().int().min(100).max(20000).default(10000) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, pullNumber, page, perPage, maxPatchChars }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.pulls.listFiles({ owner, repo, pull_number: pullNumber, page, per_page: perPage }), { retries: config.githubReadRetries });
    return data.map((file: any) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes, patch: typeof file.patch === 'string' ? file.patch.slice(0, maxPatchChars) : null, patchTruncated: typeof file.patch === 'string' && file.patch.length > maxPatchChars, htmlUrl: file.blob_url }));
  }));

  registerWriteTool(server, config, 'github_add_review_comment', {
    title: 'Add inline GitHub review comment (approval required)',
    description: 'Add an inline comment to a pull request diff. Show the exact repository, PR number, file, line, side, and full comment before approval.',
    inputSchema: { ...repoShape, pullNumber: z.number().int().min(1).max(1_000_000_000), path: z.string().min(1).max(500), line: z.number().int().min(1).max(100000), side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'), body: z.string().min(1).max(60000), commitId: z.string().max(100).optional() },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, pullNumber, path, line, side, body, commitId }) => {
    assertAllowedRepo(owner, repo, config);
    const args = { owner, repo, pullNumber, path, line, side, body, commitId: commitId || '' };
    await requireApproval(server, 'github_add_review_comment', `${owner}/${repo}#${pullNumber}:${path}:${line}:${side}`, args);
    const currentCommit = commitId ? null : await githubRequest(() => octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }), { retries: config.githubReadRetries });
    const { data } = await githubRequest(() => octokit.rest.pulls.createReviewComment({ owner, repo, pull_number: pullNumber, path, line, side, body, commit_id: commitId || currentCommit?.data.head.sha }), { retryable: false });
    return { id: data.id, path: data.path, line: data.line, side: data.side, body: data.body, htmlUrl: data.html_url, createdAt: data.created_at };
  }));
}
