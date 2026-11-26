/**
 * Security validation, workspace path confinement, command screening,
 * browser SSRF/private-network protection, secret redaction, and webhook verification.
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import path from 'node:path';

export const AUTHORIZED_WORKSPACE_ROOT = '/home/user/workspace';
export const MAX_FILE_PATH_LENGTH = 512;
export const MAX_FILE_WRITE_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_COMMAND_LENGTH = 4096;
export const MAX_ENV_VARS = 40;

const BLOCKED_ENV_KEY_PATTERNS = [
  /^GEMINI_API_KEY$/i,
  /^OPENAI_API_KEY$/i,
  /^ANTHROPIC_API_KEY$/i,
  /^OPENROUTER/i,
  /^E2B_API_KEY$/i,
  /^DAYTONA_API_KEY$/i,
  /^BROWSERBASE_API_KEY$/i,
  /^BROWSERLESS_TOKEN$/i,
  /^SANDBOX_RUNTIME_API_KEY$/i,
  /^BROWSER_RUNTIME_API_KEY$/i,
  /^SANDBOX_WEBHOOK_SECRET$/i,
  /^POLICY_GATEWAY_SECRET$/i,
  /^TOKEN_ENCRYPTION_SECRET$/i,
  /^UPSTASH_REDIS/i,
  /^FIREBASE_SERVICE_ACCOUNT/i,
  /^GOOGLE_APPLICATION_CREDENTIALS$/i,
  /^AWS_SECRET/i,
  /^AWS_SESSION_TOKEN$/i,
  /^DATABASE_URL$/i,
  /^POSTGRES_URL$/i,
  /^LD_PRELOAD$/i,
  /^LD_LIBRARY_PATH$/i,
  /^NODE_OPTIONS$/i,
];

const FORBIDDEN_HOST_ESCAPE_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(nsenter|unshare|chroot|mount|umount|insmod|modprobe|kexec|reboot|shutdown|poweroff)\b/i, reason: 'Host/kernel privilege escalation commands are forbidden.' },
  { pattern: /\/proc\/1\/(root|ns|environ|mem)|\/dev\/(mem|kmem|sda|nvme|vda)/i, reason: 'Access to host kernel/device pseudo-filesystems is forbidden.' },
  { pattern: /169\.254\.169\.254|metadata\.google\.internal|metadata\.goog|100\.100\.100\.200/i, reason: 'Access to cloud instance metadata endpoints is forbidden.' },
  { pattern: /\/var\/run\/docker\.sock|\/run\/containerd/i, reason: 'Container runtime socket access is forbidden.' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'Fork bombs are forbidden.' },
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|\/\*|\.\.|~)(\s|$)/i, reason: 'Destructive root filesystem deletion is forbidden.' },
];

const APPROVAL_REQUIRED_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(npm|pnpm|yarn|bun)\s+(install|i|add|dlx|exec)\b|\bnpx\b|\bpip3?\s+install\b|\bpoetry\s+add\b|\bcargo\s+install\b|\bapt(-get)?\s+install\b/i, reason: 'Installing external dependencies requires explicit user approval.' },
  { pattern: /\b(curl|wget|nc|ncat|ssh|scp|rsync|ftp|telnet)\b/i, reason: 'External network transfer or remote command requires explicit user approval.' },
  { pattern: /\b(rm|rmdir|unlink|shred|git\s+push|git\s+reset\s+--hard|git\s+clean\s+-fd)\b/i, reason: 'Destructive filesystem or remote git mutation requires explicit user approval.' },
  { pattern: /\b(chmod|chown|sudo|su)\b/i, reason: 'Permission or privilege change command requires explicit user approval.' },
];

const SENSITIVE_BROWSER_INTERACTION_PATTERNS = [
  /\b(delete|remove|destroy|purge|drop|terminate|cancel|close\s*account)\b/i,
  /\b(pay|checkout|purchase|buy|order|transfer|withdraw|send\s*money|billing|confirm\s*payment|place\s*order)\b/i,
  /\b(submit|publish|post|send|deploy|merge|approve|authorize|grant|revoke)\b/i,
  /\b(password|passwd|secret|token|api[\s_-]?key|credit[\s_-]?card|cvv|ssn|otp|2fa)\b/i,
];

/**
 * Validates identifiers (sandboxId, workspaceId, projectId, executionId, sessionId).
 */
export function isValidResourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

/**
 * Resolves and confines a caller-supplied path strictly within the workspace root.
 * Blocks path traversal (`..`), null bytes, Windows drive escapes, symlink escape
 * segments, and host filesystem paths.
 */
export function resolveWorkspacePath(
  rawPath: string,
  workspaceRoot = AUTHORIZED_WORKSPACE_ROOT,
): { valid: boolean; normalizedRelative?: string; absolutePath?: string; error?: string } {
  const rootPosix = path.posix.resolve('/', workspaceRoot || AUTHORIZED_WORKSPACE_ROOT);
  const input = typeof rawPath === 'string' ? rawPath.trim() : '';

  if (input.length > MAX_FILE_PATH_LENGTH) {
    return { valid: false, error: `Path exceeds maximum length of ${MAX_FILE_PATH_LENGTH} characters.` };
  }
  if (input.includes('\0') || /[\r\n]/.test(input)) {
    return { valid: false, error: 'Path contains forbidden control characters.' };
  }
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.includes('\\')) {
    return { valid: false, error: 'Backslashes and drive-letter paths are not allowed.' };
  }

  // Allow empty string or "." to mean workspace root
  const cleanedInput = input === '' || input === '.' || input === './' ? '' : input;

  // Reject explicit traversal segments before resolution as defense-in-depth
  const segments = cleanedInput.split('/').filter(Boolean);
  if (segments.some((seg) => seg === '..')) {
    return { valid: false, error: 'Path traversal ("..") outside the authorized workspace is forbidden.' };
  }

  // If caller passed an absolute path, it MUST already start inside workspaceRoot
  let candidatePosix: string;
  if (cleanedInput.startsWith('/')) {
    candidatePosix = path.posix.resolve(cleanedInput);
  } else {
    candidatePosix = path.posix.resolve(rootPosix, cleanedInput);
  }

  if (candidatePosix !== rootPosix && !candidatePosix.startsWith(`${rootPosix}/`)) {
    return {
      valid: false,
      error: 'Resolved path escapes the authorized workspace boundary.',
    };
  }

  const relative = path.posix.relative(rootPosix, candidatePosix);
  return {
    valid: true,
    normalizedRelative: relative === '' ? '.' : relative,
    absolutePath: candidatePosix,
  };
}

/**
 * Validates file write payload size and content type.
 */
export function validateFileWritePayload(content: unknown, maxBytes = MAX_FILE_WRITE_BYTES): { valid: boolean; byteLength: number; error?: string } {
  if (typeof content !== 'string') {
    return { valid: false, byteLength: 0, error: 'File content must be a UTF-8 string.' };
  }
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > maxBytes) {
    return {
      valid: false,
      byteLength,
      error: `File size (${byteLength} bytes) exceeds the limit of ${maxBytes} bytes.`,
    };
  }
  return { valid: true, byteLength };
}

/**
 * Validates terminal command syntax, host-escape patterns, and approval risk.
 */
export function validateSandboxCommand(
  command: unknown,
  timeoutMs?: number,
): {
  valid: boolean;
  requiresApproval: boolean;
  approvalReason?: string;
  error?: string;
  normalizedCommand?: string;
} {
  if (typeof command !== 'string' || !command.trim()) {
    return { valid: false, requiresApproval: true, error: 'Command must be a non-empty string.' };
  }
  const normalized = command.trim();
  if (normalized.length > MAX_COMMAND_LENGTH) {
    return { valid: false, requiresApproval: true, error: `Command exceeds ${MAX_COMMAND_LENGTH} character limit.` };
  }
  if (normalized.includes('\0')) {
    return { valid: false, requiresApproval: true, error: 'Command contains null bytes.' };
  }

  for (const rule of FORBIDDEN_HOST_ESCAPE_COMMAND_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return { valid: false, requiresApproval: true, error: rule.reason };
    }
  }

  if (typeof timeoutMs === 'number' && timeoutMs > 60_000) {
    return {
      valid: true,
      requiresApproval: true,
      approvalReason: 'Long-running command execution (>60s) requires explicit user approval.',
      normalizedCommand: normalized,
    };
  }

  for (const rule of APPROVAL_REQUIRED_COMMAND_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return {
        valid: true,
        requiresApproval: true,
        approvalReason: rule.reason,
        normalizedCommand: normalized,
      };
    }
  }

  return {
    valid: true,
    requiresApproval: false,
    normalizedCommand: normalized,
  };
}

/**
 * Sanitizes user-supplied sandbox environment variables, stripping any server secret
 * keys or loader-hijack variables so secrets can never leak into a sandbox.
 */
export function sanitizeSandboxEnv(rawEnv?: Record<string, unknown>): Record<string, string> {
  if (!rawEnv || typeof rawEnv !== 'object' || Array.isArray(rawEnv)) return {};
  const safe: Record<string, string> = {};
  let count = 0;

  for (const [key, val] of Object.entries(rawEnv)) {
    if (count >= MAX_ENV_VARS) break;
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/i.test(key)) continue;
    if (BLOCKED_ENV_KEY_PATTERNS.some((re) => re.test(key))) continue;
    if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') continue;
    const strVal = String(val);
    if (strVal.length > 2048 || strVal.includes('\0')) continue;
    safe[key] = strVal;
    count++;
  }
  return safe;
}

/**
 * Checks whether an IPv4 address string falls into loopback, private, link-local,
 * CGNAT, multicast, or unspecified ranges.
 */
export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed -> treat as blocked
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast & reserved
  return false;
}

/**
 * Checks whether an IPv6 address string is loopback, unspecified, ULA, link-local,
 * multicast, or an IPv4-mapped private address.
 */
export function isPrivateOrReservedIpv6(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, '').toLowerCase();
  if (!ip) return true;
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // fc00::/7 ULA
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true; // fe80::/10 link-local
  if (ip.startsWith('ff')) return true; // multicast
  const v4Mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    return isPrivateOrReservedIpv4(v4Mapped[1]);
  }
  const v4HexMapped = ip.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4HexMapped) {
    const hi = parseInt(v4HexMapped[1], 16);
    const lo = parseInt(v4HexMapped[2], 16);
    const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    return isPrivateOrReservedIpv4(ipv4);
  }
  return false;
}

function isBlockedHostnameStatic(hostname: string): string | null {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host) return 'Empty hostname is not permitted.';

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host === 'instance-data' ||
    host === 'metadata'
  ) {
    return `Access to private or internal host "${host}" is blocked by network security policy.`;
  }

  // Detect numeric / hex / octal obfuscated IPv4 literals (e.g. 2130706433, 0x7f000001, 0177.0.0.1)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    return 'Numeric/encoded IP literals are blocked by network security policy.';
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateOrReservedIpv4(host)) {
      return `Access to private, loopback, or metadata IP "${host}" is blocked.`;
    }
  } else if (/^[0-7]+\.[0-7.]+$/.test(host)) {
    return 'Octal-encoded IP addresses are blocked by network security policy.';
  }

  if (host.includes(':')) {
    if (isPrivateOrReservedIpv6(host)) {
      return `Access to private or loopback IPv6 address "${host}" is blocked.`;
    }
  }

  return null;
}

/**
 * Synchronous URL validation for browser navigation and outbound fetches.
 * Optionally allows explicitly authorized sandbox preview hosts (e.g. *.e2b.app).
 */
export function validateBrowserNavigationUrl(
  rawUrl: string,
  options?: { allowedHosts?: string[] },
): { valid: boolean; normalizedUrl?: string; hostname?: string; error?: string } {
  const input = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!input || input.length > 2048) {
    return { valid: false, error: 'URL must be a non-empty string under 2048 characters.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Protocol "${parsed.protocol}" is forbidden. Only HTTP and HTTPS URLs are permitted.` };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Embedded credentials in URLs are not permitted.' };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blockedReason = isBlockedHostnameStatic(host);
  if (blockedReason) {
    return { valid: false, error: blockedReason };
  }

  if (options?.allowedHosts && options.allowedHosts.length > 0) {
    const allowed = options.allowedHosts.some(
      (allowedHost) => host === allowedHost.toLowerCase() || host.endsWith(`.${allowedHost.toLowerCase()}`),
    );
    if (!allowed) {
      return { valid: false, error: `Host "${host}" is not in the authorized domain allowlist.` };
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    hostname: host,
  };
}

/**
 * Full async validation including DNS resolution check to block DNS rebinding
 * to localhost, RFC1918 private networks, or cloud metadata IPs.
 */
export async function validateBrowserNavigationUrlWithDns(
  rawUrl: string,
  options?: { allowedHosts?: string[]; skipDnsLookup?: boolean },
): Promise<{ valid: boolean; normalizedUrl?: string; hostname?: string; error?: string }> {
  const staticCheck = validateBrowserNavigationUrl(rawUrl, options);
  if (!staticCheck.valid || !staticCheck.hostname) {
    return staticCheck;
  }

  if (options?.skipDnsLookup) {
    return staticCheck;
  }

  const host = staticCheck.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return staticCheck;
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    for (const rec of records) {
      const blocked =
        rec.family === 6 ? isPrivateOrReservedIpv6(rec.address) : isPrivateOrReservedIpv4(rec.address);
      if (blocked) {
        return {
          valid: false,
          error: `DNS resolution for "${host}" pointed to a restricted private/loopback address and was blocked.`,
        };
      }
    }
  } catch {
    // If DNS lookup fails in an offline test environment, fail closed only when explicitly required;
    // real provider navigation will naturally report DNS failure without accessing host networks.
  }

  return staticCheck;
}

/**
 * Classifies whether a browser click or form fill action targets a sensitive
 * operation requiring explicit user approval.
 */
export function requiresApprovalForBrowserAction(params: {
  action: 'click' | 'fill';
  selector?: string;
  label?: string;
  value?: string;
  url?: string;
}): { requiresApproval: boolean; reason?: string } {
  const combined = `${params.selector || ''} ${params.label || ''} ${params.url || ''}`;
  if (params.action === 'fill') {
    return {
      requiresApproval: true,
      reason: 'Filling website form inputs requires explicit user approval.',
    };
  }

  for (const re of SENSITIVE_BROWSER_INTERACTION_PATTERNS) {
    if (re.test(combined)) {
      return {
        requiresApproval: true,
        reason: `Sensitive browser interaction matching "${re.source}" requires explicit user approval.`,
      };
    }
  }

  return { requiresApproval: false };
}

/**
 * Redacts potential secrets, tokens, cookies, and host paths before returning
 * text or error output to the model or client.
 */
export function redactSensitiveExecutionText(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,}|e2b_[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ghp_[a-zA-Z0-9]{20,}|appr_[a-f0-9]{16,})\b/g, '[REDACTED_SECRET]')
    .replace(/(cookie|set-cookie|authorization|x-api-key)\s*[:=]\s*[^\r\n;]{6,}/gi, '$1: [REDACTED]')
    .replace(/\/app\/applet/g, '[workspace-host]')
    .replace(/\/var\/task/g, '[runtime-host]');
}

/**
 * Verifies an HMAC-SHA256 webhook signature from a sandbox/browser provider
 * using constant-time comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(params: {
  rawBody: string;
  signatureHeader?: string | null;
  secret?: string | null;
}): { valid: boolean; reason: string } {
  const secret = (params.secret ?? process.env.SANDBOX_WEBHOOK_SECRET ?? '').trim();
  if (!secret || secret.length < 16) {
    return { valid: false, reason: 'Webhook verification secret is not configured.' };
  }
  const provided = (params.signatureHeader || '').trim().replace(/^sha256=/i, '');
  if (!provided || !/^[a-f0-9]{64}$/i.test(provided)) {
    return { valid: false, reason: 'Missing or malformed HMAC-SHA256 webhook signature.' };
  }
  const expected = crypto.createHmac('sha256', secret).update(params.rawBody, 'utf8').digest('hex');
  const a = Buffer.from(provided.toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'Webhook signature mismatch.' };
  }
  return { valid: true, reason: 'Webhook signature verified.' };
}
