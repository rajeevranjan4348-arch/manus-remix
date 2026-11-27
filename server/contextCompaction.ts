/**
 * Smart Context Compaction & Token Budget Manager
 *
 * Automatically prevents context window overflow on long multi-turn conversations and
 * heavy autonomous workflows by compacting older turns into a structured factual summary
 * while preserving system instructions, pinned directives, multimodal attachments, and
 * the most recent conversation turns verbatim.
 */

import { GoogleGenAI } from '@google/genai';

export interface CompactableMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ContextCompactionOptions {
  /** Target max prompt token budget before compaction triggers (default: 18,000 tokens) */
  maxTokenBudget?: number;
  /** Minimum number of recent non-system messages to keep verbatim (default: 8) */
  preserveRecentTurns?: number;
  /** Maximum characters to allow in the generated summary block (default: 3600) */
  maxSummaryChars?: number;
  /** Optional custom summarizer (used in unit tests or custom provider pipelines) */
  summarizer?: (transcript: string) => Promise<string>;
  /** AbortSignal for bounded latency */
  signal?: AbortSignal;
}

export interface ContextCompactionResult {
  messages: CompactableMessage[];
  compacted: boolean;
  strategy: 'none' | 'gemini-summary' | 'extractive-fallback';
  originalTokens: number;
  compactedTokens: number;
  summarizedMessageCount: number;
  preservedMessageCount: number;
  summaryText?: string;
}

const COMPACTION_MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * Estimates tokens for text while treating base64 image payloads as a bounded multimodal token cost
 * (~258 tokens per inline image instead of raw base64 character length).
 */
export function estimateTextTokens(content: string): number {
  const raw = String(content || '');
  if (!raw) return 0;
  let imageCount = 0;
  const withoutImages = raw.replace(/\[IMAGE_DATA_URL:[^\]]+\]/gi, () => {
    imageCount += 1;
    return '';
  });
  const textTokens = Math.ceil(withoutImages.length / 4);
  return textTokens + imageCount * 258;
}

export function estimateConversationTokens(
  messages: CompactableMessage[],
  systemInstruction = '',
): number {
  let total = estimateTextTokens(systemInstruction);
  for (const msg of messages) {
    total += 4 + estimateTextTokens(msg.content);
  }
  return total;
}

/**
 * Deterministic extractive fallback summarizer when GEMINI_API_KEY is unavailable or times out.
 * Preserves user goals, key file paths, code identifiers, decisions, and latest outcomes.
 */
export function buildExtractiveCompactionSummary(
  olderMessages: CompactableMessage[],
  maxSummaryChars = 3200,
): string {
  const userGoals: string[] = [];
  const keyFindings: string[] = [];
  const referencedEntities = new Set<string>();

  for (const msg of olderMessages) {
    const cleaned = String(msg.content || '')
      .replace(/\[IMAGE_DATA_URL:[^\]]+\]/gi, '[image attachment]')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;

    // Extract file paths, URLs, and identifiers worth preserving across compaction
    const pathMatches = cleaned.match(/\b(?:src|server|netlify|tests)\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+/g) || [];
    for (const p of pathMatches.slice(0, 8)) referencedEntities.add(p);

    if (msg.role === 'user') {
      userGoals.push(`- User: ${cleaned.slice(0, 220)}${cleaned.length > 220 ? '...' : ''}`);
    } else if (msg.role === 'assistant') {
      const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned.slice(0, 220);
      keyFindings.push(`- Assistant: ${firstSentence.slice(0, 220)}${firstSentence.length > 220 ? '...' : ''}`);
    }
  }

  const lines: string[] = [
    '[COMPACTED EARLIER CONVERSATION CONTEXT]',
    `Summarized ${olderMessages.length} earlier turn(s) to stay within model context budget.`,
  ];

  if (userGoals.length > 0) {
    lines.push('\nKey User Requests & Goals:');
    lines.push(...userGoals.slice(-8));
  }
  if (keyFindings.length > 0) {
    lines.push('\nKey Decisions & Findings:');
    lines.push(...keyFindings.slice(-8));
  }
  if (referencedEntities.size > 0) {
    lines.push(`\nReferenced Files/Artifacts: ${Array.from(referencedEntities).slice(0, 15).join(', ')}`);
  }

  return lines.join('\n').slice(0, maxSummaryChars);
}

async function summarizeWithGemini(
  transcript: string,
  maxSummaryChars: number,
): Promise<string | null> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt =
      'Compress the following earlier conversation turns into a dense, factual working-memory brief ' +
      `under ${maxSummaryChars} characters. Preserve: (1) user goals & constraints, (2) concrete facts, numbers, ` +
      'decisions, and file paths/code symbols, (3) unresolved questions or next steps. Do not add greetings or fluff.\n\n' +
      `CONVERSATION TRANSCRIPT:\n${transcript.slice(0, 32000)}`;

    const response = await Promise.race([
      ai.models.generateContent({
        model: COMPACTION_MODEL,
        contents: prompt,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);

    const summary = response?.text?.trim();
    if (!summary || summary.length < 20) return null;
    return `[COMPACTED EARLIER CONVERSATION CONTEXT]\n${summary.slice(0, maxSummaryChars)}`;
  } catch {
    return null;
  }
}

/**
 * Automatically compacts long conversation threads when total tokens or turn count exceed thresholds.
 * Always keeps system messages and the most recent `preserveRecentTurns` turns intact.
 */
export async function compactConversationMessages(
  messages: CompactableMessage[],
  systemInstruction = '',
  options: ContextCompactionOptions = {},
): Promise<ContextCompactionResult> {
  const maxTokenBudget = Math.max(1500, options.maxTokenBudget ?? 18_000);
  const preserveRecentTurns = Math.max(2, options.preserveRecentTurns ?? 8);
  const maxSummaryChars = Math.max(600, options.maxSummaryChars ?? 3600);

  const originalTokens = estimateConversationTokens(messages, systemInstruction);
  const systemMessages = messages.filter((m) => m.role === 'system');
  const dialogMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  const exceedsBudget = originalTokens > maxTokenBudget;
  const exceedsTurnThreshold = dialogMessages.length > Math.max(preserveRecentTurns + 6, 20);

  if ((!exceedsBudget && !exceedsTurnThreshold) || dialogMessages.length <= preserveRecentTurns) {
    return {
      messages,
      compacted: false,
      strategy: 'none',
      originalTokens,
      compactedTokens: originalTokens,
      summarizedMessageCount: 0,
      preservedMessageCount: dialogMessages.length,
    };
  }

  // Keep the most recent turns verbatim (and never drop the very latest user message)
  const splitIndex = Math.max(1, dialogMessages.length - preserveRecentTurns);
  const olderTurns = dialogMessages.slice(0, splitIndex);
  const recentTurns = dialogMessages.slice(splitIndex);

  const transcript = olderTurns
    .map((m, i) => {
      const sanitized = m.content.replace(/\[IMAGE_DATA_URL:[^\]]+\]/gi, '[image attachment]');
      return `[Turn ${i + 1} - ${m.role.toUpperCase()}]: ${sanitized.slice(0, 1500)}`;
    })
    .join('\n\n');

  let summaryText: string | null = null;
  let strategy: 'gemini-summary' | 'extractive-fallback' = 'extractive-fallback';

  if (options.summarizer) {
    try {
      const custom = await options.summarizer(transcript);
      if (custom && custom.trim()) {
        summaryText = `[COMPACTED EARLIER CONVERSATION CONTEXT]\n${custom.trim().slice(0, maxSummaryChars)}`;
        strategy = 'gemini-summary';
      }
    } catch {
      summaryText = null;
    }
  } else if (!options.signal?.aborted) {
    summaryText = await summarizeWithGemini(transcript, maxSummaryChars);
    if (summaryText) {
      strategy = 'gemini-summary';
    }
  }

  if (!summaryText) {
    summaryText = buildExtractiveCompactionSummary(olderTurns, maxSummaryChars);
    strategy = 'extractive-fallback';
  }

  const compactedMessages: CompactableMessage[] = [
    ...systemMessages,
    {
      role: 'assistant',
      content: summaryText,
    },
    ...recentTurns,
  ];

  const compactedTokens = estimateConversationTokens(compactedMessages, systemInstruction);

  return {
    messages: compactedMessages,
    compacted: true,
    strategy,
    originalTokens,
    compactedTokens,
    summarizedMessageCount: olderTurns.length,
    preservedMessageCount: recentTurns.length,
    summaryText,
  };
}
