import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import type { RuntimeConfig } from '../config.js';
import { assertAllowedRepo, githubRequest, GitHubToolError, readTextFileContent, validateRepoPath } from '../github.js';
import { registerWriteTool, requireApproval, withToolErrors } from './common.js';
import { assertPositiveInteger } from './repo-utils.js';

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
const repoShape = {
  owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  repo: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
};

async function getContent(octokit: any, owner: string, repo: string, path: string, ref?: string, readRetries = 2) {
  return githubRequest(() => octokit.rest.repos.getContent({ owner, repo, path, ...(ref ? { ref } : {}) }), { retries: readRetries });
}
async function readTextAtRef(octokit: any, owner: string, repo: string, path: string, ref: string, readRetries = 2): Promise<{ content: string; sha: string }> {
  try {
    const result = await getContent(octokit, owner, repo, path, ref, readRetries);
    const parsed = readTextFileContent(result.data, 1_000_000);
    return { content: parsed.content, sha: parsed.sha };
  } catch (error: any) {
    if (error?.status === 404 || error?.code === 'GITHUB_HTTP_404') return { content: '', sha: '' };
    throw error;
  }
}
async function assertCanPush(octokit: any, owner: string, repo: string, readRetries = 2) {
  const { data } = await githubRequest(() => octokit.rest.repos.get({ owner, repo }), { retries: readRetries });
  if (data.permissions && data.permissions.push === false && data.permissions.admin !== true) {
    throw new GitHubToolError('The configured GitHub identity does not have push access to this repository.', 'PUSH_PERMISSION_REQUIRED');
  }
  return data;
}

async function assertPathAbsent(octokit: any, owner: string, repo: string, rootTreeSha: string, path: string, readRetries = 2) {
  const parts = path.split('/');
  let treeSha = rootTreeSha;
  for (let index = 0; index < parts.length; index += 1) {
    const { data } = await githubRequest(() => octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha }), { retries: readRetries });
    const entry = (data.tree || []).find((item: any) => item.path === parts[index]);
    if (!entry) return;
    if (index === parts.length - 1) throw new GitHubToolError('This path already exists. Use github_update_file with its current SHA instead of overwriting it.', 'FILE_ALREADY_EXISTS');
    if (entry.type !== 'tree') throw new GitHubToolError('A parent path exists but is not a directory.', 'PATH_PARENT_NOT_DIRECTORY');
    treeSha = entry.sha;
  }
}

async function createFileWithRefGuard(octokit: any, owner: string, repo: string, path: string, content: string, message: string, branch: string, readRetries = 2) {
  const branchName = branch.replace(/^refs\/heads\//, '');
  const { data: branchRef } = await githubRequest(() => octokit.rest.git.getRef({ owner, repo, ref: `heads/${branchName}` }), { retries: readRetries });
  const expectedHeadSha = branchRef.object.sha;
  const { data: headCommit } = await githubRequest(() => octokit.rest.git.getCommit({ owner, repo, commit_sha: expectedHeadSha }), { retries: readRetries });
  const rootTreeSha = headCommit.tree.sha;
  await assertPathAbsent(octokit, owner, repo, rootTreeSha, path, readRetries);
  const { data: blob } = await githubRequest(() => octokit.rest.git.createBlob({ owner, repo, content, encoding: 'utf-8' }), { retryable: false });
  const { data: tree } = await githubRequest(() => octokit.rest.git.createTree({ owner, repo, base_tree: rootTreeSha, tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] }), { retryable: false });
  const { data: commit } = await githubRequest(() => octokit.rest.git.createCommit({ owner, repo, message, tree: tree.sha, parents: [expectedHeadSha] }), { retryable: false });
  const { data: updatedRef } = await githubRequest(() => octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branchName}`, sha: commit.sha, force: false }), { retryable: false });
  return { commitSha: commit.sha, commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`, branch: updatedRef.ref.replace(/^refs\/heads\//, '') };
}

async function getBoundedTree(octokit: any, owner: string, repo: string, rootTreeSha: string, maxEntries: number, readRetries: number) {
  const entries: any[] = [];
  const pending: Array<{ sha: string; prefix: string; depth: number }> = [{ sha: rootTreeSha, prefix: '', depth: 0 }];
  let truncated = false;
  let treeRequests = 0;
  while (pending.length && entries.length < maxEntries && treeRequests < 32) {
    const current = pending.shift()!;
    treeRequests += 1;
    const { data } = await githubRequest(() => octokit.rest.git.getTree({ owner, repo, tree_sha: current.sha }), { retries: readRetries });
    if (data.truncated) truncated = true;
    for (const item of data.tree || []) {
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      const path = current.prefix ? `${current.prefix}/${item.path}` : String(item.path);
      const entry = { ...item, path };
      entries.push(entry);
      if (entry.type === 'tree') {
        if (current.depth < 8) pending.push({ sha: entry.sha, prefix: path, depth: current.depth + 1 });
        else truncated = true;
      }
    }
  }
  if (pending.length) truncated = true;
  return { entries, truncated, treeRequests };
}

export function registerFileTools(server: any, octokit: any, config: RuntimeConfig) {
  server.registerTool('github_browse_repository', {
    title: 'Browse GitHub repository files',
    description: 'List files and folders at a repository path/ref. Read-only. Output is bounded; use a more specific path when a directory is large.',
    inputSchema: {
      ...repoShape,
      path: z.string().max(500).default('').describe('Relative directory path; empty string means repository root.'),
      ref: z.string().max(255).optional().describe('Branch, tag, or commit; defaults to the repository default branch.'),
      maxEntries: z.number().int().min(1).max(500).default(200),
    },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, path, ref, maxEntries }) => {
    assertAllowedRepo(owner, repo, config);
    if (path) validateRepoPath(path);
    const { data } = await getContent(octokit, owner, repo, path, ref, config.githubReadRetries);
    const entries = Array.isArray(data) ? data : [data];
    const visible = entries.slice(0, maxEntries).map((item: any) => ({ name: item.name, path: item.path, type: item.type, size: item.type === 'file' ? item.size : undefined, sha: item.sha, htmlUrl: item.html_url }));
    return { repository: `${owner}/${repo}`, path, ref: ref || null, entries: visible, totalReturnedByGitHub: entries.length, truncated: entries.length > visible.length };
  }));

  server.registerTool('github_read_file', {
    title: 'Read GitHub source file',
    description: 'Read bounded UTF-8 text from a file in an allowed repository. Binary files and files larger than 1 MB are rejected. Includes the current Git blob SHA for safe updates.',
    inputSchema: { ...repoShape, path: z.string().min(1).max(500), ref: z.string().max(255).optional(), maxChars: z.number().int().min(1).max(100000).default(30000) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, path, ref, maxChars }) => {
    assertAllowedRepo(owner, repo, config);
    validateRepoPath(path);
    const { data } = await getContent(octokit, owner, repo, path, ref, config.githubReadRetries);
    const file = readTextFileContent(data, maxChars);
    return { repository: `${owner}/${repo}`, path, ref: ref || null, sha: file.sha, size: file.size, truncated: file.truncated, content: file.content };
  }));

  server.registerTool('github_search_code', {
    title: 'Search GitHub code',
    description: 'Search GitHub-indexed code. Results are limited to allowed repositories when hosted; code search may require that the token has access and GitHub has indexed the branch.',
    inputSchema: {
      query: z.string().min(1).max(256),
      repository: z.string().regex(/^[^/]+\/[^/]+$/).optional().describe('Optional exact owner/repo scope.'),
      page: z.number().int().min(1).max(1000).default(1),
      perPage: z.number().int().min(1).max(100).default(20),
    },
    annotations: readAnnotations,
  }, withToolErrors(async ({ query, repository, page, perPage }) => {
    let searchQuery = query;
    if (repository) {
      const fullName = repository.trim();
      const [owner, repo] = fullName.split('/');
      assertAllowedRepo(owner!, repo!, config);
      searchQuery += ` repo:${fullName}`;
    }
    const { data } = await githubRequest(() => octokit.rest.search.code({ q: searchQuery, page, per_page: perPage }), { retries: config.githubReadRetries });
    const items = data.items.filter((item: any) => config.allowedRepos.size === 0 || config.allowedRepos.has(String(item.repository.full_name).toLowerCase()));
    return { ...(config.allowedRepos.size === 0 ? { totalCount: data.total_count, incompleteResults: data.incomplete_results } : {}), items: items.map((item: any) => ({ name: item.name, path: item.path, repository: item.repository.full_name, htmlUrl: item.html_url, sha: item.sha })) };
  }));

  registerWriteTool(server, config, 'github_create_file', {
    title: 'Create GitHub file (approval required)',
    description: 'Create a new UTF-8 file on a branch. It refuses to overwrite an existing file. Show the repository, path, branch, commit message, and complete file contents before explicit approval.',
    inputSchema: { ...repoShape, path: z.string().min(1).max(500), content: z.string().max(100000), message: z.string().min(1).max(256), branch: z.string().min(1).max(255) },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, path, content, message, branch }) => {
    assertAllowedRepo(owner, repo, config);
    validateRepoPath(path);
    const args = { owner, repo, path, content, message, branch };
    const target = `${owner}/${repo}:${path}@${branch}`;
    await requireApproval(server, 'github_create_file', target, args);
    await assertCanPush(octokit, owner, repo, config.githubReadRetries);
    const created = await createFileWithRefGuard(octokit, owner, repo, path, content, message, branch, config.githubReadRetries);
    return { operation: 'created', path, ...created };
  }));

  registerWriteTool(server, config, 'github_update_file', {
    title: 'Update GitHub file (approval required)',
    description: 'Update an existing UTF-8 file on a branch using its current blob SHA. The server rejects stale SHA values. Show the complete proposed content and commit message before explicit approval.',
    inputSchema: { ...repoShape, path: z.string().min(1).max(500), content: z.string().max(100000), message: z.string().min(1).max(256), branch: z.string().min(1).max(255), existingSha: z.string().min(1).max(100) },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, path, content, message, branch, existingSha }) => {
    assertAllowedRepo(owner, repo, config);
    validateRepoPath(path);
    const args = { owner, repo, path, content, message, branch, existingSha };
    const target = `${owner}/${repo}:${path}@${branch}`;
    await requireApproval(server, 'github_update_file', target, args);
    await assertCanPush(octokit, owner, repo, config.githubReadRetries);
    const current = await getContent(octokit, owner, repo, path, branch, config.githubReadRetries);
    if (Array.isArray(current.data) || current.data.type !== 'file' || current.data.sha !== existingSha) {
      throw new GitHubToolError('The file SHA is stale or does not match the file at the target branch. Read the current file and request approval again.', 'STALE_FILE_SHA');
    }
    const { data } = await githubRequest(() => octokit.rest.repos.createOrUpdateFileContents({ owner, repo, path, message, content: Buffer.from(content, 'utf8').toString('base64'), branch, sha: existingSha }), { retryable: false });
    return { operation: 'updated', path, branch, commitUrl: data.commit.html_url, contentUrl: data.content?.html_url, sha: data.content?.sha };
  }));

  registerWriteTool(server, config, 'github_delete_file', {
    title: 'Delete GitHub file (approval required)',
    description: 'Delete a file from a branch. This action is destructive. Show the repository, path, branch, current contents/SHA, and commit message before explicit approval.',
    inputSchema: { ...repoShape, path: z.string().min(1).max(500), message: z.string().min(1).max(256), branch: z.string().min(1).max(255), existingSha: z.string().min(1).max(100) },
    annotations: destructiveAnnotations,
  }, withToolErrors(async ({ owner, repo, path, message, branch, existingSha }) => {
    assertAllowedRepo(owner, repo, config);
    validateRepoPath(path);
    const args = { owner, repo, path, message, branch, existingSha };
    const target = `${owner}/${repo}:${path}@${branch}`;
    await requireApproval(server, 'github_delete_file', target, args);
    await assertCanPush(octokit, owner, repo, config.githubReadRetries);
    const current = await getContent(octokit, owner, repo, path, branch, config.githubReadRetries);
    if (Array.isArray(current.data) || current.data.type !== 'file' || current.data.sha !== existingSha) {
      throw new GitHubToolError('The file SHA is stale or does not match the file at the target branch. Read the current file and request approval again.', 'STALE_FILE_SHA');
    }
    const { data } = await githubRequest(() => octokit.rest.repos.deleteFile({ owner, repo, path, message, branch, sha: existingSha }), { retryable: false });
    return { operation: 'deleted', path, branch, commitUrl: data.commit.html_url };
  }));

  server.registerTool('github_compare_file_changes', {
    title: 'Compare GitHub file changes',
    description: 'Compare a single text file between two branches, tags, or commits and return a unified diff.',
    inputSchema: { ...repoShape, path: z.string().min(1).max(500), baseRef: z.string().min(1).max(255), headRef: z.string().min(1).max(255), maxDiffChars: z.number().int().min(100).max(100000).default(30000) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, path, baseRef, headRef, maxDiffChars }) => {
    assertAllowedRepo(owner, repo, config);
    validateRepoPath(path);
    const [base, head] = await Promise.all([readTextAtRef(octokit, owner, repo, path, baseRef, config.githubReadRetries), readTextAtRef(octokit, owner, repo, path, headRef, config.githubReadRetries)]);
    if (!base.sha && !head.sha) throw new GitHubToolError('The file does not exist at either comparison ref.', 'FILE_NOT_FOUND');
    const patch = createTwoFilesPatch(`${path}@${baseRef}`, `${path}@${headRef}`, base.content, head.content, '', '', { context: 3 });
    return { repository: `${owner}/${repo}`, path, baseRef, headRef, baseSha: base.sha || null, headSha: head.sha || null, diff: patch.slice(0, maxDiffChars), truncated: patch.length > maxDiffChars };
  }));

  server.registerTool('github_analyze_repository_structure', {
    title: 'Analyze GitHub repository structure',
    description: 'Analyze the Git tree for top-level layout, common config files, extensions, and directory counts. This reads repository metadata only and never executes files or scripts.',
    inputSchema: { ...repoShape, ref: z.string().max(255).optional(), maxEntries: z.number().int().min(1).max(500).default(500) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, ref, maxEntries }) => {
    assertAllowedRepo(owner, repo, config);
    const { data: repository } = await githubRequest(() => octokit.rest.repos.get({ owner, repo }), { retries: config.githubReadRetries });
    const requestedRef = ref || repository.default_branch;
    const commitSha = /^[0-9a-f]{40}$/i.test(requestedRef)
      ? requestedRef
      : (await githubRequest(() => octokit.rest.git.getRef({ owner, repo, ref: `heads/${requestedRef.replace(/^refs\/heads\//, '')}` }), { retries: config.githubReadRetries })).data.object.sha;
    const { data: commit } = await githubRequest(() => octokit.rest.git.getCommit({ owner, repo, commit_sha: commitSha }), { retries: config.githubReadRetries });
    const treeSha = commit.tree.sha;
    const { entries: visible, truncated } = await getBoundedTree(octokit, owner, repo, treeSha, maxEntries, config.githubReadRetries);
    const directories = visible.filter((entry: any) => entry.type === 'tree');
    const files = visible.filter((entry: any) => entry.type === 'blob');
    const extensions: Record<string, number> = {};
    const rootEntries = visible.filter((entry: any) => !String(entry.path).includes('/')).map((entry: any) => ({ name: entry.path, type: entry.type, size: entry.size }));
    for (const file of files) {
      const path = String(file.path || '');
      const basename = path.split('/').pop() || path;
      const extension = basename.includes('.') ? `.${basename.split('.').pop()!.toLowerCase()}` : '[no extension]';
      extensions[extension] = (extensions[extension] || 0) + 1;
    }
    const configFiles = files.map((entry: any) => String(entry.path)).filter((path: string) => /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|Dockerfile|docker-compose\.ya?ml|tsconfig\.json|vite\.config\.[^/]+|next\.config\.[^/]+|\.github\/workflows\/[^/]+)$/i.test(path)).slice(0, 100);
    return { repository: `${owner}/${repo}`, ref: requestedRef, defaultBranch: repository.default_branch, entriesVisited: visible.length, truncated, files: files.length, directories: directories.length, rootEntries, topDirectories: directories.filter((entry: any) => !String(entry.path).includes('/')).slice(0, 100).map((entry: any) => String(entry.path)), extensions: Object.fromEntries(Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 30)), likelyConfigFiles: configFiles };
  }));
}
