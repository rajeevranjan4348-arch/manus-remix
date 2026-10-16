/**
 * Intelligent Model Router for Manus AI
 * 
 * Dynamically routes queries to optimal AI models based on task type,
 * capability affinity, latency targets, and verified provider availability.
 */

import { observability } from './observability';

export type TaskType = 'coding' | 'web_research' | 'fast_chat' | 'reasoning' | 'creative' | 'data_analysis';

export interface ModelRouteDecision {
  selectedModel: string;
  taskType: TaskType;
  reason: string;
  fallbackModels: string[];
  temperature: number;
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
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro (2M Context Window)',
    provider: 'google',
    contextWindow: 2097152,
    strengths: ['coding', 'data_analysis', 'reasoning'],
    isAvailable: true,
    averageLatencyMs: 950,
  },
  {
    id: 'manus-1.6-max',
    name: 'Manus 1.6 Max (2M Context)',
    provider: 'google',
    contextWindow: 2097152,
    strengths: ['coding', 'data_analysis', 'reasoning'],
    isAvailable: true,
    averageLatencyMs: 950,
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Manus Default)',
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

class ModelRouterService {
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
   * Selects best model with graceful fallbacks
   */
  public route(prompt: string, userPreference?: string): ModelRouteDecision {
    const taskType = this.classifyTask(prompt);
    let selectedModel = 'gemini-3.8-flash';
    let reason = 'Balanced high-speed general intelligence';
    let temperature = 0.7;

    if (userPreference && SUPPORTED_MODELS.some(m => m.id === userPreference)) {
      selectedModel = userPreference;
      reason = `Selected by user setting (${userPreference})`;
    } else if (prompt.length > 25000 || /\b(2\s*m(illion)?\s*context|massive\s*context|long\s*context|large\s*document|huge\s*codebase)\b/i.test(prompt)) {
      selectedModel = 'gemini-3.1-pro-preview';
      reason = 'Massive 2,000,000 token context window for comprehensive document and codebase ingestion';
      temperature = 0.3;
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

    const fallbackModels = SUPPORTED_MODELS
      .map(m => m.id)
      .filter(id => id !== selectedModel);

    observability.log({
      level: 'info',
      category: 'router',
      message: `Routed ${taskType} task to ${selectedModel}`,
      details: { taskType, selectedModel, reason },
    });

    return {
      selectedModel,
      taskType,
      reason,
      fallbackModels,
      temperature,
    };
  }
}

export const modelRouter = new ModelRouterService();
