/**
 * Autonomous multi-agent runtime (Feature 03).
 *
 * Executes a plan of role-scoped subtasks through real model-provider calls,
 * honoring dependencies, parallelism limits, budgets, timeouts and
 * cancellation. Agent context is isolated: each agent sees only the objective
 * plus the outputs of its declared dependencies. Usage is accumulated from
 * provider-reported token counts. A final reviewer pass gates completion.
 * Nothing is executed with tools here; sub-agents propose work, and tool
 * execution happens exclusively through the authorized tool framework
 * (Feature 06 sandbox tools when configured).
 */

import {
  AGENT_HARD_LIMITS, DEFAULT_BUDGETS,
  type AgentBudget, type AgentRole, type AgentRunRecord, type AgentUsage,
  type SubtaskResult, type SubtaskSpec,
} from './types';
import { callModel, type ModelMessage } from './modelProvider';
import type { AgentStore } from './agentStore';
import { newRunId } from './agentStore';

export type ModelCaller = typeof callModel;

export const AGENT_ROLES: AgentRole[] = ['research', 'coding', 'debugging', 'testing', 'analysis', 'browser', 'security', 'qa', 'documentation', 'planner', 'reviewer'];

const ROLE_INSTRUCTIONS: Record<AgentRole, string> = {
  planner: 'You decompose user objectives into a minimal set of concrete subtasks with explicit dependencies. Output only JSON.',
  research: 'You are a research agent. Gather and synthesize factual information with sources. Never invent citations or facts.',
  coding: 'You are a coding agent. Produce complete code with file paths. Never claim code was executed; recommend sandbox verification.',
  debugging: 'You are a debugging agent. Analyze errors and propose minimal, targeted fixes with explicit reasoning.',
  testing: 'You are a testing agent. Produce concrete test cases with expected outcomes for the provided artifacts.',
  analysis: 'You are an analysis agent. Produce findings with explicit assumptions and limitations.',
  browser: 'You are a browser agent. Specify exact browser interactions (navigate, inspect, click, fill) needed to verify behavior. You cannot browse directly; your plan is executed by the sandbox browser tools.',
  security: 'You are a security reviewer. Identify vulnerabilities and misuse risks in the provided artifacts and classify severity.',
  qa: 'You are a QA agent. Verify the work against the objective and list any unmet acceptance criteria.',
  documentation: 'You are a documentation agent. Write concise, accurate docs for the provided artifacts.',
  reviewer: 'You are the final reviewer. Judge whether the objective has been genuinely met based only on the collected agent outputs. Reply with a first line of exactly PASS or FAIL, then your justification. Never invent evidence.',
};

export interface PlanValidation {
  valid: boolean;
  error?: string;
}

export function validatePlan(subtasks: SubtaskSpec[]): PlanValidation {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return { valid: false, error: 'A plan requires at least one subtask.' };
  }
  if (subtasks.length > AGENT_HARD_LIMITS.maxSubtasks) {
    return { valid: false, error: 'Plan exceeds the maximum of ' + AGENT_HARD_LIMITS.maxSubtasks + ' subtasks.' };
  }
  const ids = new Set<string>();
  for (const s of subtasks) {
    if (!s || typeof s.id !== 'string' || !s.id) return { valid: false, error: 'Every subtask needs a stable id.' };
    if (ids.has(s.id)) return { valid: false, error: 'Duplicate subtask id: ' + s.id };
    ids.add(s.id);
    if (!AGENT_ROLES.includes(s.role)) return { valid: false, error: 'Unknown agent role: ' + String(s && s.role) };
    if (typeof s.instructions !== 'string' || !s.instructions.trim()) {
      return { valid: false, error: 'Subtask ' + s.id + ' needs instructions.' };
    }
    if (s.instructions.length > AGENT_HARD_LIMITS.maxInstructionsChars) {
      return { valid: false, error: 'Subtask ' + s.id + ' exceeds the instruction length limit.' };
    }
  }
  // Dependency graph: known deps, no cycles (self-deps included).
  const byId = new Map(subtasks.map((s) => [s.id, s] as const));
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    const st = state.get(id);
    if (st === 1) return false;
    if (st === 2) return true;
    state.set(id, 1);
    const spec = byId.get(id);
    for (const d of (spec?.dependsOn || [])) {
      if (!byId.has(d)) return false;
      if (!visit(d)) return false;
    }
    state.set(id, 2);
    return true;
  };
  for (const s of subtasks) {
    if (!visit(s.id)) return { valid: false, error: 'Dependency cycle or unknown dependency at subtask ' + s.id + '.' };
  }
  return { valid: true };
}

function emptyUsage(): AgentUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
}

function addUsage(target: AgentUsage, add: AgentUsage): void {
  target.promptTokens += add.promptTokens;
  target.completionTokens += add.completionTokens;
  target.totalTokens += add.totalTokens;
  target.costUsd = Math.round((target.costUsd + add.costUsd) * 1e6) / 1e6;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '...[truncated]';
}

export interface CreateRunOptions {
  taskId?: string;
  budgets?: Partial<AgentBudget>;
}

export class AgentRuntimeService {
  constructor(private readonly store: AgentStore, private readonly modelCaller: ModelCaller = callModel) {}

  async createRun(
    userId: string,
    objective: string,
    subtasks?: SubtaskSpec[],
    opts: CreateRunOptions = {},
  ): Promise<AgentRunRecord> {
    let plan = subtasks;
    if (!Array.isArray(plan) || plan.length === 0) {
      plan = await this.plan(objective); // model-backed; throws MODEL_PROVIDER_UNAVAILABLE when unconfigured
    }
    const validation = validatePlan(plan);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.error || 'Invalid plan.'), { code: 'INVALID_PLAN', status: 400 });
    }
    const budgets: AgentBudget = {
      maxTokens: Math.max(1, Math.min(opts.budgets?.maxTokens ?? DEFAULT_BUDGETS.maxTokens, AGENT_HARD_LIMITS.maxTokensPerRun)),
      timeoutSeconds: Math.max(1, Math.min(opts.budgets?.timeoutSeconds ?? DEFAULT_BUDGETS.timeoutSeconds, AGENT_HARD_LIMITS.timeoutPerAgentSeconds)),
    };
    const normalized: SubtaskSpec[] = plan.map((s) => ({
      id: String(s.id).slice(0, 64),
      role: s.role,
      title: String(s.title || s.id).slice(0, 200),
      instructions: clip(String(s.instructions || ''), AGENT_HARD_LIMITS.maxInstructionsChars),
      dependsOn: (s.dependsOn || []).map((d) => String(d).slice(0, 64)),
      budget: s.budget,
    }));
    const now = new Date().toISOString();
    const record: AgentRunRecord = {
      runId: newRunId(),
      userId,
      taskId: opts.taskId,
      objective: clip(String(objective || ''), AGENT_HARD_LIMITS.maxObjectiveChars),
      status: 'queued',
      subtasks: normalized,
      results: normalized.map((s) => ({ subtaskId: s.id, role: s.role, status: 'pending', output: '', usage: emptyUsage() })),
      reviewer: null,
      totalUsage: emptyUsage(),
      budgets,
      durable: this.store.durable,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putRun(record);
    return record;
  }

  /** Model-backed planning. Fails closed (MODEL_PROVIDER_UNAVAILABLE) when unconfigured. */
  async plan(objective: string): Promise<SubtaskSpec[]> {
    const messages: ModelMessage[] = [
      {
        role: 'system',
        content: ROLE_INSTRUCTIONS.planner
          + ' Return ONLY a JSON array; each item: {"id","role","title","instructions","dependsOn"}. Allowed roles: '
          + AGENT_ROLES.filter((r) => r !== 'planner' && r !== 'reviewer').join(', ')
          + '. At most 8 subtasks.',
      },
      { role: 'user', content: clip(objective, AGENT_HARD_LIMITS.maxObjectiveChars) },
    ];
    const call = await this.modelCaller(messages, { timeoutSeconds: 90, temperature: 0.1 });
    const match = call.content.match(/\[[\s\S]*\]/);
    if (!match) {
      throw Object.assign(new Error('Planner output was not valid JSON.'), { code: 'PLAN_PARSE_FAILED', status: 502 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw Object.assign(new Error('Planner output was not valid JSON.'), { code: 'PLAN_PARSE_FAILED', status: 502 });
    }
    if (!Array.isArray(parsed)) {
      throw Object.assign(new Error('Planner output was not a JSON array.'), { code: 'PLAN_PARSE_FAILED', status: 502 });
    }
    return parsed as SubtaskSpec[];
  }

  async getRun(userId: string, runId: string): Promise<AgentRunRecord | null> {
    return this.store.getRun(runId, userId);
  }

  async listRuns(userId: string, filter?: { status?: string; limit?: number }): Promise<AgentRunRecord[]> {
    return this.store.listRuns(userId, filter);
  }

  async cancelRun(userId: string, runId: string): Promise<AgentRunRecord | null> {
    const run = await this.store.getRun(runId, userId);
    if (!run) return null;
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    run.cancelRequested = true;
    run.updatedAt = new Date().toISOString();
    await this.store.putRun(run);
    return run;
  }

  async executeRun(userId: string, runId: string, externalSignal?: AbortSignal): Promise<AgentRunRecord> {
    const run = await this.store.getRun(runId, userId);
    if (!run) {
      throw Object.assign(new Error('Agent run not found for this user.'), { code: 'RUN_NOT_FOUND', status: 404 });
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;

    run.status = 'running';
    run.updatedAt = new Date().toISOString();
    await this.store.putRun(run);

    const results = new Map<string, SubtaskResult>(run.results.map((r) => [r.subtaskId, { ...r, usage: { ...r.usage } } as SubtaskResult]));
    const usage: AgentUsage = { ...(run.totalUsage || emptyUsage()) };

    const persist = async (): Promise<void> => {
      run.results = Array.from(results.values());
      run.totalUsage = { ...usage };
      run.updatedAt = new Date().toISOString();
      await this.store.putRun(run);
    };

    const isPending = (s: SubtaskSpec): boolean => {
      const r = results.get(s.id);
      return !r || r.status === 'pending' || r.status === 'blocked';
    };

    let budgetExceeded = false;

    while (run.subtasks.some(isPending)) {
      // Durable + in-flight cancellation is polled between waves.
      const fresh = await this.store.getRun(runId, userId);
      if (run.cancelRequested === true || fresh?.cancelRequested === true || externalSignal?.aborted === true) {
        for (const s of run.subtasks) {
          if (isPending(s)) {
            results.set(s.id, { subtaskId: s.id, role: s.role, status: 'cancelled', output: '', usage: emptyUsage(), error: 'CANCELLED' });
          }
        }
        run.status = 'cancelled';
        run.error = 'Cancelled by user request.';
        await persist();
        return run;
      }

      const completed = new Set(Array.from(results.values()).filter((r) => r.status === 'completed').map((r) => r.subtaskId));
      const runnable = run.subtasks.filter((s) => isPending(s) && (s.dependsOn || []).every((d) => completed.has(d)));
      if (runnable.length === 0 || budgetExceeded) {
        for (const s of run.subtasks) {
          if (isPending(s)) {
            results.set(s.id, {
              subtaskId: s.id, role: s.role, status: 'skipped', output: '', usage: emptyUsage(),
              error: budgetExceeded ? 'SKIPPED_BUDGET_EXCEEDED' : 'SKIPPED_DEPENDENCY_FAILED',
            });
          }
        }
        break;
      }

      const wave = runnable.slice(0, AGENT_HARD_LIMITS.maxConcurrency);
      await Promise.all(wave.map((s) => this.runSubtask(run, s, results, usage, persist, externalSignal)));
      if (usage.totalTokens >= run.budgets.maxTokens) budgetExceeded = true;
    }

    await persist();

    /* ---------- Reviewer / QA gate ---------- */
    const notCompleted = run.subtasks.filter((s) => results.get(s.id)?.status !== 'completed');
    try {
      const transcript = run.subtasks.map((s) => {
        const r = results.get(s.id);
        return '[' + s.role + ' ' + s.id + ' ' + (r ? r.status : 'unknown') + ']' + '\n' + clip(r?.output || r?.error || '(no output)', 6000);
      }).join('\n\n');
      const messages: ModelMessage[] = [
        { role: 'system', content: ROLE_INSTRUCTIONS.reviewer },
        {
          role: 'user',
          content: 'Objective: ' + clip(run.objective, AGENT_HARD_LIMITS.maxObjectiveChars)
            + '\n\nAgent outputs:\n\n' + transcript
            + '\n\nWas the objective genuinely met? First line exactly PASS or FAIL.',
        },
      ];
      const reviewCall = await this.modelCaller(messages, { timeoutSeconds: 120 });
      const passed = /^\s*PASS\b/.test(reviewCall.content);
      run.reviewer = { passed, output: clip(reviewCall.content, 8000), usage: reviewCall.usage };
      addUsage(usage, reviewCall.usage);
    } catch (err: any) {
      run.status = 'failed';
      run.error = 'REVIEWER_UNAVAILABLE: ' + String(err?.code || err?.message || 'review call failed');
      await persist();
      return run;
    }

    if (run.reviewer.passed && notCompleted.length === 0) {
      run.status = 'completed';
    } else {
      run.status = 'failed';
      if (notCompleted.length > 0) run.error = 'INCOMPLETE_SUBTASKS: ' + notCompleted.map((s) => s.id).join(', ');
      else run.error = 'REVIEWER_REJECTED';
    }
    await persist();
    return run;
  }

  private async runSubtask(
    run: AgentRunRecord,
    spec: SubtaskSpec,
    results: Map<string, SubtaskResult>,
    sharedUsage: AgentUsage,
    persist: () => Promise<void>,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    // Per-agent budget guard against the shared run budget.
    if (sharedUsage.totalTokens >= run.budgets.maxTokens) {
      results.set(spec.id, {
        subtaskId: spec.id, role: spec.role, status: 'skipped', output: '', usage: emptyUsage(),
        error: 'SKIPPED_BUDGET_EXCEEDED',
      });
      await persist();
      return;
    }

    const timeoutSeconds = Math.min(spec.budget?.timeoutSeconds ?? run.budgets.timeoutSeconds, AGENT_HARD_LIMITS.timeoutPerAgentSeconds);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const onOuterAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onOuterAbort);
    }

    const result: SubtaskResult = {
      subtaskId: spec.id, role: spec.role, status: 'running', output: '', usage: emptyUsage(),
      startedAt: new Date().toISOString(),
    };
    results.set(spec.id, result);
    await persist();

    try {
      const messages = this.buildMessages(run, spec, results);
      const call = await this.modelCaller(messages, { signal: controller.signal, timeoutSeconds });
      result.output = call.content;
      result.usage = call.usage;
      result.modelId = call.modelId;
      addUsage(sharedUsage, call.usage);
      if (!call.content || !call.content.trim()) {
        result.status = 'failed';
        result.error = 'EMPTY_OUTPUT';
      } else {
        result.status = 'completed';
      }
    } catch (err: any) {
      result.status = 'failed';
      result.error = controller.signal.aborted
        ? (externalSignal?.aborted ? 'CANCELLED' : 'AGENT_TIMEOUT')
        : String(err?.code || err?.message || 'AGENT_EXECUTION_FAILED');
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onOuterAbort);
      result.finishedAt = new Date().toISOString();
      result.validation = {
        passed: result.status === 'completed',
        reason: result.status === 'completed' ? 'Non-empty output returned.' : String(result.error || 'failed'),
      };
      await persist();
    }
  }

  /** Isolated context: only the objective plus the outputs of declared dependencies. */
  private buildMessages(run: AgentRunRecord, spec: SubtaskSpec, results: Map<string, SubtaskResult>): ModelMessage[] {
    const system = ROLE_INSTRUCTIONS[spec.role]
      + ' You operate inside the Manus Remix multi-agent runtime under strict budgets. Never claim to have executed tools you did not run.';
    const parts: string[] = ['Objective: ' + clip(run.objective, AGENT_HARD_LIMITS.maxObjectiveChars)];
    for (const depId of spec.dependsOn || []) {
      const r = results.get(depId);
      parts.push('Output from agent "' + depId + '" (' + (r ? r.status : 'unknown') + '):\n' + clip(r?.output || r?.error || '(no output)', 6000));
    }
    parts.push('Your task (' + spec.role + '): ' + spec.instructions);
    return [
      { role: 'system', content: system },
      { role: 'user', content: parts.join('\n\n') },
    ];
  }
}
