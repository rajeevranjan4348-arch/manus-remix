/**
 * Observability, Tracing, and Diagnostics Engine for Manus AI
 * 
 * Provides structured diagnostics, request IDs, latency metrics,
 * error taxonomy, secret redaction, and provider health checks.
 */

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ErrorClassification = 
  | 'RATE_LIMIT'
  | 'AUTH_FAILURE'
  | 'NETWORK_TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'TOOL_EXECUTION_FAILURE'
  | 'MODEL_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'INTERNAL_ERROR';

export interface TraceMetric {
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface DiagnosticLog {
  id: string;
  timestamp: string;
  traceId?: string;
  level: ErrorSeverity;
  category: string;
  message: string;
  classification?: ErrorClassification;
  durationMs?: number;
  details?: Record<string, any>;
}

export interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'degraded' | 'unreachable';
  latencyMs: number;
  lastChecked: string;
  error?: string;
}

class ObservabilityService {
  private activeTraces = new Map<string, TraceMetric>();
  private logs: DiagnosticLog[] = [];
  private readonly MAX_LOGS = 200;
  private providerHealthCache = new Map<string, ProviderHealth>();

  /**
   * Generates a unique, high-entropy trace ID
   */
  public generateTraceId(prefix = 'trace'): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Redacts sensitive strings (API keys, tokens, secret passwords)
   */
  public redactSecrets(input: string): string {
    if (!input || typeof input !== 'string') return input;
    return input
      .replace(/(sk-[a-zA-Z0-9_-]{10,})/g, 'sk-***REDACTED***')
      .replace(/(AIzaSy[a-zA-Z0-9_-]{20,})/g, 'AIzaSy***REDACTED***')
      .replace(/(Bearer\s+)[a-zA-Z0-9._-]{15,}/gi, '$1***TOKEN_REDACTED***')
      .replace(/(token|apiKey|api_key|password|secret)["']?\s*[:=]\s*["']?([^"',\s]+)/gi, '$1: "***REDACTED***"');
  }

  /**
   * Start tracking an operation latency
   */
  public startTrace(name: string, metadata?: Record<string, any>): string {
    const traceId = this.generateTraceId();
    this.activeTraces.set(traceId, {
      traceId,
      name,
      startTime: performance.now(),
      metadata,
    });
    return traceId;
  }

  /**
   * End an active trace and record metric
   */
  public endTrace(traceId: string, extraMeta?: Record<string, any>): number {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return 0;

    const endTime = performance.now();
    const durationMs = Math.round(endTime - trace.startTime);
    trace.endTime = endTime;
    trace.durationMs = durationMs;

    this.activeTraces.delete(traceId);

    this.log({
      level: 'info',
      category: 'performance',
      traceId,
      message: `Completed ${trace.name} in ${durationMs}ms`,
      durationMs,
      details: { ...trace.metadata, ...extraMeta },
    });

    return durationMs;
  }

  /**
   * Categorizes errors into standardized taxonomy
   */
  public classifyError(error: unknown): ErrorClassification {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    
    if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted')) {
      return 'RATE_LIMIT';
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('auth') || msg.includes('token expired')) {
      return 'AUTH_FAILURE';
    }
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('aborted')) {
      return 'NETWORK_TIMEOUT';
    }
    if (msg.includes('validation') || msg.includes('invalid') || msg.includes('schema') || msg.includes('required')) {
      return 'VALIDATION_ERROR';
    }
    if (msg.includes('tool') || msg.includes('connector') || msg.includes('execution failed')) {
      return 'TOOL_EXECUTION_FAILURE';
    }
    if (msg.includes('model') || msg.includes('overloaded') || msg.includes('unavailable') || msg.includes('503')) {
      return 'MODEL_UNAVAILABLE';
    }
    if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('blocked')) {
      return 'PERMISSION_DENIED';
    }
    return 'INTERNAL_ERROR';
  }

  /**
   * Append diagnostic log with automatic sanitization
   */
  public log(entry: Omit<DiagnosticLog, 'id' | 'timestamp'>): void {
    const sanitizedMsg = this.redactSecrets(entry.message);
    const sanitizedDetails = entry.details ? JSON.parse(this.redactSecrets(JSON.stringify(entry.details))) : undefined;

    const fullLog: DiagnosticLog = {
      id: `diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
      message: sanitizedMsg,
      details: sanitizedDetails,
    };

    this.logs.unshift(fullLog);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.pop();
    }

    if (entry.level === 'error' || entry.level === 'critical') {
      console.error(`[Diagnostics] [${entry.classification || 'ERROR'}] ${sanitizedMsg}`, sanitizedDetails || '');
    }
  }

  /**
   * Retrieve filtered diagnostic logs
   */
  public getLogs(filter?: { level?: ErrorSeverity; category?: string; limit?: number }): DiagnosticLog[] {
    let result = this.logs;
    if (filter?.level) {
      result = result.filter(l => l.level === filter.level);
    }
    if (filter?.category) {
      result = result.filter(l => l.category === filter.category);
    }
    return result.slice(0, filter?.limit || 50);
  }

  /**
   * Register or update health status for model / service provider
   */
  public recordProviderHealth(health: ProviderHealth): void {
    this.providerHealthCache.set(health.provider, health);
  }

  /**
   * Get all provider health statuses
   */
  public getAllProviderHealth(): ProviderHealth[] {
    return Array.from(this.providerHealthCache.values());
  }

  /**
   * Clear recorded diagnostics
   */
  public clearLogs(): void {
    this.logs = [];
  }
}

export const observability = new ObservabilityService();
