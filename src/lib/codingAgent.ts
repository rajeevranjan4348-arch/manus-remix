/**
 * Coding Agent & GitHub Integration for Deku AI
 * 
 * Provides repository inspection, file reading/writing, diff generation,
 * branch verification, commit creation, and real SHA reporting via GitHub API.
 */

import { observability } from './observability';
import { securityCenter } from './securityCenter';
import { approvalManager } from './approvalManager';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

export interface GitHubFileEntry {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  url: string;
}

export interface CommitResult {
  success: boolean;
  commitSha?: string;
  commitUrl?: string;
  branch: string;
  filesChanged: string[];
  message: string;
  verified: boolean;
  error?: string;
}

export interface DiffPreview {
  filePath: string;
  originalContent: string;
  newContent: string;
  linesAdded: number;
  linesRemoved: number;
  patchSummary: string;
}

class CodingAgentService {
  private getApiBase(): string {
    return (import.meta as any).env?.VITE_GITHUB_API_URL || 'https://api.github.com';
  }

  /**
   * Helper to fetch GitHub API with authorization token if available
   */
  private async request(path: string, token?: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'DekuAI-CodingAgent/2.0',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers.Authorization = `token ${token}`;
    }

    const url = `${this.getApiBase()}${path.startsWith('/') ? path : '/' + path}`;
    return fetch(url, { ...options, headers });
  }

  /**
   * Inspect files and directories in a repository
   */
  public async listRepositoryFiles(
    owner: string,
    repo: string,
    path = '',
    token?: string
  ): Promise<{ files: GitHubFileEntry[]; error?: string }> {
    const traceId = observability.startTrace('github_list_files', { owner, repo, path });
    try {
      const res = await this.request(`/repos/${owner}/${repo}/contents/${path}`, token);
      if (!res.ok) {
        throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const files: GitHubFileEntry[] = Array.isArray(data)
        ? data.map((item: any) => ({
            name: item.name,
            path: item.path,
            sha: item.sha,
            size: item.size || 0,
            type: item.type === 'dir' ? 'dir' : 'file',
            url: item.html_url || '',
          }))
        : [];

      observability.endTrace(traceId);
      return { files };
    } catch (err: any) {
      observability.endTrace(traceId, { error: err.message });
      return { files: [], error: securityCenter.toSafeErrorMessage(err) };
    }
  }

  /**
   * Read raw file content from GitHub repository
   */
  public async getFileContent(
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
    token?: string
  ): Promise<{ content: string; sha: string; error?: string }> {
    const traceId = observability.startTrace('github_get_content', { owner, repo, filePath });
    try {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const res = await this.request(`/repos/${owner}/${repo}/contents/${filePath}${query}`, token);
      if (!res.ok) {
        throw new Error(`Failed to read file ${filePath} (${res.status})`);
      }

      const data = await res.json();
      const rawBase64 = data.content || '';
      // Decode UTF-8 base64 safely
      const content = decodeURIComponent(
        escape(atob(rawBase64.replace(/\n/g, '')))
      );

      observability.endTrace(traceId);
      return { content, sha: data.sha };
    } catch (err: any) {
      observability.endTrace(traceId, { error: err.message });
      return { content: '', sha: '', error: securityCenter.toSafeErrorMessage(err) };
    }
  }

  /**
   * Generates a line-by-line diff preview before committing
   */
  public previewDiff(filePath: string, originalContent: string, newContent: string): DiffPreview {
    const origLines = originalContent ? originalContent.split('\n') : [];
    const newLines = newContent ? newContent.split('\n') : [];

    let linesAdded = 0;
    let linesRemoved = 0;

    // Fast metric approximation
    if (origLines.length === 0) {
      linesAdded = newLines.length;
    } else {
      const origSet = new Set(origLines);
      const newSet = new Set(newLines);
      linesAdded = newLines.filter(l => !origSet.has(l)).length;
      linesRemoved = origLines.filter(l => !newSet.has(l)).length;
    }

    return {
      filePath,
      originalContent,
      newContent,
      linesAdded,
      linesRemoved,
      patchSummary: `+${linesAdded} lines, -${linesRemoved} lines across ${filePath}`,
    };
  }

  /**
   * Create or update a file in the repository with real commit confirmation
   */
  public async commitFile(params: {
    owner: string;
    repo: string;
    filePath: string;
    content: string;
    message: string;
    branch?: string;
    existingSha?: string;
    token: string;
    isApproved?: boolean;
  }): Promise<CommitResult> {
    const { owner, repo, filePath, content, message, branch = 'main', existingSha, token, isApproved } = params;

    // Safety check: requires approval for commits
    if (!isApproved) {
      approvalManager.proposeAction({
        toolName: 'github_commit_file',
        title: `Commit to ${owner}/${repo}`,
        description: `Create/update file "${filePath}" with message: "${message}" on branch "${branch}".`,
        target: `${owner}/${repo}/${filePath}`,
        parameters: { owner, repo, filePath, branch, message },
        riskLevel: 'sensitive',
        consequences: [
          `Will modify "${filePath}" in remote GitHub repository ${owner}/${repo}.`,
          `Creates a permanent git commit on branch "${branch}".`,
        ],
      });

      return {
        success: false,
        branch,
        filesChanged: [filePath],
        message,
        verified: false,
        error: 'APPROVAL_REQUIRED: Commit proposal created. User authorization needed.',
      };
    }

    const traceId = observability.startTrace('github_commit_file', { owner, repo, filePath, branch });
    try {
      // Encode UTF-8 content to base64 safely
      const encodedContent = btoa(unescape(encodeURIComponent(content)));

      const bodyPayload: Record<string, any> = {
        message,
        content: encodedContent,
        branch,
      };

      if (existingSha) {
        bodyPayload.sha = existingSha;
      }

      const res = await this.request(`/repos/${owner}/${repo}/contents/${filePath}`, token, {
        method: 'PUT',
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.message || `GitHub error ${res.status}`);
      }

      const result = await res.json();
      const commitSha = result.commit?.sha || '';
      const commitUrl = result.commit?.html_url || `https://github.com/${owner}/${repo}/commit/${commitSha}`;

      observability.endTrace(traceId, { commitSha });
      return {
        success: true,
        commitSha,
        commitUrl,
        branch,
        filesChanged: [filePath],
        message,
        verified: Boolean(commitSha),
      };
    } catch (err: any) {
      observability.endTrace(traceId, { error: err.message });
      return {
        success: false,
        branch,
        filesChanged: [filePath],
        message,
        verified: false,
        error: securityCenter.toSafeErrorMessage(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Sandboxed Coding Execution Engine Client (/api/sandbox/*)
  // -------------------------------------------------------------------------

  private async sandboxRequest<T = any>(
    endpoint: string,
    method: 'GET' | 'POST' = 'POST',
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string; code?: string; challenge?: any }> {
    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };

    try {
      const res = await fetch(`/api/sandbox${endpoint}`, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
        signal,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: payload?.error || `Sandbox API error (HTTP ${res.status})`,
          code: payload?.code,
          challenge: payload?.challenge,
          data: payload,
        };
      }
      return { ok: true, status: res.status, data: payload as T };
    } catch (err: any) {
      return {
        ok: false,
        status: 0,
        error: securityCenter.toSafeErrorMessage(err),
        code: 'SANDBOX_NETWORK_ERROR',
      };
    }
  }

  public async getSandboxHealth(live = false) {
    return this.sandboxRequest(`/health${live ? '?live=true' : ''}`, 'GET');
  }

  public async createSandbox(params: {
    projectId: string;
    taskId?: string;
    runtime?: string;
    image?: string;
    limits?: Record<string, unknown>;
    env?: Record<string, unknown>;
    persistent?: boolean;
    provider?: string;
    idempotencyKey?: string;
  }) {
    return this.sandboxRequest('/create', 'POST', params);
  }

  public async getSandboxStatus(sandboxId: string, refresh = true) {
    return this.sandboxRequest('/status', 'POST', { sandboxId, refresh });
  }

  public async cleanupSandbox(sandboxId: string) {
    return this.sandboxRequest('/cleanup', 'POST', { sandboxId });
  }

  public async executeTerminal(params: {
    sandboxId: string;
    command: string;
    cwd?: string;
    env?: Record<string, unknown>;
    timeoutMs?: number;
    approvalToken?: string;
    idempotencyKey?: string;
  }, signal?: AbortSignal) {
    return this.sandboxRequest('/terminal/execute', 'POST', params, signal);
  }

  public async streamTerminal(
    params: {
      sandboxId: string;
      command: string;
      cwd?: string;
      env?: Record<string, unknown>;
      timeoutMs?: number;
      approvalToken?: string;
      idempotencyKey?: string;
    },
    onEvent?: (event: { type: string; data: any }) => void,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; execution?: any; events: Array<{ type: string; data: any }>; error?: string; code?: string; challenge?: any }> {
    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    const events: Array<{ type: string; data: any }> = [];
    try {
      const res = await fetch('/api/sandbox/terminal/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify(params),
        signal,
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        return {
          ok: false,
          events,
          error: errPayload?.error || `Stream failed (HTTP ${res.status})`,
          code: errPayload?.code,
          challenge: errPayload?.challenge,
        };
      }

      const text = await res.text();
      let finalExecution: any;
      let streamError: string | undefined;
      let streamCode: string | undefined;
      let challenge: any;

      const blocks = text.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        let evType = 'message';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) evType = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr);
          const item = { type: evType, data: parsed };
          events.push(item);
          onEvent?.(item);
          if (evType === 'complete' && parsed?.execution) finalExecution = parsed.execution;
          if (evType === 'error') {
            streamError = parsed?.error || 'Terminal stream error';
            streamCode = parsed?.code;
            challenge = parsed?.challenge;
          }
        } catch {
          // Skip malformed SSE block
        }
      }

      if (streamError) {
        return { ok: false, events, error: streamError, code: streamCode, challenge };
      }
      return { ok: true, execution: finalExecution, events };
    } catch (err: any) {
      return { ok: false, events, error: securityCenter.toSafeErrorMessage(err), code: 'STREAM_NETWORK_ERROR' };
    }
  }

  public async cancelTerminal(sandboxId: string, executionId: string) {
    return this.sandboxRequest('/terminal/cancel', 'POST', { sandboxId, executionId });
  }

  public async listWorkspaceFiles(sandboxId: string, path = '.') {
    return this.sandboxRequest('/files/list', 'POST', { sandboxId, path });
  }

  public async readWorkspaceFile(sandboxId: string, path: string) {
    return this.sandboxRequest('/files/read', 'POST', { sandboxId, path });
  }

  public async writeWorkspaceFile(sandboxId: string, path: string, content: string) {
    return this.sandboxRequest('/files/write', 'POST', { sandboxId, path, content });
  }

  public async deleteWorkspaceFile(sandboxId: string, path: string, approvalToken?: string) {
    return this.sandboxRequest('/files/delete', 'POST', { sandboxId, path, approvalToken });
  }

  public async makeWorkspaceDirectory(sandboxId: string, path: string) {
    return this.sandboxRequest('/files/mkdir', 'POST', { sandboxId, path });
  }

  public async renameWorkspacePath(sandboxId: string, fromPath: string, toPath: string) {
    return this.sandboxRequest('/files/rename', 'POST', { sandboxId, fromPath, toPath });
  }

  public async searchWorkspaceFiles(sandboxId: string, query: string, path = '.') {
    return this.sandboxRequest('/files/search', 'POST', { sandboxId, query, path });
  }

  public async inspectWorkspaceStructure(sandboxId: string, maxDepth = 3) {
    return this.sandboxRequest('/files/structure', 'POST', { sandboxId, maxDepth });
  }

  public async createWorkspaceArtifact(sandboxId: string, path = '.') {
    return this.sandboxRequest('/files/artifact', 'POST', { sandboxId, path });
  }

  public async startPreview(params: {
    sandboxId: string;
    command: string;
    port: number;
    cwd?: string;
    readinessTimeoutMs?: number;
    approvalToken?: string;
  }) {
    return this.sandboxRequest('/preview/start', 'POST', params);
  }

  public async getPreviewStatus(sandboxId: string) {
    return this.sandboxRequest('/preview/status', 'POST', { sandboxId });
  }
}

export const codingAgent = new CodingAgentService();
