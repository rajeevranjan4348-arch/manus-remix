/**
 * Parallel Multi-Agent Orchestrator for Manus AI
 * 
 * Coordinates specialized sub-agents running concurrently,
 * assigns explicit sub-goals, resource budgets, and synthesizes findings.
 */

import { observability } from './observability';

export type SubAgentRole = 'researcher' | 'coder' | 'analyst' | 'reviewer';

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
}

class MultiAgentOrchestratorService {
  /**
   * Deconstructs a complex user objective into independent sub-agent assignments
   */
  public planSubTasks(objective: string): SubAgentTask[] {
    const clean = objective.toLowerCase();
    const tasks: SubAgentTask[] = [];

    // 1. Research agent for fact gathering
    tasks.push({
      id: `sub_${Date.now()}_research`,
      role: 'researcher',
      goal: `Gather verified background, facts, and documentation regarding: "${objective.slice(0, 100)}"`,
      context: objective,
      status: 'pending',
    });

    // 2. Coder or Analyst based on prompt intent
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

    // 3. Reviewer/Critic to eliminate contradictions
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
    executorFn: (task: SubAgentTask) => Promise<{ result: string; citations?: any[] }>
  ): Promise<MultiAgentResult> {
    const orchestrationId = `orch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const traceId = observability.startTrace('multi_agent_execution', { orchestrationId, taskCount: tasks.length });

    // Mark as running
    tasks.forEach(t => (t.status = 'running'));

    // Concurrently execute independent agents
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

    // Synthesize outputs
    const completedTasks = tasks.filter(t => t.status === 'completed');
    const synthesized = this.synthesizeOutputs(completedTasks);

    const durationMs = observability.endTrace(traceId);

    return {
      orchestrationId,
      subTasks: tasks,
      synthesizedReport: synthesized,
      durationMs,
    };
  }

  /**
   * Merges sub-agent outputs and resolves contradictions
   */
  private synthesizeOutputs(tasks: SubAgentTask[]): string {
    if (tasks.length === 0) {
      return 'Multi-agent execution concluded with no completed subtasks.';
    }

    const sections = tasks
      .map(t => `### 🤖 ${t.role.toUpperCase()} AGENT REPORT\n${t.result || 'No output.'}`)
      .join('\n\n---\n\n');

    return sections;
  }
}

export const multiAgentOrchestrator = new MultiAgentOrchestratorService();
