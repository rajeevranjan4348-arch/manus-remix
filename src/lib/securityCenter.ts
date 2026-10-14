/**
 * Security Center for Manus AI
 * 
 * Enforces input sanitization, prompt injection detection, rate limiting,
 * safe path traversal mitigation, and security audit event logging.
 */

import { observability } from './observability';

export interface SecurityAuditEvent {
  id: string;
  timestamp: string;
  action: string;
  userId: string;
  status: 'allowed' | 'denied' | 'flagged' | 'rate_limited';
  reason?: string;
  target?: string;
  ip?: string;
}

export interface SecurityScanResult {
  isSafe: boolean;
  score: number; // 0 to 1 (0 = safe, 1 = high risk)
  threats: string[];
  sanitizedText: string;
}

// Patterns commonly used in prompt injection and jailbreak attacks
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior)\s+(system|rules)/i,
  /you\s+are\s+now\s+(an?\s+unfiltered|DAN|jailbroken|unrestricted)/i,
  /print\s+(your\s+)?(system\s+prompt|developer\s+instructions)/i,
  /reveal\s+(the\s+)?(hidden\s+prompt|secret\s+instructions)/i,
  /repeat\s+(everything|the\s+words)\s+above/i,
  /<\/?system>/i,
  /\[SYSTEM_PROMPT\]/i,
  /bypass\s+(safety|content)\s+filters/i,
];

// Dangerous file patterns
const PATH_TRAVERSAL_PATTERN = /(\.\.[\/\\]|[\/\\]\.\.|^\/etc\/|^\/root\/|C:\\Windows)/i;

class SecurityCenterService {
  private auditEvents: SecurityAuditEvent[] = [];
  private rateLimitWindow = new Map<string, number[]>(); // ip/user -> timestamps
  private readonly MAX_EVENTS = 150;

  /**
   * Scans text for prompt injection, jailbreaking, or dangerous command sequences
   */
  public scanInput(text: string, userId = 'usr_manus_default'): SecurityScanResult {
    if (!text || typeof text !== 'string') {
      return { isSafe: true, score: 0, threats: [], sanitizedText: '' };
    }

    const threats: string[] = [];
    let riskScore = 0;

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        threats.push(`Potential prompt override detected: ${pattern.source}`);
        riskScore += 0.7;
      }
    }

    if (PATH_TRAVERSAL_PATTERN.test(text)) {
      threats.push('Path traversal sequence detected');
      riskScore += 0.5;
    }

    const isSafe = riskScore < 0.7;

    // Neutralize dangerous structural tokens without changing ordinary conversational wording
    let sanitizedText = text
      .replace(/\0/g, '') // remove null bytes
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''); // strip script tags

    // Redact secrets like API keys, private tokens, passwords
    const SECRET_PATTERNS = [
      /sk-[a-zA-Z0-9_\-]{16,}/g,
      /AIza[0-9A-Za-z\-_]{35}/g,
      /ghp_[a-zA-Z0-9]{36}/g,
      /bearer\s+[a-zA-Z0-9_\.\-]{20,}/gi,
      /password\s*[:=]\s*['"]?[^'"\s]+['"]?/gi,
    ];

    for (const secretPattern of SECRET_PATTERNS) {
      sanitizedText = sanitizedText.replace(secretPattern, '[REDACTED_SECRET]');
    }

    if (!isSafe) {
      this.recordAudit({
        action: 'prompt_injection_blocked',
        userId,
        status: 'denied',
        reason: threats.join('; '),
      });
      observability.log({
        level: 'warning',
        category: 'security',
        classification: 'VALIDATION_ERROR',
        message: `Blocked suspicious input from ${userId}`,
        details: { threats, sample: sanitizedText.slice(0, 100) },
      });
    }

    return {
      isSafe,
      score: Math.min(riskScore, 1.0),
      threats,
      sanitizedText,
    };
  }

  /**
   * Validates and sanitizes file paths to prevent directory traversal
   */
  public sanitizeFilePath(rawPath: string): string {
    if (!rawPath) return '';
    // Strip traversal tokens and illegal characters
    let clean = rawPath
      .replace(/\\/g, '/')
      .replace(/\.\.+[\/\\]/g, '')
      .replace(/^\/+/, '')
      .replace(/[\0\x00-\x1f\x7f<>:"|?*]/g, '');

    // Prevent access to sensitive dotfiles (.env, .git, etc.)
    if (/^\.(env|git|ssh|aws|config)/i.test(clean)) {
      clean = clean.replace(/^\./, 'safe_');
    }

    return clean || 'unnamed_file';
  }

  /**
   * Rate limiting using sliding window algorithm
   */
  public checkRateLimit(key: string, limit = 40, windowSeconds = 60): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const timestamps = (this.rateLimitWindow.get(key) || []).filter(t => now - t < windowMs);

    if (timestamps.length >= limit) {
      this.recordAudit({
        action: 'rate_limit_exceeded',
        userId: key,
        status: 'rate_limited',
        reason: `Exceeded ${limit} requests per ${windowSeconds}s`,
      });
      return { allowed: false, remaining: 0 };
    }

    timestamps.push(now);
    this.rateLimitWindow.set(key, timestamps);
    return { allowed: true, remaining: limit - timestamps.length };
  }

  /**
   * Record security audit event
   */
  public recordAudit(event: Omit<SecurityAuditEvent, 'id' | 'timestamp'>): void {
    const fullEvent: SecurityAuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.auditEvents.unshift(fullEvent);
    if (this.auditEvents.length > this.MAX_EVENTS) {
      this.auditEvents.pop();
    }
  }

  /**
   * Get audit log history
   */
  public getAuditEvents(limit = 50): SecurityAuditEvent[] {
    return this.auditEvents.slice(0, limit);
  }

  /**
   * Formats safe user-facing error message without leaking stack traces or system environment
   */
  public toSafeErrorMessage(err: unknown, fallback = 'An unexpected error occurred. Please try again.'): string {
    if (!err) return fallback;
    const raw = err instanceof Error ? err.message : String(err);

    // Filter out internal system variables or sensitive keys
    if (/sk-[a-zA-Z0-9_-]{10,}|AIzaSy|Bearer|password|secret|Token/i.test(raw)) {
      return 'The operation encountered an authorization or provider error. Sensitive details have been redacted.';
    }

    // Filter out raw file paths
    if (/(\/app\/|\/var\/|\/usr\/|[A-Z]:\\[^ \n]+)/.test(raw)) {
      return raw.replace(/(\/[a-zA-Z0-9_\-\.\/]+|[A-Z]:\\[a-zA-Z0-9_\-\.\\]+)/g, '[redacted_path]');
    }

    return raw.slice(0, 300);
  }
}

export const securityCenter = new SecurityCenterService();
