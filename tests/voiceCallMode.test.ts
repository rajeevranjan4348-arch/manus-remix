import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getVoiceCallStatusLabel,
  detectVoiceSearchIntent,
  createBargeInTracker,
  detectSpeechBargeIn,
  extractSpeakableSentences,
  SentenceStreamQueue,
  type VoiceCallState,
} from '../src/lib/voiceCallEngine';

const ROOT = process.cwd();
const read = (relPath: string) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

describe('Futuristic AI Voice Call Mode Engine', () => {
  it('maps every required VoiceCallState to its exact live status label', () => {
    const expected: Record<VoiceCallState, string> = {
      connecting: 'Connecting...',
      listening: 'Listening...',
      thinking: 'Thinking...',
      searching: 'Searching...',
      speaking: 'Speaking...',
      idle: 'Ready.',
      error: 'Connection interrupted',
    };

    for (const [state, label] of Object.entries(expected)) {
      expect(getVoiceCallStatusLabel(state as VoiceCallState)).toBe(label);
    }
  });

  it('detects live search intent accurately', () => {
    expect(detectVoiceSearchIntent("What's the weather in Tokyo today?")).toBe(true);
    expect(detectVoiceSearchIntent('Search for the latest Bitcoin price')).toBe(true);
    expect(detectVoiceSearchIntent('Check my Gmail inbox for invoices')).toBe(true);
    expect(detectVoiceSearchIntent('Explain quantum entanglement simply')).toBe(false);
    expect(detectVoiceSearchIntent('')).toBe(false);
  });

  it('triggers speech barge-in only on sustained voice above threshold and respects cooldown', () => {
    const tracker = createBargeInTracker();
    let now = 5000;

    // Brief 2-frame click should NOT trigger barge-in
    expect(detectSpeechBargeIn(0.42, tracker, { requiredFrames: 4, now })).toBe(false);
    expect(detectSpeechBargeIn(0.39, tracker, { requiredFrames: 4, now: now + 30 })).toBe(false);
    // Drops back to silence
    expect(detectSpeechBargeIn(0.05, tracker, { requiredFrames: 4, now: now + 60 })).toBe(false);
    expect(detectSpeechBargeIn(0.04, tracker, { requiredFrames: 4, now: now + 90 })).toBe(false);

    // Sustained 4 frames of user speech triggers barge-in on frame 4
    expect(detectSpeechBargeIn(0.35, tracker, { requiredFrames: 4, now: now + 120 })).toBe(false);
    expect(detectSpeechBargeIn(0.36, tracker, { requiredFrames: 4, now: now + 150 })).toBe(false);
    expect(detectSpeechBargeIn(0.38, tracker, { requiredFrames: 4, now: now + 180 })).toBe(false);
    expect(detectSpeechBargeIn(0.4, tracker, { requiredFrames: 4, now: now + 210 })).toBe(true);

    // Immediate next frame within cooldown does NOT re-trigger
    expect(detectSpeechBargeIn(0.45, tracker, { requiredFrames: 1, cooldownMs: 1000, now: now + 400 })).toBe(false);
    // After cooldown expires, can trigger again
    expect(detectSpeechBargeIn(0.45, tracker, { requiredFrames: 1, cooldownMs: 1000, now: now + 1300 })).toBe(true);
  });

  it('extracts speakable sentences progressively from streaming text chunks', () => {
    const first = extractSpeakableSentences('Deploying the liquidity monitor now. ', false);
    expect(first.sentences).toEqual(['Deploying the liquidity monitor now.']);
    expect(first.remainder).toBe('');

    const partial = extractSpeakableSentences('Monitoring pools in real time', false);
    expect(partial.sentences).toEqual([]);
    expect(partial.remainder).toBe('Monitoring pools in real time');

    const flushed = extractSpeakableSentences('Monitoring pools in real time', true);
    expect(flushed.sentences).toEqual(['Monitoring pools in real time']);
    expect(flushed.remainder).toBe('');
  });

  it('streams sentences sequentially via SentenceStreamQueue and supports instant interruption', () => {
    const spoken: string[] = [];
    let activeOnEnd: (() => void) | undefined;
    let startedCount = 0;
    let endedCount = 0;
    const stopMock = vi.fn();

    const speakMock = vi.fn((text: string, opts?: any) => {
      spoken.push(text);
      opts?.onStart?.();
      activeOnEnd = opts?.onEnd;
      return true;
    });

    const queue = new SentenceStreamQueue({
      voicePersona: 'aura',
      rate: 1.0,
      speakFn: speakMock as any,
      stopFn: stopMock,
      onSpeakingStart: () => {
        startedCount += 1;
      },
      onSpeakingEnd: () => {
        endedCount += 1;
      },
    });

    queue.startStream();
    queue.pushDelta('First sentence is ready to speak. ');
    queue.pushDelta('Second sentence follows cleanly. ');
    queue.finishStream();

    // First sentence plays immediately while second stays queued
    expect(spoken).toEqual(['First sentence is ready to speak.']);
    expect(startedCount).toBe(1);
    expect(endedCount).toBe(0);

    // Finishing first sentence automatically advances to second
    activeOnEnd?.();
    expect(spoken).toEqual([
      'First sentence is ready to speak.',
      'Second sentence follows cleanly.',
    ]);

    // Interrupt immediately stops playback and clears queue
    queue.interrupt();
    expect(stopMock).toHaveBeenCalled();
    expect(queue.speaking).toBe(false);

    // Late onEnd from aborted utterance must not trigger ended callback
    activeOnEnd?.();
    expect(endedCount).toBe(0);

    queue.dispose();
  });
});

describe('Futuristic AI Voice Call Mode Architecture & Integration', () => {
  it('connects VoiceCallModal to existing Gemini stream backend, Firebase auth, and long-term memory with zero hardcoded fallback replies', () => {
    const modal = read('src/components/voice/VoiceCallModal.tsx');

    expect(modal).toContain("fetch('/api/gemini/stream'");
    expect(modal).toContain('getFirebaseAuthorizationHeader');
    expect(modal).toMatch(/longTermMemory\s*\.\s*getRelevantContext/);
    expect(modal).toMatch(/longTermMemory\s*\.\s*captureFromUserMessage/);
    expect(modal).toContain('requestMicrophonePermission');
    expect(modal).toContain('SentenceStreamQueue');
    expect(modal).toContain('detectSpeechBargeIn');

    // Must not contain old hardcoded fallback replies
    expect(modal).not.toContain("I'm on it. I'll analyze that and give you the key insights.");
    expect(modal).not.toContain("Good to hear your voice!");
  });

  it('implements the required futuristic call screen controls, ambient styling, and cleanup', () => {
    const modal = read('src/components/voice/VoiceCallModal.tsx');
    const orb = read('src/components/voice/FuturisticVoiceOrb.tsx');
    const css = read('src/index.css');

    // Required top, center, and bottom controls
    expect(modal).toContain('Close chat');
    expect(modal).toContain('FuturisticVoiceOrb');
    expect(modal).toContain('Voice call information and controls');
    expect(modal).toContain('Send text message in voice mode');
    expect(modal).toContain('Mute microphone');
    expect(modal).toContain('Unmute microphone');

    // Proper resource cleanup
    expect(modal).toContain('getTracks().forEach');
    expect(modal).toContain('cancelAnimationFrame');
    expect(modal).toContain('stopCleanSpeech()');
    expect(modal).toContain('abortControllerRef.current.abort()');

    // GPU-friendly orb states & CSS variable reactivity (no 60fps React state thrashing)
    expect(orb).toContain('--orb-level');
    expect(orb).toContain('voice-orb-float');
    expect(orb).toContain('voice-orb-think-spin');
    expect(orb).toContain('voice-orb-connect-ring');
    expect(css).toContain('@keyframes voice-orb-float');
    expect(css).toContain('@keyframes voice-mic-ripple');
    expect(css).toContain('[data-perf-mode="ultra-lite"] .voice-orb-float');
  });

  it('preserves conversation context between ChatView, AttachmentMenu, useAgentTask, and VoiceCallModal', () => {
    const hook = read('src/hooks/useAgentTask.ts');
    const app = read('src/App.tsx');
    const chatView = read('src/components/agent/ChatView.tsx');
    const menu = read('src/components/chat/AttachmentMenu.tsx');

    expect(hook).toContain('appendVoiceExchange');
    expect(app).toContain('onVoiceExchangeComplete={appendVoiceExchange}');
    expect(chatView).toContain('conversationMessages={messages}');
    expect(chatView).toContain('onVoiceExchangeComplete={onVoiceExchangeComplete}');
    expect(menu).toContain('conversationMessages={conversationMessages}');
    expect(menu).toContain('onVoiceExchangeComplete={onVoiceExchangeComplete}');
  });
});
