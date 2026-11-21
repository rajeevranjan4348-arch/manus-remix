import {
  measurePerformanceSnapshot,
  trimAllManagedCaches,
  type PerformanceMeasurementSnapshot,
} from './performanceEngine';
import { observability } from './observability';

export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000;
export const DEFAULT_PERFORMANCE_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const HEALTH_FAILURES_BEFORE_DEGRADED = 2;
const HEALTH_URL = '/api/health';

type RecoveryMonitorOptions = {
  healthIntervalMs?: number;
  performanceIntervalMs?: number;
  fetchHealth?: (signal: AbortSignal) => Promise<Response>;
  onPerformanceDegraded?: (degraded: boolean) => void;
};

/**
 * A conservative trigger: estimated heap values are not used to force a profile change.
 * Long-task degradation is based on new tasks since the previous sample, not historical maxima.
 */
export function isPerformancePressureDetected(
  current: PerformanceMeasurementSnapshot,
  previous?: PerformanceMeasurementSnapshot,
): boolean {
  const measuredHeapPressure =
    !current.memory.isEstimatedHeap && current.memory.heapUtilizationPercent >= 85;
  const newLongTasks = Math.max(0, current.longTasks.count - (previous?.longTasks.count ?? current.longTasks.count));
  const severeNewLongTask =
    newLongTasks > 0 && current.longTasks.lastTaskDurationMs >= 250;
  const burstOfLongTasks = newLongTasks >= 5;
  return measuredHeapPressure || severeNewLongTask || burstOfLongTasks;
}

export function startRecoveryMonitoring(options: RecoveryMonitorOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const healthIntervalMs = Math.max(10_000, options.healthIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS);
  const performanceIntervalMs = Math.max(10_000, options.performanceIntervalMs ?? DEFAULT_PERFORMANCE_CHECK_INTERVAL_MS);
  let stopped = false;
  let healthCheckInFlight = false;
  let activeHealthController: AbortController | null = null;
  let consecutiveHealthFailures = 0;
  let backendDegraded = false;
  let performanceDegraded = false;
  let healthyPerformanceSamples = 0;
  let previousSnapshot: PerformanceMeasurementSnapshot | undefined;

  const log = (level: 'info' | 'warning' | 'error', category: string, message: string, details?: Record<string, unknown>) => {
    observability.log({ level, category, message, details });
  };

  const setPerformanceDegraded = (next: boolean) => {
    if (performanceDegraded === next) return;
    performanceDegraded = next;
    if (next) trimAllManagedCaches(0.5);
    options.onPerformanceDegraded?.(next);
    window.dispatchEvent(new CustomEvent('cue:recovery-performance', { detail: { degraded: next } }));
    log('warning', 'recovery', next ? 'Adaptive performance protection enabled.' : 'Adaptive performance protection cleared.');
  };

  const checkHealth = async () => {
    if (stopped || healthCheckInFlight || navigator.onLine === false) return;
    healthCheckInFlight = true;
    const controller = new AbortController();
    activeHealthController = controller;
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      const response = options.fetchHealth
        ? await options.fetchHealth(controller.signal)
        : await fetch(HEALTH_URL, { method: 'GET', cache: 'no-store', signal: controller.signal });
      if (stopped) return;
      let payload: { ok?: boolean } | null = null;
      try { payload = await response.json(); } catch { /* non-JSON means the health probe failed */ }
      if (!response.ok || payload?.ok !== true) {
        throw new Error(`Health probe returned ${response.status || 'invalid response'}`);
      }
      consecutiveHealthFailures = 0;
      if (backendDegraded) {
        backendDegraded = false;
        log('info', 'recovery', 'Backend health probe recovered.');
      }
    } catch (error) {
      if (stopped) return;
      consecutiveHealthFailures++;
      if (!backendDegraded && consecutiveHealthFailures >= HEALTH_FAILURES_BEFORE_DEGRADED) {
        backendDegraded = true;
        log('error', 'recovery', 'Backend health probe failed repeatedly; waiting for service recovery.', {
          failureCount: consecutiveHealthFailures,
          aborted: controller.signal.aborted,
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    } finally {
      window.clearTimeout(timeout);
      if (activeHealthController === controller) activeHealthController = null;
      healthCheckInFlight = false;
    }
  };

  const samplePerformance = () => {
    if (stopped || document.visibilityState === 'hidden') return;
    try {
      const snapshot = measurePerformanceSnapshot();
      if (isPerformancePressureDetected(snapshot, previousSnapshot)) {
        healthyPerformanceSamples = 0;
        setPerformanceDegraded(true);
      } else if (performanceDegraded) {
        healthyPerformanceSamples++;
        if (healthyPerformanceSamples >= 3) {
          healthyPerformanceSamples = 0;
          setPerformanceDegraded(false);
        }
      }
      previousSnapshot = snapshot;
    } catch {
      // Monitoring must never destabilize the application it is protecting.
    }
  };

  const onError = () => {
    log('error', 'ui-recovery', 'A browser runtime error was reported.');
  };
  const onUnhandledRejection = () => {
    log('error', 'ui-recovery', 'An unhandled asynchronous error was reported.');
  };
  const onOffline = () => {
    log('warning', 'network', 'The browser reported that the network is offline.');
  };
  const onOnline = () => {
    log('info', 'network', 'The browser reported that the network is online again.');
    void checkHealth();
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  const healthTimer = window.setInterval(() => void checkHealth(), healthIntervalMs);
  const performanceTimer = window.setInterval(samplePerformance, performanceIntervalMs);
  void checkHealth();
  samplePerformance();

  return () => {
    stopped = true;
    activeHealthController?.abort();
    window.clearInterval(healthTimer);
    window.clearInterval(performanceTimer);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
