import { cleanTextForSpeech, speakCleanHumanVoice, stopCleanSpeech } from './speechSynthesis';

export type VoiceCallState =
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'searching'
  | 'speaking'
  | 'error';

export function getVoiceCallStatusLabel(state: VoiceCallState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting...';
    case 'listening':
      return 'Listening...';
    case 'thinking':
      return 'Thinking...';
    case 'searching':
      return 'Searching...';
    case 'speaking':
      return 'Speaking...';
    case 'error':
      return 'Connection interrupted';
    case 'idle':
    default:
      return 'Ready.';
  }
}

const SEARCH_INTENT_PATTERN =
  /\b(weather|forecast|temperature|rain|humidity|news|latest|today|current|price|stock|score|search|look up|find online|google|email|gmail|calendar|schedule|drive|file|sheet|document)\b/i;

export function detectVoiceSearchIntent(query: string): boolean {
  const normalized = (query || '').trim();
  if (!normalized) return false;
  return SEARCH_INTENT_PATTERN.test(normalized);
}

/**
 * Calibrated Voice Activity Detection (VAD) barge-in detector.
 * Requires sustained microphone energy across consecutive frames so brief
 * speaker clicks or room pops do not accidentally interrupt AI playback.
 */
export interface BargeInTracker {
  consecutiveFrames: number;
  lastTriggeredAt: number;
}

export function createBargeInTracker(): BargeInTracker {
  return {
    consecutiveFrames: 0,
    lastTriggeredAt: 0,
  };
}

export function detectSpeechBargeIn(
  rmsLevel: number,
  tracker: BargeInTracker,
  options?: {
    threshold?: number;
    requiredFrames?: number;
    cooldownMs?: number;
    now?: number;
  }
): boolean {
  const threshold = options?.threshold ?? 0.24;
  const requiredFrames = options?.requiredFrames ?? 6;
  const cooldownMs = options?.cooldownMs ?? 1200;
  const now = options?.now ?? Date.now();

  if (now - tracker.lastTriggeredAt < cooldownMs) {
    tracker.consecutiveFrames = 0;
    return false;
  }

  if (rmsLevel >= threshold) {
    tracker.consecutiveFrames += 1;
    if (tracker.consecutiveFrames >= requiredFrames) {
      tracker.consecutiveFrames = 0;
      tracker.lastTriggeredAt = now;
      return true;
    }
    return false;
  }

  tracker.consecutiveFrames = Math.max(0, tracker.consecutiveFrames - 1);
  return false;
}

/**
 * Splits a streaming text buffer into speakable sentence chunks so TTS can start
 * speaking naturally as soon as the first sentence arrives from the SSE stream.
 */
export function extractSpeakableSentences(
  buffer: string,
  flush = false
): { sentences: string[]; remainder: string } {
  if (!buffer) {
    return { sentences: [], remainder: '' };
  }

  const sentences: string[] = [];
  let working = buffer;

  // Match sentence endings followed by whitespace or newline.
  // Require at least 18 characters so abbreviations like "Dr." or "U.S." don't fragment speech.
  const boundaryRegex = /([\s\S]{18,}?[.!?](?:["')\]]+)?)(?:\s+|\n+)/;

  while (true) {
    const match = boundaryRegex.exec(working);
    if (!match) break;
    const rawSentence = match[1].trim();
    const cleaned = cleanTextForSpeech(rawSentence);
    if (cleaned) {
      sentences.push(cleaned);
    }
    working = working.slice(match.index + match[0].length);
  }

  // Also split on paragraph breaks even without punctuation
  if (working.includes('\n\n')) {
    const parts = working.split(/\n\n+/);
    const tail = parts.pop() ?? '';
    for (const part of parts) {
      const cleaned = cleanTextForSpeech(part);
      if (cleaned) {
        sentences.push(cleaned);
      }
    }
    working = tail;
  }

  if (flush) {
    const cleanedTail = cleanTextForSpeech(working);
    if (cleanedTail) {
      sentences.push(cleanedTail);
    }
    return { sentences, remainder: '' };
  }

  return { sentences, remainder: working };
}

export interface SentenceStreamQueueOptions {
  voicePersona: string;
  rate?: number;
  volume?: number;
  onSpeakingStart?: () => void;
  onSpeakingEnd?: () => void;
  onSpeechLevel?: (level: number) => void;
  onError?: (error: unknown) => void;
  speakFn?: typeof speakCleanHumanVoice;
  stopFn?: typeof stopCleanSpeech;
}

/**
 * Manages progressive sentence-by-sentence TTS playback for streaming AI responses,
 * with clean interruption support when the user speaks or taps the orb/mic.
 */
export class SentenceStreamQueue {
  private buffer = '';
  private queue: string[] = [];
  private isSpeaking = false;
  private isStreamFinished = false;
  private isDisposed = false;
  private generation = 0;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private phase = 0;
  private options: SentenceStreamQueueOptions;

  constructor(options: SentenceStreamQueueOptions) {
    this.options = options;
  }

  public updateOptions(partial: Partial<SentenceStreamQueueOptions>): void {
    this.options = { ...this.options, ...partial };
  }

  public get speaking(): boolean {
    return this.isSpeaking || this.queue.length > 0;
  }

  public startStream(): void {
    this.interrupt();
    this.isStreamFinished = false;
  }

  public pushDelta(delta: string): void {
    if (this.isDisposed || !delta) return;
    this.buffer += delta;
    const { sentences, remainder } = extractSpeakableSentences(this.buffer, false);
    this.buffer = remainder;
    if (sentences.length > 0) {
      this.queue.push(...sentences);
      this.pump();
    }
  }

  public finishStream(): void {
    if (this.isDisposed) return;
    this.isStreamFinished = true;
    const { sentences } = extractSpeakableSentences(this.buffer, true);
    this.buffer = '';
    if (sentences.length > 0) {
      this.queue.push(...sentences);
      this.pump();
    } else if (!this.isSpeaking && this.queue.length === 0) {
      this.stopLevelEnvelope();
      this.options.onSpeakingEnd?.();
    }
  }

  public speakFull(text: string): void {
    this.startStream();
    this.pushDelta(text);
    this.finishStream();
  }

  public interrupt(): void {
    this.generation += 1;
    this.buffer = '';
    this.queue = [];
    this.isSpeaking = false;
    this.isStreamFinished = true;
    this.stopLevelEnvelope();
    const stopFn = this.options.stopFn ?? stopCleanSpeech;
    try {
      stopFn();
    } catch {
      // ignore synthesis cancellation errors
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    this.interrupt();
  }

  private startLevelEnvelope(): void {
    if (this.levelTimer) return;
    this.phase = 0;
    this.levelTimer = setInterval(() => {
      this.phase += 0.38;
      // Natural cadence envelope modulating between 0.25 and 0.88 while speaking
      const wave =
        0.52 +
        0.24 * Math.sin(this.phase) +
        0.12 * Math.sin(this.phase * 2.3 + 0.7);
      this.options.onSpeechLevel?.(Math.max(0.18, Math.min(0.95, wave)));
    }, 85);
  }

  private stopLevelEnvelope(): void {
    if (this.levelTimer) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    this.options.onSpeechLevel?.(0);
  }

  private pump(): void {
    if (this.isDisposed || this.isSpeaking) return;

    const nextSentence = this.queue.shift();
    if (!nextSentence) {
      if (this.isStreamFinished) {
        this.stopLevelEnvelope();
        this.options.onSpeakingEnd?.();
      }
      return;
    }

    const activeGen = this.generation;
    const wasFirstSentence = !this.levelTimer;
    this.isSpeaking = true;

    const speakFn = this.options.speakFn ?? speakCleanHumanVoice;
    const started = speakFn(nextSentence, {
      voicePersona: this.options.voicePersona,
      rate: this.options.rate ?? 1.0,
      volume: this.options.volume ?? 1.0,
      onStart: () => {
        if (this.isDisposed || activeGen !== this.generation) return;
        if (wasFirstSentence) {
          this.options.onSpeakingStart?.();
        }
        this.startLevelEnvelope();
      },
      onEnd: () => {
        if (this.isDisposed || activeGen !== this.generation) return;
        this.isSpeaking = false;
        this.pump();
      },
      onError: (err) => {
        if (this.isDisposed || activeGen !== this.generation) return;
        this.isSpeaking = false;
        this.options.onError?.(err);
        this.pump();
      },
    });

    if (!started) {
      this.isSpeaking = false;
      if (this.queue.length === 0 && this.isStreamFinished) {
        this.stopLevelEnvelope();
        this.options.onSpeakingEnd?.();
      } else {
        this.pump();
      }
    }
  }
}
