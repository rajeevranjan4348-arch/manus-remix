import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingCircuitBreaker } from '../server/circuitBreaker';
import {
  RECOVERY_POLICY_VERSION,
  recoveryTelemetry,
} from '../server/recoveryTelemetry';
import { isPerformancePressureDetected } from '../src/lib/recoveryController';
import type { PerformanceMeasurementSnapshot } from '../src/lib/performanceEngine';

function snapshot(overrides: Partial<PerformanceMeasurementSnapshot> = {}): PerformanceMeasurementSnapshot {
  return {
    timestamp: 1,
    activeProfile: 'balanced',
    profileSetting: 'auto',
    ultraLiteEnabled: false,
    hardware: {
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      saveData: false,
      effectiveConnectionType: '4g',
      isAndroid: false,
      isLowEndAndroid: false,
      prefersReducedMotion: false,
      detectedProfile: 'balanced',
    },
    memory: {
      usedJSHeapMB: 100,
      totalJSHeapMB: 120,
      jsHeapLimitMB: 1024,
      heapUtilizationPercent: 10,
      domNodeCount: 100,
      managedCacheEntries: 0,
      activeObjectUrls: 0,
      isEstimatedHeap: false,
    },
    timing: { domContentLoadedMs: 0, firstPaintMs: 0, appMountDurationMs: 1 },
    longTasks: { count: 0, maxDurationMs: 0, totalBlockingTimeMs: 0, lastTaskDurationMs: 0 },
    scrolling: { averageFps: 60, p95FrameTimeMs: 16, droppedFrames: 0, sampledFrames: 0 },
    streaming: { rawChunksReceived: 0, batchedCommitsFlushed: 0, renderReductionPercent: 0 },
    networkAndDb: { deduplicatedRequestsSaved: 0, firestoreReadsSaved: 0, firestoreWritesCoalesced: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  recoveryTelemetry.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adaptive recovery thresholds', () => {
  it('does not trigger degradation from estimated memory measurements', () => {
    const highEstimatedHeap = snapshot({
      memory: { ...snapshot().memory, heapUtilizationPercent: 99, isEstimatedHeap: true },
    });
    expect(isPerformancePressureDetected(highEstimatedHeap)).toBe(false);
  });

  it('triggers on measured heap pressure', () => {
    const highHeap = snapshot({
      memory: { ...snapshot().memory, heapUtilizationPercent: 85, isEstimatedHeap: false },
    });
    expect(isPerformancePressureDetected(highHeap)).toBe(true);
  });

  it('triggers on newly observed severe long tasks but ignores historical long-task maxima', () => {
    const previous = snapshot({ longTasks: { count: 2, maxDurationMs: 600, totalBlockingTimeMs: 500, lastTaskDurationMs: 300 } });
    expect(isPerformancePressureDetected(previous, previous)).toBe(false);
    const next = snapshot({ longTasks: { count: 3, maxDurationMs: 600, totalBlockingTimeMs: 750, lastTaskDurationMs: 300 } });
    expect(isPerformancePressureDetected(next, previous)).toBe(true);
  });
});

describe('bounded circuit-breaker recovery', () => {
  it('opens after bounded provider failures and allows a recovery probe after cooldown', () => {
    const breaker = new StreamingCircuitBreaker({
      serviceName: 'test-provider',
      failureThreshold: 2,
      resetTimeoutMs: 1_000,
      halfOpenSuccessThreshold: 1,
    });
    breaker.recordFailure({ status: 503, message: 'temporary outage' });
    breaker.recordFailure({ status: 503, message: 'temporary outage' });
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.canAttempt()).toBe(false);

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1_001);
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.getState()).toBe('HALF_OPEN');
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
  });
});

describe('bounded recovery telemetry', () => {
  it('records versioned allowlisted metadata without accepting raw error or secret fields', () => {
    const event = recoveryTelemetry.record({
      component: 'gemini',
      action: 'provider_fallback',
      outcome: 'failed',
      statusCode: 503,
      requestId: 'req_safe_1',
    });
    expect(event.policyVersion).toBe(RECOVERY_POLICY_VERSION);
    expect(event.statusCode).toBe(503);
    expect(event).not.toHaveProperty('error');
    expect(JSON.stringify(event)).not.toContain('apiKey');
  });

  it('keeps only the most recent 100 records', () => {
    for (let index = 0; index < 110; index++) {
      recoveryTelemetry.record({
        component: 'health',
        action: 'provider_fallback',
        outcome: 'failed',
        requestId: `req_${index}`,
      });
    }
    expect(recoveryTelemetry.getRecent(200)).toHaveLength(100);
    expect(recoveryTelemetry.getRecent(1)[0].requestId).toBe('req_109');
  });
});
