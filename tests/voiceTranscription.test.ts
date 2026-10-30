import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractTranscriptFromResults,
  formatSpokenPunctuation,
  formatSpeechAutoFill,
  isSpeechRecognitionSupported,
} from '../src/components/voice/VoiceInputButton';
import { formatRecordingDuration } from '../src/components/voice/VoiceTranscriptionIndicator';

describe('Real-Time Voice-to-Text Transcription & Input Container Indicator', () => {
  it('separates final and interim transcripts from Web Speech API SpeechRecognitionResultList', () => {
    const mockResults = [
      Object.assign([{ transcript: 'Write a unit test' }], { isFinal: true }),
      Object.assign([{ transcript: 'for the voice transcription' }], { isFinal: false }),
    ];

    const parsed = extractTranscriptFromResults(mockResults);
    expect(parsed.finalTranscript).toBe('Write a unit test');
    expect(parsed.interimTranscript).toBe('for the voice transcription');
    expect(parsed.fullTranscript).toBe('Write a unit test for the voice transcription');
  });

  it('converts spoken punctuation commands into symbols in real time', () => {
    const raw = 'Hello comma can you summarize this document question mark';
    expect(formatSpokenPunctuation(raw)).toBe('Hello, can you summarize this document?');
  });

  it('combines existing input text with newly transcribed speech smoothly', () => {
    expect(formatSpeechAutoFill('', 'explain quantum computing')).toBe('explain quantum computing');
    expect(formatSpeechAutoFill('Context:', 'summarize the above')).toBe('Context: summarize the above');
  });

  it('detects SpeechRecognition or webkitSpeechRecognition browser support', () => {
    expect(isSpeechRecognitionSupported({})).toBe(false);
    expect(isSpeechRecognitionSupported({ SpeechRecognition: function () {} })).toBe(true);
    expect(isSpeechRecognitionSupported({ webkitSpeechRecognition: function () {} })).toBe(true);
  });

  it('formats elapsed recording duration as MM:SS for the visual indicator', () => {
    expect(formatRecordingDuration(0)).toBe('00:00');
    expect(formatRecordingDuration(9)).toBe('00:09');
    expect(formatRecordingDuration(65)).toBe('01:05');
  });

  it('renders VoiceTranscriptionIndicator inside manus-input-container across ChatView, Home, and MyAIChat', () => {
    const chatViewSource = readFileSync(
      resolve(__dirname, '../src/components/agent/ChatView.tsx'),
      'utf-8'
    );
    const homeSource = readFileSync(
      resolve(__dirname, '../src/pages/Home.tsx'),
      'utf-8'
    );
    const myAiChatSource = readFileSync(
      resolve(__dirname, '../src/components/chat/MyAIChat.tsx'),
      'utf-8'
    );
    const indicatorSource = readFileSync(
      resolve(__dirname, '../src/components/voice/VoiceTranscriptionIndicator.tsx'),
      'utf-8'
    );

    expect(indicatorSource).toContain('data-testid="speech-listening-indicator"');
    expect(indicatorSource).toContain('data-testid="speech-recording-timer"');
    expect(indicatorSource).toContain('data-testid="speech-live-transcript"');
    expect(indicatorSource).toContain('data-testid="speech-waveform-visualizer"');

    expect(chatViewSource).toContain('data-testid="manus-input-container"');
    expect(chatViewSource).toContain('<VoiceTranscriptionIndicator');
    expect(homeSource).toContain('data-testid="manus-input-container"');
    expect(homeSource).toContain('<VoiceTranscriptionIndicator');
    expect(myAiChatSource).toContain('data-testid="manus-input-container"');
    expect(myAiChatSource).toContain('<VoiceTranscriptionIndicator');
  });
});
