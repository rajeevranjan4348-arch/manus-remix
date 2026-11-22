import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalPhraseFor } from '../src/tools/common.js';
import { testConfig, createTestClient, parseToolText } from './fixtures.js';

const repositoryData = {
  full_name: 'owner/repo',
  description: 'A test repository',
  private: true,
  default_branch: 'main',
  visibility: 'private',
  archived: false,
  permissions: { pull: true, push: true, admin: true },
  html_url: 'https://github.com/owner/repo',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  pushed_at: '2024-01-02T00:00:00Z',
  topics: [],
  license: null,
};

test('MCP initialization and tool discovery expose all documented GitHub capabilities', async () => {
  const harness = await createTestClient(testConfig(), { rest: {} });
  try {
    const { tools } = await harness.client.listTools();
    const names = tools.map((tool) => tool.name);
    const required = [
      'github_search_repositories', 'github_list_my_repositories', 'github_get_repository', 'github_create_repository', 'github_fork_repository', 'github_archive_repository',
      'github_browse_repository', 'github_read_file', 'github_search_code', 'github_create_file', 'github_update_file', 'github_delete_file', 'github_compare_file_changes', 'github_analyze_repository_structure',
      'github_list_branches', 'github_create_branch', 'github_compare_branches', 'github_list_commits', 'github_get_commit',
      'github_list_issues', 'github_search_issues', 'github_create_issue', 'github_get_issue', 'github_list_issue_comments',
      'github_create_pull_request', 'github_review_pull_request', 'github_read_pull_request_diff', 'github_add_review_comment',
      'github_list_workflow_runs', 'github_get_workflow_run', 'github_get_workflow_logs', 'github_monitor_failed_workflows', 'github_trigger_workflow',
    ];
    assert.equal(names.length, required.length);
    for (const name of required) assert.ok(names.includes(name), `Missing tool ${name}`);
    assert.ok(tools.every((tool) => tool.inputSchema && tool.description));
  } finally {
    await harness.close();
  }
});

test('MCP read call reaches mocked Octokit and repository allowlists block other repositories before API access', async () => {
  let getCalls = 0;
  const harness = await createTestClient(testConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo' }), {
    rest: { repos: { get: async () => { getCalls += 1; return { data: repositoryData }; } } },
  });
  try {
    const result = await harness.client.callTool({ name: 'github_get_repository', arguments: { owner: 'owner', repo: 'repo' } });
    assert.notEqual(result.isError, true);
    assert.equal(parseToolText(result).fullName, 'owner/repo');
    assert.equal(getCalls, 1);

    const denied = await harness.client.callTool({ name: 'github_get_repository', arguments: { owner: 'owner', repo: 'secret' } });
    assert.equal(denied.isError, true);
    assert.equal(getCalls, 1);
  } finally {
    await harness.close();
  }
});

test('MCP read tools honor the configured retry count', async () => {
  let calls = 0;
  const harness = await createTestClient(testConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo', GITHUB_READ_RETRIES: '0' }), {
    rest: { repos: { get: async () => { calls += 1; throw Object.assign(new Error('temporary upstream failure'), { status: 503 }); } } },
  });
  try {
    const result = await harness.client.callTool({ name: 'github_get_repository', arguments: { owner: 'owner', repo: 'repo' } });
    assert.equal(result.isError, true);
    assert.equal(calls, 1);
  } finally {
    await harness.close();
  }
});

test('MCP rejects path traversal before any GitHub content request', async () => {
  let contentCalls = 0;
  const harness = await createTestClient(testConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo' }), {
    rest: { repos: { getContent: async () => { contentCalls += 1; return { data: {} }; } } },
  });
  try {
    const result = await harness.client.callTool({ name: 'github_read_file', arguments: { owner: 'owner', repo: 'repo', path: '../private-key' } });
    assert.equal(result.isError, true);
    assert.equal(parseToolText(result).code, 'INVALID_PATH');
    assert.equal(contentCalls, 0);
  } finally {
    await harness.close();
  }
});

test('MCP write tool refuses missing approval and performs no GitHub write', async () => {
  let writes = 0;
  const harness = await createTestClient(testConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo' }), {
    rest: { issues: { create: async () => { writes += 1; return { data: {} }; } } },
  });
  try {
    const result = await harness.client.callTool({ name: 'github_create_issue', arguments: { owner: 'owner', repo: 'repo', title: 'Bug report' } });
    assert.equal(result.isError, true);
    assert.equal(parseToolText(result).code, 'USER_APPROVAL_REQUIRED');
    assert.equal(writes, 0);
  } finally {
    await harness.close();
  }
});

test('hosted repository search filters results and suppresses cross-allowlist counts', async () => {
  const harness = await createTestClient(testConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo' }), {
    rest: {
      search: {
        repos: async () => ({ data: {
          total_count: 47,
          incomplete_results: false,
          items: [
            { full_name: 'owner/repo', description: 'visible', private: true, default_branch: 'main', stargazers_count: 1, language: 'TypeScript', updated_at: '2024-01-01', html_url: 'https://github.com/owner/repo' },
            { full_name: 'another/private', description: 'hidden', private: true, default_branch: 'main', stargazers_count: 99, language: 'Go', updated_at: '2024-01-01', html_url: 'https://github.com/another/private' },
          ],
        } }),
      },
    },
  });
  try {
    const result = await harness.client.callTool({ name: 'github_search_repositories', arguments: { query: 'test' } });
    const payload = parseToolText(result);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].fullName, 'owner/repo');
    assert.equal('totalCount' in payload, false);
    assert.equal('incompleteResults' in payload, false);
  } finally {
    await harness.close();
  }
});

test('MCP file creation uses a Git ref compare-and-swap instead of the overwrite-capable contents endpoint', async () => {
  const calls: Array<{ name: string; arguments_: any }> = [];
  const api = {
    rest: {
      repos: {
        get: async () => ({ data: { permissions: { push: true, admin: false } } }),
        createOrUpdateFileContents: async () => { throw new Error('Unsafe contents endpoint must not be used.'); },
      },
      git: {
        getRef: async (arguments_: any) => { calls.push({ name: 'getRef', arguments_ }); return { data: { object: { sha: 'old-head' } } }; },
        getCommit: async () => ({ data: { tree: { sha: 'root-tree' } } }),
        getTree: async () => ({ data: { tree: [] } }),
        createBlob: async (arguments_: any) => { calls.push({ name: 'createBlob', arguments_ }); return { data: { sha: 'new-blob' } }; },
        createTree: async (arguments_: any) => { calls.push({ name: 'createTree', arguments_ }); return { data: { sha: 'new-tree' } }; },
        createCommit: async (arguments_: any) => { calls.push({ name: 'createCommit', arguments_ }); return { data: { sha: 'new-commit' } }; },
        updateRef: async (arguments_: any) => { calls.push({ name: 'updateRef', arguments_ }); return { data: { ref: 'refs/heads/main' } }; },
      },
    },
  };
  const harness = await createTestClient(testConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo' }), api);
  const input = { owner: 'owner', repo: 'repo', path: 'new.txt', content: 'hello', message: 'Add new file', branch: 'main' };
  const phrase = approvalPhraseFor('github_create_file', 'owner/repo:new.txt@main', input);
  try {
    const result = await harness.client.callTool({ name: 'github_create_file', arguments: { ...input, approvalPhrase: phrase } });
    assert.notEqual(result.isError, true);
    assert.equal(parseToolText(result).operation, 'created');
    const update = calls.find((call) => call.name === 'updateRef');
    assert.ok(update);
    assert.equal(update.arguments_.force, false);
    assert.equal(update.arguments_.sha, 'new-commit');
    assert.equal(calls.find((call) => call.name === 'createTree')?.arguments_.tree[0].path, 'new.txt');
  } finally {
    await harness.close();
  }
});

test('MCP file creation refuses an existing path before creating Git objects', async () => {
  let objectWrites = 0;
  const api = {
    rest: {
      repos: { get: async () => ({ data: { permissions: { push: true } } }) },
      git: {
        getRef: async () => ({ data: { object: { sha: 'old-head' } } }),
        getCommit: async () => ({ data: { tree: { sha: 'root-tree' } } }),
        getTree: async () => ({ data: { tree: [{ path: 'new.txt', type: 'blob', sha: 'existing-blob' }] } }),
        createBlob: async () => { objectWrites += 1; return { data: { sha: 'new-blob' } }; },
      },
    },
  };
  const harness = await createTestClient(testConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo' }), api);
  const input = { owner: 'owner', repo: 'repo', path: 'new.txt', content: 'hello', message: 'Add new file', branch: 'main' };
  const phrase = approvalPhraseFor('github_create_file', 'owner/repo:new.txt@main', input);
  try {
    const result = await harness.client.callTool({ name: 'github_create_file', arguments: { ...input, approvalPhrase: phrase } });
    assert.equal(result.isError, true);
    assert.equal(parseToolText(result).code, 'FILE_ALREADY_EXISTS');
    assert.equal(objectWrites, 0);
  } finally {
    await harness.close();
  }
});
