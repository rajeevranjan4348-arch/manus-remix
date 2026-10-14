/**
 * Browser Automation Framework for Manus AI
 * 
 * Provides automated web inspection, structured DOM snapshot extraction,
 * safe interaction simulation, form analysis, and safety approval checks.
 */

import { observability } from './observability';
import { securityCenter } from './securityCenter';
import { approvalManager } from './approvalManager';

export interface PageSnapshot {
  url: string;
  title: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  interactiveElements: Array<{ tag: string; type?: string; text?: string; id?: string; name?: string }>;
  textContent: string;
  capturedAt: string;
}

export interface BrowserActionResult {
  success: boolean;
  action: 'navigate' | 'snapshot' | 'extract' | 'interact';
  url: string;
  data?: any;
  error?: string;
  summary: string;
}

class BrowserAutomationService {
  /**
   * Safe URL inspection to protect against SSRF and intranet targets
   */
  private validateTargetUrl(rawUrl: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, error: 'Only HTTP and HTTPS URLs are permitted.' };
      }
      const host = parsed.hostname.toLowerCase();
      if (['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'].includes(host) || host.endsWith('.local') || host.endsWith('.internal')) {
        return { valid: false, error: 'SSRF Protection: Access to private networks is forbidden.' };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid URL format.' };
    }
  }

  /**
   * Navigate and extract structured content from a target page
   */
  public async navigateAndInspect(targetUrl: string): Promise<BrowserActionResult> {
    const traceId = observability.startTrace('browser_navigate', { targetUrl });
    const validation = this.validateTargetUrl(targetUrl);

    if (!validation.valid) {
      observability.endTrace(traceId);
      return {
        success: false,
        action: 'navigate',
        url: targetUrl,
        error: validation.error,
        summary: `Blocked navigation to ${targetUrl}: ${validation.error}`,
      };
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ManusBrowserAutomation/2.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) {
        throw new Error(`Target returned HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Check for CAPTCHA challenge or Cloudflare interstitial
      if (/cf-turnstile|g-recaptcha|hcaptcha|challenge-running|waf-block/i.test(html)) {
        observability.endTrace(traceId, { captchaDetected: true });
        return {
          success: false,
          action: 'navigate',
          url: targetUrl,
          error: 'CAPTCHA_RESTRICTION: Target page requires interactive bot verification.',
          summary: `Navigation halted: CAPTCHA verification detected at ${targetUrl}.`,
        };
      }

      // Parse structured page elements
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : targetUrl;

      // Extract Headings (h1, h2, h3)
      const headings: string[] = [];
      const headingMatches = html.matchAll(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi);
      for (const m of headingMatches) {
        const text = m[1].trim();
        if (text && headings.length < 15) headings.push(text);
      }

      // Extract public links
      const links: Array<{ text: string; href: string }> = [];
      const linkMatches = html.matchAll(/<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi);
      for (const m of linkMatches) {
        const href = m[1];
        const text = m[2].trim();
        if (href && !href.startsWith('javascript:') && links.length < 20) {
          try {
            const absoluteHref = new URL(href, targetUrl).toString();
            links.push({ text: text || absoluteHref, href: absoluteHref });
          } catch {}
        }
      }

      // Clean text body
      const cleanText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 12000);

      const snapshot: PageSnapshot = {
        url: targetUrl,
        title,
        headings,
        links,
        interactiveElements: [],
        textContent: cleanText,
        capturedAt: new Date().toISOString(),
      };

      observability.endTrace(traceId);
      return {
        success: true,
        action: 'navigate',
        url: targetUrl,
        data: snapshot,
        summary: `Inspected "${title}" (${headings.length} headings, ${links.length} links, ${cleanText.length} chars).`,
      };
    } catch (err: any) {
      observability.endTrace(traceId, { error: err.message });
      return {
        success: false,
        action: 'navigate',
        url: targetUrl,
        error: securityCenter.toSafeErrorMessage(err),
        summary: `Navigation to ${targetUrl} failed.`,
      };
    }
  }

  /**
   * Request approval for sensitive browser actions (form submissions, external mutations)
   */
  public async submitFormWithApproval(params: {
    formUrl: string;
    formInputs: Record<string, string>;
    isApproved?: boolean;
    userId?: string;
  }): Promise<BrowserActionResult> {
    const { formUrl, formInputs, isApproved, userId = 'usr_manus_default' } = params;

    if (!isApproved) {
      approvalManager.proposeAction({
        toolName: 'browser_form_submit',
        title: `Submit form on ${new URL(formUrl).hostname}`,
        description: `Submit data to external endpoint: ${formUrl}`,
        target: formUrl,
        parameters: formInputs,
        riskLevel: 'sensitive',
        consequences: [
          'Transmits data to an external web service.',
          'May execute remote state modifications on the third-party website.',
        ],
        userId,
      });

      return {
        success: false,
        action: 'interact',
        url: formUrl,
        error: 'APPROVAL_REQUIRED: User authorization required before submitting external form.',
        summary: 'Form submission proposal pending user confirmation.',
      };
    }

    // Submit when approved
    try {
      const res = await fetch(formUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formInputs).toString(),
        signal: AbortSignal.timeout(10000),
      });

      return {
        success: res.ok,
        action: 'interact',
        url: formUrl,
        summary: `Form submitted to ${formUrl} with status HTTP ${res.status}.`,
      };
    } catch (e: any) {
      return {
        success: false,
        action: 'interact',
        url: formUrl,
        error: securityCenter.toSafeErrorMessage(e),
        summary: 'Form submission failed.',
      };
    }
  }
}

export const browserAutomation = new BrowserAutomationService();
