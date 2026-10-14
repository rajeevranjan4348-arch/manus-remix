/**
 * Reliable Response Engine for Manus AI
 * 
 * Prevents duplicate submissions, duplicate stream finalization events,
 * guarantees message ordering, manages request fencing, and validates structured outputs.
 */

import { observability } from './observability';

export interface StreamEvent {
  requestId: string;
  conversationId: string;
  seq: number;
  type: 'delta' | 'thought' | 'tool_call' | 'finish' | 'error';
  content?: string;
  metadata?: Record<string, any>;
}

class ReliableResponseEngineService {
  private inFlightRequests = new Set<string>(); // requestId set
  private finalizedRequests = new Set<string>(); // prevent double finalization
  private activeSequenceTracker = new Map<string, number>(); // requestId -> highest seq seen
  private responseCache = new Map<string, string>(); // requestId -> accumulated text

  /**
   * Generates a fenced request ID tied to conversation
   */
  public createRequestFence(conversationId: string): string {
    const reqId = `req_${conversationId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.inFlightRequests.add(reqId);
    this.activeSequenceTracker.set(reqId, 0);
    this.responseCache.set(reqId, '');
    return reqId;
  }

  /**
   * Check if submission is already in-flight to prevent double-clicks
   */
  public isRequestActive(requestId: string): boolean {
    return this.inFlightRequests.has(requestId);
  }

  /**
   * Ingest and validate streaming chunk with sequencing check
   */
  public processChunk(
    requestId: string,
    chunk: string,
    seq?: number
  ): { shouldApply: boolean; sanitizedChunk: string } {
    if (this.finalizedRequests.has(requestId)) {
      // Reject any trailing chunks arriving after stream has already completed
      return { shouldApply: false, sanitizedChunk: '' };
    }

    if (typeof seq === 'number') {
      const highest = this.activeSequenceTracker.get(requestId) || 0;
      if (seq < highest) {
        // Out-of-order chunk detected
        return { shouldApply: false, sanitizedChunk: '' };
      }
      this.activeSequenceTracker.set(requestId, seq);
    }

    // Accumulate
    const current = this.responseCache.get(requestId) || '';
    this.responseCache.set(requestId, current + chunk);

    return { shouldApply: true, sanitizedChunk: chunk };
  }

  /**
   * Finalize response safely, ensuring finish is executed exactly once
   */
  public finalizeRequest(requestId: string): { finalized: boolean; fullContent: string } {
    if (this.finalizedRequests.has(requestId)) {
      // Prevent double finalization
      return { finalized: false, fullContent: this.responseCache.get(requestId) || '' };
    }

    this.finalizedRequests.add(requestId);
    this.inFlightRequests.delete(requestId);
    const fullContent = this.responseCache.get(requestId) || '';

    observability.log({
      level: 'info',
      category: 'streaming',
      message: `Successfully finalized request ${requestId} (${fullContent.length} chars)`,
    });

    return { finalized: true, fullContent };
  }

  /**
   * Cleans up stale requests after 10 minutes
   */
  public cleanup(requestId: string): void {
    this.inFlightRequests.delete(requestId);
    this.finalizedRequests.delete(requestId);
    this.activeSequenceTracker.delete(requestId);
    this.responseCache.delete(requestId);
  }

  /**
   * Validate that structured JSON output is well-formed
   */
  public validateStructuredOutput(content: string): { isValidJson: boolean; parsed?: any } {
    const clean = content.trim();
    if (!clean.startsWith('{') && !clean.startsWith('[')) {
      const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          return { isValidJson: true, parsed };
        } catch {}
      }
      return { isValidJson: false };
    }

    try {
      const parsed = JSON.parse(clean);
      return { isValidJson: true, parsed };
    } catch {
      return { isValidJson: false };
    }
  }
}

export const reliableResponseEngine = new ReliableResponseEngineService();
