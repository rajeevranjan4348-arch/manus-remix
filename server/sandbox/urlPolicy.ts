/**
 * URL navigation policy for browser and preview operations (Feature 06).
 *
 * Pure and dependency-free so it is directly unit-testable. Applied on every
 * browser navigation, page interaction and preview readiness check. Blocks
 * loopback, private, link-local, and cloud metadata targets by default.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  '169.254.169.254',
]);

const INFRA_TLD_SUFFIXES = ['.local', '.internal', '.home.arpa', '.lan', '.localdomain', '.test', '.example', '.invalid'];

function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * Returns an error string when the host must be blocked, or null when allowed.
 * Numeric private ranges, loopback, link-local (incl. AWS/GCP metadata),
 * carrier-grade NAT and IPv6 ULA/link-local are all rejected.
 */
export function hostnameViolation(host: string): string | null {
  const normalized = String(host || '').trim().toLowerCase().replace(/\\.$/, '');
  if (!normalized) return 'Empty hostname';

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return 'Access to private networks and cloud metadata endpoints is forbidden';
  }
  for (const suffix of INFRA_TLD_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return 'Access to internal infrastructure hostnames is forbidden';
    }
  }

  const v4 = ipv4Octets(normalized);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return 'Access to private or loopback networks is forbidden';
    if (a === 169 && b === 254) return 'Access to link-local or cloud metadata endpoints is forbidden';
    if (a === 172 && b >= 16 && b <= 31) return 'Access to private networks is forbidden';
    if (a === 192 && b === 168) return 'Access to private networks is forbidden';
    if (a === 192 && b === 0) return 'Access to infrastructure protocols is forbidden';
    if (a === 100 && b >= 64 && b <= 127) return 'Access to carrier-grade NAT ranges is forbidden';
    if (a === 198 && (b === 18 || b === 19)) return 'Access to benchmark networks is forbidden';
    if (a >= 224) return 'Access to multicast or reserved ranges is forbidden';
    return null;
  }

  // IPv6 (colon present)
  if (normalized.includes(':')) {
    const bare = normalized.replace(/^\\[|\\]$/g, '');
    // ::1 or ::1 equivalents, ::ffff:127.0.0.1 style mapped addresses
    if (bare === '::1' || bare === '::' || /^::ffff:127\\./.test(bare) || /^::ffff:10\\./.test(bare) || /^::ffff:192\\.168\\./.test(bare) || /^::ffff:169\\.254\\./.test(bare)) {
      return 'Access to loopback or private networks is forbidden';
    }
    const leadGroups = bare.split(':')[0];
    if (leadGroups && /^f[cd]/i.test(bare.slice(0, 3)) === false && /^(fe80|fc[0-9a-f]{2}|fd[0-9a-f]{2})/i.test(bare)) {
      return 'Access to IPv6 link-local or unique-local ranges is forbidden';
    }
    if (/^(fc|fd)/i.test(bare)) return 'Access to IPv6 unique-local ranges is forbidden';
    if (/^fe[89ab]/i.test(bare)) return 'Access to IPv6 link-local ranges is forbidden';
    return null;
  }

  return null;
}

export interface NavigationDecision {
  allowed: boolean;
  reason?: string;
  normalizedUrl?: string;
}

/**
 * Full navigation validation: scheme allowlist, SSRF host policy, size-bounded.
 */
export function validateNavigationUrl(rawUrl: string): NavigationDecision {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || trimmed.length > 2048) {
    return { allowed: false, reason: 'Invalid or oversized URL' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { allowed: false, reason: 'Invalid URL format' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: 'Only HTTP and HTTPS URLs are permitted' };
  }
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: 'URLs with embedded credentials are rejected' };
  }
  const violation = hostnameViolation(parsed.hostname);
  if (violation) {
    return { allowed: false, reason: `SSRF protection: ${violation}` };
  }
  return { allowed: true, normalizedUrl: parsed.toString() };
}
