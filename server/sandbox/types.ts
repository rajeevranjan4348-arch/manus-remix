/**
 * Shared types for the sandboxed coding & browser execution engine (Feature 06).
 *
 * All execution happens inside an external, isolated sandbox provider.
 * Nothing in this module ever grants access to the host filesystem.
 */

export type SandboxStatus =
  | 'creating'
  | 'ready'
  | 'busy'
  | 'stopped'
  | 'expired'
  | 'failed';

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export type BrowserSessionStatus =
  | 'creating'
  | 'ready'
  | 'closed'
  | 'failed';

export type RuntimeId =
  | 'node'
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'html-css'
  | 'react-vite'
  | 'next'
  | 'custom';

export interface SandboxLimits {
  /** Wall-clock lifetime of the sandbox in seconds. */
  maxLifetimeSeconds: number;
  /** Idle time before automatic cleanup in seconds. */
  idleTimeoutSeconds: number;
  /** Per-command timeout in seconds. */
  commandTimeoutSeconds: number;
  /** vCPU allocation (provider dependent). */
  cpuCores: number;
  /** Memory allocation in MB (provider dependent). */
  memoryMB: number;
  /** Maximum concurrent sandboxes per user. */
  maxConcurrentPerUser: number;
}

export interface SandboxCreateOptions {
  userId: string;
  runtime?: RuntimeId;
  workspaceLabel?: string;
  env?: Record<string, string>;
  templateId?: string;
  limits?: Partial<SandboxLimits>;
}

export interface SandboxSessionRecord {
  sessionId: string;
  userId: string;
  providerId: string;
  providerSandboxId: string | null;
  runtime: RuntimeId;
  workspaceLabel: string;
  status: SandboxStatus;
  durable: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  metadata: Record<string, unknown>;
}

export interface CommandExecutionRequest {
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
}

export interface CommandExecutionRecord {
  executionId: string;
  sessionId: string;
  userId: string;
  status: ExecutionStatus;
  command: string;
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  truncated: boolean;
}

export interface FilesystemEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
}

export interface FilesystemWriteRequest {
  path: string;
  content: string;
  createDirectories?: boolean;
}

/** Capabilities a provider advertises. Tools must refuse anything not listed. */
export interface ProviderCapabilities {
  terminal: boolean;
  filesystem: boolean;
  devServerPreview: boolean;
  browser: boolean;
  browserScreenshots: boolean;
  runtimes: RuntimeId[];
}

export interface ProviderHealth {
  providerId: string;
  configured: boolean;
  available: boolean;
  detail: string;
  checkedAt: string;
}

/**
 * Contract every sandbox provider adapter must implement.
 * Providers run OUTSIDE the Netlify host boundary: the host never spawns
 * user commands locally and never touches its own filesystem.
 */
export interface SandboxProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  /** True when credentials/module for this provider are present. */
  isConfigured(): boolean;
  /** Explains what is missing, for safe 'unavailable' reporting. */
  configurationErrors(): string[];

  healthCheck(timeoutMs?: number): Promise<ProviderHealth>;

  createSession(opts: SandboxCreateOptions, limits: SandboxLimits): Promise<{ providerSandboxId: string; expiresAt: string; metadata: Record<string, unknown> }>;
  terminateSession(providerSandboxId: string): Promise<void>;

  execCommand(providerSandboxId: string, request: CommandExecutionRequest): Promise<Omit<CommandExecutionRecord, 'executionId' | 'sessionId' | 'userId' | 'status'> & { status: 'completed' | 'failed' | 'timed_out' }>;
  readPreviewHostUrl(providerSandboxId: string, port: number): Promise<string | null>;
  fetchPreviewStatus(providerSandboxId: string, port: number, timeoutMs?: number): Promise<{ reachable: boolean; httpStatus: number | null; error?: string }> ;

  writeFile(providerSandboxId: string, virtualPath: string, content: string, createDirectories: boolean): Promise<{ size: number }>;
  readFile(providerSandboxId: string, virtualPath: string): Promise<{ content: string; size: number }>;
  listFiles(providerSandboxId: string, virtualDir: string): Promise<FilesystemEntry[]>;
  deletePath(providerSandboxId: string, virtualPath: string): Promise<void>;
  movePath(providerSandboxId: string, from: string, to: string): Promise<void>;
  statPath(providerSandboxId: string, virtualPath: string): Promise<FilesystemEntry | null>;

  // Browser sessions (isolated per browser session, inside the sandbox when supported)
  /** Create or re-attach an isolated browser session; returns provider metadata that MUST be persisted for restart recovery. */
  browserCreate(providerSandboxId: string, browserSessionId: string, restore?: Record<string, unknown>): Promise<{ metadata: Record<string, unknown> }>;
  browserNavigate(providerSandboxId: string, browserSessionId: string, url: string, timeoutMs: number): Promise<{ url: string; title: string; textContent: string; consoleErrors: string[] }>;
  browserInspect(providerSandboxId: string, browserSessionId: string, selector?: string, limit?: number): Promise<{ elements: Array<{ tag: string; id?: string; classes?: string; text?: string; href?: string; inputType?: string; name?: string }> }>;
  browserClick(providerSandboxId: string, browserSessionId: string, selector: string): Promise<{ clicked: boolean; navigationTriggered: boolean; urlAfter: string }>;
  browserFill(providerSandboxId: string, browserSessionId: string, fields: Array<{ selector: string; value: string; type?: 'text' | 'password' | 'email' | 'number' }>): Promise<{ filled: number }>;
  browserScroll(providerSandboxId: string, browserSessionId: string, direction: 'up' | 'down', pixels: number): Promise<void>;
  browserWaitFor(providerSandboxId: string, browserSessionId: string, condition: 'navigation' | 'selector', value: string, timeoutMs: number): Promise<void>;
  browserScreenshot(providerSandboxId: string, browserSessionId: string): Promise<{ dataUrl: string }>;
  browserClose(providerSandboxId: string, browserSessionId: string): Promise<void>;
}
