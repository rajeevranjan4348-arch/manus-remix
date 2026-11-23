/**
 * Real-Time Intelligence Engine (RTIE) — Content Extraction & URL Security Service
 *
 * Provides:
 * - Strict SSRF protection (blocks localhost, loopback, link-local, private RFC1918 IPs, non-HTTP/HTTPS)
 * - Webpage content extraction with timeouts
 * - Publication date extraction from HTML meta tags, JSON-LD, and <time> elements
 * - Untrusted webpage instruction sanitization (defends against indirect prompt injection)
 */

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd[0-9a-f]{2}:/i,
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  '[::1]',
  'metadata.google.internal',
  '169.254.169.254',
  'instance-data',
]);

/**
 * Validates that an external URL is safe to fetch (prevents SSRF)
 */
export function validateSafeExternalUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  reason?: string;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'URL must be a non-empty string.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: 'Malformed URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URLs containing embedded credentials are blocked.' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, reason: 'Target host is restricted by SSRF policy.' };
  }

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: 'Private or loopback IP range is restricted by SSRF policy.' };
    }
  }

  parsed.hash = '';
  return { valid: true, normalizedUrl: parsed.toString() };
}

/**
 * Strips prompt injection attempts and malicious directives from untrusted webpage text
 */
export function sanitizeUntrustedWebContent(rawText: string, maxLength = 2500): string {
  if (!rawText) return '';
  return rawText
    .replace(/ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/gi, '[filtered-untrusted-directive]')
    .replace(/disregard\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?/gi, '[filtered-untrusted-directive]')
    .replace(/system\s*prompt\s*:/gi, '[filtered-directive]:')
    .replace(/you\s+are\s+now\s+in\s+developer\s+mode/gi, '[filtered-untrusted-directive]')
    .replace(/<\s*\/?\s*(?:system|instruction|prompt|think)\s*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Extracts publication date from raw HTML or text snippet
 */
export function extractPublicationDate(htmlOrText: string): string | undefined {
  if (!htmlOrText) return undefined;

  // 1. Meta tags (article:published_time, datePublished, pubdate, dc.date)
  const metaMatch = htmlOrText.match(
    /(?:property|name|itemprop)=["'](?:article:published_time|datePublished|pubdate|publishdate|dc\.date|date)["'][^>]*content=["']([^"']{8,40})["']/i
  ) || htmlOrText.match(
    /content=["']([^"']{8,40})["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|pubdate|publishdate|dc\.date|date)["']/i
  );
  if (metaMatch?.[1]) {
    const parsed = Date.parse(metaMatch[1]);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  // 2. JSON-LD "datePublished"
  const jsonLdMatch = htmlOrText.match(/"datePublished"\s*:\s*"([^"]{8,40})"/i);
  if (jsonLdMatch?.[1]) {
    const parsed = Date.parse(jsonLdMatch[1]);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  // 3. <time datetime="...">
  const timeTagMatch = htmlOrText.match(/<time[^>]*datetime=["']([^"']{8,40})["']/i);
  if (timeTagMatch?.[1]) {
    const parsed = Date.parse(timeTagMatch[1]);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  // 4. Explicit ISO date in text (e.g., 2025-05-14 or 2026-10-30)
  const isoDateMatch = htmlOrText.match(/\b(20[12]\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/);
  if (isoDateMatch?.[1]) {
    const parsed = Date.parse(isoDateMatch[1]);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return undefined;
}

export interface ExtractedWebPage {
  url: string;
  title: string;
  description: string;
  textContent: string;
  publishedAt?: string;
  fetchedAt: string;
  ok: boolean;
  error?: string;
}

/**
 * Safely fetches and extracts clean text, title, and publication date from a public URL
 */
export async function fetchAndExtractWebPage(
  rawUrl: string,
  timeoutMs = 5500,
  signal?: AbortSignal
): Promise<ExtractedWebPage> {
  const fetchedAt = new Date().toISOString();
  const check = validateSafeExternalUrl(rawUrl);
  if (!check.valid || !check.normalizedUrl) {
    return {
      url: rawUrl,
      title: rawUrl,
      description: '',
      textContent: '',
      fetchedAt,
      ok: false,
      error: check.reason || 'Blocked URL',
    };
  }

  const targetUrl = check.normalizedUrl;
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal
      : timeoutSignal;

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Deku-RTIE-ResearchBot/1.0 (+https://deku.ai)',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9',
      },
      redirect: 'follow',
      signal: combinedSignal,
    });

    if (!res.ok) {
      return {
        url: targetUrl,
        title: targetUrl,
        description: '',
        textContent: '',
        fetchedAt,
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (
      !contentType.includes('text/') &&
      !contentType.includes('application/json') &&
      !contentType.includes('application/xml') &&
      !contentType.includes('application/xhtml')
    ) {
      return {
        url: targetUrl,
        title: targetUrl,
        description: '',
        textContent: '',
        fetchedAt,
        ok: false,
        error: `Unsupported content-type: ${contentType}`,
      };
    }

    const rawBody = (await res.text()).slice(0, 150000);
    const publishedAt = extractPublicationDate(rawBody);

    if (contentType.includes('application/json')) {
      return {
        url: targetUrl,
        title: targetUrl,
        description: 'JSON API Response',
        textContent: sanitizeUntrustedWebContent(rawBody, 2500),
        publishedAt,
        fetchedAt,
        ok: true,
      };
    }

    const titleMatch = rawBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]
      ? sanitizeUntrustedWebContent(titleMatch[1].replace(/<[^>]+>/g, ''), 200)
      : targetUrl;

    const descMatch =
      rawBody.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      rawBody.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
    const description = descMatch?.[1] ? sanitizeUntrustedWebContent(descMatch[1], 400) : '';

    const cleanHtml = rawBody
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');

    const textContent = sanitizeUntrustedWebContent(cleanHtml, 2500);

    return {
      url: targetUrl,
      title: title || targetUrl,
      description,
      textContent: textContent || description,
      publishedAt,
      fetchedAt,
      ok: Boolean(textContent || description),
    };
  } catch (err: any) {
    return {
      url: targetUrl,
      title: targetUrl,
      description: '',
      textContent: '',
      fetchedAt,
      ok: false,
      error: err?.message || 'Fetch failed',
    };
  }
}
