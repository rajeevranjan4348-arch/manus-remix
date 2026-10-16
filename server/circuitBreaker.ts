/**
 * Server-Side Circuit Breaker Pattern for AI & Gemini API Integrations
 * 
 * Prevents cascading failures, request hangs, and excessive latency when downstream
 * AI providers experience service outages, rate limits, or network timeouts.
 * Provides clear, actionable recovery feedback directly to the user.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  serviceName?: string;
  failureThreshold?: number;       // Number of consecutive failures to trip circuit (default: 3)
  resetTimeoutMs?: number;         // Time in ms to remain open before half-open probe (default: 30000)
  halfOpenSuccessThreshold?: number; // Number of consecutive successes in HALF_OPEN to close circuit (default: 2)
  isFailure?: (error: any) => boolean;
}

export interface CircuitBreakerMetrics {
  serviceName: string;
  state: CircuitState;
  failureCount: number;
  consecutiveSuccessCount: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  timeUntilResetMs: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError: {
    message: string;
    status?: number;
    code?: string;
    timestamp: number;
  } | null;
}

export class StreamingCircuitBreaker {
  public readonly serviceName: string;
  public readonly failureThreshold: number;
  public readonly resetTimeoutMs: number;
  public readonly halfOpenSuccessThreshold: number;

  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private consecutiveSuccessCount: number = 0;
  private lastFailureTime: number = 0;
  private lastSuccessTime: number = 0;
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private lastError: {
    message: string;
    status?: number;
    code?: string;
    timestamp: number;
  } | null = null;

  private isFailurePredicate?: (error: any) => boolean;

  constructor(options: CircuitBreakerOptions = {}) {
    this.serviceName = options.serviceName ?? 'AI';
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 1;
    this.isFailurePredicate = options.isFailure;
  }

  /**
   * Evaluates current circuit breaker state, transitioning to HALF_OPEN if reset window passed.
   */
  getState(): CircuitState {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.consecutiveSuccessCount = 0;
      }
    }
    return this.state;
  }

  /**
   * Checks whether a new request should be allowed through.
   */
  canAttempt(): boolean {
    const currentState = this.getState();
    return currentState === 'CLOSED' || currentState === 'HALF_OPEN';
  }

  /**
   * Evaluates if a given error represents an outage or server-side failure.
   */
  isOutageError(error?: any): boolean {
    if (this.isFailurePredicate) {
      return this.isFailurePredicate(error);
    }

    if (!error) return true;
    const status = error?.status || error?.statusCode || error?.response?.status;
    const code = error?.code || error?.error?.code;
    const msg = String(error?.message || error || '').toLowerCase();

    // 4xx client errors (like 400 Bad Request, 404 Not Found) are not service outages
    if (status === 400 || status === 404 || status === 422) {
      return false;
    }

    // 5xx server errors, rate limits, timeouts, and network disconnects are outage errors
    if (
      status === 500 || status === 502 || status === 503 || status === 504 ||
      status === 429 || code === 'ECONNRESET' || code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' || code === 'ENOTFOUND' ||
      msg.includes('503') || msg.includes('502') || msg.includes('504') ||
      msg.includes('unavailable') || msg.includes('overloaded') ||
      msg.includes('timeout') || msg.includes('deadline') ||
      msg.includes('abort') || msg.includes('resource_exhausted') ||
      msg.includes('rate limit') || msg.includes('quota') ||
      msg.includes('network') || msg.includes('fetch failed')
    ) {
      return true;
    }

    return true;
  }

  /**
   * Records a successful operation, transitioning from HALF_OPEN to CLOSED if threshold met.
   */
  recordSuccess(): void {
    this.totalRequests += 1;
    this.totalSuccesses += 1;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccessCount += 1;
      if (this.consecutiveSuccessCount >= this.halfOpenSuccessThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.consecutiveSuccessCount = 0;
      }
    } else {
      this.failureCount = 0;
      this.state = 'CLOSED';
    }
  }

  /**
   * Records a failure and trips the circuit to OPEN if threshold reached or if in HALF_OPEN.
   */
  recordFailure(error?: any): void {
    this.totalRequests += 1;
    this.totalFailures += 1;

    // Check if error qualifies as an outage failure
    if (!this.isOutageError(error)) {
      return;
    }

    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    const status = error?.status || error?.statusCode || error?.response?.status;
    const message = error?.message || String(error || 'Service failure');
    const code = error?.code || (status ? `HTTP_${status}` : undefined);

    this.lastError = {
      message,
      status: typeof status === 'number' ? status : undefined,
      code,
      timestamp: this.lastFailureTime,
    };

    if (this.state === 'HALF_OPEN') {
      // In half-open trial, even a single failure trips back to open
      this.state = 'OPEN';
      this.consecutiveSuccessCount = 0;
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Manually trips the circuit breaker to OPEN (e.g. for testing or emergency maintenance).
   */
  trip(reason = 'Manual trip triggered', error?: any): void {
    this.state = 'OPEN';
    this.failureCount = this.failureThreshold;
    this.lastFailureTime = Date.now();
    this.lastError = {
      message: reason,
      code: 'MANUAL_TRIP',
      timestamp: this.lastFailureTime,
      status: error?.status || 503,
    };
  }

  /**
   * Resets the circuit breaker to clean CLOSED state.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.consecutiveSuccessCount = 0;
    this.lastFailureTime = 0;
    this.lastError = null;
  }

  /**
   * Returns complete metrics and health status for monitoring and API responses.
   */
  getMetrics(): CircuitBreakerMetrics {
    const currentState = this.getState();
    const elapsed = this.lastFailureTime > 0 ? Date.now() - this.lastFailureTime : 0;
    const timeUntilResetMs = currentState === 'OPEN' ? Math.max(0, this.resetTimeoutMs - elapsed) : 0;

    return {
      serviceName: this.serviceName,
      state: currentState,
      failureCount: this.failureCount,
      consecutiveSuccessCount: this.consecutiveSuccessCount,
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeoutMs,
      halfOpenSuccessThreshold: this.halfOpenSuccessThreshold,
      lastFailureTime: this.lastFailureTime > 0 ? this.lastFailureTime : null,
      lastSuccessTime: this.lastSuccessTime > 0 ? this.lastSuccessTime : null,
      timeUntilResetMs,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastError: this.lastError,
    };
  }

  /**
   * Produces a specific, actionable error message tailored to the exact failure mode.
   */
  formatActionableErrorMessage(error?: any): string {
    return this.formatActionableRecoveryMessage(error);
  }

  /**
   * Produces rich, context-aware recovery feedback with actionable instructions.
   */
  formatActionableRecoveryMessage(error?: any): string {
    const currentState = this.getState();
    const err = error || this.lastError;
    const msg = String(err?.message || err || '').toLowerCase();
    const status = err?.status || err?.statusCode;

    if (currentState === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      const remainingSec = Math.max(1, Math.ceil((this.resetTimeoutMs - elapsed) / 1000));

      return `⚠️ **${this.serviceName} Outage Detected (Circuit Breaker Tripped)**

The upstream AI provider is currently experiencing service disruptions or elevated error rates. The circuit breaker is **OPEN** to protect your session and avoid hanging requests.

**Actionable Steps:**
1. ⏳ **Auto-Recovery**: The circuit breaker will automatically probe service recovery in **${remainingSec}s**.
2. 🔄 **Retry Request**: Click **Retry Request** below. Manus will automatically route your request through secondary fallback synthesizers.
3. ⚡ **Switch Model**: Open **Settings** (⚙️) to select an alternative model (e.g. Gemini 3.1 Flash Lite) or configure a personal OpenRouter API key.
4. 🛠️ **Reset Circuit**: Click the **Reset** button below to clear the active error state immediately.`;
    }

    // Rate Limit / Quota Exceeded (429)
    if (status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted')) {
      return `⚡ **${this.serviceName} Rate Limit Exceeded**

The AI provider quota has been temporarily exhausted.

**Actionable Steps:**
- **Wait & Retry**: Wait 10-15 seconds and click **Retry Request**.
- **Model Selection**: Switch to a lightweight model (e.g. Gemini 3.1 Flash Lite) in Settings for higher quota headroom.
- **Dedicated Key**: Add your personal Gemini API Key or OpenRouter Key in Settings for unlimited throughput.`;
    }

    // Authentication / Unauthorized (401 / 403)
    if (status === 401 || status === 403 || msg.includes('unauthenticated') || msg.includes('api key') || msg.includes('permission_denied')) {
      return `🔑 **${this.serviceName} Authentication Error**

The upstream AI provider rejected the request due to missing or invalid credentials.

**Actionable Steps:**
- Verify that \`GEMINI_API_KEY\` is defined in your environment variables.
- Ensure the API key has permission for Gemini models in Google AI Studio.
- Click **Reset** below to refresh the active session.`;
    }

    // Timeout / Deadline Exceeded
    if (msg.includes('timeout') || msg.includes('deadline') || msg.includes('abort') || msg.includes('etimedout')) {
      const title = this.serviceName === 'AI' ? 'AI Response Timed Out' : `${this.serviceName} - AI Response Timed Out`;
      return `⏱️ **${title}**

The connection exceeded the request deadline while waiting for model generation.

**Actionable Steps:**
- Click **Retry Request** below to re-dispatch your prompt.
- If using "Deep reasoning", toggle it off temporarily to reduce inference latency.
- Break down very large questions into smaller focused queries.`;
    }

    // Service Unavailable / 503 / 502 / 500 Outage
    if (status === 503 || status === 502 || status === 500 || msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
      return `🌐 **${this.serviceName} Temporarily Unavailable (503 Outage)**

The upstream AI model servers are currently experiencing elevated latency or temporary downtime.

**Actionable Steps:**
- Click **Retry Request** below to trigger resilient fallback routing.
- The circuit breaker monitors recovery status and will test connection stability automatically.
- Click **Reset** to clear the conversation state if needed.`;
    }

    const displayError = err?.message || String(err || 'Unknown streaming interruption');
    return `❌ **${this.serviceName} Execution Interrupted**

${displayError}

**Actionable Steps:**
- Click **Retry Request** below to re-submit your prompt.
- If the issue persists, click **Reset** to restart your session.`;
  }
}

// Global shared circuit breaker for outer HTTP middleware
export const globalStreamingCircuitBreaker = new StreamingCircuitBreaker({
  serviceName: 'AI Streaming Service',
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenSuccessThreshold: 2,
});

// Dedicated server-side circuit breaker for Google Gemini API integration
export const geminiCircuitBreaker = new StreamingCircuitBreaker({
  serviceName: 'Google Gemini API',
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenSuccessThreshold: 2,
});
