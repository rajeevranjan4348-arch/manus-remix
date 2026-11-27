/**
 * Intelligent Model Router for Deku AI
 * 
 * Dynamically routes queries to optimal AI models based on task type,
 * capability affinity, latency targets, and verified provider availability.
 */

import { observability } from './observability';

export type TaskType = 'coding' | 'web_research' | 'fast_chat' | 'reasoning' | 'creative' | 'data_analysis';
export type ComplexityLevel = 'low' | 'medium' | 'high';
export type ModelCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ComplexityAnalysis {
  level: ComplexityLevel;
  score: number;
  signals: string[];
}

export interface ModelHealthStatus {
  modelId: string;
  state: ModelCircuitState;
  consecutiveFailures: number;
  lastError?: string;
  lastLatencyMs?: number;
  cooldownRemainingMs: number;
}

export interface ModelRouteOptions {
  thinkHarder?: boolean;
  mode?: 'chat' | 'work';
  estimatedInputTokens?: number;
}

export interface ModelRouteDecision {
  selectedModel: string;
  taskType: TaskType;
  reason: string;
  fallbackModels: string[];
  temperature: number;
  complexity?: ComplexityAnalysis;
  circuitState?: ModelCircuitState;
  compactionRecommended?: boolean;
  estimatedInputTokens?: number;
  thinkingBudgetHint?: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: 'google' | 'openrouter';
  contextWindow: number;
  strengths: TaskType[];
  isAvailable: boolean;
  averageLatencyMs?: number;
}

export const SUPPORTED_MODELS: ModelProfile[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Deku Default)',
    provider: 'google',
    contextWindow: 1048576,
    strengths: ['web_research', 'fast_chat', 'reasoning'],
    isAvailable: true,
    averageLatencyMs: 420,
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'google',
    contextWindow: 1048576,
    strengths: ['fast_chat'],
    isAvailable: true,
    averageLatencyMs: 250,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'google',
    contextWindow: 2097152,
    strengths: ['coding', 'data_analysis', 'reasoning'],
    isAvailable: true,
    averageLatencyMs: 950,
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek Chat (OpenRouter)',
    provider: 'openrouter',
    contextWindow: 65536,
    strengths: ['coding', 'reasoning'],
    isAvailable: true,
    averageLatencyMs: 800,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B (OpenRouter)',
    provider: 'openrouter',
    contextWindow: 131072,
    strengths: ['creative', 'fast_chat'],
    isAvailable: true,
    averageLatencyMs: 650,
  },
];

interface CircuitRecord {
  state: ModelCircuitState;
  consecutiveFailures: number;
  openedAt: number;
  lastError?: string;
  lastLatencyMs?: number;
}

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

class ModelRouterService {
  private circuits = new Map<string, CircuitRecord>();

  /**
   * Classify user prompt into task category
   */
  public classifyTask(prompt: string): TaskType {
    const q = prompt.toLowerCase();

    if (/\b(write code|function|refactor|debug|compile|npm|import|class|typescript|javascript|python|sql|html|css|github|repo)\b/i.test(q)) {
      return 'coding';
    }
    if (/\b(search|latest news|news|current events|who is|recent updates|source|cite|browse|url|website|google)\b/i.test(q)) {
      return 'web_research';
    }
    if (/\b(analyze|statistics|variance|correlation|dataset|table|metrics|forecast|chart|graph)\b/i.test(q)) {
      return 'data_analysis';
    }
    if (/\b(think harder|step by step|logic puzzle|prove|solve|math|complex reasoning)\b/i.test(q)) {
      return 'reasoning';
    }
    if (/\b(story|poem|creative|brainstorm|pitch|joke|novel)\b/i.test(q)) {
      return 'creative';
    }
    return 'fast_chat';
  }

  /**
   * Score prompt complexity to adaptively select fast vs deep-reasoning models.
   */
  public analyzeComplexity(prompt: string, options?: ModelRouteOptions): ComplexityAnalysis {
    const text = String(prompt || '').trim();
    const signals: string[] = [];
    let score = 0;

    if (options?.thinkHarder) {
      score += 45;
      signals.push('think_harder_enabled');
    }
    if (options?.mode === 'work') {
      score += 20;
      signals.push('work_mode');
    }
    if (text.length > 600) {
      score += 25;
      signals.push('long_prompt');
    } else if (text.length > 180) {
      score += 12;
      signals.push('medium_prompt');
    }
    if (/```[\s\S]+```/.test(text)) {
      score += 20;
      signals.push('contains_code_block');
    }
    if (/\b(architect|architecture|distributed|trade-?off|security audit|migration|multi-step|optimize|refactor|proof|theorem|algorithm|root cause)\b/i.test(text)) {
      score += 25;
      signals.push('deep_reasoning_keywords');
    }
    if (/\b(compare|benchmark|synthesize|step[- ]by[- ]step|debug|investigate|implement)\b/i.test(text)) {
      score += 12;
      signals.push('analytical_keywords');
    }
    if ((options?.estimatedInputTokens ?? 0) > 12_000) {
      score += 15;
      signals.push('large_context');
    }

    const level: ComplexityLevel = score >= 45 ? 'high' : score >= 18 ? 'medium' : 'low';
    return { level, score, signals };
  }

  /**
   * Record execution outcome for per-model circuit breaking and adaptive failover.
   */
  public recordOutcome(
    modelId: string,
    outcome: { ok: boolean; latencyMs?: number; statusCode?: number; error?: string },
  ): ModelHealthStatus {
    const existing = this.circuits.get(modelId) || {
      state: 'CLOSED' as ModelCircuitState,
      consecutiveFailures: 0,
      openedAt: 0,
    };

    if (outcome.ok) {
      existing.state = 'CLOSED';
      existing.consecutiveFailures = 0;
      existing.openedAt = 0;
      existing.lastError = undefined;
      existing.lastLatencyMs = outcome.latencyMs;
    } else {
      existing.consecutiveFailures += 1;
      existing.lastError = outcome.error || (outcome.statusCode ? `HTTP ${outcome.statusCode}` : 'Provider error');
      existing.lastLatencyMs = outcome.latencyMs;

      // Trip circuit immediately on 429/502/503/504 after threshold
      const isOutageStatus = !outcome.statusCode || outcome.statusCode === 429 || outcome.statusCode >= 500;
      if (isOutageStatus && existing.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        existing.state = 'OPEN';
        existing.openedAt = Date.now();
      }
    }

    this.circuits.set(modelId, existing);
    return this.getModelHealth(modelId);
  }

  public getModelHealth(modelId: string): ModelHealthStatus {
    const rec = this.circuits.get(modelId);
    if (!rec) {
      return {
        modelId,
        state: 'CLOSED',
        consecutiveFailures: 0,
        cooldownRemainingMs: 0,
      };
    }

    if (rec.state === 'OPEN') {
      const elapsed = Date.now() - rec.openedAt;
      if (elapsed >= CIRCUIT_COOLDOWN_MS) {
        rec.state = 'HALF_OPEN';
        return {
          modelId,
          state: 'HALF_OPEN',
          consecutiveFailures: rec.consecutiveFailures,
          lastError: rec.lastError,
          lastLatencyMs: rec.lastLatencyMs,
          cooldownRemainingMs: 0,
        };
      }
      return {
        modelId,
        state: 'OPEN',
        consecutiveFailures: rec.consecutiveFailures,
        lastError: rec.lastError,
        lastLatencyMs: rec.lastLatencyMs,
        cooldownRemainingMs: Math.max(0, CIRCUIT_COOLDOWN_MS - elapsed),
      };
    }

    return {
      modelId,
      state: rec.state,
      consecutiveFailures: rec.consecutiveFailures,
      lastError: rec.lastError,
      lastLatencyMs: rec.lastLatencyMs,
      cooldownRemainingMs: 0,
    };
  }

  public resetCircuit(modelId?: string): void {
    if (modelId) {
      this.circuits.delete(modelId);
    } else {
      this.circuits.clear();
    }
  }

  public shouldCompactContext(estimatedTokens: number, modelId?: string): boolean {
    const profile = SUPPORTED_MODELS.find((m) => m.id === modelId);
    const softBudget = profile && profile.contextWindow < 100_000 ? 12_000 : 18_000;
    return estimatedTokens >= softBudget;
  }

  /**
   * Selects best model with complexity adaptation, circuit-breaker failover, and compaction hints.
   */
  public route(prompt: string, userPreference?: string, options?: ModelRouteOptions): ModelRouteDecision {
    const taskType = this.classifyTask(prompt);
    const complexity = this.analyzeComplexity(prompt, options);
    const estimatedInputTokens = options?.estimatedInputTokens ?? Math.ceil(String(prompt || '').length / 4);

    let selectedModel = 'gemini-3.8-flash';
    let reason = 'Balanced high-speed general intelligence';
    let temperature = 0.7;

    if (userPreference && SUPPORTED_MODELS.some((m) => m.id === userPreference)) {
      selectedModel = userPreference;
      reason = `Selected by user setting (${userPreference})`;
    } else if (complexity.level === 'high') {
      selectedModel = 'gemini-3.1-pro-preview';
      reason = `Deep reasoning model selected for high-complexity ${taskType} task (${complexity.signals.join(', ')})`;
      temperature = taskType === 'coding' || taskType === 'data_analysis' ? 0.2 : 0.35;
    } else {
      switch (taskType) {
        case 'coding':
          selectedModel = 'gemini-3.8-flash';
          reason = 'Specialized for syntax generation, structural analysis, and code reasoning';
          temperature = 0.2;
          break;
        case 'web_research':
          selectedModel = 'gemini-3.8-flash';
          reason = 'Optimized for Google Search grounding and citation synthesis';
          temperature = 0.3;
          break;
        case 'data_analysis':
          selectedModel = 'gemini-3.8-flash';
          reason = 'Strong statistical computation and JSON schema alignment';
          temperature = 0.2;
          break;
        case 'fast_chat':
          selectedModel = 'gemini-3.1-flash-lite';
          reason = 'Lowest latency for interactive conversational answers';
          temperature = 0.7;
          break;
        case 'reasoning':
          selectedModel = 'gemini-3.8-flash';
          reason = 'Extended chain-of-thought and mathematical reasoning';
          temperature = 0.4;
          break;
      }
    }

    // Circuit-breaker automatic failover if selected model is currently OPEN
    const initialHealth = this.getModelHealth(selectedModel);
    const orderedModels = SUPPORTED_MODELS.map((m) => m.id);
    if (initialHealth.state === 'OPEN') {
      const healthyFallback = orderedModels.find(
        (id) => id !== selectedModel && this.getModelHealth(id).state !== 'OPEN',
      );
      if (healthyFallback) {
        reason = `Circuit OPEN for ${selectedModel}; automatically failed over to ${healthyFallback}`;
        selectedModel = healthyFallback;
      }
    }

    const fallbackModels = orderedModels
      .filter((id) => id !== selectedModel)
      .sort((a, b) => {
        const ha = this.getModelHealth(a).state === 'OPEN' ? 1 : 0;
        const hb = this.getModelHealth(b).state === 'OPEN' ? 1 : 0;
        return ha - hb;
      });

    const finalHealth = this.getModelHealth(selectedModel);
    const compactionRecommended = this.shouldCompactContext(estimatedInputTokens, selectedModel);
    const thinkingBudgetHint =
      complexity.level === 'high' ? 2048 : complexity.level === 'medium' ? 512 : 0;

    observability.log({
      level: 'info',
      category: 'router',
      message: `Routed ${taskType} (${complexity.level}) task to ${selectedModel}`,
      details: { taskType, selectedModel, complexity: complexity.level, circuitState: finalHealth.state, reason },
    });

    return {
      selectedModel,
      taskType,
      reason,
      fallbackModels,
      temperature,
      complexity,
      circuitState: finalHealth.state,
      compactionRecommended,
      estimatedInputTokens,
      thinkingBudgetHint,
    };
  }
}

export const modelRouter = new ModelRouterService();
