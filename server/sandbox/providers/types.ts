/**
 * Swappable sandbox provider abstraction & error definitions.
 */

import type {
  ProviderCapabilityReport,
  SandboxProviderId,
  SandboxResourceLimits,
  SandboxRuntime,
  SandboxStatus,
  TerminalStreamEvent,
  WorkspaceArtifact,
  WorkspaceFileEntry,
  WorkspaceSearchMatch,
} from '../types';

export class SandboxProviderError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly provider: SandboxProviderId;

  constructor(params: {
    message: string;
    code: string;
    statusCode?: number;
    retryable?: boolean;
    provider?: SandboxProviderId;
  }) {
    super(params.message);
    this.name = 'SandboxProviderError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 502;
    this.retryable = params.retryable ?? false;
    this.provider = params.provider ?? 'unconfigured';
  }
}

export const RUNTIME_IMAGE_CATALOG: Record<SandboxRuntime, { label: string; defaultTemplate: string; defaultImage: string }> = {
  node: { label: 'Node.js 20 LTS', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
  typescript: { label: 'TypeScript + Node.js 20', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
  javascript: { label: 'JavaScript + Node.js 20', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
  python: { label: 'Python 3.12', defaultTemplate: 'code-interpreter-v1', defaultImage: 'python:3.12-slim' },
  html: { label: 'Static HTML/CSS/JS', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
  react: { label: 'React + Vite', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
  vite: { label: 'Vite Dev Environment', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
  nextjs: { label: 'Next.js Full-Stack', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
  custom: { label: 'Custom Approved Image', defaultTemplate: 'base', defaultImage: 'node:20-bookworm' },
};

export interface ProviderCreateSandboxInput {
  workspaceId: string;
  userId: string;
  projectId: string;
  taskId?: string;
  runtime: SandboxRuntime;
  image?: string;
  limits: SandboxResourceLimits;
  env: Record<string, string>;
  persistent: boolean;
}

export interface ProviderCreateSandboxResult {
  providerSandboxId: string;
  workspaceRoot: string;
  status: SandboxStatus;
  image?: string;
}

export interface ProviderCommandInput {
  providerSandboxId: string;
  command: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  background?: boolean;
  onEvent?: (event: TerminalStreamEvent) => void;
}

export interface ProviderCommandResult {
  providerExecutionId?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
  cancelled?: boolean;
  durationMs: number;
}

export interface SandboxProviderAdapter {
  readonly id: SandboxProviderId;
  isConfigured(): boolean;
  getMissingCredentials(): string[];
  getSupportedRuntimes(): SandboxRuntime[];
  healthCheck(): Promise<ProviderCapabilityReport>;

  createSandbox(input: ProviderCreateSandboxInput): Promise<ProviderCreateSandboxResult>;
  getSandboxStatus(providerSandboxId: string): Promise<{ status: SandboxStatus; error?: string }>;
  destroySandbox(providerSandboxId: string): Promise<void>;

  executeCommand(input: ProviderCommandInput): Promise<ProviderCommandResult>;
  cancelCommand(providerSandboxId: string, providerExecutionId: string): Promise<boolean>;

  listFiles(providerSandboxId: string, absolutePath: string): Promise<WorkspaceFileEntry[]>;
  readFile(providerSandboxId: string, absolutePath: string): Promise<string>;
  writeFile(providerSandboxId: string, absolutePath: string, content: string): Promise<void>;
  deletePath(providerSandboxId: string, absolutePath: string): Promise<void>;
  makeDirectory(providerSandboxId: string, absolutePath: string): Promise<void>;
  renamePath(providerSandboxId: string, fromAbsolutePath: string, toAbsolutePath: string): Promise<void>;
  searchFiles(providerSandboxId: string, rootAbsolutePath: string, query: string): Promise<WorkspaceSearchMatch[]>;
  createArtifact?(providerSandboxId: string, rootAbsolutePath: string): Promise<WorkspaceArtifact>;

  getPreviewUrl(providerSandboxId: string, port: number): Promise<string>;
}
