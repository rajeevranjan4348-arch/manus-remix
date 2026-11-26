/**
 * Parallel Multi-Agent Orchestrator for Deku AI
 * 
 * Coordinates specialized sub-agents running concurrently,
 * assigns explicit sub-goals, resource budgets, and synthesizes findings.
 */

import { observability } from './observability';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

export type SubAgentRole =
  | 'researcher'
  | 'coder'
  | 'analyst'
  | 'reviewer'
  | 'research'
  | 'coding'
  | 'debugging'
  | 'testing'
  | 'analysis'
  | 'browser'
  | 'security_reviewer'
  | 'qa'
  | 'documentation';

export interface SubAgentTask {
  id: string;
  role: SubAgentRole;
  goal: string;
  context: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  citations?: Array<{ title: string; url: string }>;
  durationMs?: number;
}

export interface MultiAgentResult {
  orchestrationId: string;
  subTasks: SubAgentTask[];
  synthesizedReport: string;
  durationMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

class MultiAgentOrchestratorService {
  /**
   * Execute real provider-backed autonomous multi-agent DAG orchestration via Feature 03 (/api/multi-agent/run).
   */
  public async runAutonomousOrchestration(params: {
    objective: string;
    maxConcurrency?: number;
    maxTotalTokens?: number;
    maxCostUsd?: number;
    timeoutMs?: number;
    enableQaReview?: boolean;
  }): Promise<{ ok: boolean; run?: any; error?: string; code?: string }> {
    const authHeader = await getFirebaseAuthorizationHeader();
    if (!authHeader) {
      return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required for multi-agent execution.' };
    }
    const res = await fetch('/api/multi-agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(params),
    });
    return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  }

  public async getAutonomousRunStatus(runId: string): Promise<{ ok: boolean; run?: any; error?: string }> {
    const authHeader = await getFirebaseAuthorizationHeader();
    if (!authHeader) return { ok: false, error: 'Authentication required.' };
    const res = await fetch(`/api/multi-agent/status?runId=${encodeURIComponent(runId)}`, {
      headers: { Accept: 'application/json', Authorization: authHeader },
    });
    return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  }

  public async cancelAutonomousRun(runId: string): Promise<{ ok: boolean; run?: any; error?: string }> {
    const authHeader = await getFirebaseAuthorizationHeader();
    if (!authHeader) return { ok: false, error: 'Authentication required.' };
    const res = await fetch('/api/multi-agent/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ runId }),
    });
    return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  }

  /**
   * Deconstructs a complex user objective into independent sub-agent assignments
   */
  public planSubTasks(objective: string): SubAgentTask[] {
    const clean = objective.toLowerCase();
    const tasks: SubAgentTask[] = [];

    tasks.push({
      id: `sub_${Date.now()}_research`,
      role: 'researcher',
      goal: `Gather verified background, facts, and documentation regarding: "${objective.slice(0, 100)}"`,
      context: objective,
      status: 'pending',
    });

    if (/code|build|script|app|function|bug|react|python|typescript|css|html/i.test(clean)) {
      tasks.push({
        id: `sub_${Date.now()}_coder`,
        role: 'coder',
        goal: `Architect clean, production-grade code implementation and verify syntax.`,
        context: objective,
        status: 'pending',
      });
    }

    if (/data|analyze|metrics|stats|finance|report|compare|trend/i.test(clean)) {
      tasks.push({
        id: `sub_${Date.now()}_analyst`,
        role: 'analyst',
        goal: `Extract statistical trends, variance, key metrics, and strategic implications.`,
        context: objective,
        status: 'pending',
      });
    }

    tasks.push({
      id: `sub_${Date.now()}_reviewer`,
      role: 'reviewer',
      goal: `Synthesize findings, verify source grounding, and eliminate discrepancies.`,
      context: objective,
      status: 'pending',
    });

    return tasks;
  }

  /**
   * Execute sub-tasks in parallel
   */
  public async executeParallel(
    tasks: SubAgentTask[],
    executorFn: (task: SubAgentTask) => Promise<{ result: string; citations?: any[] }>,
  ): Promise<MultiAgentResult> {
    const orchestrationId = `orch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const traceId = observability.startTrace('multi_agent_execution', { orchestrationId, taskCount: tasks.length });

    tasks.forEach((t) => (t.status = 'running'));

    const promises = tasks.map(async (task) => {
      const taskStart = performance.now();
      try {
        const output = await executorFn(task);
        task.status = 'completed';
        task.result = output.result;
        task.citations = output.citations;
        task.durationMs = Math.round(performance.now() - taskStart);
      } catch (err: any) {
        task.status = 'failed';
        task.result = `Subtask error: ${err.message}`;
        task.durationMs = Math.round(performance.now() - taskStart);
      }
    });

    await Promise.allSettled(promises);

    const completedTasks = tasks.filter((t) => t.status === 'completed');
    const synthesized = this.synthesizeOutputs(completedTasks);

    const durationMs = observability.endTrace(traceId);

    return {
      orchestrationId,
      subTasks: tasks,
      synthesizedReport: synthesized,
      durationMs,
    };
  }

  private synthesizeOutputs(tasks: SubAgentTask[]): string {
    if (tasks.length === 0) {
      return 'Multi-agent execution concluded with no completed subtasks.';
    }

    return tasks
      .map((t) => `### 🤖 ${t.role.toUpperCase()} AGENT REPORT\n${t.result || 'No output.'}`)
      .join('\n\n---\n\n');
  }
}

export const multiAgentOrchestrator = new MultiAgentOrchestratorService();
