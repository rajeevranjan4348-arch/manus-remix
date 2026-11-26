/**
 * Canonical types for the Sandboxed Coding & Real Browser Execution Engine.
 */

export type SandboxRuntime =
  | 'node'
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'html'
  | 'react'
  | 'vite'
  | 'nextjs'
  | 'custom';

export type SandboxProviderId = 'e2b' | 'daytona' | 'http-runtime' | 'unconfigured';
export type BrowserProviderId = 'browserless' | 'browserbase' | 'http-browser' | 'unconfigured';

export type SandboxStatus =
  | 'creating'
  | 'running'
  | 'idle'
  | 'stopping'
  | 'stopped'
  | 'expired'
  | 'error';

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export type BrowserSessionStatus =
  | 'creating'
  | 'active'
  | 'closed'
  | 'expired'
  | 'error';

export interface SandboxResourceLimits {
  cpuCores: number;
  memoryMb: number;
  diskMb: number;
  timeoutSec: number;
  idleTimeoutSec: number;
  maxCommandTimeoutMs: number;
  maxFileSizeBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxResourceLimits = {
  cpuCores: 2,
  memoryMb: 2048,
  diskMb: 4096,
  timeoutSec: 1800, // 30 minutes max sandbox lifetime
  idleTimeoutSec: 900, // 15 minutes idle cleanup
  maxCommandTimeoutMs: 120_000, // 2 minutes max per command
  maxFileSizeBytes: 2 * 1024 * 1024, // 2 MiB per file write
};

export interface SandboxWorkspaceRecord {
  sandboxId: string;
  workspaceId: string;
  provider: SandboxProviderId;
  providerSandboxId: string;
  userId: string;
  projectId: string;
  taskId?: string;
  runtime: SandboxRuntime;
  image?: string;
  workspaceRoot: string;
  status: SandboxStatus;
  limits: SandboxResourceLimits;
  persistent: boolean;
  previewUrl?: string;
  previewPort?: number;
  previewStatus?: 'stopped' | 'starting' | 'ready' | 'failed';
  previewCommandExecutionId?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  cleanedUpAt?: string;
  error?: string;
}

export interface TerminalExecutionRecord {
  executionId: string;
  sandboxId: string;
  workspaceId: string;
  userId: string;
  provider: SandboxProviderId;
  providerExecutionId?: string;
  command: string;
  cwd: string;
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  timeoutMs: number;
  idempotencyKey?: string;
  retryCount: number;
  cancelled?: boolean;
  error?: string;
  /** Marks terminal output explicitly as untrusted external data, never system instructions */
  untrustedData: true;
}

export interface TerminalStreamEvent {
  type: 'status' | 'stdout' | 'stderr' | 'exit' | 'error';
  executionId: string;
  data?: string;
  exitCode?: number | null;
  status?: ExecutionStatus;
  timestamp: string;
  error?: string;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string;
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  preview: string;
}

export interface WorkspaceArtifact {
  filename: string;
  mimeType: string;
  encoding: 'base64';
  sizeBytes: number;
  contentBase64: string;
  fileCount: number;
  createdAt: string;
}

export interface PreviewServerState {
  sandboxId: string;
  workspaceId: string;
  command: string;
  port: number;
  status: 'starting' | 'ready' | 'failed' | 'stopped';
  previewUrl?: string;
  httpStatus?: number;
  executionId?: string;
  checkedAt: string;
  error?: string;
}

export interface BrowserSessionRecord {
  sessionId: string;
  provider: BrowserProviderId;
  providerSessionId: string;
  userId: string;
  projectId?: string;
  taskId?: string;
  status: BrowserSessionStatus;
  currentUrl?: string;
  currentTitle?: string;
  viewport: { width: number; height: number };
  isolatedStorage: true;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  closedAt?: string;
  error?: string;
}

export interface BrowserConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
  timestamp: string;
}

export interface BrowserInteractiveElement {
  index: number;
  tag: string;
  selector: string;
  role?: string;
  type?: string;
  text?: string;
  name?: string;
  placeholder?: string;
  href?: string;
  ariaLabel?: string;
  visible: boolean;
}

export interface BrowserPageState {
  url: string;
  title: string;
  statusCode?: number;
  textContent: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  interactiveElements: BrowserInteractiveElement[];
  consoleErrors: BrowserConsoleEntry[];
  capturedAt: string;
  /** Marks webpage content strictly as untrusted data */
  untrustedData: true;
}

export interface BrowserScreenshotResult {
  sessionId: string;
  url: string;
  title?: string;
  mimeType: 'image/png' | 'image/jpeg';
  encoding: 'base64';
  dataBase64: string;
  width: number;
  height: number;
  fullPage: boolean;
  capturedAt: string;
}

export interface ProviderCapabilityReport {
  provider: SandboxProviderId | BrowserProviderId;
  configured: boolean;
  operational: boolean;
  liveCheckPerformed: boolean;
  supportedRuntimes?: SandboxRuntime[];
  features: string[];
  missingCredentials: string[];
  checkedAt: string;
  error?: string;
}

export interface EngineActionAuditEntry {
  auditId: string;
  userId: string;
  action: string;
  resourceType: 'sandbox' | 'terminal' | 'filesystem' | 'preview' | 'browser' | 'permission' | 'webhook';
  resourceId: string;
  status: 'allowed' | 'denied' | 'challenged' | 'succeeded' | 'failed';
  details: Record<string, unknown>;
  timestamp: string;
}
