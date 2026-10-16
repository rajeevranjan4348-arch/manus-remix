export type AppTheme = 'light' | 'dark' | 'system';
export type AppMode = 'chat' | 'work';
export type AppLanguage = 'en' | 'hi' | 'es' | 'fr' | 'de' | 'ja' | 'zh';
export type ResponseTone = 'balanced' | 'concise' | 'professional' | 'creative' | 'academic';
export type VoicePersona = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'marcus' | 'tintin' | 'guy';

export interface UserSettings {
  // General
  theme: AppTheme;
  defaultMode: AppMode;
  language: AppLanguage;
  soundEffects: boolean;
  reducedMotion: boolean;

  // Robot appearance and animation
  robotState: string;
  robotShape: string;
  robotTheme: number;
  robotSpeed: number;
  robotSeed: number;
  robotPaused: boolean;
  robotInteractive: boolean;
  robotAntenna: boolean;
  robotFloorShadow: boolean;
  robotCloudSync: boolean; // Enables cloud-syncing of custom robot personalities and visual themes across devices
  robotPersonality?: string; // Custom personality trait (e.g., 'balanced', 'analytical', 'creative', 'companion')
  robotEyeColor?: string;
  robotAccentHardware?: string;
  robotName?: string;
  robotSize?: number;

  // AI & Intelligence
  defaultModel: string;
  temperature: number; // 0.0 to 1.0
  enableWebSearch: boolean;
  enableCodeSandbox: boolean;
  deepResearchMode: boolean;
  streamingSpeed: 'normal' | 'fast' | 'instant';
  openRouterApiKey?: string;
  workModeApiKey?: string;

  // Personalization
  userName: string;
  userRole: string;
  aboutUser: string;
  customInstructions: string;
  responseTone: ResponseTone;

  // Voice & Audio
  voicePersona: VoicePersona;
  voiceInputLanguage?: string; // BCP-47 language tag for voice-to-text input (e.g., 'en-US', 'hi-IN', 'es-ES', 'fr-FR', 'auto')
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
