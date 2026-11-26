/**
 * Multi-agent runtime types (Feature 03).
 *
 * A run is a durable record of one autonomous multi-agent execution. Agent
 * outputs are real model-provider responses; usage figures come only from
 * provider-reported usage fields. Nothing here may be fabricated.
 */

export type AgentRole =
  | 'research' | 'coding' | 'debugging' | 'testing' | 'analysis'
  | 'browser' | 'security' | 'qa' | 'documentation' | 'planner' | 'reviewer';

export interface AgentBudget {
  maxTokens: number;
  timeoutSeconds: number;
}

export interface SubtaskSpec {
  id: string;
  role: AgentRole;
  title: string;
  instructions: string;
  dependsOn: string[];
  budget?: Partial<AgentBudget>;
}

export type SubtaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface SubtaskResult {
  subtaskId: string;
  role: AgentRole;
  status: SubtaskStatus;
  output: string;
  usage: AgentUsage;
  modelId?: string;
  error?: string;
  validation?: { passed: boolean; reason: string };
  startedAt?: string;
  finishedAt?: string;
}

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunRecord {
  runId: string;
  userId: string;
  taskId?: string;
  objective: string;
  status: AgentRunStatus;
  cancelRequested?: boolean;
  subtasks: SubtaskSpec[];
  results: SubtaskResult[];
  reviewer?: { passed: boolean; output: string; usage: AgentUsage } | null;
  totalUsage: AgentUsage;
  budgets: AgentBudget;
  error?: string;
  durable: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hard platform limits. Recursion depth is fixed at 1: agent runs never spawn
 * nested agent runs.  Concurrency is bounded; token budgets are capped.
 */
export const AGENT_HARD_LIMITS = {
  maxSubtasks: 12,
  maxConcurrency: 4,
  maxTokensPerAgent: 100000,
  timeoutPerAgentSeconds: 300,
  maxTokensPerRun: 400000,
  maxRunTimeoutSeconds: 1500,
  maxObjectiveChars: 4000,
  maxInstructionsChars: 8000,
} as const;

export const DEFAULT_BUDGETS: AgentBudget = {
  maxTokens: AGENT_HARD_LIMITS.maxTokensPerRun,
  timeoutSeconds: 120,
};
