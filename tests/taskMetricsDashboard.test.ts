import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTaskMetricsSummary,
  estimateTokenCount,
  formatDurationLabel,
  formatTokenCount,
  normalizeUsagePayload,
  taskMetricsStore,
} from '../src/lib/taskMetrics';

describe('Task Metrics Engine & Recharts Dashboard Telemetry', () => {
  beforeEach(() => {
    taskMetricsStore.resetForTesting();
  });

  it('estimates token counts accurately and ignores base64 image blobs', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('   ')).toBe(0);
    expect(estimateTokenCount('Hello world!')).toBe(3);

    const hugeBase64 = 'A'.repeat(20000);
    const withImage = `[IMAGE_DATA_URL:data:image/png;base64,${hugeBase64}]\nDescribe this photo`;
    const estimate = estimateTokenCount(withImage);
    expect(estimate).toBeLessThan(30);
    expect(estimate).toBeGreaterThan(2);
  });

  it('formats token counts and completion durations cleanly', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(842)).toBe('842');
    expect(formatTokenCount(1450)).toBe('1.45k');
    expect(formatTokenCount(12400)).toBe('12.4k');
    expect(formatTokenCount(1250000)).toBe('1.25M');

    expect(formatDurationLabel(420)).toBe('420ms');
    expect(formatDurationLabel(1500)).toBe('1.5s');
    expect(formatDurationLabel(12430)).toBe('12.4s');
    expect(formatDurationLabel(74000)).toBe('1m 14s');
    expect(formatDurationLabel(3660000)).toBe('1h 1m');
  });

  it('normalizes Gemini usageMetadata and OpenRouter usage payloads with fallback', () => {
    const geminiUsage = normalizeUsagePayload({
      promptTokenCount: 310,
      candidatesTokenCount: 190,
      thoughtsTokenCount: 45,
      totalTokenCount: 545,
      model: 'gemini-3-flash-preview',
    });
    expect(geminiUsage).toMatchObject({
      promptTokens: 310,
      completionTokens: 235,
      thoughtTokens: 45,
      totalTokens: 545,
      source: 'exact',
      model: 'gemini-3-flash-preview',
    });

    const openRouterUsage = normalizeUsagePayload({
      prompt_tokens: 120,
      completion_tokens: 80,
      total_tokens: 200,
    });
    expect(openRouterUsage).toMatchObject({
      promptTokens: 120,
      completionTokens: 80,
      totalTokens: 200,
      source: 'exact',
    });

    const missingUsage = normalizeUsagePayload(null, 'Explain Recharts', 'Recharts is a React charting library.');
    expect(missingUsage).toMatchObject({ promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'unavailable' });
    expect(geminiUsage.promptTokens + geminiUsage.completionTokens).toBe(geminiUsage.totalTokens);
    expect(openRouterUsage.promptTokens + openRouterUsage.completionTokens).toBe(openRouterUsage.totalTokens);
  });

  it('records multi-turn exact telemetry, binds message IDs, and aggregates summary metrics', () => {
    const taskId = 'task_multi_turn';

    taskMetricsStore.recordTurnStart({
      taskId,
      requestId: 'req_1',
      promptText: 'Summarize Q4 revenue trends',
      startedAt: 1000,
      model: 'gemini-3-flash-preview',
    });
    taskMetricsStore.recordFirstToken({ taskId, requestId: 'req_1', at: 1450 });
    taskMetricsStore.recordTurnComplete({
      taskId,
      requestId: 'req_1',
      promptText: 'Summarize Q4 revenue trends',
      responseText: 'Q4 revenue grew 24% year-over-year.',
      usage: {
        promptTokens: 200,
        completionTokens: 150,
        thoughtTokens: 50,
        totalTokens: 400,
        source: 'exact',
      },
      durationMs: 2500,
      completedAt: 3500,
    });
    taskMetricsStore.bindMessageId(taskId, 'req_1', 'assistant_msg_1');

    taskMetricsStore.recordTurnStart({
      taskId,
      requestId: 'req_2',
      promptText: 'Break down by region',
      startedAt: 5000,
      model: 'gemini-3-flash-preview',
    });
    taskMetricsStore.recordTurnComplete({
      taskId,
      requestId: 'req_2',
      promptText: 'Break down by region',
      responseText: 'North America led with 45% share.',
      usage: {
        promptTokens: 320,
        completionTokens: 280,
        thoughtTokens: 0,
        totalTokens: 600,
        source: 'exact',
      },
      durationMs: 3500,
      completedAt: 8500,
    });
    taskMetricsStore.bindMessageId(taskId, 'req_2', 'assistant_msg_2');

    const summary = buildTaskMetricsSummary({
      taskId,
      messages: [
        { id: 'u1', role: 'user', content: 'Summarize Q4 revenue trends' },
        { id: 'assistant_msg_1', role: 'assistant', content: 'Q4 revenue grew 24% year-over-year.' },
        { id: 'u2', role: 'user', content: 'Break down by region' },
        { id: 'assistant_msg_2', role: 'assistant', content: 'North America led with 45% share.' },
      ],
      isRunning: false,
      nowMs: 10000,
    });

    expect(summary.hasExactUsage).toBe(true);
    expect(summary.hasLiveTurn).toBe(false);
    expect(summary.completedTurnCount).toBe(2);
    expect(summary.totalPromptTokens).toBe(520);
    expect(summary.totalCompletionTokens).toBe(480);
    expect(summary.totalThoughtTokens).toBe(50);
    expect(summary.totalTokens).toBe(1000);
    expect(summary.totalDurationMs).toBe(6000);
    expect(summary.avgTurnDurationMs).toBe(3000);
    expect(summary.turnSeries).toHaveLength(2);
    expect(summary.turnSeries[0].ttftMs).toBe(450);
    expect(summary.turnSeries[1].durationSec).toBe(3.5);
    expect(summary.tokenBreakdown.map((s) => s.key)).toEqual(['prompt', 'completion']);
    expect(summary.totalPromptTokens + summary.totalCompletionTokens).toBe(summary.totalTokens);
  });

  it('tracks live in-progress turn elapsed time and streaming tokens smoothly', () => {
    const taskId = 'task_live_turn';
    taskMetricsStore.recordTurnStart({
      taskId,
      requestId: 'req_live',
      promptText: 'Write a short poem about TypeScript',
      startedAt: 10000,
      model: 'gemini-3-flash-preview',
    });
    taskMetricsStore.recordFirstToken({ taskId, requestId: 'req_live', at: 10400 });

    const summary = buildTaskMetricsSummary({
      taskId,
      messages: [
        { id: 'u_live', role: 'user', content: 'Write a short poem about TypeScript', timestamp: new Date(10000).toISOString() },
        { id: 'a_live', role: 'assistant', content: 'Types keep bugs away', status: 'streaming' },
      ],
      isRunning: true,
      liveStreamText: 'Types keep bugs away, interfaces guide the day.',
      nowMs: 12250,
    });

    expect(summary.hasLiveTurn).toBe(true);
    expect(summary.turnSeries).toHaveLength(1);
    expect(summary.turnSeries[0].isLive).toBe(true);
    expect(summary.turnSeries[0].durationMs).toBe(2250);
    expect(summary.turnSeries[0].ttftMs).toBe(400);
    expect(summary.totalTokens).toBe(0);
    expect(summary.turnSeries[0].source).toBe('unavailable');
  });

  it('derives deterministic estimates for historical tasks without stored telemetry', () => {
    const t0 = '2026-11-23T10:00:00.000Z';
    const t1 = '2026-11-23T10:00:04.200Z';
    const summary = buildTaskMetricsSummary({
      taskId: 'legacy_task_no_store',
      messages: [
        { id: 'old_u1', role: 'user', content: 'What is the capital of India?', timestamp: t0 },
        { id: 'old_a1', role: 'assistant', content: 'The capital of India is New Delhi.', timestamp: t1 },
      ],
      isRunning: false,
    });

    expect(summary.hasExactUsage).toBe(false);
    expect(summary.turnSeries).toHaveLength(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalDurationMs).toBe(0);
  });

  it('verifies Recharts dashboard wiring and server telemetry capture across Vite & Netlify', () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/components/agent/TaskMetricsDashboard.tsx'),
      'utf8'
    );
    const chatViewSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/components/agent/ChatView.tsx'),
      'utf8'
    );
    const geminiSvcSrc = fs.readFileSync(
      path.resolve(__dirname, '../server/geminiService.ts'),
      'utf8'
    );
    const netlifyFnSrc = fs.readFileSync(
      path.resolve(__dirname, '../netlify/functions/agent.ts'),
      'utf8'
    );
    const viteCfgSrc = fs.readFileSync(
      path.resolve(__dirname, '../vite.config.ts'),
      'utf8'
    );

    expect(dashboardSrc).toContain("from 'recharts'");
    expect(dashboardSrc).toContain('BarChart');
    expect(dashboardSrc).toContain('AreaChart');
    expect(dashboardSrc).toContain('PieChart');
    expect(dashboardSrc).toContain('ResponsiveContainer');
    expect(dashboardSrc).toContain('data-testid="task-metrics-dashboard"');

    expect(chatViewSrc).toContain('TaskMetricsDashboard');
    expect(chatViewSrc).toContain("import('./TaskMetricsDashboard')");

    expect(geminiSvcSrc).toContain('usageMetadata');
    expect(geminiSvcSrc).toContain('onUsage');
    expect(netlifyFnSrc).toContain('usageMetadata');
    expect(netlifyFnSrc).toContain('durationMs');
    expect(viteCfgSrc).toContain('onUsage');
    expect(viteCfgSrc).toContain('durationMs');
  });
});
