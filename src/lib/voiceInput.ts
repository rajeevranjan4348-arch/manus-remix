export type SpeechInputResult = { transcript: string };

type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = { 0?: SpeechRecognitionAlternativeLike; isFinal?: boolean };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionErrorLike = { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function isSpeechInputSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const speechWindow = window as SpeechWindow;
  return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition);
}

/**
 * Starts microphone capture only after a user gesture. The browser/OS owns
 * permission prompts; no background recording is attempted.
 */
export function listenForSpeech(language = 'en-IN'): Promise<SpeechInputResult> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Microphone input is unavailable.'));
  const speechWindow = window as SpeechWindow;
  const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!Recognition) return Promise.reject(new Error('Speech recognition is not supported in this browser. Try Chrome on Android.'));
  return new Promise((resolve, reject) => {
    const recognition = new Recognition();
    let transcript = '';
    let settled = false;
    recognition.lang = language;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      const result = event.results[event.results.length - 1];
      transcript = result?.[0]?.transcript?.trim() || transcript;
    };
    recognition.onerror = event => {
      if (settled) return;
      settled = true;
      const reason = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone permission was denied. Allow microphone access in browser settings.'
        : event.error === 'no-speech'
          ? 'No speech detected. Please try again.'
          : 'Microphone input failed. Please try again.';
      reject(new Error(reason));
    };
    recognition.onend = () => {
      if (settled) return;
      settled = true;
      if (transcript) resolve({ transcript });
      else reject(new Error('No speech detected. Please try again.'));
    };
    try { recognition.start(); } catch { reject(new Error('Could not start microphone capture.')); }
  });
}
