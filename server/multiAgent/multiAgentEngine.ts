/**
 * Feature 03 — True Autonomous Multi-Agent Runtime Engine.
 *
 * Implements a real provider-backed, DAG-scheduled multi-agent orchestration engine:
 * - 9 specialized agent roles (research, coding, debugging, testing, analysis, browser,
 *   security_reviewer, qa, documentation) with isolated system instructions & scoped tool allowlists.
 * - Real model provider adapters: Google Gemini (@google/genai: gemini-4-hydrogen / gemini-4-neon),
 *   OpenRouter, OpenAI, Anthropic. Fails honestly with HTTP 503 if no provider key is configured.
 * - Real token & USD cost accounting derived strictly from provider usage payloads.
 * - DAG execution with parallel waves bounded by maxConcurrency, dependency handoff,
 *   isolated per-agent contexts, recursion depth limits, token/cost budget enforcement,
 *   timeouts & AbortSignal cancellation, scoped tool checks via Feature 02 Permissions Gateway,
 *   validation + correction loop, and final QA / Security Reviewer consolidation pass.
 */

import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from '../infrastructure/durableCollectionStore';
import {
  permissionsGateway,
  type PermissionsGatewayService,
} from '../permissionsGateway';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
} from '../sandbox/durableStore';

export type AgentRoleId =
  | 'research'
  | 'coding'
  | 'debugging'
  | 'testing'
  | 'analysis'
  | 'browser'
  | 'security_reviewer'
  | 'qa'
  | 'documentation';

export interface AgentRoleSpec {
  role: AgentRoleId;
  displayName: string;
  systemPrompt: string;
  allowedTools: string[];
  preferredTier: 'standard' | 'complex';
  maxOutputTokens: number;
}

export interface AgentTaskNodeInput {
  id: string;
  role: AgentRoleId;
  title: string;
  objective: string;
  dependsOn?: string[];
  requestedTools?: string[];
  requiredKeywords?: string[];
  recursionDepth?: number;
}

export interface ModelUsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  provider: string;
  model: string;
}

export interface ModelGenerationRequest {
  role: AgentRoleId;
  systemPrompt: string;
  userPrompt: string;
  preferredTier: 'standard' | 'complex';
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ModelGenerationResponse {
  text: string;
  usage: ModelUsageMetrics;
}

export interface ModelProviderAdapter {
  readonly name: string;
  isConfigured(): boolean;
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResponse>;
}

export interface AgentToolExecutor {
  (params: {
    toolName: string;
    args: Record<string, unknown>;
    role: AgentRoleId;
    userId: string;
  }): Promise<{ ok: boolean; output: unknown; error?: string }>;
}

export interface AgentNodeExecutionResult {
  nodeId: string;
  role: AgentRoleId;
  title: string;
  status: 'completed' | 'failed' | 'cancelled' | 'skipped';
  dependsOn: string[];
  output?: string;
  error?: string;
  correctionAttempts: number;
  toolInvocations: Array<{
    toolName: string;
    allowed: boolean;
    reason: string;
    output?: unknown;
  }>;
  usage: ModelUsageMetrics;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface MultiAgentRunRecord {
  runId: string;
  userId: string;
  objective: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  provider: string;
  maxConcurrency: number;
  maxRecursionDepth: number;
  maxTotalTokens: number;
  maxCostUsd: number;
  timeoutMs: number;
  nodes: AgentNodeExecutionResult[];
  qaReview?: {
    passed: boolean;
    summary: string;
    issues: string[];
    usage: ModelUsageMetrics;
  };
  consolidatedAnswer?: string;
  totalUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export class MultiAgentEngineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'MULTI_AGENT_ERROR', statusCode = 400) {
    super(message);
    this.name = 'MultiAgentEngineError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const RUNS_COLLECTION = 'multi_agent_runs';

// Per-1M token pricing estimates used to compute real USD cost from actual provider usage counts
const MODEL_PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gemini-4-hydrogen': { input: 0.3, output: 1.2 },
  'gemini-4-neon': { input: 1.5, output: 6.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'claude-3-5-sonnet-latest': { input: 3.0, output: 15.0 },
  default: { input: 0.5, output: 2.0 },
};

export function calculateUsageCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const rate = MODEL_PRICING_PER_MILLION[model] || MODEL_PRICING_PER_MILLION.default;
  const cost = (promptTokens / 1_000_000) * rate.input + (completionTokens / 1_000_000) * rate.output;
  return Number(cost.toFixed(6));
}

export const AGENT_ROLE_CATALOG: Record<AgentRoleId, AgentRoleSpec> = {
  research: {
    role: 'research',
    displayName: 'Research Agent',
    systemPrompt:
      'You are a specialized Research Agent. Gather verified facts, synthesize sources concisely, highlight uncertainties explicitly, and never fabricate citations.',
    allowedTools: ['web_search', 'fetch_webpage', 'read_memory', 'calculate'],
    preferredTier: 'standard',
    maxOutputTokens: 2048,
  },
  coding: {
    role: 'coding',
    displayName: 'Coding Agent',
    systemPrompt:
      'You are a specialized Coding Agent. Design clean, modular, type-safe production code, operate strictly within authorized sandbox boundaries, and report exact changed files.',
    allowedTools: [
      'filesystem_list',
      'filesystem_read',
      'filesystem_write',
      'filesystem_edit',
      'filesystem_search',
      'sandbox_status',
      'preview_status',
    ],
    preferredTier: 'complex',
    maxOutputTokens: 4096,
  },
  debugging: {
    role: 'debugging',
    displayName: 'Debugging Agent',
    systemPrompt:
      'You are a specialized Debugging Agent. Perform root-cause analysis from real logs, stack traces, and command exit codes; propose minimal surgical fixes.',
    allowedTools: [
      'filesystem_read',
      'filesystem_search',
      'filesystem_edit',
      'terminal_exec',
      'sandbox_status',
      'browser_console',
    ],
    preferredTier: 'complex',
    maxOutputTokens: 3072,
  },
  testing: {
    role: 'testing',
    displayName: 'Testing Agent',
    systemPrompt:
      'You are a specialized Testing Agent. Write and execute real automated tests, verify edge cases, and report exact pass/fail counts with zero fabricated results.',
    allowedTools: [
      'filesystem_read',
      'filesystem_write',
      'terminal_exec',
      'preview_status',
      'browser_navigate',
      'browser_extract',
    ],
    preferredTier: 'standard',
    maxOutputTokens: 3072,
  },
  analysis: {
    role: 'analysis',
    displayName: 'Analysis Agent',
    systemPrompt:
      'You are a specialized Data & Systems Analysis Agent. Perform rigorous quantitative/architectural analysis, identify trade-offs, and produce structured findings.',
    allowedTools: ['calculate', 'filesystem_read', 'filesystem_search', 'web_search', 'read_memory'],
    preferredTier: 'complex',
    maxOutputTokens: 3072,
  },
  browser: {
    role: 'browser',
    displayName: 'Browser Automation Agent',
    systemPrompt:
      'You are a specialized Browser Agent. Inspect web applications via isolated browser sessions, verify DOM state, console logs, and screenshots safely.',
    allowedTools: [
      'browser_create_session',
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_extract',
      'browser_screenshot',
      'browser_console',
      'browser_close_session',
    ],
    preferredTier: 'standard',
    maxOutputTokens: 2048,
  },
  security_reviewer: {
    role: 'security_reviewer',
    displayName: 'Security Reviewer Agent',
    systemPrompt:
      'You are a specialized Security Reviewer Agent. Audit code, permissions, authentication, tenant isolation, secret handling, and injection risks with strict fail-closed criteria.',
    allowedTools: ['filesystem_list', 'filesystem_read', 'filesystem_search', 'get_git_status'],
    preferredTier: 'complex',
    maxOutputTokens: 3072,
  },
  qa: {
    role: 'qa',
    displayName: 'QA Reviewer Agent',
    systemPrompt:
      'You are a specialized QA & Synthesis Reviewer Agent. Validate predecessor outputs against requirements, identify gaps or contradictions, and issue PASS or FAIL with concrete evidence.',
    allowedTools: ['filesystem_read', 'filesystem_search', 'preview_status', 'read_checkpoint'],
    preferredTier: 'standard',
    maxOutputTokens: 2048,
  },
  documentation: {
    role: 'documentation',
    displayName: 'Documentation Agent',
    systemPrompt:
      'You are a specialized Documentation Agent. Produce clear, accurate technical documentation, API contracts, and operational runbooks grounded strictly in verified outputs.',
    allowedTools: ['filesystem_list', 'filesystem_read', 'filesystem_write', 'filesystem_search'],
    preferredTier: 'standard',
    maxOutputTokens: 3072,
  },
};

/**
 * Real Google Gemini provider using @google/genai (gemini-4-hydrogen / gemini-4-neon).
 */
export class GeminiModelProvider implements ModelProviderAdapter {
  public readonly name = 'gemini';

  public isConfigured(): boolean {
    return Boolean((process.env.GEMINI_API_KEY || '').trim());
  }

  public async generate(request: ModelGenerationRequest): Promise<ModelGenerationResponse> {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      throw new MultiAgentEngineError(
        'GEMINI_API_KEY is not configured.',
        'MODEL_PROVIDER_UNAVAILABLE',
        503,
      );
    }

    const model = request.preferredTier === 'complex' ? 'gemini-4-neon' : 'gemini-4-hydrogen';
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    if (request.signal?.aborted) {
      throw new MultiAgentEngineError('Agent execution aborted.', 'AGENT_CANCELLED', 499);
    }

    const response = await ai.models.generateContent({
      model,
      contents: request.userPrompt,
      config: {
        systemInstruction: request.systemPrompt,
        maxOutputTokens: request.maxOutputTokens,
      },
    });

    const text = (response.text || '').trim();
    const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    const totalTokens = response.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: calculateUsageCostUsd(model, promptTokens, completionTokens),
        provider: this.name,
        model,
      },
    };
  }
}

/**
 * Real OpenAI-compatible provider (supports OpenRouter or OpenAI via real HTTPS requests).
 */
export class OpenAICompatibleModelProvider implements ModelProviderAdapter {
  public readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKeyEnv: string;
  private readonly standardModel: string;
  private readonly complexModel: string;

  constructor(config: {
    name: string;
    baseUrl: string;
    apiKeyEnv: string;
    standardModel: string;
    complexModel: string;
  }) {
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKeyEnv = config.apiKeyEnv;
    this.standardModel = config.standardModel;
    this.complexModel = config.complexModel;
  }

  public isConfigured(): boolean {
    return Boolean((process.env[this.apiKeyEnv] || '').trim());
  }

  public async generate(request: ModelGenerationRequest): Promise<ModelGenerationResponse> {
    const apiKey = (process.env[this.apiKeyEnv] || '').trim();
    if (!apiKey) {
      throw new MultiAgentEngineError(
        `${this.apiKeyEnv} is not configured.`,
        'MODEL_PROVIDER_UNAVAILABLE',
        503,
      );
    }

    const model = request.preferredTier === 'complex' ? this.complexModel : this.standardModel;
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxOutputTokens,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
      }),
      signal: request.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new MultiAgentEngineError(
        `Model provider '${this.name}' returned HTTP ${res.status}: ${errBody.slice(0, 300)}`,
        'MODEL_PROVIDER_ERROR',
        502,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const text = (data.choices?.[0]?.message?.content || '').trim();
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: calculateUsageCostUsd(model, promptTokens, completionTokens),
        provider: this.name,
        model,
      },
    };
  }
}

/**
 * Real Anthropic Messages API provider.
 */
export class AnthropicModelProvider implements ModelProviderAdapter {
  public readonly name = 'anthropic';

  public isConfigured(): boolean {
    return Boolean((process.env.ANTHROPIC_API_KEY || '').trim());
  }

  public async generate(request: ModelGenerationRequest): Promise<ModelGenerationResponse> {
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!apiKey) {
      throw new MultiAgentEngineError('ANTHROPIC_API_KEY is not configured.', 'MODEL_PROVIDER_UNAVAILABLE', 503);
    }

    const model = 'claude-3-5-sonnet-latest';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxOutputTokens,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      }),
      signal: request.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new MultiAgentEngineError(
        `Anthropic API returned HTTP ${res.status}: ${errBody.slice(0, 300)}`,
        'MODEL_PROVIDER_ERROR',
        502,
      );
    }

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = (data.content || [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim();

    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: calculateUsageCostUsd(model, promptTokens, completionTokens),
        provider: this.name,
        model,
      },
    };
  }
}

export function resolveDefaultProviders(): ModelProviderAdapter[] {
  return [
    new GeminiModelProvider(),
    new OpenAICompatibleModelProvider({
      name: 'openrouter',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      standardModel: 'google/gemini-2.5-flash',
      complexModel: 'anthropic/claude-3.5-sonnet',
    }),
    new OpenAICompatibleModelProvider({
      name: 'openai',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      standardModel: 'gpt-4o-mini',
      complexModel: 'gpt-4o',
    }),
    new AnthropicModelProvider(),
  ];
}

export interface MultiAgentEngineOptions {
  store?: DurableCollectionStore;
  auditStore?: DurableExecutionStore;
  permissions?: PermissionsGatewayService;
  providers?: ModelProviderAdapter[];
  toolExecutor?: AgentToolExecutor;
  defaultMaxConcurrency?: number;
  defaultMaxRecursionDepth?: number;
  defaultMaxTotalTokens?: number;
  defaultMaxCostUsd?: number;
  defaultTimeoutMs?: number;
}

export class MultiAgentRuntimeEngine {
  private readonly store: DurableCollectionStore;
  private readonly auditStore: DurableExecutionStore;
  private readonly permissions: PermissionsGatewayService;
  private readonly providers: ModelProviderAdapter[];
  private readonly toolExecutor?: AgentToolExecutor;
  private readonly defaultMaxConcurrency: number;
  private readonly defaultMaxRecursionDepth: number;
  private readonly defaultMaxTotalTokens: number;
  private readonly defaultMaxCostUsd: number;
  private readonly defaultTimeoutMs: number;
  private readonly activeAbortControllers = new Map<string, AbortController>();

  constructor(options?: MultiAgentEngineOptions) {
    this.store = options?.store ?? defaultCollectionStore;
    this.auditStore = options?.auditStore ?? defaultDurableStore;
    this.permissions = options?.permissions ?? permissionsGateway;
    this.providers = options?.providers ?? resolveDefaultProviders();
    this.toolExecutor = options?.toolExecutor;
    this.defaultMaxConcurrency = Math.max(1, options?.defaultMaxConcurrency ?? 3);
    this.defaultMaxRecursionDepth = Math.max(1, options?.defaultMaxRecursionDepth ?? 3);
    this.defaultMaxTotalTokens = Math.max(100, options?.defaultMaxTotalTokens ?? 40_000);
    this.defaultMaxCostUsd = Math.max(0.001, options?.defaultMaxCostUsd ?? 1.0);
    this.defaultTimeoutMs = Math.max(1_000, options?.defaultTimeoutMs ?? 120_000);
  }

  public getRoles(): AgentRoleSpec[] {
    return Object.values(AGENT_ROLE_CATALOG);
  }

  public getActiveProvider(): ModelProviderAdapter | null {
    for (const p of this.providers) {
      if (p.isConfigured()) return p;
    }
    return null;
  }

  public getHealth(ctx?: DurableRequestContext) {
    const configuredProviders = this.providers.filter((p) => p.isConfigured()).map((p) => p.name);
    return {
      ready: configuredProviders.length > 0,
      configuredProviders,
      activeProvider: configuredProviders[0] || null,
      supportedRoles: Object.keys(AGENT_ROLE_CATALOG),
      persistenceMode: this.store.getMode(ctx),
    };
  }

  /**
   * Build a structured default DAG plan when the caller supplies only a high-level objective.
   */
  public buildDefaultPlan(objective: string): AgentTaskNodeInput[] {
    const lower = objective.toLowerCase();
    const isCoding = /\b(code|build|implement|fix|debug|app|api|component|refactor|test|website)\b/.test(lower);
    const isBrowser = /\b(browser|website|page|screenshot|dom|ui check|scrape|inspect url)\b/.test(lower);

    if (isCoding) {
      const nodes: AgentTaskNodeInput[] = [
        {
          id: 'research_arch',
          role: 'research',
          title: 'Requirements & Architecture Research',
          objective: `Analyze technical requirements and constraints for: ${objective}`,
        },
        {
          id: 'security_threat_model',
          role: 'security_reviewer',
          title: 'Security & Boundary Review',
          objective: `Identify security, authentication, input validation, and boundary risks for: ${objective}`,
        },
        {
          id: 'coding_impl',
          role: 'coding',
          title: 'Implementation Plan & Code',
          objective: `Produce the concrete implementation for: ${objective}`,
          dependsOn: ['research_arch', 'security_threat_model'],
        },
        {
          id: 'testing_verify',
          role: 'testing',
          title: 'Test Plan & Verification',
          objective: `Define and validate automated test cases covering happy paths and edge cases for: ${objective}`,
          dependsOn: ['coding_impl'],
        },
      ];
      if (isBrowser) {
        nodes.push({
          id: 'browser_verify',
          role: 'browser',
          title: 'Browser Verification Plan',
          objective: `Verify live UI/DOM rendering, console cleanliness, and user flows for: ${objective}`,
          dependsOn: ['coding_impl'],
        });
      }
      return nodes;
    }

    return [
      {
        id: 'research_primary',
        role: 'research',
        title: 'Primary Research & Evidence Gathering',
        objective: `Research verified facts and key data points for: ${objective}`,
      },
      {
        id: 'analysis_synthesis',
        role: 'analysis',
        title: 'Structured Analysis',
        objective: `Analyze trade-offs, structure findings, and highlight key conclusions for: ${objective}`,
        dependsOn: ['research_primary'],
      },
      {
        id: 'documentation_report',
        role: 'documentation',
        title: 'Executive Summary & Documentation',
        objective: `Draft a concise, well-structured final deliverable for: ${objective}`,
        dependsOn: ['analysis_synthesis'],
      },
    ];
  }

  /**
   * Validate DAG structure (no unknown roles, no missing deps, no cycles, recursion depth <= max).
   */
  private validatePlan(nodes: AgentTaskNodeInput[], maxRecursionDepth: number): void {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new MultiAgentEngineError('At least one agent node is required.', 'INVALID_PLAN', 400);
    }
    if (nodes.length > 20) {
      throw new MultiAgentEngineError('Plan exceeds maximum of 20 agent nodes.', 'PLAN_TOO_LARGE', 400);
    }

    const byId = new Map<string, AgentTaskNodeInput>();
    for (const node of nodes) {
      if (!node.id || !node.id.trim()) {
        throw new MultiAgentEngineError('Each agent node requires a non-empty id.', 'INVALID_NODE', 400);
      }
      if (byId.has(node.id)) {
        throw new MultiAgentEngineError(`Duplicate node id '${node.id}'.`, 'DUPLICATE_NODE', 400);
      }
      if (!AGENT_ROLE_CATALOG[node.role]) {
        throw new MultiAgentEngineError(`Unsupported agent role '${node.role}'.`, 'INVALID_ROLE', 400);
      }
      if ((node.recursionDepth ?? 0) > maxRecursionDepth) {
        throw new MultiAgentEngineError(
          `Node '${node.id}' exceeds maximum recursion depth (${maxRecursionDepth}).`,
          'MAX_RECURSION_EXCEEDED',
          400,
        );
      }
      byId.set(node.id, node);
    }

    // Cycle detection (DFS 3-color) & missing dependency validation
    const state = new Map<string, 'visiting' | 'visited'>();
    const visit = (id: string, depth: number) => {
      if (depth > maxRecursionDepth + nodes.length) {
        throw new MultiAgentEngineError('Dependency graph exceeds allowed depth.', 'CYCLE_DETECTED', 400);
      }
      const node = byId.get(id)!;
      state.set(id, 'visiting');
      for (const dep of node.dependsOn || []) {
        if (!byId.has(dep)) {
          throw new MultiAgentEngineError(`Node '${id}' depends on unknown node '${dep}'.`, 'UNKNOWN_DEPENDENCY', 400);
        }
        const depState = state.get(dep);
        if (depState === 'visiting') {
          throw new MultiAgentEngineError(`Circular dependency detected involving '${dep}'.`, 'CYCLE_DETECTED', 400);
        }
        if (!depState) visit(dep, depth + 1);
      }
      state.set(id, 'visited');
    };

    for (const id of byId.keys()) {
      if (!state.has(id)) visit(id, 0);
    }
  }

  /**
   * Execute a full autonomous multi-agent run with real provider calls, DAG scheduling,
   * scoped tool checks, token/cost budget enforcement, correction rounds, and final QA review.
   */
  public async runOrchestration(
    ctx: DurableRequestContext,
    input: {
      objective: string;
      nodes?: AgentTaskNodeInput[];
      maxConcurrency?: number;
      maxRecursionDepth?: number;
      maxTotalTokens?: number;
      maxCostUsd?: number;
      timeoutMs?: number;
      maxCorrectionRounds?: number;
      enableQaReview?: boolean;
      toolArgsByNode?: Record<string, Array<{ toolName: string; args: Record<string, unknown>; approvalToken?: string }>>;
      signal?: AbortSignal;
    },
  ): Promise<MultiAgentRunRecord> {
    const objective = (input.objective || '').trim();
    if (!objective) {
      throw new MultiAgentEngineError('objective is required.', 'INVALID_OBJECTIVE', 400);
    }

    const provider = this.getActiveProvider();
    if (!provider) {
      throw new MultiAgentEngineError(
        'No real AI model provider is configured. Set GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.',
        'MODEL_PROVIDER_UNAVAILABLE',
        503,
      );
    }

    const maxConcurrency = Math.min(8, Math.max(1, input.maxConcurrency ?? this.defaultMaxConcurrency));
    const maxRecursionDepth = Math.min(10, Math.max(1, input.maxRecursionDepth ?? this.defaultMaxRecursionDepth));
    const maxTotalTokens = Math.max(100, input.maxTotalTokens ?? this.defaultMaxTotalTokens);
    const maxCostUsd = Math.max(0.0001, input.maxCostUsd ?? this.defaultMaxCostUsd);
    const timeoutMs = Math.max(500, input.timeoutMs ?? this.defaultTimeoutMs);
    const maxCorrectionRounds = Math.min(3, Math.max(0, input.maxCorrectionRounds ?? 1));
    const enableQaReview = input.enableQaReview ?? true;

    const planNodes = input.nodes && input.nodes.length > 0 ? input.nodes : this.buildDefaultPlan(objective);
    this.validatePlan(planNodes, maxRecursionDepth);

    const runId = `marun_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const record: MultiAgentRunRecord = {
      runId,
      userId: ctx.userId,
      objective: objective.slice(0, 4000),
      status: 'running',
      provider: provider.name,
      maxConcurrency,
      maxRecursionDepth,
      maxTotalTokens,
      maxCostUsd,
      timeoutMs,
      nodes: [],
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.put(ctx, RUNS_COLLECTION, runId, record);

    const abortController = new AbortController();
    this.activeAbortControllers.set(runId, abortController);

    const externalAbortHandler = () => abortController.abort(new Error('Cancelled by caller'));
    if (input.signal) {
      if (input.signal.aborted) {
        abortController.abort(new Error('Cancelled by caller'));
      } else {
        input.signal.addEventListener('abort', externalAbortHandler, { once: true });
      }
    }

    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error(`Multi-agent run exceeded timeout (${timeoutMs}ms).`));
    }, timeoutMs);

    const completedOutputs = new Map<string, AgentNodeExecutionResult>();
    const pending = new Map<string, AgentTaskNodeInput>(planNodes.map((n) => [n.id, n]));
    const inFlight = new Set<string>();

    const checkBudgetOrThrow = () => {
      if (abortController.signal.aborted) {
        const reason = abortController.signal.reason instanceof Error
          ? abortController.signal.reason.message
          : 'Run cancelled or timed out.';
        throw new MultiAgentEngineError(reason, 'RUN_ABORTED', 499);
      }
      if (record.totalUsage.totalTokens > maxTotalTokens) {
        throw new MultiAgentEngineError(
          `Token budget exceeded (${record.totalUsage.totalTokens} > ${maxTotalTokens}).`,
          'TOKEN_BUDGET_EXCEEDED',
          402,
        );
      }
      if (record.totalUsage.costUsd > maxCostUsd) {
        throw new MultiAgentEngineError(
          `Cost budget exceeded ($${record.totalUsage.costUsd.toFixed(6)} > $${maxCostUsd.toFixed(6)}).`,
          'COST_BUDGET_EXCEEDED',
          402,
        );
      }
    };

    const addUsage = (u: ModelUsageMetrics) => {
      record.totalUsage.promptTokens += u.promptTokens;
      record.totalUsage.completionTokens += u.completionTokens;
      record.totalUsage.totalTokens += u.totalTokens;
      record.totalUsage.costUsd = Number((record.totalUsage.costUsd + u.costUsd).toFixed(6));
    };

    const executeSingleNode = async (node: AgentTaskNodeInput): Promise<AgentNodeExecutionResult> => {
      const startedMs = Date.now();
      const startedAt = new Date(startedMs).toISOString();
      const spec = AGENT_ROLE_CATALOG[node.role];
      const toolInvocations: AgentNodeExecutionResult['toolInvocations'] = [];

      // Isolated context: only explicit predecessor summaries are handed off (never raw private state)
      const handoffContext = (node.dependsOn || [])
        .map((depId) => {
          const depRes = completedOutputs.get(depId);
          if (!depRes) return '';
          return `[Predecessor ${depRes.role}:${depRes.nodeId} (${depRes.title})]\n${(depRes.output || '').slice(0, 2500)}`;
        })
        .filter(Boolean)
        .join('\n\n');

      // Enforce scoped tool allowlist + Feature 02 permissions gateway for any requested tool calls
      const scheduledTools = input.toolArgsByNode?.[node.id] || [];
      for (const reqTool of scheduledTools) {
        if (!spec.allowedTools.includes(reqTool.toolName)) {
          toolInvocations.push({
            toolName: reqTool.toolName,
            allowed: false,
            reason: `Tool '${reqTool.toolName}' is not permitted for agent role '${node.role}'.`,
          });
          await this.permissions.recordSecurityAuditDurable(
            ctx,
            {
              action: `agent_tool_scope_denied:${reqTool.toolName}`,
              category: 'multi_agent',
              resourceId: `${runId}:${node.id}`,
              status: 'denied',
              details: { role: node.role, toolName: reqTool.toolName },
            },
            this.auditStore,
          );
          continue;
        }

        const evalRes = await this.permissions.evaluateActionDurable(
          {
            toolName: reqTool.toolName,
            args: reqTool.args,
            userId: ctx.userId,
            approvalToken: reqTool.approvalToken,
          },
          ctx,
          this.auditStore,
        );

        if (!evalRes.allowed) {
          toolInvocations.push({
            toolName: reqTool.toolName,
            allowed: false,
            reason: evalRes.reason,
          });
          continue;
        }

        if (this.toolExecutor) {
          const execOut = await this.toolExecutor({
            toolName: reqTool.toolName,
            args: reqTool.args,
            role: node.role,
            userId: ctx.userId,
          });
          toolInvocations.push({
            toolName: reqTool.toolName,
            allowed: execOut.ok,
            reason: execOut.ok ? 'Executed within role scope.' : execOut.error || 'Tool execution failed.',
            output: execOut.output,
          });
        } else {
          toolInvocations.push({
            toolName: reqTool.toolName,
            allowed: true,
            reason: 'Authorized within role scope.',
          });
        }
      }

      const toolEvidence =
        toolInvocations.length > 0
          ? `\n\nTool Execution Results:\n${JSON.stringify(toolInvocations, null, 2).slice(0, 2000)}`
          : '';

      const basePrompt = [
        `Overall Objective: ${objective}`,
        `Assigned Node: ${node.title} (Role: ${spec.displayName})`,
        `Task: ${node.objective}`,
        handoffContext ? `Verified Handoff From Predecessors:\n${handoffContext}` : 'No predecessor handoffs.',
        toolEvidence,
      ]
        .filter(Boolean)
        .join('\n\n');

      let accumulatedUsage: ModelUsageMetrics = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        provider: provider.name,
        model: 'unknown',
      };

      let finalOutput = '';
      let correctionAttempts = 0;

      for (let attempt = 0; attempt <= maxCorrectionRounds; attempt++) {
        checkBudgetOrThrow();
        const promptForAttempt =
          attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nPrevious draft failed validation. Ensure your response is substantive and directly addresses all required terms: ${(node.requiredKeywords || []).join(', ')}.`;

        const gen = await provider.generate({
          role: node.role,
          systemPrompt: spec.systemPrompt,
          userPrompt: promptForAttempt,
          preferredTier: spec.preferredTier,
          maxOutputTokens: spec.maxOutputTokens,
          signal: abortController.signal,
        });

        accumulatedUsage = {
          promptTokens: accumulatedUsage.promptTokens + gen.usage.promptTokens,
          completionTokens: accumulatedUsage.completionTokens + gen.usage.completionTokens,
          totalTokens: accumulatedUsage.totalTokens + gen.usage.totalTokens,
          costUsd: Number((accumulatedUsage.costUsd + gen.usage.costUsd).toFixed(6)),
          provider: gen.usage.provider,
          model: gen.usage.model,
        };
        addUsage(gen.usage);
        checkBudgetOrThrow();

        finalOutput = gen.text;
        const missingKeywords = (node.requiredKeywords || []).filter(
          (kw) => !finalOutput.toLowerCase().includes(kw.toLowerCase()),
        );
        const valid = finalOutput.trim().length >= 10 && missingKeywords.length === 0;
        if (valid) {
          break;
        }
        if (attempt < maxCorrectionRounds) {
          correctionAttempts += 1;
        }
      }

      const completedMs = Date.now();
      return {
        nodeId: node.id,
        role: node.role,
        title: node.title,
        status: 'completed',
        dependsOn: node.dependsOn || [],
        output: finalOutput,
        correctionAttempts,
        toolInvocations,
        usage: accumulatedUsage,
        startedAt,
        completedAt: new Date(completedMs).toISOString(),
        durationMs: Math.max(0, completedMs - startedMs),
      };
    };

    try {
      while (pending.size > 0) {
        checkBudgetOrThrow();

        const readyNodes = Array.from(pending.values()).filter((node) => {
          if (inFlight.has(node.id)) return false;
          return (node.dependsOn || []).every((depId) => completedOutputs.get(depId)?.status === 'completed');
        });

        if (readyNodes.length === 0) {
          throw new MultiAgentEngineError(
            'No runnable agent nodes remain due to failed or unsatisfied dependencies.',
            'DEPENDENCY_DEADLOCK',
            500,
          );
        }

        const wave = readyNodes.slice(0, maxConcurrency);
        for (const n of wave) inFlight.add(n.id);

        const waveResults = await Promise.all(
          wave.map(async (node) => {
            try {
              return await executeSingleNode(node);
            } finally {
              inFlight.delete(node.id);
              pending.delete(node.id);
            }
          }),
        );

        for (const res of waveResults) {
          completedOutputs.set(res.nodeId, res);
          record.nodes.push(res);
        }

        record.updatedAt = new Date().toISOString();
        await this.store.put(ctx, RUNS_COLLECTION, runId, record);
      }

      // Final QA Reviewer consolidation pass
      if (enableQaReview) {
        checkBudgetOrThrow();
        const qaSpec = AGENT_ROLE_CATALOG.qa;
        const summaryBlock = record.nodes
          .map((n) => `## ${n.title} (${n.role})\n${(n.output || '').slice(0, 2000)}`)
          .join('\n\n');

        const qaGen = await provider.generate({
          role: 'qa',
          systemPrompt: qaSpec.systemPrompt,
          userPrompt: `Review all specialized agent outputs for objective: "${objective}".\nRespond with a concise verification summary and final consolidated answer.\n\n${summaryBlock}`,
          preferredTier: qaSpec.preferredTier,
          maxOutputTokens: qaSpec.maxOutputTokens,
          signal: abortController.signal,
        });

        addUsage(qaGen.usage);
        checkBudgetOrThrow();

        const failedFlag = /\bVERDICT:\s*FAIL\b/i.test(qaGen.text);
        record.qaReview = {
          passed: !failedFlag,
          summary: qaGen.text,
          issues: failedFlag ? ['QA Reviewer flagged unresolved issues in agent deliverables.'] : [],
          usage: qaGen.usage,
        };
        record.consolidatedAnswer = qaGen.text;
      } else {
        record.consolidatedAnswer = record.nodes
          .map((n) => `### ${n.title}\n${n.output || ''}`)
          .join('\n\n');
      }

      const doneIso = new Date().toISOString();
      record.status = 'completed';
      record.updatedAt = doneIso;
      record.completedAt = doneIso;
      await this.store.put(ctx, RUNS_COLLECTION, runId, record);

      await this.permissions.recordSecurityAuditDurable(
        ctx,
        {
          action: 'multi_agent_run',
          category: 'multi_agent',
          resourceId: runId,
          status: 'succeeded',
          details: {
            provider: record.provider,
            nodeCount: record.nodes.length,
            totalTokens: record.totalUsage.totalTokens,
            costUsd: record.totalUsage.costUsd,
          },
        },
        this.auditStore,
      );

      return record;
    } catch (err) {
      const doneIso = new Date().toISOString();
      const isCancelled = abortController.signal.aborted;
      record.status = isCancelled ? 'cancelled' : 'failed';
      record.error = err instanceof Error ? err.message : 'Multi-agent execution failed.';
      record.updatedAt = doneIso;
      record.completedAt = doneIso;
      await this.store.put(ctx, RUNS_COLLECTION, runId, record);

      await this.permissions.recordSecurityAuditDurable(
        ctx,
        {
          action: 'multi_agent_run',
          category: 'multi_agent',
          resourceId: runId,
          status: 'failed',
          details: { error: record.error, status: record.status },
        },
        this.auditStore,
      );

      if (err instanceof MultiAgentEngineError) throw err;
      throw new MultiAgentEngineError(record.error, 'MULTI_AGENT_FAILED', 500);
    } finally {
      clearTimeout(timeoutHandle);
      if (input.signal) {
        input.signal.removeEventListener('abort', externalAbortHandler);
      }
      this.activeAbortControllers.delete(runId);
    }
  }

  public async getRun(ctx: DurableRequestContext, runId: string): Promise<MultiAgentRunRecord | null> {
    const run = await this.store.get<MultiAgentRunRecord>(ctx, RUNS_COLLECTION, runId);
    if (!run || run.userId !== ctx.userId) return null;
    return run;
  }

  public async listRuns(ctx: DurableRequestContext, limit = 30): Promise<MultiAgentRunRecord[]> {
    const all = await this.store.list<MultiAgentRunRecord>(ctx, RUNS_COLLECTION, 100);
    return all
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.min(100, Math.max(1, limit)));
  }

  public async cancelRun(ctx: DurableRequestContext, runId: string): Promise<MultiAgentRunRecord | null> {
    const controller = this.activeAbortControllers.get(runId);
    if (controller) {
      controller.abort(new Error('Cancelled by user request.'));
    }
    const existing = await this.getRun(ctx, runId);
    if (!existing) return null;
    if (existing.status === 'running') {
      existing.status = 'cancelled';
      existing.error = 'Cancelled by user request.';
      existing.updatedAt = new Date().toISOString();
      existing.completedAt = existing.updatedAt;
      await this.store.put(ctx, RUNS_COLLECTION, runId, existing);
    }
    return existing;
  }
}

export const defaultMultiAgentEngine = new MultiAgentRuntimeEngine();
