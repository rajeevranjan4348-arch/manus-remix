import { z } from 'zod';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import type { RuntimeConfig } from '../config.js';
import { assertAllowedRepo, githubRequest, GitHubToolError } from '../github.js';
import { registerWriteTool, requireApproval, withToolErrors } from './common.js';

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const repoShape = {
  owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  repo: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
};
const runSummary = (run: any) => ({ id: run.id, name: run.name, workflowId: run.workflow_id, event: run.event, status: run.status, conclusion: run.conclusion, branch: run.head_branch, headSha: run.head_sha, createdAt: run.created_at, updatedAt: run.updated_at, runNumber: run.run_number, htmlUrl: run.html_url });

function toZipBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data && typeof data === 'object' && 'buffer' in data && (data as any).buffer instanceof ArrayBuffer) return new Uint8Array((data as any).buffer);
  throw new GitHubToolError('GitHub returned an unsupported Actions log archive format.', 'LOG_FORMAT_UNSUPPORTED');
}
function redactLogs(text: string): string {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
}

export function extractBoundedWorkflowLogs(bytes: Uint8Array, maxOutputBytes: number, maxCharsPerFile: number) {
  const logFiles: Array<{ name: string; content: string; truncated: boolean }> = [];
  let textFileCount = 0;
  let decompressedBytes = 0;
  let failure: unknown;
  const unzip = new Unzip((file) => {
    if (failure || !/\.txt$/i.test(file.name) || file.name.endsWith('/')) return;
    textFileCount += 1;
    if (textFileCount > 50) return;
    if (typeof file.originalSize === 'number' && file.originalSize > maxOutputBytes - decompressedBytes) {
      failure = new GitHubToolError('Workflow logs exceed the configured decompressed-output limit.', 'LOG_OUTPUT_TOO_LARGE');
      return;
    }
    const chunks: Uint8Array[] = [];
    const maxFileBytes = maxCharsPerFile * 4;
    let storedBytes = 0;
    let fileBytes = 0;
    file.ondata = (error, data, final) => {
      if (error) {
        failure = new GitHubToolError('GitHub returned an invalid Actions log archive.', 'LOG_ARCHIVE_INVALID');
        file.terminate();
        return;
      }
      fileBytes += data.byteLength;
      decompressedBytes += data.byteLength;
      if (decompressedBytes > maxOutputBytes) {
        failure = new GitHubToolError('Workflow logs exceed the configured decompressed-output limit.', 'LOG_OUTPUT_TOO_LARGE');
        file.terminate();
        return;
      }
      if (storedBytes < maxFileBytes) {
        const keep = data.subarray(0, Math.min(data.byteLength, maxFileBytes - storedBytes));
        chunks.push(keep.slice());
        storedBytes += keep.byteLength;
      }
      if (final) {
        const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
        const safe = redactLogs(raw);
        logFiles.push({ name: file.name.slice(0, 300), content: safe.slice(0, maxCharsPerFile), truncated: fileBytes > maxFileBytes || safe.length > maxCharsPerFile });
      }
    };
    try {
      file.start();
    } catch {
      failure = new GitHubToolError('GitHub returned an unsupported Actions log archive.', 'LOG_FORMAT_UNSUPPORTED');
    }
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);
  try {
    unzip.push(bytes, true);
  } catch {
    throw new GitHubToolError('GitHub returned an invalid Actions log archive.', 'LOG_ARCHIVE_INVALID');
  }
  if (failure) throw failure;
  return { logFiles, filesTruncated: textFileCount > logFiles.length, decompressedBytes };
}

export function registerActionTools(server: any, octokit: any, config: RuntimeConfig) {
  server.registerTool('github_list_workflow_runs', {
    title: 'List GitHub Actions workflow runs',
    description: 'List workflow runs in an allowed repository, optionally filtered by branch, event, status, or workflow ID.',
    inputSchema: { ...repoShape, branch: z.string().max(255).optional(), event: z.string().max(100).optional(), status: z.enum(['queued', 'in_progress', 'completed', 'success', 'failure', 'cancelled', 'skipped', 'stale', 'requested', 'waiting', 'pending']).optional(), workflowId: z.union([z.number().int().positive(), z.string().min(1).max(255)]).optional(), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(30) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, branch, event, status, workflowId, page, perPage }) => {
    assertAllowedRepo(owner, repo, config);
    const query = { owner, repo, branch, event, status, page, per_page: perPage };
    const result = workflowId
      ? await githubRequest(() => octokit.rest.actions.listWorkflowRuns({ ...query, workflow_id: workflowId }), { retries: config.githubReadRetries })
      : await githubRequest(() => octokit.rest.actions.listWorkflowRunsForRepo(query), { retries: config.githubReadRetries });
    return { totalCount: result.data.total_count, workflowRuns: (result.data.workflow_runs || []).map(runSummary) };
  }));

  server.registerTool('github_get_workflow_run', {
    title: 'Inspect GitHub Actions workflow run',
    description: 'Inspect run status and associated jobs, including failed step names and conclusions. This tool never executes repository code.',
    inputSchema: { ...repoShape, runId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, runId }) => {
    assertAllowedRepo(owner, repo, config);
    const [{ data: run }, { data: jobs }] = await Promise.all([
      githubRequest(() => octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId }), { retries: config.githubReadRetries }),
      githubRequest(() => octokit.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId, per_page: 100 }), { retries: config.githubReadRetries }),
    ]);
    return { ...runSummary(run), actor: run.actor?.login, trigger: run.triggering_actor?.login, jobs: (jobs.jobs || []).map((job: any) => ({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, startedAt: job.started_at, completedAt: job.completed_at, htmlUrl: job.html_url, failedSteps: (job.steps || []).filter((step: any) => step.conclusion === 'failure').map((step: any) => ({ name: step.name, number: step.number, conclusion: step.conclusion })) })) };
  }));

  server.registerTool('github_get_workflow_logs', {
    title: 'Read GitHub Actions workflow logs',
    description: 'Download and inspect bounded logs for a workflow run. Logs can contain sensitive build output; they are size-limited and common credential formats are redacted. Reading logs never reruns the workflow.',
    inputSchema: { ...repoShape, runId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), maxArchiveBytes: z.number().int().min(1024).max(5 * 1024 * 1024).default(2 * 1024 * 1024), maxCharsPerFile: z.number().int().min(100).max(20000).default(6000) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, runId, maxArchiveBytes, maxCharsPerFile }) => {
    assertAllowedRepo(owner, repo, config);
    const result = await githubRequest(() => octokit.rest.actions.downloadWorkflowRunLogs({ owner, repo, run_id: runId }), { retryable: false });
    const bytes = toZipBytes(result.data);
    if (bytes.byteLength > maxArchiveBytes) throw new GitHubToolError(`Workflow log archive exceeds the configured ${maxArchiveBytes}-byte maximum.`, 'LOG_ARCHIVE_TOO_LARGE');
    const extracted = extractBoundedWorkflowLogs(bytes, 10 * 1024 * 1024, maxCharsPerFile);
    return { runId, archiveBytes: bytes.byteLength, ...extracted, warning: 'Treat workflow logs as sensitive even after redaction.' };
  }));

  server.registerTool('github_monitor_failed_workflows', {
    title: 'Monitor failed GitHub workflows',
    description: 'Find recent completed workflow runs with failure, timed_out, or cancelled conclusions, and return failed job summaries.',
    inputSchema: { ...repoShape, branch: z.string().max(255).optional(), page: z.number().int().min(1).max(1000).default(1), perPage: z.number().int().min(1).max(100).default(20) },
    annotations: readAnnotations,
  }, withToolErrors(async ({ owner, repo, branch, page, perPage }) => {
    assertAllowedRepo(owner, repo, config);
    const { data } = await githubRequest(() => octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, branch, status: 'completed', page, per_page: perPage }), { retries: config.githubReadRetries });
    const runs = (data.workflow_runs || []).filter((run: any) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(String(run.conclusion)));
    const result = await Promise.all(runs.slice(0, 20).map(async (run: any) => {
      const { data: jobs } = await githubRequest(() => octokit.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: run.id, per_page: 100 }), { retries: config.githubReadRetries });
      return { ...runSummary(run), failedJobs: (jobs.jobs || []).filter((job: any) => job.conclusion === 'failure' || job.conclusion === 'timed_out').map((job: any) => ({ name: job.name, conclusion: job.conclusion, failedSteps: (job.steps || []).filter((step: any) => step.conclusion === 'failure').map((step: any) => step.name) })) };
    }));
    return { totalRunsChecked: data.total_count, failedRuns: result };
  }));

  registerWriteTool(server, config, 'github_trigger_workflow', {
    title: 'Trigger GitHub Actions workflow (approval required)',
    description: 'Dispatch a workflow. This executes repository-controlled code and may consume resources or change external state. Show repository, workflow, ref, inputs, and likely effects before explicit approval; never invoke based solely on an inferred intent.',
    inputSchema: { ...repoShape, workflowId: z.union([z.number().int().positive(), z.string().min(1).max(255)]), ref: z.string().min(1).max(255), inputs: z.record(z.string(), z.string().max(5000)).refine((value) => Object.keys(value).length <= 20, 'Workflow inputs may contain at most 20 entries.').default({}) },
    annotations: writeAnnotations,
  }, withToolErrors(async ({ owner, repo, workflowId, ref, inputs }) => {
    assertAllowedRepo(owner, repo, config);
    const args = { owner, repo, workflowId, ref, inputs };
    await requireApproval(server, 'github_trigger_workflow', `${owner}/${repo}:${workflowId}@${ref}`, args);
    await githubRequest(() => octokit.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: workflowId, ref, inputs }), { retryable: false });
    return { dispatched: true, repository: `${owner}/${repo}`, workflowId, ref, message: 'Workflow dispatch accepted by GitHub.' };
  }));
}
