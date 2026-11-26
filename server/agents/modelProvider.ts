/**
 * Real model-provider adapter (Feature 03).
 *
 * Speaks the OpenAI-compatible chat-completions protocol against whatever
 * AGENT_MODEL_BASE_URL points at. Fail-closed: when credentials are missing
 * the caller gets MODEL_PROVIDER_UNAVAILABLE, never fabricated output.
 * Token usage and cost come exclusively from the provider response.
 */

import type { AgentUsage } from './types';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelCallOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutSeconds?: number;
}

export interface ModelCallResult {
  content: string;
  usage: AgentUsage;
  modelId: string;
}

export interface ModelProviderConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

export function resolveModelProvider(): { available: boolean; reason?: string; config?: ModelProviderConfig } {
  const provider = (process.env.AGENT_MODEL_PROVIDER || '').trim();
  const apiKey = (process.env.AGENT_MODEL_API_KEY || '').trim();
  const baseUrl = (process.env.AGENT_MODEL_BASE_URL || '').trim();
  const modelId = (process.env.AGENT_MODEL_ID || '').trim();
  if (!apiKey || !baseUrl || !modelId) {
    return {
      available: false,
      reason: 'Model provider is not configured. Set AGENT_MODEL_API_KEY, AGENT_MODEL_BASE_URL and AGENT_MODEL_ID to enable real agent execution.',
    };
  }
  return {
    available: true,
    config: { provider: provider || 'openai-compatible', apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), modelId },
  };
}

function priceInput(): number {
  const n = Number(process.env.AGENT_MODEL_PRICE_INPUT_PER_1K_USD);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function priceOutput(): number {
  const n = Number(process.env.AGENT_MODEL_PRICE_OUTPUT_PER_1K_USD);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function callModel(messages: ModelMessage[], options: ModelCallOptions = {}): Promise<ModelCallResult> {
  const resolved = resolveModelProvider();
  if (!resolved.available || !resolved.config) {
    throw Object.assign(new Error(resolved.reason || 'Model provider unavailable.'), {
      code: 'MODEL_PROVIDER_UNAVAILABLE', status: 503,
    });
  }
  const { apiKey, baseUrl, modelId } = resolved.config;
  const timeoutMs = Math.min(Math.max((options.timeoutSeconds ?? 120) * 1000, 1000), 300000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onExternalAbort);
  }
  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: options.temperature ?? 0.2,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 500);
      throw Object.assign(new Error('Model provider returned HTTP ' + res.status + '.'), {
        code: 'MODEL_PROVIDER_ERROR', status: 502, detail,
      });
    }
    const data: any = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.choices)) {
      throw Object.assign(new Error('Model provider response did not contain any completion.'), {
        code: 'MODEL_PROVIDER_ERROR', status: 502,
      });
    }
    const content = String(data.choices[0]?.message?.content || '');
    const u = (data.usage || {}) as Record<string, unknown>;
    const promptTokens = Number(u.prompt_tokens || 0);
    const completionTokens = Number(u.completion_tokens || 0);
    const totalTokens = Number(u.total_tokens || promptTokens + completionTokens);
    const usage: AgentUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd: (promptTokens / 1000) * priceInput() + (completionTokens / 1000) * priceOutput(),
    };
    return { content, usage, modelId };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
  }
}
