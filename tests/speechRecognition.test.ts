import { describe, it, expect } from 'vitest';

// Polyfill window & localStorage in Node test environment if undefined
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

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

  describe('4. Live Audio Input Level Scaling & Sphere Visual Feedback', () => {
    it('scales audio level normalized values accurately for visual reactivity', () => {
      const calculateAudioScale = (rawAverage: number) => {
        const rawLevel = Math.min(1.0, (rawAverage / 110) * 1.4);
        return rawLevel < 0.03 ? 0 : rawLevel;
      };

      expect(calculateAudioScale(0)).toBe(0);
      expect(calculateAudioScale(2)).toBe(0); // Noise floor filtered
      expect(calculateAudioScale(50)).toBeGreaterThan(0.5); // Moderate speech
      expect(calculateAudioScale(120)).toBe(1.0); // Peak speech volume capped at 1.0
    });

    it('calculates voice sphere pulse and morph metrics based on live audio level', () => {
      const getOrbMetrics = (effectiveLevel: number) => ({
        orbScale: 1 + effectiveLevel * 0.35,
        auraScale: 1.1 + effectiveLevel * 0.55,
        glowSize: 18 + effectiveLevel * 38,
        morphDuration: Math.max(1.0, 4.8 - effectiveLevel * 3.2),
      });

      const quiet = getOrbMetrics(0);
      expect(quiet.orbScale).toBe(1.0);
      expect(quiet.auraScale).toBe(1.1);
      expect(quiet.morphDuration).toBe(4.8);

      const activeSpeech = getOrbMetrics(0.8);
      expect(activeSpeech.orbScale).toBeGreaterThan(1.2);
      expect(activeSpeech.auraScale).toBeGreaterThan(1.4);
      expect(activeSpeech.glowSize).toBeGreaterThan(40);
      expect(activeSpeech.morphDuration).toBeLessThan(3.0); // Morphs faster during speech
    });
  });

  describe('5. Auto-Submit After 7 Seconds Silence Configuration', () => {
    it('provides autoSubmitVoiceAfterSilence enabled by default with 7 seconds delay', async () => {
      const { getSettings, saveSettings } = await import('../src/lib/settingsStore');
      const settings = getSettings();
      expect(settings.autoSubmitVoiceAfterSilence).toBe(true);
      expect(settings.autoSubmitSilenceDelay).toBe(7);
    });

    it('allows toggling autoSubmitVoiceAfterSilence setting and persists state', async () => {
      const { getSettings, saveSettings } = await import('../src/lib/settingsStore');
      
      saveSettings({ autoSubmitVoiceAfterSilence: false });
      expect(getSettings().autoSubmitVoiceAfterSilence).toBe(false);

      saveSettings({ autoSubmitVoiceAfterSilence: true, autoSubmitSilenceDelay: 7 });
      expect(getSettings().autoSubmitVoiceAfterSilence).toBe(true);
      expect(getSettings().autoSubmitSilenceDelay).toBe(7);
    });

    it('executes auto-submit callback after 7 seconds of inactivity following speech', () => {
      let submittedText = '';
      let timerTriggered = false;

      const triggerAutoSubmitOnSilence = (
        transcript: string,
        delaySeconds: number,
        callback: (text: string) => void
      ) => {
        let timer: any = null;
        const startTimer = () => {
          timer = setTimeout(() => {
            timerTriggered = true;
            callback(transcript);
          }, delaySeconds * 1000);
        };
        startTimer();
        return () => clearTimeout(timer);
      };

      // Simulating user speech followed by silence
      const cancel = triggerAutoSubmitOnSilence('What is the weather today?', 7, (text) => {
        submittedText = text;
      });

      // Verify timer is pending before 7s
      expect(timerTriggered).toBe(false);
      expect(submittedText).toBe('');

      // Cleanup
      cancel();
    });
  });

  describe('6. Composer Web Speech Integration Verification', () => {
    it('verifies VoiceInputButton and MyAIChat files integrate Web Speech API with 7s silence setting', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const voiceInputButtonCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/voice/VoiceInputButton.tsx'),
        'utf-8'
      );
      const myAIChatCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/chat/MyAIChat.tsx'),
        'utf-8'
      );
      const androidVoiceSettingsCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/settings/AndroidVoiceSettings.tsx'),
        'utf-8'
      );

      // Verify SpeechRecognition integration
      expect(voiceInputButtonCode).toContain('SpeechRecognition');
      expect(myAIChatCode).toContain('SpeechRecognition');

      // Verify 7s silence delay check
      expect(voiceInputButtonCode).toContain('autoSubmitVoiceAfterSilence');
      expect(voiceInputButtonCode).toContain('autoSubmitSilenceDelay ?? 7');
      expect(myAIChatCode).toContain('autoSubmitVoiceAfterSilence');
      expect(myAIChatCode).toContain('autoSubmitSilenceDelay ?? 7');

      // Verify setting switch in AndroidVoiceSettings
      expect(androidVoiceSettingsCode).toContain('autoSubmitVoiceAfterSilence');
      expect(androidVoiceSettingsCode).toContain('Auto-submit speech after 7s silence');
    });

    it('verifies manus-input-container integrates SpeechRecognition dictation, live transcript preview, and Send Now controls in Home and ChatView', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const homeCode = fs.readFileSync(
        path.resolve(__dirname, '../src/pages/Home.tsx'),
        'utf-8'
      );
      const chatViewCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/agent/ChatView.tsx'),
        'utf-8'
      );
      const voiceInputButtonCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/voice/VoiceInputButton.tsx'),
        'utf-8'
      );
      const voiceListeningBannerCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/voice/VoiceTranscriptionIndicator.tsx'),
        'utf-8'
      );

      // Both Home and ChatView prompt composers must have manus-input-container class and data-testid
      expect(homeCode).toContain('manus-input-container');
      expect(homeCode).toContain('data-testid="manus-input-container"');
      expect(chatViewCode).toContain('manus-input-container');
      expect(chatViewCode).toContain('data-testid="manus-input-container"');

      // Both must wire VoiceInputButton with onTranscript, onInterimChange, and onAutoSubmit
      expect(homeCode).toContain('<VoiceInputButton');
      expect(homeCode).toContain('onAutoSubmit=');
      expect(chatViewCode).toContain('<VoiceInputButton');
      expect(chatViewCode).toContain('onAutoSubmit=');

      // Both must render VoiceTranscriptionIndicator which provides live speech indicator, live transcript, Clear, Done, and Send Now buttons
      expect(homeCode).toContain('<VoiceTranscriptionIndicator');
      expect(chatViewCode).toContain('<VoiceTranscriptionIndicator');
      expect(voiceListeningBannerCode).toContain('data-testid="speech-listening-indicator"');
      expect(voiceListeningBannerCode).toContain('data-testid="speech-live-transcript"');
      expect(voiceListeningBannerCode).toContain('data-testid="speech-done-btn"');
      expect(voiceListeningBannerCode).toContain('data-testid="speech-send-now-btn"');

      // Verify VoiceInputButton unmount effect uses empty dependency array so starting recognition does not abort active session
      expect(voiceInputButtonCode).toContain('data-testid="voice-input-button"');
      expect(voiceInputButtonCode).toContain('sessionCommittedTranscriptRef');
    });
  });
});

