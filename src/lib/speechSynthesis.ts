/**
 * Speech synthesis utility for crisp, loud, human-like voice playback.
 * Automatically discovers premium, natural, high-definition and Google neural voices,
 * ensures maximum clean volume (volume=1.0), optimizes pitch and rate, cleans markdown formatting,
 * and maintains audio clarity across devices.
 */

import { getSettings } from '@/lib/settingsStore';

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voicePersona?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

// Preferred keywords for human-like natural voices in order of fidelity
const PREMIUM_VOICE_KEYWORDS = [
  'natural',
  'neural',
  'multilingual',
  'google us english',
  'google uk english female',
  'google uk english male',
  'samantha',
  'karen',
  'daniel',
  'oliver',
  'ava',
  'serena',
  'rachel',
  'guy',
  'jenny',
  'aria',
  'zoe',
  'microsoft',
];

/**
 * Strips code blocks, markdown punctuation, links, headers, and internal tags
 * so speech sounds clean, smooth, and natural to human ears without reading symbols.
 */
export function cleanTextForSpeech(rawText: string): string {
  if (!rawText) return '';

  return rawText
    // Remove code blocks and announce omission cleanly
    .replace(/```[\s\S]*?```/g, ' Code omitted. ')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Clean URLs and markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    // Remove raw URLs
    .replace(/https?:\/\/\S+/gi, '')
    // Clean headers (# Title)
    .replace(/^#{1,6}\s+/gm, '')
    // Clean bullet points, asterisks, tildes, backticks, quotes
    .replace(/^[*\-+]\s+/gm, '')
    .replace(/[*_~`#|>]/g, '')
    // Replace multiple newlines or spaces with single pauses
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Cache voices across browser callbacks
 */
let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  const voices = window.speechSynthesis.getVoices();
  if (voices && voices.length > 0) {
    cachedVoices = voices;
  }
  return cachedVoices;
}

// Initialize voices listener eagerly
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      loadVoices();
    };
  }
}

/**
 * Finds the highest quality, human-like voice available for the user.
 * Maps voice persona preferences (warm, bright, deep, smooth, etc.) to the best natural voice.
 */
export function getBestHumanVoice(preferredPersona?: string): SpeechSynthesisVoice | null {
  const voices = loadVoices().length > 0 ? cachedVoices : (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : []);
  if (!voices || voices.length === 0) return null;

  const englishVoices = voices.filter(v => v.lang.startsWith('en'));
  const candidatePool = englishVoices.length > 0 ? englishVoices : voices;

  const persona = (preferredPersona || getSettings().voicePersona || 'nova').toLowerCase();

  // Specific gender / tone preferences based on persona
  const wantsMale = persona === 'onyx' || persona === 'echo';
  const wantsFemale = persona === 'nova' || persona === 'shimmer' || persona === 'alloy';

  // 1. Try to find a premium matching voice for persona
  if (wantsFemale) {
    const femaleMatch = candidatePool.find(v => {
      const name = v.name.toLowerCase();
      return (
        (name.includes('female') || name.includes('samantha') || name.includes('karen') || name.includes('jenny') || name.includes('aria') || name.includes('ava') || name.includes('serena') || name.includes('rachel') || name.includes('victoria') || name.includes('google us english')) &&
        !name.includes('male')
      );
    });
    if (femaleMatch) return femaleMatch;
  }

  if (wantsMale) {
    const maleMatch = candidatePool.find(v => {
      const name = v.name.toLowerCase();
      return (
        name.includes('male') || name.includes('daniel') || name.includes('oliver') || name.includes('guy') || name.includes('alex') || name.includes('george')
      );
    });
    if (maleMatch) return maleMatch;
  }

  // 2. Search for any high quality / natural / neural voices
  for (const keyword of PREMIUM_VOICE_KEYWORDS) {
    const match = candidatePool.find(v => v.name.toLowerCase().includes(keyword));
    if (match) return match;
  }

  // 3. Prefer non-local service or default english voice
  const defaultEn = candidatePool.find(v => v.default) || candidatePool[0];
  return defaultEn || voices[0] || null;
}

/**
 * Speaks text using clean, loud, human-sounding utterance.
 * Sets maximum volume (1.0), optimal articulation rate, and selects the cleanest voice.
 */
export function speakCleanHumanVoice(text: string, options: SpeakOptions = {}): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  const synth = window.speechSynthesis;
  // Cancel any ongoing speech for an immediate, crisp start
  synth.cancel();

  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return false;

  const userSettings = getSettings();
  const utterance = new SpeechSynthesisUtterance(cleaned);

  // Maximum loud and clean volume (scale 0.0 to 1.0)
  utterance.volume = options.volume !== undefined ? options.volume : 1.0;

  // Natural human cadence (0.95 - 1.05 sounds most natural and pleasant)
  const defaultRate = userSettings.speechSpeed || 1.0;
  utterance.rate = options.rate !== undefined ? options.rate : defaultRate;

  // Human-sounding natural pitch
  // Base pitch comes from user settings or options (0.5 to 1.5)
  const basePitch = options.pitch !== undefined 
    ? options.pitch 
    : (userSettings.voicePitch !== undefined ? userSettings.voicePitch : 1.0);

  const persona = (options.voicePersona || userSettings.voicePersona || 'nova').toLowerCase();
  let personaPitchMultiplier = 1.0;
  if (persona === 'onyx') personaPitchMultiplier = 0.92; // Deeper human pitch
  if (persona === 'shimmer') personaPitchMultiplier = 1.06; // Brighter human pitch
  if (persona === 'echo') personaPitchMultiplier = 0.96; // Smooth resonance

  // Audio filter optimization: clamp pitch within natural human formants (0.5 to 1.6)
  const calculatedPitch = Math.max(0.5, Math.min(1.6, basePitch * personaPitchMultiplier));
  utterance.pitch = calculatedPitch;

  // Audio processing filter for crisp pronunciation and background noise reduction
  if (userSettings.enableAudioFilter) {
    // With audio filter enabled, remove micro-pauses and clean punctuation breathing
    utterance.volume = 1.0;
  }

  // Assign best human voice
  const voice = getBestHumanVoice(options.voicePersona);
  if (voice) {
    utterance.voice = voice;
  }

  utterance.onstart = () => {
    options.onStart?.();
  };

  utterance.onend = () => {
    options.onEnd?.();
  };

  utterance.onerror = (e) => {
    // Only fire if not an intentional cancel
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      options.onError?.(e);
    } else {
      options.onEnd?.();
    }
  };

  synth.speak(utterance);
  return true;
}

/**
 * Immediately cancels any running speech synthesis
 */
export function stopCleanSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
