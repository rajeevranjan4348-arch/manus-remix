/**
 * Agent Configuration and Policy Manager for Manus AI
 * 
 * Manages runtime policies, model providers, tool permissions,
 * and security constraints with safe defaults.
 */

import { observability } from './observability';

export interface AgentPolicyConfig {
  defaultModel: string;
  maxAutonomousSteps: number;
  toolApprovalPolicy: 'ask_all' | 'ask_sensitive' | 'auto_approve';
  enableWebSearch: boolean;
  enableCodeSandbox: boolean;
  enableBrowserAutomation: boolean;
  enableLongTermMemory: boolean;
  enableMultiAgentParallelism: boolean;
  timeoutSeconds: number;
  updatedAt: string;
}

const CONFIG_STORAGE_KEY = 'manus_agent_policy_config';

const DEFAULT_POLICY: AgentPolicyConfig = {
  defaultModel: 'gemini-3.8-flash',
  maxAutonomousSteps: 15,
  toolApprovalPolicy: 'ask_sensitive',
  enableWebSearch: true,
  enableCodeSandbox: true,
  enableBrowserAutomation: true,
  enableLongTermMemory: true,
  enableMultiAgentParallelism: true,
  timeoutSeconds: 60,
  updatedAt: new Date().toISOString(),
};

class AgentConfigManagerService {
  private currentPolicy: AgentPolicyConfig = { ...DEFAULT_POLICY };

  constructor() {
    this.loadPolicy();
  }

  public getPolicy(): AgentPolicyConfig {
    return { ...this.currentPolicy };
  }

  public updatePolicy(updates: Partial<AgentPolicyConfig>): AgentPolicyConfig {
    const previous = { ...this.currentPolicy };
    this.currentPolicy = {
      ...this.currentPolicy,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    observability.log({
      level: 'info',
      category: 'configuration',
      message: 'Agent policy updated',
      details: {
        changedKeys: Object.keys(updates),
        newApprovalPolicy: this.currentPolicy.toolApprovalPolicy,
      },
    });

    this.persistPolicy();
    return this.currentPolicy;
  }

  private persistPolicy() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.currentPolicy));
    } catch {}
  }

  private loadPolicy() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) {
        this.currentPolicy = { ...DEFAULT_POLICY, ...JSON.parse(raw) };
      }
    } catch {}
  }
}

export const agentConfigManager = new AgentConfigManagerService();
