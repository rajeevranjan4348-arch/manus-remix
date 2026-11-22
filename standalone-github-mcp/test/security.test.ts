import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { isFirebaseUidAllowed } from '../src/auth.js';
import { readConfig } from '../src/config.js';
import { assertAllowedFullName, assertAllowedRepo, githubRequest, GitHubToolError, validateRepoPath } from '../src/github.js';
import { resetRateLimitsForTests, consumeRateLimit } from '../src/rateLimit.js';
import { sanitizeError } from '../src/tools/common.js';
import { extractBoundedWorkflowLogs } from '../src/tools/actions.js';
import { testConfig } from './fixtures.js';

const allowedRepoConfig = () => testConfig({ GITHUB_ALLOWED_REPOS: 'Team/Project' });

test('HTTP configuration fails closed without Firebase UID, repo, host, and production Redis allowlists', () => {
  const tokenEnv = { NODE_ENV: 'test', MCP_TRANSPORT: 'http', GITHUB_TOKEN: 'test-token' };
  assert.throws(() => readConfig(tokenEnv), /FIREBASE_PROJECT_ID/);
  assert.throws(() => readConfig({ ...tokenEnv, FIREBASE_PROJECT_ID: 'cue-app-project-123' }), /MCP_ALLOWED_FIREBASE_UIDS/);
  assert.throws(() => readConfig({ ...tokenEnv, FIREBASE_PROJECT_ID: 'cue-app-project-123', MCP_ALLOWED_FIREBASE_UIDS: 'uid-1' }), /GITHUB_ALLOWED_REPOS/);
  assert.throws(() => readConfig({ ...tokenEnv, FIREBASE_PROJECT_ID: 'cue-app-project-123', MCP_ALLOWED_FIREBASE_UIDS: 'uid-1', GITHUB_ALLOWED_REPOS: 'team/repo' }), /MCP_ALLOWED_HOSTS/);
  assert.throws(() => readConfig({ ...tokenEnv, NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'cue-app-project-123', MCP_ALLOWED_FIREBASE_UIDS: 'uid-1', GITHUB_ALLOWED_REPOS: 'team/repo', MCP_ALLOWED_HOSTS: 'mcp.example.com' }), /UPSTASH_REDIS/);
  assert.throws(() => readConfig({ ...tokenEnv, MCP_TRANSPORT: 'http', FIREBASE_PROJECT_ID: 'cue-app-project-123', MCP_ALLOWED_FIREBASE_UIDS: 'uid-1', GITHUB_ALLOWED_REPOS: 'team/repo', MCP_ALLOWED_HOSTS: '*.example.com' }), /wildcards/);
});

test('write tools are disabled by default and their environment switch is strict', () => {
  assert.equal(testConfig().enableWriteTools, false);
  assert.equal(testConfig({ MCP_ENABLE_WRITE_TOOLS: 'true' }).enableWriteTools, true);
  assert.equal(testConfig({ MCP_ENABLE_WRITE_TOOLS: 'false' }).enableWriteTools, false);
  assert.throws(() => testConfig({ MCP_ENABLE_WRITE_TOOLS: 'yes' }), /MCP_ENABLE_WRITE_TOOLS/);
});

test('Render assigned hostname is accepted as an exact host when no manual list is provided', () => {
  const config = readConfig({
    NODE_ENV: 'production',
    MCP_TRANSPORT: 'http',
    GITHUB_TOKEN: 'test-token',
    FIREBASE_PROJECT_ID: 'eternal-envoy-cnzsc',
    MCP_ALLOWED_FIREBASE_UIDS: 'uid-one',
    GITHUB_ALLOWED_REPOS: 'team/repo',
    RENDER_EXTERNAL_HOSTNAME: 'cue-github-mcp.onrender.com',
    UPSTASH_REDIS_REST_URL: 'https://redis.example',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
  });
  assert.deepEqual([...config.allowedHosts], ['cue-github-mcp.onrender.com']);
});

test('Firebase UID and repository allowlists are exact and case-normalized only for repositories', () => {
  const config = allowedRepoConfig();
  assert.equal(isFirebaseUidAllowed('uid-one', { ...config, allowedFirebaseUids: new Set(['uid-one']) }), true);
  assert.equal(isFirebaseUidAllowed('uid-two', { ...config, allowedFirebaseUids: new Set(['uid-one']) }), false);
  assert.equal(isFirebaseUidAllowed('', config), false);
  assert.equal(assertAllowedRepo('team', 'project', config), 'team/project');
  assert.equal(assertAllowedFullName('TEAM/PROJECT', config), 'TEAM/PROJECT');
  assert.throws(() => assertAllowedRepo('team', 'other', config), (error: any) => error instanceof GitHubToolError && error.code === 'REPOSITORY_NOT_ALLOWED');
  assert.throws(() => assertAllowedFullName('team/project/extra', config), /owner\/repo/);
});

test('repository paths reject traversal, absolute paths, backslashes, and control bytes', () => {
  for (const path of ['../secret', 'src/../../secret', '/etc/passwd', 'src\\file.ts', './file', 'src/./file', 'bad\u0000name']) {
    assert.throws(() => validateRepoPath(path), (error: any) => error instanceof GitHubToolError && error.code === 'INVALID_PATH');
  }
  assert.equal(validateRepoPath('src/index.ts'), 'src/index.ts');
});

test('GitHub API retries transient rate limits with bounded backoff and sanitizes failures', async () => {
  let calls = 0;
  const result = await githubRequest(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('rate limit'), { status: 429, response: { headers: { 'retry-after': '0' } } });
    return { ok: true };
  }, { retries: 1 });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);

  await assert.rejects(
    () => githubRequest(async () => { throw Object.assign(new Error('invalid key Bearer ghp_abcdefghijklmnopqrstuvwx'), { status: 422 }); }, { retryable: false }),
    (error: any) => error instanceof GitHubToolError && error.code === 'GITHUB_HTTP_422' && !error.message.includes('ghp_') && !error.message.includes('Bearer invalid'),
  );
  assert.doesNotMatch(sanitizeError(new Error('oops Bearer github_pat_abcdefghijklmnopqrstuvwx')).message, /github_pat_|Bearer github/);
});

test('local rate limiting resets by window and production HTTP fails closed without Redis', async () => {
  resetRateLimitsForTests();
  const config = testConfig({ MCP_RATE_LIMIT_PER_MINUTE: '10' });
  for (let i = 0; i < 10; i += 1) assert.equal((await consumeRateLimit('uid', config, 60_000)).allowed, true);
  assert.equal((await consumeRateLimit('uid', config, 60_000)).allowed, false);
  assert.equal((await consumeRateLimit('uid', config, 120_000)).allowed, true);

  const production = { ...testConfig(), transport: 'http' as const, nodeEnv: 'production' };
  const denied = await consumeRateLimit('uid', production);
  assert.equal(denied.allowed, false);
  assert.equal(denied.distributed, false);
  resetRateLimitsForTests();
});

test('Actions log extraction redacts common secrets and enforces decompressed size limits', () => {
  const archive = zipSync({ 'job/log.txt': strToU8('token ghp_abcdefghijklmnopqrstuvwx and Bearer secret-value') }, { level: 9 });
  const extracted = extractBoundedWorkflowLogs(archive, 10_000, 500);
  assert.equal(extracted.logFiles.length, 1);
  assert.match(extracted.logFiles[0]!.content, /REDACTED_GITHUB_TOKEN/);
  assert.match(extracted.logFiles[0]!.content, /Bearer \[REDACTED\]/);
  assert.equal(extracted.filesTruncated, false);

  const bomb = zipSync({ 'job/huge.txt': strToU8('x'.repeat(200_000)) }, { level: 9 });
  assert.ok(bomb.byteLength < 1024);
  assert.throws(() => extractBoundedWorkflowLogs(bomb, 100_000, 500), (error: any) => error instanceof GitHubToolError && error.code === 'LOG_OUTPUT_TOO_LARGE');
});
