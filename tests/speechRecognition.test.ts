import { describe, it, expect } from 'vitest';
import { extractTranscriptFromResults, formatSpeechAutoFill } from '../src/components/voice/VoiceInputButton';

describe('SpeechRecognition API Integration & Auto-Fill', () => {
  describe('1. extractTranscriptFromResults', () => {
    it('handles empty or invalid results gracefully', () => {
      expect(extractTranscriptFromResults(null)).toEqual({
        finalTranscript: '',
        interimTranscript: '',
        fullTranscript: '',
      });
      expect(extractTranscriptFromResults(undefined)).toEqual({
        finalTranscript: '',
        interimTranscript: '',
        fullTranscript: '',
      });
      expect(extractTranscriptFromResults([])).toEqual({
        finalTranscript: '',
        interimTranscript: '',
        fullTranscript: '',
      });
    });

    it('extracts interim transcript when user is currently speaking', () => {
      const mockResults = [
        Object.assign([{ transcript: 'what is the capital of' }], { isFinal: false }),
      ];

      const res = extractTranscriptFromResults(mockResults);
      expect(res.interimTranscript).toBe('what is the capital of');
      expect(res.finalTranscript).toBe('');
      expect(res.fullTranscript).toBe('what is the capital of');
    });

    it('extracts final transcript once SpeechRecognition finalizes phrase', () => {
      const mockResults = [
        Object.assign([{ transcript: 'what is the capital of France' }], { isFinal: true }),
      ];

      const res = extractTranscriptFromResults(mockResults);
      expect(res.interimTranscript).toBe('');
      expect(res.finalTranscript).toBe('what is the capital of France');
      expect(res.fullTranscript).toBe('what is the capital of France');
    });

    it('combines finalized phrases with ongoing interim speech accurately', () => {
      const mockResults = [
        Object.assign([{ transcript: 'Compare Q3 revenue and' }], { isFinal: true }),
        Object.assign([{ transcript: 'generate a chart' }], { isFinal: false }),
      ];

      const res = extractTranscriptFromResults(mockResults);
      expect(res.finalTranscript).toBe('Compare Q3 revenue and');
      expect(res.interimTranscript).toBe('generate a chart');
      expect(res.fullTranscript).toBe('Compare Q3 revenue and generate a chart');
    });

    it('accumulates multiple continuous finalized sentences without truncation', () => {
      const mockResults = [
        Object.assign([{ transcript: 'Search for recent events in space exploration.' }], { isFinal: true }),
        Object.assign([{ transcript: 'Cite the top 3 news sources.' }], { isFinal: true }),
      ];

      const res = extractTranscriptFromResults(mockResults);
      expect(res.finalTranscript).toBe('Search for recent events in space exploration. Cite the top 3 news sources.');
      expect(res.interimTranscript).toBe('');
      expect(res.fullTranscript).toBe('Search for recent events in space exploration. Cite the top 3 news sources.');
    });
  });

  describe('2. formatSpeechAutoFill', () => {
    it('returns dictated text when base input is empty', () => {
      expect(formatSpeechAutoFill('', 'Hello Manus')).toBe('Hello Manus');
      expect(formatSpeechAutoFill('   ', 'Explain quantum computing')).toBe('Explain quantum computing');
    });

    it('returns base text when dictated text is empty', () => {
      expect(formatSpeechAutoFill('Existing question', '')).toBe('Existing question');
      expect(formatSpeechAutoFill('Existing question', '   ')).toBe('Existing question');
    });

    it('concatenates base text and newly dictated speech with single clean space', () => {
      expect(formatSpeechAutoFill('Draft an email to John', 'asking for the meeting reschedule')).toBe(
        'Draft an email to John asking for the meeting reschedule'
      );
      expect(formatSpeechAutoFill('Analyze this data  ', '  and build a website')).toBe(
        'Analyze this data and build a website'
      );
    });
  });

  describe('3. Browser SpeechRecognition API Compatibility', () => {
    it('supports checking standard and webkit prefixed constructors', () => {
      const fakeSpeechRecognition = function () {};
      const fakeWindow: any = { SpeechRecognition: fakeSpeechRecognition };

      const resolved = fakeWindow.SpeechRecognition || fakeWindow.webkitSpeechRecognition;
      expect(resolved).toBe(fakeSpeechRecognition);

      const fakeWebkitWindow: any = { webkitSpeechRecognition: fakeSpeechRecognition };
      const resolvedWebkit = fakeWebkitWindow.SpeechRecognition || fakeWebkitWindow.webkitSpeechRecognition;
      expect(resolvedWebkit).toBe(fakeSpeechRecognition);
    });
  });
});
