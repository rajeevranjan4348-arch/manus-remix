import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, ExternalLink, Phone, Camera, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { matchVoiceCommand, executeOpenUrl, executeDeviceCommand, VoiceCommandResult } from '@/lib/voiceCommands';
import { speakCleanHumanVoice } from '@/lib/speechSynthesis';
import { getSettings } from '@/lib/settingsStore';
import { emitRobotEvent } from '@/hooks/useRobotStateController';
import { MicrophonePermissionModal } from './MicrophonePermissionModal';
import { checkMicrophonePermissionState } from '@/lib/permissionsManager';

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  onInterimChange?: (interim: string) => void;
  onListeningStateChange?: (isListening: boolean) => void;
  onAudioLevelChange?: (level: number) => void;
  onAutoSubmit?: (text: string) => void;
  onExecuteCommand?: (cmd: VoiceCommandResult) => void;
  onRequestApproval?: (cmd: VoiceCommandResult) => void;
  className?: string;
  size?: number;
  autoSubmitOnSpeech?: boolean;
}

/**
 * Checks whether the browser supports the Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 */
export function isSpeechRecognitionSupported(win: any = typeof window !== 'undefined' ? window : undefined): boolean {
  if (!win) return false;
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

/**
 * Automatically maps spoken punctuation commands into punctuation marks.
 * e.g. "question mark" -> "?", "comma" -> ",", "period" -> ".", "new line" -> "\n"
 */
export function formatSpokenPunctuation(text: string): string {
  if (!text) return '';
  return text
    .replace(/\b(?:question mark)\b/gi, '?')
    .replace(/\b(?:exclamation mark|exclamation point)\b/gi, '!')
    .replace(/\b(?:comma)\b/gi, ',')
    .replace(/\b(?:period|full stop)\b/gi, '.')
    .replace(/\b(?:colon)\b/gi, ':')
    .replace(/\b(?:semicolon)\b/gi, ';')
    .replace(/\b(?:new line|next line)\b/gi, '\n')
    .replace(/\b(?:new paragraph)\b/gi, '\n\n')
    // Clean up extra spaces before punctuation
    .replace(/\s+([,.:;?!])/g, '$1')
    // Capitalize letter after sentence enders
    .replace(/([.?!]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase())
    .trim();
}

/**
 * Extracts and accumulates both final and interim transcripts from SpeechRecognition results.
 */
export function extractTranscriptFromResults(results: any): { finalTranscript: string; interimTranscript: string; fullTranscript: string } {
  let finalTranscript = '';
  let interimTranscript = '';

  if (!results || typeof results.length !== 'number') {
    return { finalTranscript: '', interimTranscript: '', fullTranscript: '' };
  }

  for (let i = 0; i < results.length; ++i) {
    const result = results[i];
    const text = (result?.[0]?.transcript || '').trim();
    if (!text) continue;
    if (result.isFinal) {
      finalTranscript += (finalTranscript ? ' ' : '') + text;
    } else {
      interimTranscript += (interimTranscript ? ' ' : '') + text;
    }
  }

  const rawFull = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();
  const fullTranscript = formatSpokenPunctuation(rawFull);
  return { 
    finalTranscript: formatSpokenPunctuation(finalTranscript), 
    interimTranscript, 
    fullTranscript 
  };
}

/**
 * Combines previously typed text with newly dictated speech transcript.
 */
export function formatSpeechAutoFill(baseText: string, dictatedText: string): string {
  const base = (baseText || '').trim();
  const dictated = (dictatedText || '').trim();
  if (!base) return dictated;
  if (!dictated) return base;
  return `${base} ${dictated}`;
}

export function VoiceInputButton({
  onTranscript,
  onInterimChange,
  onListeningStateChange,
  onAudioLevelChange,
  onAutoSubmit,
  onExecuteCommand,
  onRequestApproval,
  className,
  size = 18,
  autoSubmitOnSpeech = false,
}: VoiceInputButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef<boolean>(false);
  const isExplicitStopRef = useRef<boolean>(false);
  const isRestartingRef = useRef<boolean>(false);
  const sessionCommittedTranscriptRef = useRef<string>('');
  const currentTurnFinalRef = useRef<string>('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<any>(null);
  const lastTranscriptRef = useRef<string>('');

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopAudioMeter = () => {
    clearSilenceTimer();
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    setAudioLevel(0);
    onAudioLevelChange?.(0);
  };

  const startAudioMeter = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(1.0, Math.max(0, (avg / 128) * 1.5));
        setAudioLevel(normalized);
        onAudioLevelChange?.(normalized);
        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch {
      // Audio level meter is an enhancement; gracefully fallback
    }
  };

  const stopListening = () => {
    isExplicitStopRef.current = true;
    isListeningRef.current = false;
    isRestartingRef.current = false;
    sessionCommittedTranscriptRef.current = '';
    currentTurnFinalRef.current = '';
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    stopAudioMeter();
    setIsListening(false);
    onListeningStateChange?.(false);
    onInterimChange?.('');
    emitRobotEvent('VOICE_LISTENING_STOPPED');
    window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
  };

  const toggleListeningRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handleStopEvent = () => {
      if (isListeningRef.current) {
        stopListening();
      }
    };
    const handleToggleEvent = () => {
      toggleListeningRef.current();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+V shortcut to toggle voice typing
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        toggleListeningRef.current();
      }
    };

    window.addEventListener('manus_stop_voice_input', handleStopEvent);
    window.addEventListener('manus_toggle_voice_input', handleToggleEvent);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('manus_stop_voice_input', handleStopEvent);
      window.removeEventListener('manus_toggle_voice_input', handleToggleEvent);
      window.removeEventListener('keydown', handleKeyDown);
      isExplicitStopRef.current = true;
      isListeningRef.current = false;
      stopAudioMeter();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  const toggleListening = async () => {
    if (typeof window === 'undefined') return;

    if (isListeningRef.current || isListening) {
      stopListening();
      return;
    }

    // Check secure context
    if (!window.isSecureContext) {
      toast.error('Microphone access requires HTTPS or localhost.');
      return;
    }

    // Check if permission is known to be denied
    try {
      const permState = await checkMicrophonePermissionState();
      if (permState === 'denied') {
        toast.error('Microphone permission is blocked in browser settings.');
        return;
      }
    } catch {}

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // If SpeechRecognition is missing, test getUserMedia or inform user
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('Voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
        return;
      }

      // Check if getUserMedia can be requested
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        toast.info('Audio recording is supported. For live speech dictation, Chrome or Edge is recommended.');
      } catch (e: any) {
        toast.error('Microphone permission is blocked in browser settings.');
      }
      return;
    }

    try {
      isExplicitStopRef.current = false;
      isRestartingRef.current = false;
      sessionCommittedTranscriptRef.current = '';
      currentTurnFinalRef.current = '';
      lastTranscriptRef.current = '';

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      const settings = getSettings();
      const preferredLang = settings.voiceInputLanguage || 'en-US';
      const actualLang = preferredLang === 'auto'
        ? (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US')
        : preferredLang;

      recognition.lang = actualLang;

      recognition.onstart = () => {
        const wasRestarting = isRestartingRef.current;
        isRestartingRef.current = false;
        isListeningRef.current = true;
        setIsListening(true);
        if (!wasRestarting) {
          onListeningStateChange?.(true);
          emitRobotEvent('VOICE_LISTENING_STARTED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'listening' }));
          startAudioMeter();
          toast.info('🎙️ Listening... Speak your prompt', { duration: 2500 });
        }
      };

      recognition.onresult = async (event: any) => {
        const { finalTranscript, interimTranscript, fullTranscript } = extractTranscriptFromResults(event.results);

        if (!fullTranscript && !interimTranscript) return;

        currentTurnFinalRef.current = finalTranscript;
        const combinedFullTranscript = [
          sessionCommittedTranscriptRef.current,
          fullTranscript,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

        const combinedFinalTranscript = [
          sessionCommittedTranscriptRef.current,
          finalTranscript,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

        // Provide real-time live transcription to input area (auto-filling)
        if (combinedFullTranscript) {
          onTranscript(combinedFullTranscript);
        }
        if (onInterimChange) {
          onInterimChange(interimTranscript || combinedFullTranscript);
        }

        if (finalTranscript.trim()) {
          const transcript = combinedFinalTranscript || finalTranscript.trim();
          const currentSettings = getSettings();
          const policy = currentSettings.toolApprovalPolicy || 'ask_sensitive';

          // Check for voice/device commands
          const cmd = matchVoiceCommand(finalTranscript.trim());
          if (cmd && cmd.matched) {
            const needsApproval =
              policy === 'ask_all' ||
              (policy === 'ask_sensitive' && cmd.riskLevel === 'sensitive');

            if (needsApproval && onRequestApproval) {
              toast.info(`Approval required for ${cmd.targetName}`);
              onRequestApproval(cmd);
              return;
            }

            if (cmd.action === 'open_url' || cmd.action === 'search') {
              if (cmd.url) executeOpenUrl(cmd.url);
            } else {
              await executeDeviceCommand(cmd);
            }

            toast.success(`${cmd.targetName}: ${cmd.feedbackSpeech}`, {
              icon: cmd.action === 'phone_call' ? <Phone size={16} /> : <ExternalLink size={16} />,
              duration: 4000,
            });

            speakCleanHumanVoice(cmd.feedbackSpeech, {
              volume: 1.0,
              voicePersona: currentSettings.voicePersona,
              rate: currentSettings.speechSpeed,
              pitch: currentSettings.voicePitch,
            });

            onExecuteCommand?.(cmd);
            return;
          }

          const shouldAutoSubmit = autoSubmitOnSpeech || currentSettings.enableHandsFreeVoice;
          if (shouldAutoSubmit && onAutoSubmit) {
            clearSilenceTimer();
            onAutoSubmit(transcript);
            return;
          }

          // If auto-submit on silence is enabled, start 7-second timer
          const autoSubmitAfterSilence = currentSettings.autoSubmitVoiceAfterSilence ?? true;
          const silenceDelayMs = (currentSettings.autoSubmitSilenceDelay ?? 7) * 1000;
          lastTranscriptRef.current = transcript;

          if (autoSubmitAfterSilence && onAutoSubmit && lastTranscriptRef.current.trim()) {
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              const textToSend = lastTranscriptRef.current.trim();
              if (textToSend) {
                toast.info('Auto-submitted prompt after 7s of silence');
                if (recognitionRef.current) {
                  isExplicitStopRef.current = true;
                  isListeningRef.current = false;
                  try {
                    recognitionRef.current.stop();
                  } catch {}
                }
                stopAudioMeter();
                setIsListening(false);
                onListeningStateChange?.(false);
                onAutoSubmit(textToSend);
              }
            }, silenceDelayMs);
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          console.warn('[Voice Recognition] Permission blocked:', event.error);
          toast.error('Microphone permission is blocked in browser settings.');
          emitRobotEvent('TASK_FAILED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
        } else if (event.error === 'audio-capture') {
          console.warn('[Voice Recognition] Audio capture error:', event.error);
          toast.error('No microphone found or another app is using it.');
          emitRobotEvent('TASK_FAILED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('[Voice Recognition]', event.error);
          toast.error(`Microphone error: ${event.error}`);
          emitRobotEvent('TASK_FAILED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
        } else {
          if (event.error === 'no-speech' && !isExplicitStopRef.current && isListeningRef.current) {
            // Keep session alive through brief silence
            return;
          }
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
        }
        isExplicitStopRef.current = true;
        isListeningRef.current = false;
        stopAudioMeter();
        setIsListening(false);
        onListeningStateChange?.(false);
        onInterimChange?.('');
      };

      recognition.onend = () => {
        // If the user didn't explicitly stop listening, auto-restart to prevent silent pause cutoff
        if (!isExplicitStopRef.current && isListeningRef.current) {
          if (currentTurnFinalRef.current.trim()) {
            sessionCommittedTranscriptRef.current = [
              sessionCommittedTranscriptRef.current,
              currentTurnFinalRef.current.trim(),
            ]
              .filter(Boolean)
              .join(' ')
              .trim();
            currentTurnFinalRef.current = '';
          }
          try {
            isRestartingRef.current = true;
            recognition.start();
            return;
          } catch {}
        }

        isListeningRef.current = false;
        stopAudioMeter();
        setIsListening(false);
        onListeningStateChange?.(false);
        onInterimChange?.('');
        emitRobotEvent('VOICE_LISTENING_STOPPED');
        window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Speech recognition error:', err);
      if (err?.name === 'NotAllowedError' || err?.message?.includes('denied') || err?.message?.includes('not-allowed')) {
        toast.error('Microphone permission is blocked in browser settings.');
      } else {
        toast.error('Could not start microphone');
      }
      isListeningRef.current = false;
      stopAudioMeter();
      setIsListening(false);
      onListeningStateChange?.(false);
      onInterimChange?.('');
      window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
    }
  };

  toggleListeningRef.current = toggleListening;

  return (
    <>
      <button
        type="button"
        data-testid="voice-input-button"
        data-listening={isListening ? 'true' : 'false'}
        onClick={toggleListening}
        aria-label={isListening ? 'Stop voice recording' : 'Voice-to-text input (Speak your prompt)'}
        title={isListening ? 'Listening... click to stop' : 'Voice-to-text input: Speak your prompt instead of typing (Alt+V)'}
        className={cn(
          "relative flex items-center justify-center rounded-full transition-all cursor-pointer shrink-0 active:scale-95",
          isListening
            ? "bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] shadow-md ring-2 ring-[#333333] dark:ring-[#E0E0E0]"
            : "hover:bg-[#F2F2F2] dark:hover:bg-[#171717] text-[#000000] dark:text-[#FFFFFF]",
          className
        )}
      >
        {isListening && (
          <span 
            className="absolute inset-0 rounded-full bg-[#000000]/20 dark:bg-[#FFFFFF]/20 animate-ping pointer-events-none"
            style={{
              transform: `scale(${1 + audioLevel * 0.5})`,
              opacity: 0.3 + audioLevel * 0.7
            }}
          />
        )}
        {isListening ? (
          <MicOff size={size} className="shrink-0 relative z-10" />
        ) : (
          <Mic size={size} className="shrink-0 relative z-10" />
        )}
      </button>
    </>
  );
}

