import { z } from 'zod';
import type { RuntimeConfig } from '../config.js';
import { assertAllowedFullName, assertAllowedRepo, githubRequest, GitHubToolError } from '../github.js';
import { approvalPhraseSchema, asText, repoShape, requireApproval, withToolErrors } from './common.js';

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

export function registerRepositoryTools(server: any, octokit: any, config: RuntimeConfig) {
  server.registerTool('github_search_repositories', {
    title: 'Search GitHub repositories',
    description: 'Search repository metadata visible on GitHub. Read-only. Use exact owner/repo scope when known; results are filtered to the configured allowlist in hosted mode.',
    inputSchema: {
      query: z.string().min(1).max(256).describe('GitHub repository search query.'),
      page: z.number().int().min(1).max(1000).default(1),
      perPage: z.number().int().min(1).max(100).default(20),
    },
    annotations: readAnnotations,
  }, withToolErrors(async ({ query, page, perPage }) => {
    const { data } = await githubRequest(() => octokit.rest.search.repos({ q: query, page, per_page: perPage }), { retries: config.githubReadRetries });
    const items = data.items.filter((item: any) => config.allowedRepos.size === 0 || config.allowedRepos.has(String(item.full_name).toLowerCase()));
    return { ...(config.allowedRepos.size === 0 ? { totalCount: data.total_count, incompleteResults: data.incomplete_results } : {}), items: items.map((item: any) => ({ fullName: item.full_name, description: item.description, private: item.private, defaultBranch: item.default_branch, stars: item.stargazers_count, language: item.language, updatedAt: item.updated_at, htmlUrl: item.html_url })) };
  }));

  server.registerTool('github_list_my_repositories', {
    title: 'List authenticated GitHub repositories',
    description: 'List repositories accessible to the configured GitHub identity. Hosted results are restricted to the exact server allowlist.',
    inputSchema: {
      visibility: z.enum(['all', 'public', 'private']).default('all'),
      affiliation: z.string().default('owner,collaborator,organization_member').refine((value) => value.split(',').every((item) => ['owner', 'collaborator', 'organization_member'].includes(item)), 'Use comma-separated owner, collaborator, and/or organization_member values.'),
      sort: z.enum(['created', 'updated', 'pushed', 'full_name']).default('updated'),
      direction: z.enum(['asc', 'desc']).default('desc'),
      page: z.number().int().min(1).max(1000).default(1),
      perPage: z.number().int().min(1).max(100).default(30),
    },
    annotations: readAnnotations,
  }, withToolErrors(async ({ visibility, affiliation, sort, direction, page, perPage }) => {
    const { data } = await githubRequest(() => octokit.rest.repos.listForAuthenticatedUser({ visibility, affiliation, sort, direction, page, per_page: perPage }), { retries: config.githubReadRetries });
    const items = data.filter((repo: any) => config.allowedRepos.size === 0 || config.allowedRepos.has(String(repo.full_name).toLowerCase()));
    return items.map((repo: any) => ({ fullName: repo.full_name, description: repo.description, private: repo.private, defaultBranch: repo.default_branch, stars: repo.stargazers_count, forks: repo.forks_count, openIssues: repo.open_issues_count, permissions: repo.permissions, updatedAt: repo.updated_at, htmlUrl: repo.html_url }));
  }));

  server.registerTool('github_get_repository', {
    title: 'Get GitHub repository information',
    description: 'Read metadata and permission information for an allowed repository.',
    inputSchema: repoShape,
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.repos.get({ owner, repo }), { retries: config.githubReadRetries });
    return { fullName: data.full_name, description: data.description, private: data.private, defaultBranch: data.default_branch, visibility: data.visibility, archived: data.archived, permissions: data.permissions, htmlUrl: data.html_url, createdAt: data.created_at, updatedAt: data.updated_at, pushedAt: data.pushed_at, topics: data.topics, license: data.license?.spdx_id };
  }));

  server.registerTool('github_create_repository', {
    title: 'Create GitHub repository (approval required)',
    description: 'Create a repository under the authenticated PAT user. Requires a fine-grained/personal token; GitHub App installation credentials cannot create personal repositories. In hosted mode, pre-add the exact owner/name to GITHUB_ALLOWED_REPOS. Show the exact name, visibility, description, and initialization choice before user approval.',
    inputSchema: {
      name: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
      description: z.string().max(350).default(''),
      visibility: z.enum(['private', 'public']).default('private'),
      autoInit: z.boolean().default(false),
      approvalPhrase: approvalPhraseSchema,
    },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ name, description, visibility, autoInit, approvalPhrase }) => {
    if (config.githubAuthMode !== 'pat') throw new GitHubToolError('Repository creation is supported only for PAT credentials, not GitHub App installation credentials.', 'UNSUPPORTED_AUTH_METHOD');
    const { data: user } = await githubRequest(() => octokit.rest.users.getAuthenticated(), { retries: config.githubReadRetries });
    const fullName = `${user.login}/${name}`;
    assertAllowedFullName(fullName, config);
    const args = { name, description, visibility, autoInit };
    requireApproval('github_create_repository', fullName, args, approvalPhrase);
    const { data } = await githubRequest(() => octokit.rest.repos.createForAuthenticatedUser({ name, description, private: visibility === 'private', auto_init: autoInit }), { retryable: false });
    return { fullName: data.full_name, private: data.private, defaultBranch: data.default_branch, htmlUrl: data.html_url, createdAt: data.created_at };
  }));

  server.registerTool('github_fork_repository', {
    title: 'Fork GitHub repository (approval required)',
    description: 'Fork an allowed repository to the authenticated GitHub identity. Show the source repository and requested target organization before approval.',
    inputSchema: { ...repoShape, organization: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).optional(), approvalPhrase: approvalPhraseSchema },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, organization, approvalPhrase }) => {
    assertAllowedRepo(owner, repo, config);
    let targetOwner = organization;
    if (!targetOwner) {
      if (config.githubAuthMode !== 'pat') throw new GitHubToolError('For GitHub App credentials, specify an allowlisted organization as the fork target.', 'FORK_TARGET_REQUIRED');
      const { data: user } = await githubRequest(() => octokit.rest.users.getAuthenticated(), { retries: config.githubReadRetries });
      targetOwner = user.login;
    }
    const targetFullName = `${targetOwner}/${repo}`;
    assertAllowedFullName(targetFullName, config);
    const args = { owner, repo, organization: organization || '' };
    requireApproval('github_fork_repository', `${owner}/${repo} -> ${targetFullName}`, args, approvalPhrase);
    const { data } = await githubRequest(() => octokit.rest.repos.createFork({ owner, repo, ...(organization ? { organization } : {}) }), { retryable: false });
    if (String(data.full_name).toLowerCase() !== targetFullName.toLowerCase()) throw new GitHubToolError('GitHub created the fork under an unexpected owner; verify the returned repository before further use.', 'FORK_TARGET_MISMATCH');
    return { fullName: data.full_name, htmlUrl: data.html_url, createdAt: data.created_at };
  }));

  server.registerTool('github_archive_repository', {
    title: 'Archive GitHub repository (approval required)',
    description: 'Archive an allowed repository. This is destructive and makes the repository read-only. Requires GitHub admin permission. Show the repository name and consequence before approval.',
    inputSchema: { ...repoShape, approvalPhrase: approvalPhraseSchema },
    annotations: destructiveAnnotations,
  }, withToolErrors(async ({ owner, repo, approvalPhrase }) => {
    assertAllowedRepo(owner, repo, config);
    const args = { owner, repo };
    requireApproval('github_archive_repository', `${owner}/${repo}`, args, approvalPhrase);
    const { data: current } = await githubRequest(() => octokit.rest.repos.get({ owner, repo }), { retries: config.githubReadRetries });
    if (current.permissions?.admin !== true) throw new GitHubToolError('Archiving requires admin access to the repository.', 'ADMIN_PERMISSION_REQUIRED');
    const { data } = await githubRequest(() => octokit.rest.repos.update({ owner, repo, archived: true }), { retryable: false });
    return { fullName: data.full_name, archived: data.archived, htmlUrl: data.html_url };
  }));
}
