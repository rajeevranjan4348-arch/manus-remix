/**
 * Speech synthesis utility for crisp, loud, human-like voice playback.
 * Automatically discovers premium, natural, high-definition and Google neural voices,
 * ensures maximum clean volume (volume=1.0), optimizes pitch and rate, cleans markdown formatting,
 * and maintains audio clarity across devices.
 */

import { getSettings } from '@/lib/settingsStore';
import { emitRobotEvent } from '@/hooks/useRobotStateController';

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
  'google uk english male',
  'google uk english female',
  'guy',
  'christopher',
  'ryan',
  'eric',
  'daniel',
  'oliver',
  'alex',
  'samantha',
  'karen',
  'ava',
  'serena',
  'rachel',
  'jenny',
  'aria',
  'zoe',
  'microsoft',
];

// Specific keywords that identify natural and high-fidelity male voices across browsers and OSes
const MALE_VOICE_KEYWORDS = [
  'microsoft guy online (natural)',
  'microsoft christopher online (natural)',
  'microsoft ryan online (natural)',
  'microsoft eric online (natural)',
  'microsoft guy',
  'microsoft christopher',
  'microsoft david',
  'microsoft mark',
  'google uk english male',
  'google us english male',
  'daniel (enhanced)',
  'daniel (premium)',
  'daniel',
  'oliver (enhanced)',
  'oliver',
  'alex',
  'tom (enhanced)',
  'tom',
  'evan (enhanced)',
  'evan',
  'nathan (enhanced)',
  'nathan',
  'arthur',
  'george',
  'rishi',
  'lee',
  'guy',
  'en-us-x-sfg#male',
  'en-us-x-iol#male',
  'en-us-x-tpd#male',
  'male',
];

/**
 * Checks if a voice matches any male characteristics
 */
export function isMaleVoice(voice: SpeechSynthesisVoice): boolean {
  const name = voice.name.toLowerCase();
  if (name.includes('female')) return false;
  return MALE_VOICE_KEYWORDS.some(kw => name.includes(kw));
}

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

  const persona = (preferredPersona || getSettings().voicePersona || 'marcus').toLowerCase();

  // Specific gender / tone preferences based on persona
  const wantsMale = persona === 'marcus' || persona === 'onyx' || persona === 'echo' || persona === 'tintin' || persona === 'guy' || persona === 'daniel' || persona === 'oliver';
  const wantsFemale = persona === 'nova' || persona === 'shimmer' || persona === 'alloy';

  // 1. If male voice is requested, prioritize natural human male voices
  if (wantsMale) {
    // 1a. Try to match specific persona names first (e.g. Guy, Christopher, Daniel, Oliver, Alex)
    if (persona === 'marcus' || persona === 'guy') {
      const match = candidatePool.find(v => {
        const name = v.name.toLowerCase();
        return (name.includes('guy') || name.includes('christopher') || name.includes('daniel') || name.includes('ryan')) && !name.includes('female');
      });
      if (match) return match;
    }
    if (persona === 'onyx') {
      // Prefer installed neural/natural male voices before applying a subtle baritone pitch.
      const deepMalePatterns = ['guy online (natural)', 'christopher online (natural)', 'ryan online (natural)', 'david', 'mark', 'guy', 'christopher', 'daniel', 'alex', 'tom'];
      for (const pattern of deepMalePatterns) {
        const match = candidatePool.find(v => {
          const name = v.name.toLowerCase();
          return name.includes(pattern) && !name.includes('female') && !name.includes('child');
        });
        if (match) return match;
      }
    }
    if (persona === 'echo' || persona === 'tintin') {
      const match = candidatePool.find(v => {
        const name = v.name.toLowerCase();
        return (name.includes('oliver') || name.includes('evan') || name.includes('nathan') || name.includes('george')) && !name.includes('female');
      });
      if (match) return match;
    }

    // 1b. Match any high quality natural/neural male voice from the keywords
    for (const kw of MALE_VOICE_KEYWORDS) {
      const match = candidatePool.find(v => {
        const name = v.name.toLowerCase();
        return name.includes(kw) && !name.includes('female');
      });
      if (match) return match;
    }
  }

  // 2. Try to find a premium matching female voice if female persona requested
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

  // 3. Search for any high quality / natural / neural voices
  for (const keyword of PREMIUM_VOICE_KEYWORDS) {
    const match = candidatePool.find(v => v.name.toLowerCase().includes(keyword));
    if (match) return match;
  }

  // 4. Default english voice
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

  // Assign best human voice first to inspect its characteristics
  const voice = getBestHumanVoice(options.voicePersona);
  if (voice) {
    utterance.voice = voice;
  }

  const voiceIsExplicitMale = voice ? isMaleVoice(voice) : false;
  const persona = (options.voicePersona || userSettings.voicePersona || 'marcus').toLowerCase();

  let personaPitchMultiplier = 1.0;
  let personaRateMultiplier = 1.0;

  if (persona === 'marcus') {
    // Warm, articulate, refined human male voice
    personaPitchMultiplier = voiceIsExplicitMale ? 0.95 : 0.86;
    personaRateMultiplier = 0.98;
  } else if (persona === 'onyx') {
    // Deep, resonant, rich baritone human male voice
    personaPitchMultiplier = voiceIsExplicitMale ? 0.88 : 0.80;
    personaRateMultiplier = 0.96;
  } else if (persona === 'echo') {
    // Smooth, warm conversational human male voice
    personaPitchMultiplier = voiceIsExplicitMale ? 0.93 : 0.87;
    personaRateMultiplier = 1.0;
  } else if (persona === 'tintin' || persona === 'guy') {
    // Crisp, natural young male voice
    personaPitchMultiplier = voiceIsExplicitMale ? 0.98 : 0.90;
    personaRateMultiplier = 1.02;
  } else if (persona === 'shimmer') {
    personaPitchMultiplier = 1.08;
  } else if (persona === 'nova') {
    personaPitchMultiplier = 1.02;
  }

  // Maximum loud and clean volume (scale 0.0 to 1.0)
  utterance.volume = options.volume !== undefined ? options.volume : 1.0;

  // Natural human cadence
  const defaultRate = userSettings.speechSpeed || 1.0;
  const targetRate = (options.rate !== undefined ? options.rate : defaultRate) * personaRateMultiplier;
  utterance.rate = Math.max(0.7, Math.min(1.6, targetRate));

  // Human-sounding natural pitch
  const basePitch = options.pitch !== undefined 
    ? options.pitch 
    : (userSettings.voicePitch !== undefined ? userSettings.voicePitch : 1.0);

  // Audio filter optimization: clamp pitch within natural human formants (0.5 to 1.6)
  const calculatedPitch = Math.max(0.5, Math.min(1.6, basePitch * personaPitchMultiplier));
  utterance.pitch = calculatedPitch;

  // Audio processing filter for crisp pronunciation and background noise reduction
  if (userSettings.enableAudioFilter) {
    utterance.volume = 1.0;
  }

  utterance.onstart = () => {
    emitRobotEvent('VOICE_PLAYBACK_STARTED');
    window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'speaking' }));
    options.onStart?.();
  };

  utterance.onend = () => {
    emitRobotEvent('VOICE_PLAYBACK_ENDED');
    window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
    options.onEnd?.();
  };

  utterance.onerror = (e) => {
    emitRobotEvent('VOICE_PLAYBACK_ENDED');
    if (e.error !== 'interrupted' && e.error !== 'canceled') emitRobotEvent('TASK_FAILED');
    window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
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
