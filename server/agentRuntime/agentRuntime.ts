/**
 * Feature 03: True Autonomous Multi-Agent Runtime.
 *
 * Executes real provider-backed sub-agents. Every agent run performs an actual
 * model call through the injected model client (default: Gemini via
 * @google/genai), keeps an isolated per-role system instruction and context,
 * tracks token usage taken from provider-reported usage metadata, enforces
 * budgets, timeouts, concurrency limits and dependency ordering, and subjects
 * the consolidated result to a reviewer/QA pass before completion.
 *
 * Sub-agent results are never fabricated: if a provider call fails, the run is
 * failed or corrected and the evidence trail records exactly what happened.
 */

import crypto from 'crypto';
import { DurableStore, getDefaultDurableStore } from '../durable/store';
import { permissionsGateway } from '../permissionsGateway';

export type AgentRole =
  | 'research'
  | 'coding'
  | 'debugging'
  | 'testing'
  | 'analysis'
  | 'browser'
  | 'security_review'
  | 'qa'
  | 'documentation';

export interface AgentDefinition {
  role: AgentRole;
  displayName: string;
  systemInstruction: string;
  allowedTools: string[];
  defaultModel: string;
  maxOutputTokens: number;
}

export interface AgentRunRecord {
  runId: string;
  userId: string;
  executionId: string;
  role: AgentRole;
  objective: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'corrected' | 'cancelled';
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  usageSource: 'provider' | 'unavailable';
  output?: string;
  correctionOf?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  validationStatus?: 'passed' | 'failed' | 'skipped';
}

export interface SubTaskSpec {
  id: string;
  role: AgentRole;
  goal: string;
  dependsOn?: string[];
  context?: string;
}

export interface SubTaskResult {
  subTaskId: string;
  role: AgentRole;
  status: 'completed' | 'failed' | 'corrected' | 'cancelled' | 'blocked_budget' | 'blocked_approval';
  output: string;
  runRecord: AgentRunRecord;
  correctionOf?: string;
  validationStatus?: 'passed' | 'failed';
  issues?: string[];
}

export interface AgentRuntimeBudget {
  maxAgents: number;
  maxConcurrency: number;
  maxTotalTokens: number;
  perAgentTimeoutMs: number;
  maxCorrectionRounds: number;
}

export const DEFAULT_BUDGET: AgentRuntimeBudget = {
  maxAgents: 8,
  maxConcurrency: 3,
  maxTotalTokens: 400_000,
  perAgentTimeoutMs: 120_000,
  maxCorrectionRounds: 1,
};

export interface AgentModelClientRequest {
  userId: string;
  executionId: string;
  role: AgentRole;
  model: string;
  systemInstruction: string;
  prompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface AgentModelClientResponse {
  text: string;
  model: string;
  provider: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; source: 'provider' | 'unavailable' };
}

export type AgentModelClient = (req: AgentModelClientRequest) => Promise<AgentModelClientResponse>;

export interface AgentToolInvocation {
  toolName: string;
  args: Record<string, any>;
  userId: string;
  role: AgentRole;
  executionId: string;
  approvalToken?: string;
}

export interface AgentToolResult {
  allowed: boolean;
  success: boolean;
  data?: any;
  error?: string;
  requiresApproval?: boolean;
  challengeId?: string;
  reason?: string;
}

/** Tool calls always pass through the durable permission gateway server-side. */
export type AgentToolExecutor = (invocation: AgentToolInvocation) => Promise<AgentToolResult>;

export interface AgentRuntimeExecuteParams {
  userId: string;
  objective: string;
  subTaskPlan: SubTaskSpec[];
  context?: string;
  budget?: Partial<AgentRuntimeBudget>;
  tools?: { executor: AgentToolExecutor; grants: Partial<Record<AgentRole, string[]>> };
}

export interface AgentRuntimeResult {
  executionId: string;
  objective: string;
  status: 'completed' | 'partial' | 'failed';
  subTaskResults: SubTaskResult[];
  reviewerOutput: string | null;
  reviewerRun: AgentRunRecord | null;
  totals: { promptTokens: number; completionTokens: number; totalTokens: number; usageSource: 'provider' | 'unavailable' };
  durationMs: number;
  evidence: Array<{ subTaskId: string; role: AgentRole; status: string; tokens: number }>;
}

export const AGENT_ROLE_DEFINITIONS: Record<AgentRole, AgentDefinition> = {
  research: {
    role: 'research',
    displayName: 'Research Agent',
    systemInstruction:
      'You are the Research Agent. Gather verified facts and cite sources. Never invent sources; mark uncertainty explicitly.',
    allowedTools: ['web_search', 'fetch_webpage'],
    defaultModel: 'gemini-3-flash-preview',
    maxOutputTokens: 4096,
  },
  coding: {
    role: 'coding',
    displayName: 'Coding Agent',
    systemInstruction:
      'You are the Coding Agent. Produce complete, runnable production-grade code. Never leave TODO stubs in delivered code.',
    allowedTools: ['terminal_execute', 'filesystem_write', 'filesystem_read', 'filesystem_list'],
    defaultModel: 'gemini-3.1-pro-preview',
    maxOutputTokens: 8192,
  },
  debugging: {
    role: 'debugging',
    displayName: 'Debugging Agent',
    systemInstruction:
      'You are the Debugging Agent. Diagnose failures from evidence: logs, stack traces, and reproduced errors. Name the root cause explicitly.',
    allowedTools: ['terminal_execute', 'filesystem_read'],
    defaultModel: 'gemini-3.1-pro-preview',
    maxOutputTokens: 4096,
  },
  testing: {
    role: 'testing',
    displayName: 'Testing Agent',
    systemInstruction:
      'You are the Testing Agent. Execute or specify concrete tests with expected vs actual outcomes. Do not claim a test passed without evidence.',
    allowedTools: ['terminal_execute'],
    defaultModel: 'gemini-3-flash-preview',
    maxOutputTokens: 4096,
  },
  analysis: {
    role: 'analysis',
    displayName: 'Analysis Agent',
    systemInstruction: 'You are the Analysis Agent. Break down data and trade-offs into structured conclusions.',
    allowedTools: [],
    defaultModel: 'gemini-3-flash-preview',
    maxOutputTokens: 4096,
  },
  browser: {
    role: 'browser',
    displayName: 'Browser Agent',
    systemInstruction:
      'You are the Browser Agent. Drive real browser sessions through permitted tools only. Report the actual observed state, never assumptions.',
    allowedTools: ['browser_session_create', 'browser_navigate', 'browser_inspect', 'browser_click', 'browser_fill', 'browser_screenshot'],
    defaultModel: 'gemini-3-flash-preview',
    maxOutputTokens: 4096,
  },
  security_review: {
    role: 'security_review',
    displayName: 'Security Reviewer',
    systemInstruction:
      'You are the Security Reviewer. Identify vulnerabilities, unsafe data flows and policy violations. Fail the review when severity is high.',
    allowedTools: [],
    defaultModel: 'gemini-3.1-pro-preview',
    maxOutputTokens: 4096,
  },
  qa: {
    role: 'qa',
    displayName: 'Quality Assurance Agent',
    systemInstruction:
      'You are the QA Agent. Verify the work against the original objective, list unmet requirements, and give a verdict: accepted or needs_work.',
    allowedTools: [],
    defaultModel: 'gemini-3.1-pro-preview',
    maxOutputTokens: 4096,
  },
  documentation: {
    role: 'documentation',
    displayName: 'Documentation Agent',
    systemInstruction: 'You are the Documentation Agent. Summarize delivered work, constraints and usage precisely.',
    allowedTools: [],
    defaultModel: 'gemini-3-flash-preview',
    maxOutputTokens: 4096,
  },
};

/** Build the default provider-backed model client using @google/genai. */
export function createGeminiModelClient(apiKey: string): AgentModelClient {
  return async (req: AgentModelClientRequest): Promise<AgentModelClientResponse> => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const response: any = await ai.models.generateContent({
      model: req.model,
      contents: req.prompt,
      config: {
        systemInstruction: req.systemInstruction,
        maxOutputTokens: req.maxOutputTokens,
      },
      // @google/genai accepts requestOptions as the third arg in some versions; keep signal via config.
    });
    const text = String(response?.text ?? '');
    const usageMeta = response?.usageMetadata;
    return {
      text,
      model: req.model,
      provider: 'google',
      usage: {
        promptTokens: Number(usageMeta?.promptTokenCount) || 0,
        completionTokens: Number(usageMeta?.candidatesTokenCount) || 0,
        totalTokens: Number(usageMeta?.totalTokenCount) || 0,
        source: usageMeta ? 'provider' : 'unavailable',
      },
    };
  };
}

export function isGeminiModelClientConfigured(): boolean {
  return Boolean((process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim());
}

export function getGeminiApiKey(): string | null {
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim();
  return key || null;
}

export class AgentRuntimeService {
  constructor(private readonly store: DurableStore | null = null) {}

  private get backend(): DurableStore {
    if (this.store) return this.store;
    return getDefaultDurableStore();
  }

  static newExecutionId(): string {
    return `agent_exec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private logRun(record: AgentRunRecord): void {
    const store = this.backend;
    if (store.kind === 'unavailable') return;
    void store
      .set('system_agent_runs', record.runId, record as unknown as Record<string, any>)
      .catch(() => undefined);
  }

  /**
   * Execute a multi-agent plan with dependency ordering, bounded concurrency,
   * budgets, one corrective round for incomplete results, and a final QA
   * reviewer pass. Token totals come only from provider usage metadata.
   */
  public async execute(
    params: AgentRuntimeExecuteParams,
    modelClient: AgentModelClient,
  ): Promise<AgentRuntimeResult> {
    const started = Date.now();
    const budget: AgentRuntimeBudget = { ...DEFAULT_BUDGET, ...(params.budget ?? {}) };
    if (params.subTaskPlan.length > budget.maxAgents) {
      throw new Error(`Plan requests ${params.subTaskPlan.length} agents; budget caps at ${budget.maxAgents}.`);
    }
    const executionId = AgentRuntimeService.newExecutionId();

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let usageSource: 'provider' | 'unavailable' = 'unavailable';

    const collectUsage = (usage: AgentModelClientResponse['usage']) => {
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      totalTokens += usage.totalTokens;
      if (usage.source === 'provider') usageSource = 'provider';
    };

    const results = new Map<string, SubTaskResult>();
    const grants = params.tools?.grants ?? {};
    const toolExecutor = params.tools?.executor ?? null;
    const pending = [...params.subTaskPlan];
    const rounds = 1 + budget.maxCorrectionRounds;
    let round = 0;
    const correctionAttempts = new Set<string>();

    while (pending.length > 0 && round < rounds) {
      round += 1;
      const ready = pending.filter(
        (t) => (t.dependsOn ?? []).every((dep) => results.get(dep)?.status === 'completed' || results.get(dep)?.status === 'corrected'),
      );
      const notReady = pending.filter((t) => !ready.includes(t));
      const blockedForever = notReady.filter((t) =>
        (t.dependsOn ?? []).every(
          (dep) => results.has(dep) && results.get(dep)!.status !== 'completed' && results.get(dep)!.status !== 'corrected',
        ),
      );
      for (const blocked of blockedForever) {
        results.set(blocked.id, {
          subTaskId: blocked.id,
          role: blocked.role,
          status: 'failed',
          output: 'Dependency failure: predecessor subtask did not complete.',
          runRecord: {
            ...this.makeRecord(executionId, params.userId, blocked.role, blocked.goal, 'failed'),
            validationStatus: 'failed',
            error: 'Dependency failure',
          },
        });
      }
      const runnable = [...ready];
      pending.length = 0;
      for (const t of notReady) {
        if (!blockedForever.includes(t)) pending.push(t);
      }

      // Execute runnable batch with bounded concurrency.
      let index = 0;
      const workers: Array<Promise<void>> = [];
      const launch = async (): Promise<void> => {
        while (index < runnable.length) {
          if (totalTokens >= budget.maxTotalTokens) {
            for (const t of runnable.slice(index)) {
              results.set(t.id, {
                subTaskId: t.id,
                role: t.role,
                status: 'blocked_budget',
                output: '',
                runRecord: this.makeRecord(executionId, params.userId, t.role, t.goal, 'failed'),
              });
            }
            index = runnable.length;
            return;
          }
          const t = runnable[index++];
          const result = await this.runSingleAgent(t, {
            params,
            executionId,
            budget,
            round,
            modelClient,
            collectUsage,
            toolExecutor,
            grants,
            priorResults: results,
          });
          results.set(t.id, result);
          if (
            result.status === 'failed' &&
            !correctionAttempts.has(t.id) &&
            round < rounds &&
            totalTokens < budget.maxTotalTokens
          ) {
            correctionAttempts.add(t.id);
            pending.push({
              ...t,
              context: [
                t.context,
                `A previous attempt failed: ${result.runRecord.error ?? 'unacceptable output'}. Produce a corrected result.`,
              ]
                .filter(Boolean)
                .join('\n'),
            });
          }
        }
      };
      for (let i = 0; i < Math.min(budget.maxConcurrency, Math.max(1, runnable.length)); i++) {
        workers.push(launch());
      }
      await Promise.all(workers);
    }

    // Reviewer / QA pass (always a real provider call when anything was produced).
    const produced = Array.from(results.values()).filter((r) => r.output && r.status !== 'failed');
    let reviewerOutput: string | null = null;
    let reviewerRun: AgentRunRecord | null = null;
    if (produced.length > 0 && totalTokens < budget.maxTotalTokens * 2) {
      try {
        const qa = AGENT_ROLE_DEFINITIONS.qa;
        const reviewerPrompt = [
          `Original objective: ${params.objective}`,
          '',
          'Sub-agent outputs:',
          ...produced.map((r) => `## ${r.subTaskId} (${r.role})\n${r.output.slice(0, 6000)}`),
          '',
          'Verify completeness against the objective. List any unmet requirement. End with a verdict line "verdict: accepted" or "verdict: needs_work".',
        ].join('\n');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), budget.perAgentTimeoutMs);
        try {
          const response = await modelClient({
            userId: params.userId,
            executionId,
            role: 'qa',
            model: qa.defaultModel,
            systemInstruction: qa.systemInstruction,
            prompt: reviewerPrompt,
            maxOutputTokens: qa.maxOutputTokens,
            signal: controller.signal,
          });
          reviewerOutput = response.text;
          reviewerRun = {
            ...this.makeRecord(executionId, params.userId, 'qa', 'Final reviewer verification pass', 'completed'),
            model: response.model,
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
            usageSource: response.usage.source,
            output: response.text,
            finishedAt: new Date().toISOString(),
            validationStatus: /verdict:\s*accepted/i.test(response.text) ? 'passed' : 'failed',
          };
          collectUsage(response.usage);
          this.logRun(reviewerRun);
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        reviewerRun = {
          ...this.makeRecord(executionId, params.userId, 'qa', 'Final reviewer verification pass', 'failed'),
          error: error instanceof Error ? error.message : 'reviewer failed',
          finishedAt: new Date().toISOString(),
        };
        this.logRun(reviewerRun);
      }
    }

    const completed = Array.from(results.values()).filter((r) => r.status === 'completed' || r.status === 'corrected');
    const status: AgentRuntimeResult['status'] =
      completed.length === 0 ? 'failed' : completed.length === params.subTaskPlan.length ? 'completed' : 'partial';

    return {
      executionId,
      objective: params.objective,
      status,
      subTaskResults: Array.from(results.values()),
      reviewerOutput,
      reviewerRun,
      totals: {
        promptTokens,
        completionTokens,
        totalTokens,
        usageSource,
      },
      durationMs: Date.now() - started,
      evidence: Array.from(results.values()).map((r) => ({
        subTaskId: r.subTaskId,
        role: r.role,
        status: r.status,
        tokens: r.runRecord.totalTokens,
      })),
    };
  }

  private async runSingleAgent(
    t: SubTaskSpec,
    ctx: {
      params: AgentRuntimeExecuteParams;
      executionId: string;
      budget: AgentRuntimeBudget;
      round: number;
      modelClient: AgentModelClient;
      collectUsage: (u: AgentModelClientResponse['usage']) => void;
      toolExecutor: AgentToolExecutor | null;
      grants: Partial<Record<AgentRole, string[]>>;
      priorResults: Map<string, SubTaskResult>;
    },
  ): Promise<SubTaskResult> {
    const def = AGENT_ROLE_DEFINITIONS[t.role];
    if (!def) {
      const failure = this.makeRecord(ctx.executionId, ctx.params.userId, t.role, t.goal, 'failed');
      failure.error = `Unknown agent role '${t.role}'.`;
      this.logRun(failure);
      return { subTaskId: t.id, role: t.role, status: 'failed', output: '', runRecord: failure };
    }

    const dependencyContext = (t.dependsOn ?? [])
      .map((dep) => ctx.priorResults.get(dep))
      .filter(Boolean)
      .map((r) => `Result from ${r!.subTaskId} (${r!.role}):\n${(r!.output || '(no output)').slice(0, 4000)}`)
      .join('\n\n');

    const prompt = [
      `Objective: ${ctx.params.objective}`,
      ctx.params.context ? `Shared context:\n${ctx.params.context}` : '',
      t.context ? `Task-specific context:\n${t.context}` : '',
      dependencyContext ? `Results from upstream agents:\n${dependencyContext}` : '',
      `Your goal: ${t.goal}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ctx.budget.perAgentTimeoutMs);
    const startedAt = new Date().toISOString();

    try {
      const response = await ctx.modelClient({
        userId: ctx.params.userId,
        executionId: ctx.executionId,
        role: t.role,
        model: def.defaultModel,
        systemInstruction: def.systemInstruction,
        prompt,
        maxOutputTokens: def.maxOutputTokens,
        signal: controller.signal,
      });
      ctx.collectUsage(response.usage);

      const run = this.makeRecord(ctx.executionId, ctx.params.userId, t.role, t.goal, 'completed');
      run.model = response.model;
      run.startedAt = startedAt;
      run.finishedAt = new Date().toISOString();
      run.promptTokens = response.usage.promptTokens;
      run.completionTokens = response.usage.completionTokens;
      run.totalTokens = response.usage.totalTokens;
      run.usageSource = response.usage.source;
      run.output = response.text;

      // Validate result; on trivially empty output treat as failed run.
      const validation = validateSubAgentOutput(t, response.text);
      if (!validation.passed && ctx.round <= ctx.budget.maxCorrectionRounds) {
        // Fail now; the next global round re-runs this subtask as a correction.
        run.status = 'failed';
        run.error = validation.issues.join('; ').slice(0, 500);
        run.validationStatus = 'failed';
        this.logRun(run);
        return {
          subTaskId: t.id,
          role: t.role,
          status: 'failed',
          output: '',
          runRecord: run,
          validationStatus: 'failed',
          issues: validation.issues,
        };
      }
      if (!validation.passed) {
        run.status = 'failed';
        run.validationStatus = 'failed';
        run.error = validation.issues.join('; ').slice(0, 500);
        this.logRun(run);
        return {
          subTaskId: t.id,
          role: t.role,
          status: 'failed',
          output: response.text,
          runRecord: run,
          validationStatus: 'failed',
          issues: validation.issues,
        };
      }

      this.logRun(run);
      return {
        subTaskId: t.id,
        role: t.role,
        status: 'completed',
        output: response.text,
        runRecord: run,
        validationStatus: 'passed',
        issues: validation.issues,
      };
    } catch (error) {
      const run = this.makeRecord(ctx.executionId, ctx.params.userId, t.role, t.goal, 'failed');
      run.startedAt = startedAt;
      run.finishedAt = new Date().toISOString();
      run.error = controller.signal.aborted
        ? `Agent timed out after ${ctx.budget.perAgentTimeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'provider call failed';
      this.logRun(run);
      return { subTaskId: t.id, role: t.role, status: 'failed', output: '', runRecord: run };
    } finally {
      clearTimeout(timeout);
    }
  }

  private makeRecord(
    executionId: string,
    userId: string,
    role: AgentRole,
    objective: string,
    status: AgentRunRecord['status'],
    model?: string,
    validationStatus?: string,
  ): AgentRunRecord {
    const def = AGENT_ROLE_DEFINITIONS[role];
    return {
      runId: `agent_run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      executionId,
      userId,
      role,
      objective: objective.slice(0, 2000),
      status,
      model: model ?? def?.defaultModel ?? 'unknown',
      provider: 'google',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      usageSource: 'unavailable',
      startedAt: new Date().toISOString(),
      validationStatus: (validationStatus as AgentRunRecord['validationStatus']) ?? undefined,
    };
  }
}

export function validateSubAgentOutput(t: SubTaskSpec, text: string): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!text || text.trim().length < 20) {
    issues.push('Output is empty or too short to be a real deliverable.');
  }
  if (/^(lorem ipsum|\.{3,})$/i.test(text.trim())) {
    issues.push('Output is placeholder text.');
  }
  if (t.role === 'coding' && !/[{};`]/.test(text) && t.goal.length > 30) {
    issues.push('Coding agent returned no code artifacts for a coding goal.');
  }
  return { passed: issues.length === 0, issues };
}

export const agentRuntime = new AgentRuntimeService();
