/**
 * Streaming Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures and request hangs when downstream AI providers
 * experience rate limits, outages, or high latency. Provides clear, actionable
 * error messages to the user rather than leaving the UI stuck in loading states.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of consecutive failures to trip circuit (default: 3)
  resetTimeoutMs?: number;   // Time in ms to remain open before half-open probe (default: 30000)
}

export class StreamingCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  public readonly failureThreshold: number;
  public readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
  }

  /**
   * Evaluates current circuit breaker state, transitioning to HALF_OPEN if reset window passed.
   */
  getState(): CircuitState {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      }
    }
    return this.state;
  }

  /**
   * Checks whether a new streaming request should be allowed through.
   */
  canAttempt(): boolean {
    const currentState = this.getState();
    return currentState === 'CLOSED' || currentState === 'HALF_OPEN';
  }

  /**
   * Records a successful streaming completion, resetting failure counters.
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  /**
   * Records a streaming failure and trips the circuit to OPEN if threshold reached.
   */
  recordFailure(error?: any): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Resets the circuit breaker to clean CLOSED state.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Produces a specific, actionable error message tailored to the exact failure mode.
   */
  formatActionableErrorMessage(error?: any): string {
    const currentState = this.getState();
    if (currentState === 'OPEN') {
      const remainingSec = Math.max(1, Math.ceil((this.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000));
      return `⚠️ **AI Streaming Service Paused (Circuit Breaker Tripped)**\n\nThe AI streaming provider has encountered consecutive failures. The circuit breaker is currently **OPEN** to protect system stability.\n\n**Actionable Steps:**\n1. **Auto-Recovery**: Circuit will test recovery in approximately **${remainingSec}s**.\n2. **Check Credentials**: Verify that \`GEMINI_API_KEY\` is configured in your environment.\n3. **Switch Mode**: Switch to **Work Mode** or select an alternate model in Settings.\n4. **Reset**: Click the **Reset** button below to restart your conversation.`;
    }

    const msg = String(error?.message || error || '').toLowerCase();
    const status = error?.status || error?.statusCode;

    // Rate Limit / Quota Exceeded
    if (status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted')) {
      return `⚡ **AI Provider Rate Limit Exceeded**\n\nThe AI provider quota has been temporarily exhausted.\n\n**Actionable Steps:**\n- Wait 10-15 seconds and click **Retry Request**.\n- Switch to a lightweight model (e.g. Gemini 3.1 Flash Lite) in Settings.\n- Add your personal OpenRouter or Gemini API Key in Settings for dedicated throughput.`;
    }

    // Authentication / Unauthorized
    if (status === 401 || status === 403 || msg.includes('unauthenticated') || msg.includes('api key') || msg.includes('permission_denied')) {
      return `🔑 **AI Provider Authentication Error**\n\nThe AI provider rejected the request due to missing or invalid credentials.\n\n**Actionable Steps:**\n- Verify \`GEMINI_API_KEY\` in your \`.env\` file or Netlify build settings.\n- Make sure the API key is active in Google AI Studio.`;
    }

    // Timeout / Deadline Exceeded
    if (msg.includes('timeout') || msg.includes('deadline') || msg.includes('abort') || msg.includes('etimedout')) {
      return `⏱️ **AI Response Timed Out**\n\nThe streaming connection exceeded the request deadline while waiting for model generation.\n\n**Actionable Steps:**\n- Click **Retry Request** to re-dispatch your prompt.\n- Try a more specific or concise prompt.\n- Disable "Deep reasoning" if active to reduce generation latency.`;
    }

    // Service Unavailable / 503 / 500
    if (status === 503 || status === 502 || status === 500 || msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
      return `🌐 **AI Provider Temporarily Unavailable**\n\nThe upstream AI provider is experiencing elevated latency or temporary downtime.\n\n**Actionable Steps:**\n- Click **Retry Request** in a few moments.\n- The system automatically engages fallback routing on subsequent attempts.\n- Click **Reset** if you wish to start a new task.`;
    }

    const displayError = error?.message || String(error || 'Unknown streaming interruption');
    return `❌ **Streaming Execution Interrupted**\n\n${displayError}\n\n**Actionable Steps:**\n- Click **Retry Request** below to re-submit.\n- If the issue persists, click **Reset** to clear the session state.`;
  }
}

// Global shared circuit breaker for streaming routes
export const globalStreamingCircuitBreaker = new StreamingCircuitBreaker({
  failureThreshold: 3,
  resetTimeoutMs: 30000,
});
