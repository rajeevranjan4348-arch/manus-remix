export const RECOVERY_POLICY_VERSION = '1.0.0';
const MAX_RECOVERY_EVENTS = 100;

export type RecoveryAction = 'provider_fallback' | 'circuit_open' | 'provider_recovered';
export type RecoveryOutcome = 'success' | 'failed' | 'degraded';

export interface RecoveryEvent {
  timestamp: string;
  policyVersion: string;
  component: 'gemini' | 'openrouter' | 'health';
  action: RecoveryAction;
  outcome: RecoveryOutcome;
  statusCode?: number;
  requestId?: string;
}

class RecoveryTelemetry {
  private events: RecoveryEvent[] = [];

  record(event: Omit<RecoveryEvent, 'timestamp' | 'policyVersion'>): RecoveryEvent {
    const safe: RecoveryEvent = {
      timestamp: new Date().toISOString(),
      policyVersion: RECOVERY_POLICY_VERSION,
      component: event.component,
      action: event.action,
      outcome: event.outcome,
      ...(Number.isInteger(event.statusCode) ? { statusCode: event.statusCode } : {}),
      ...(event.requestId ? { requestId: event.requestId.slice(0, 120) } : {}),
    };
    this.events.unshift(safe);
    if (this.events.length > MAX_RECOVERY_EVENTS) this.events.length = MAX_RECOVERY_EVENTS;
    // Platform function logs are access-controlled; emit metadata only, never prompts, credentials, or raw errors.
    if (safe.outcome !== 'success') console.warn('[recovery]', JSON.stringify(safe));
    return safe;
  }

  getRecent(limit = 20): RecoveryEvent[] {
    return this.events.slice(0, Math.max(0, Math.min(MAX_RECOVERY_EVENTS, limit)));
  }

  clear(): void {
    this.events = [];
  }
}

export const recoveryTelemetry = new RecoveryTelemetry();
