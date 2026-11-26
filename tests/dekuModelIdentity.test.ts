import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEKU_PRODUCT_NAME,
  MODEL_UNAVAILABLE_TEXT,
  buildDekuIdentitySystemInstruction,
  buildUnavailableExecutionMetadata,
  buildUnverifiedIdentityResponse,
  buildVerifiedExecutionMetadata,
  resolveRequestedModelRoute,
  sanitizeExecutionMetadata,
} from '../server/modelIdentity';
import {
  createUnavailableMetadata,
  formatExecutionIdentityLabel,
  formatExecutionTooltip,
  modelExecutionStore,
  parseBackendExecutionMetadata,
} from '../src/lib/modelIdentity';
import { generateResilientResponse } from '../server/geminiService';

const ROOT = path.resolve(__dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Part 2 — Deku AI Permanent Identity & Real Model Identification System', () => {
  beforeEach(() => {
    modelExecutionStore.reset();
  });

  it('1. Gemini execution: builds verified Google Gemini execution metadata and Deku AI identity policy', () => {
    const route = resolveRequestedModelRoute('google/gemini-3-flash-preview');
    expect(route.targetProvider).toBe('google');
    expect(route.targetModelId).toBe('gemini-3-flash-preview');

    const meta = buildVerifiedExecutionMetadata({
      actualModel: 'gemini-3-flash-preview',
      providerHint: 'google',
      requestedModel: 'google/gemini-3-flash-preview',
      runtimeSource: 'google-genai-sdk',
      isFallback: false,
    });

    expect(meta.product).toBe(DEKU_PRODUCT_NAME);
    expect(meta.provider).toBe('google');
    expect(meta.provider_name).toBe('Google Gemini');
    expect(meta.model).toBe('gemini-3-flash-preview');
    expect(meta.execution_status).toBe('verified');
    expect(meta.verified).toBe(true);
    expect(meta.is_fallback).toBe(false);

    const parsed = parseBackendExecutionMetadata(meta);
    expect(formatExecutionIdentityLabel(parsed)).toBe('Google Gemini · Gemini 3 Flash Preview');

    const sysPrompt = buildDekuIdentitySystemInstruction(meta);
    expect(sysPrompt).toContain('Deku AI');
    expect(sysPrompt).toContain('Never claim to be Gemini, Claude, ChatGPT, GPT');
    expect(sysPrompt).not.toMatch(/Always introduce yourself/i);
  });

  it('2. Claude (Anthropic) execution: resolves Anthropic route and produces verified Claude metadata', () => {
    const route = resolveRequestedModelRoute('anthropic/claude-3.5-sonnet');
    expect(route.targetProvider).toBe('anthropic');
    expect(route.targetModelId).toBe('claude-3-5-sonnet-latest');

    const meta = buildVerifiedExecutionMetadata({
      actualModel: 'claude-3-5-sonnet-20241022',
      providerHint: 'anthropic',
      requestedModel: 'anthropic/claude-3.5-sonnet',
      runtimeSource: 'anthropic-api',
      isFallback: false,
    });

    expect(meta.product).toBe('Deku AI');
    expect(meta.provider).toBe('anthropic');
    expect(meta.provider_name).toBe('Anthropic');
    expect(meta.model).toBe('claude-3-5-sonnet-20241022');
    expect(meta.verified).toBe(true);

    const parsed = parseBackendExecutionMetadata(meta);
    expect(formatExecutionIdentityLabel(parsed)).toBe('Anthropic · Claude 3.5 Sonnet');
  });

  it('3. OpenAI execution: resolves OpenAI route and produces verified GPT metadata', () => {
    const route = resolveRequestedModelRoute('openai/gpt-4o');
    expect(route.targetProvider).toBe('openai');
    expect(route.targetModelId).toBe('gpt-4o');

    const meta = buildVerifiedExecutionMetadata({
      actualModel: 'gpt-4o-2024-11-20',
      providerHint: 'openai',
      requestedModel: 'openai/gpt-4o',
      runtimeSource: 'openai-api',
      isFallback: false,
    });

    expect(meta.product).toBe('Deku AI');
    expect(meta.provider).toBe('openai');
    expect(meta.provider_name).toBe('OpenAI');
    expect(meta.model).toBe('gpt-4o-2024-11-20');
    expect(meta.verified).toBe(true);

    const parsed = parseBackendExecutionMetadata(meta);
    expect(formatExecutionIdentityLabel(parsed)).toContain('OpenAI');
    expect(formatExecutionIdentityLabel(parsed)).toContain('GPT');
  });

  it('4. Model switching: dynamically updates per-message identity in store without leaking across turns', () => {
    const geminiMeta = parseBackendExecutionMetadata(
      buildVerifiedExecutionMetadata({
        actualModel: 'gemini-3-flash-preview',
        providerHint: 'google',
        requestedModel: 'gemini-3-flash-preview',
        runtimeSource: 'google-genai-sdk',
      })
    )!;
    const claudeMeta = parseBackendExecutionMetadata(
      buildVerifiedExecutionMetadata({
        actualModel: 'claude-3-5-sonnet-20241022',
        providerHint: 'anthropic',
        requestedModel: 'anthropic/claude-3.5-sonnet',
        runtimeSource: 'anthropic-api',
      })
    )!;

    modelExecutionStore.recordBackendMetadata({
      requestId: 'req_turn_1',
      taskId: 'task_1',
      metadata: geminiMeta,
    });
    const bound1 = modelExecutionStore.bindRequestToMessage('req_turn_1', 'msg_1', 'task_1');

    modelExecutionStore.recordBackendMetadata({
      requestId: 'req_turn_2',
      taskId: 'task_1',
      metadata: claudeMeta,
    });
    const bound2 = modelExecutionStore.bindRequestToMessage('req_turn_2', 'msg_2', 'task_1');

    expect(formatExecutionIdentityLabel(bound1)).toBe('Google Gemini · Gemini 3 Flash Preview');
    expect(formatExecutionIdentityLabel(bound2)).toBe('Anthropic · Claude 3.5 Sonnet');
    expect(modelExecutionStore.getForMessage('msg_1')?.provider).toBe('google');
    expect(modelExecutionStore.getForMessage('msg_2')?.provider).toBe('anthropic');
  });

  it('5. Fallback execution: accurately distinguishes requested model vs executed fallback model', () => {
    const fallbackMeta = buildVerifiedExecutionMetadata({
      actualModel: 'gemini-2.5-flash',
      providerHint: 'google',
      requestedModel: 'anthropic/claude-3.5-sonnet',
      runtimeSource: 'google-genai-sdk',
      isFallback: true,
      fallbackFrom: 'anthropic/claude-3.5-sonnet',
      fallbackReason: 'Primary provider anthropic unavailable; routed to Google Gemini',
    });

    expect(fallbackMeta.execution_status).toBe('fallback');
    expect(fallbackMeta.is_fallback).toBe(true);
    expect(fallbackMeta.requested_model).toBe('anthropic/claude-3.5-sonnet');
    expect(fallbackMeta.model).toBe('gemini-2.5-flash');
    expect(fallbackMeta.fallback_from).toBe('anthropic/claude-3.5-sonnet');

    const parsed = parseBackendExecutionMetadata(fallbackMeta)!;
    expect(formatExecutionIdentityLabel(parsed)).toBe('Google Gemini · Gemini 2.5 Flash (Fallback)');
    const tooltip = formatExecutionTooltip(parsed);
    expect(tooltip).toContain('Requested Model: anthropic/claude-3.5-sonnet');
    expect(tooltip).toContain('Fallback from: anthropic/claude-3.5-sonnet');
  });

  it('6. Missing / unverified model metadata: never fabricates model name and hides unavailable placeholder text', () => {
    expect(MODEL_UNAVAILABLE_TEXT).toBe('');
    expect(formatExecutionIdentityLabel(null)).toBe('');
    expect(formatExecutionIdentityLabel(undefined)).toBe('');

    const unavailable = buildUnavailableExecutionMetadata({
      requestedModel: 'gemini-3-flash-preview',
      runtimeSource: 'local-fallback',
      executionStatus: 'degraded',
      reason: 'External provider unavailable',
    });
    expect(unavailable.verified).toBe(false);
    expect(unavailable.model).toBeNull();
    expect(formatExecutionIdentityLabel(parseBackendExecutionMetadata(unavailable))).toBe('');

    // Reject spoofed/unverified metadata attempting to claim verified=true on local-fallback or missing model
    const spoofed = parseBackendExecutionMetadata({
      product: 'Deku AI',
      provider: 'google',
      provider_name: 'Google Gemini',
      model: 'gemini-3-flash-preview',
      runtime_source: 'local-fallback',
      execution_status: 'verified',
      verified: true,
    });
    expect(spoofed?.verified).toBe(false);
    expect(formatExecutionIdentityLabel(spoofed)).toBe('');

    // Local resilient synthesizer MUST NOT claim a Gemini model when running locally
    const localReply = generateResilientResponse('Which model are you running on?', [], 'gemini-3-flash-preview');
    expect(localReply).toContain('Deku AI');
    expect(localReply).not.toContain('Model information unavailable');
    expect(localReply).not.toContain('gemini-3-flash-preview');
    expect(buildUnverifiedIdentityResponse()).not.toContain('Model information unavailable');
    expect(buildUnverifiedIdentityResponse()).toContain('Deku AI');

    // Unbound request in client store safely resolves to empty label
    const unbound = modelExecutionStore.bindRequestToMessage('req_unknown', 'msg_unknown', 'task_unknown');
    expect(unbound.verified).toBe(false);
    expect(formatExecutionIdentityLabel(unbound)).toBe('');
    expect(createUnavailableMetadata().verified).toBe(false);
  });

  it('7. Streaming metadata, secret redaction, and full-stack wiring verification', () => {
    // Secret redaction check
    const leaked = buildVerifiedExecutionMetadata({
      actualModel: 'gpt-4o',
      providerHint: 'openai',
      requestedModel: 'openai/gpt-4o',
      runtimeSource: 'openai-api',
      isFallback: true,
      fallbackFrom: 'sk-ant-api03-SECRETTOKEN1234567890',
      fallbackReason: 'Auth error with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    });
    const sanitized = sanitizeExecutionMetadata(leaked);
    expect(sanitized.fallback_from).not.toContain('sk-ant-');
    expect(sanitized.fallback_reason).not.toContain('eyJhbGci');
    expect(sanitized.fallback_from).toContain('[redacted]');
    expect(sanitized.fallback_reason).toContain('[redacted]');

    // Verify Vite SSE + Netlify SSE + blink.ts + useAgentTask.ts + ChatView.tsx wiring
    const viteSrc = readSource('vite.config.ts');
    expect(viteSrc).toContain("type: 'execution-metadata'");
    expect(viteSrc).toContain('executionMetadata: finalExecutionMetadata');

    const netlifyAgentSrc = readSource('netlify/functions/agent.ts');
    expect(netlifyAgentSrc).toContain("type: 'execution-metadata'");
    expect(netlifyAgentSrc).toContain('buildUnverifiedIdentityResponse()');

    const blinkSrc = readSource('src/lib/blink.ts');
    expect(blinkSrc).toContain("eventType === 'execution-metadata'");
    expect(blinkSrc).toContain('parseBackendExecutionMetadata');
    expect(blinkSrc).toContain('modelExecutionStore.recordBackendMetadata');

    const hookSrc = readSource('src/hooks/useAgentTask.ts');
    expect(hookSrc).not.toContain('Active Underlying LLM Model:');
    expect(hookSrc).toContain('modelExecutionStore.bindRequestToMessage');
    expect(hookSrc).toContain('RESPONSE STYLE & IDENTITY POLICY:');
    expect(hookSrc).not.toMatch(/Always introduce yourself/i);
  });
});
