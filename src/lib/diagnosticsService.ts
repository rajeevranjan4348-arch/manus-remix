/**
 * Diagnostic Service for Manus AI
 * 
 * Computes conversation turns, estimated token counts, context window utilization,
 * and session telemetry for the active task.
 */

import { chatAutoSave, AutoSaveSessionSnapshot } from './chatAutoSave';
import { SUPPORTED_MODELS } from './modelRouter';

export interface DiagnosticTurnStats {
  total: number;
  user: number;
  assistant: number;
  system: number;
  cycles: number; // Back-and-forth conversational round-trips
}

export interface DiagnosticTokenStats {
  userTokens: number;
  assistantTokens: number;
  systemTokens: number;
  toolTokens: number;
  totalTokens: number;
}

export interface DiagnosticMetrics {
  totalCharacters: number;
  totalWords: number;
  averageTokensPerTurn: number;
  contextUsagePercent: number;
  remainingTokens: number;
  is2MContext: boolean;
}

export interface ConversationDiagnostics {
  hasActiveTask: boolean;
  taskId: string | null;
  taskTitle: string;
  taskStatus: 'idle' | 'running' | 'completed' | 'error';
  modelId: string;
  modelName: string;
  contextWindowMax: number;
  turns: DiagnosticTurnStats;
  tokens: DiagnosticTokenStats;
  metrics: DiagnosticMetrics;
  steps: {
    total: number;
    completed: number;
    running: number;
  };
  lastUpdated: string;
}

/**
 * Estimates token count from text using statistical LLM tokenization heuristics:
 * - ~4 characters per token for standard English prose
 * - ~3.2 characters per token for code/JSON/symbols
 * - Higher weighting for non-ASCII unicode / CJK characters
 * - 4 tokens overhead per message wrapper
 */
export function estimateTokens(content: string | undefined | null): number {
  if (!content) return 0;
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (!str.trim()) return 0;

  const nonAsciiCount = (str.match(/[^\x00-\x7F]/g) || []).length;
  const symbolCount = (str.match(/[{}[\]()<>=;:.,_+\-*/\\|&!%?~`^$@#]/g) || []).length;
  const whitespaceCount = (str.match(/\s/g) || []).length;
  const alphanumericCount = Math.max(0, str.length - nonAsciiCount - symbolCount - whitespaceCount);

  const charTokens = alphanumericCount / 4.0;
  const symbolTokens = symbolCount / 2.7;
  const spaceTokens = whitespaceCount / 3.6;
  const unicodeTokens = nonAsciiCount / 1.7;

  return Math.max(1, Math.ceil(charTokens + symbolTokens + spaceTokens + unicodeTokens));
}

/**
 * Formats a raw number of tokens into a human-readable string (e.g. "1,240", "45.2K", "1.8M")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const formatted = (tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, '');
    return `${formatted}M`;
  }
  if (tokens >= 10_000) {
    const formatted = (tokens / 1_000).toFixed(1).replace(/\.?0+$/, '');
    return `${formatted}K`;
  }
  return tokens.toLocaleString();
}

/**
 * Computes comprehensive conversation diagnostics from messages, task status, and step information.
 */
export function computeConversationDiagnostics(input: {
  taskId?: string | null;
  prompt?: string;
  messages?: any[];
  steps?: any[];
  status?: 'idle' | 'running' | 'completed' | 'error';
  selectedModelId?: string;
}): ConversationDiagnostics {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const status = input.status || 'idle';
  const taskId = input.taskId || null;

  // Selected Model & Context Window Resolution
  const selectedModelId = input.selectedModelId || 
    (typeof window !== 'undefined' ? localStorage.getItem('selected_manus_model') : null) || 
    'gemini-3.8-flash';

  const matchedProfile = SUPPORTED_MODELS.find(m => m.id === selectedModelId);
  const is2M = selectedModelId === 'gemini-3.1-pro-preview' || 
               selectedModelId === 'manus-1.6-max' || 
               (matchedProfile?.contextWindow && matchedProfile.contextWindow >= 2_000_000);

  const contextWindowMax = matchedProfile?.contextWindow || (is2M ? 2_097_152 : 1_048_576);
  const modelName = matchedProfile?.name || (is2M ? 'Gemini 3.1 Pro (2M Context)' : 'Gemini 3.8 Flash');

  // Turn Statistics
  let userTurns = 0;
  let assistantTurns = 0;
  let systemTurns = 0;

  let userTokens = 0;
  let assistantTokens = 0;
  let systemTokens = 0;
  let toolTokens = 0;

  let totalChars = 0;
  let totalWords = 0;

  messages.forEach((msg) => {
    const rawContent = typeof msg.content === 'string' ? msg.content : (msg.content?.text || JSON.stringify(msg.content || ''));
    const role = msg.role || 'user';
    const msgTokens = estimateTokens(rawContent) + 4; // 4 tokens message framing overhead
    const charLen = rawContent.length;
    const wordLen = rawContent.trim() ? rawContent.trim().split(/\s+/).length : 0;

    totalChars += charLen;
    totalWords += wordLen;

    if (role === 'user') {
      userTurns += 1;
      userTokens += msgTokens;
    } else if (role === 'assistant') {
      assistantTurns += 1;
      assistantTokens += msgTokens;
    } else {
      systemTurns += 1;
      systemTokens += msgTokens;
    }
  });

  // Calculate tool execution tokens from steps
  steps.forEach((step) => {
    const stepLabel = step.label || '';
    const stepTrace = Array.isArray(step.trace) ? step.trace.join(' ') : '';
    const stepTokens = estimateTokens(stepLabel + ' ' + stepTrace);
    toolTokens += stepTokens;
    totalChars += stepLabel.length + stepTrace.length;
  });

  // Initial prompt tokens if not already in messages
  if (input.prompt && userTurns === 0) {
    const promptTokens = estimateTokens(input.prompt) + 4;
    userTokens += promptTokens;
    userTurns = 1;
    totalChars += input.prompt.length;
    totalWords += input.prompt.trim().split(/\s+/).length;
  }

  const totalTurns = userTurns + assistantTurns + systemTurns;
  const cycles = Math.min(userTurns, assistantTurns) || (totalTurns > 0 ? 1 : 0);
  const totalTokens = userTokens + assistantTokens + systemTokens + toolTokens;

  const contextUsagePercent = contextWindowMax > 0 ? (totalTokens / contextWindowMax) * 100 : 0;
  const remainingTokens = Math.max(0, contextWindowMax - totalTokens);
  const averageTokensPerTurn = totalTurns > 0 ? Math.round(totalTokens / totalTurns) : totalTokens;

  // Task title extraction
  let taskTitle = 'No active conversation';
  if (input.prompt) {
    taskTitle = input.prompt.slice(0, 80) + (input.prompt.length > 80 ? '...' : '');
  } else if (messages.length > 0) {
    const firstUser = messages.find(m => m.role === 'user');
    const text = firstUser?.content ? (typeof firstUser.content === 'string' ? firstUser.content : firstUser.content.text) : '';
    if (text) {
      taskTitle = text.slice(0, 80) + (text.length > 80 ? '...' : '');
    }
  }

  const hasActiveTask = Boolean(taskId || messages.length > 0 || (input.prompt && input.prompt.trim()));

  return {
    hasActiveTask,
    taskId,
    taskTitle,
    taskStatus: status,
    modelId: selectedModelId,
    modelName,
    contextWindowMax,
    turns: {
      total: totalTurns,
      user: userTurns,
      assistant: assistantTurns,
      system: systemTurns,
      cycles,
    },
    tokens: {
      userTokens,
      assistantTokens,
      systemTokens,
      toolTokens,
      totalTokens,
    },
    metrics: {
      totalCharacters: totalChars,
      totalWords: totalWords,
      averageTokensPerTurn,
      contextUsagePercent: Number(contextUsagePercent.toFixed(4)),
      remainingTokens,
      is2MContext: Boolean(is2M),
    },
    steps: {
      total: steps.length,
      completed: steps.filter(s => s.status === 'completed').length,
      running: steps.filter(s => s.status === 'running').length,
    },
    lastUpdated: new Date().toLocaleTimeString(),
  };
}

/**
 * Retrieves diagnostics for the active task, falling back to persistent autosave snapshot if available.
 */
export function getActiveTaskDiagnostics(overrideSnapshot?: AutoSaveSessionSnapshot | null): ConversationDiagnostics {
  const snapshot = overrideSnapshot || chatAutoSave.getSnapshot();
  if (snapshot) {
    return computeConversationDiagnostics({
      taskId: snapshot.taskId,
      prompt: snapshot.prompt,
      messages: snapshot.messages,
      steps: snapshot.steps,
      status: snapshot.status,
    });
  }

  return computeConversationDiagnostics({});
}
