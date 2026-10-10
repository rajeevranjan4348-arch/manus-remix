export type AppTheme = 'light' | 'dark' | 'system';
export type AppMode = 'chat' | 'work';
export type AppLanguage = 'en' | 'hi' | 'es' | 'fr' | 'de' | 'ja' | 'zh';
export type ResponseTone = 'balanced' | 'concise' | 'professional' | 'creative' | 'academic';
export type VoicePersona = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface UserSettings {
  // General
  theme: AppTheme;
  defaultMode: AppMode;
  language: AppLanguage;
  soundEffects: boolean;
  reducedMotion: boolean;

  // AI & Intelligence
  defaultModel: string;
  temperature: number; // 0.0 to 1.0
  enableWebSearch: boolean;
  enableCodeSandbox: boolean;
  deepResearchMode: boolean;
  streamingSpeed: 'normal' | 'fast' | 'instant';

  // Personalization
  userName: string;
  userRole: string;
  aboutUser: string;
  customInstructions: string;
  responseTone: ResponseTone;

  // Voice & Audio
  voicePersona: VoicePersona;
  speechSpeed: number; // 0.75, 1.0, 1.25, 1.5
  voicePitch: number; // 0.5 to 1.5 (default: 1.0)
  enableAudioFilter: boolean; // audio processing filter for noise reduction & clarity
  autoPlayAudio: boolean; // Auto-play audio playback on Gemini responses
  enableHandsFreeVoice?: boolean; // Mic input immediately sends to Gemini and plays audio

  // Security, Authorization & Permissions
  toolApprovalPolicy?: 'ask_all' | 'ask_sensitive' | 'auto_approve';
  enableBackgroundNotifications?: boolean;
  enablePhoneCommands?: boolean;

  // System / Updated
  lastUpdated?: string;
}
