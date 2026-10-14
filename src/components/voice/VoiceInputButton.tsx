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
  onListeningStateChange?: (isListening: boolean) => void;
  onAutoSubmit?: (text: string) => void;
  onExecuteCommand?: (cmd: VoiceCommandResult) => void;
  onRequestApproval?: (cmd: VoiceCommandResult) => void;
  className?: string;
  size?: number;
  autoSubmitOnSpeech?: boolean;
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

  const fullTranscript = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();
  return { finalTranscript, interimTranscript, fullTranscript };
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
  onListeningStateChange,
  onAutoSubmit,
  onExecuteCommand,
  onRequestApproval,
  className,
  size = 18,
  autoSubmitOnSpeech = false,
}: VoiceInputButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  const toggleListening = async () => {
    if (typeof window === 'undefined') return;

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      onListeningStateChange?.(false);
      emitRobotEvent('VOICE_LISTENING_STOPPED');
      window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
      return;
    }

    // Check secure context
    if (!window.isSecureContext) {
      setShowPermissionModal(true);
      toast.error('Microphone access requires HTTPS or localhost. Open Manus through its secure site.');
      return;
    }

    // Check if permission is known to be denied
    try {
      const permState = await checkMicrophonePermissionState();
      if (permState === 'denied') {
        setShowPermissionModal(true);
        toast.error('Microphone permission was blocked.', {
          description: 'Allow Microphone for this site in browser settings, then try again.',
          action: {
            label: 'Unblock Guide 🎙️',
            onClick: () => setShowPermissionModal(true),
          },
          duration: 7000,
        });
        return;
      }
    } catch {}

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // If SpeechRecognition is missing, test getUserMedia or inform user
      if (!navigator.mediaDevices?.getUserMedia) {
        setShowPermissionModal(true);
        toast.error('Voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
        return;
      }

      // Check if getUserMedia can be requested
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        toast.info('Audio recording is supported. For live speech dictation, Chrome or Edge is recommended.');
      } catch (e: any) {
        setShowPermissionModal(true);
        toast.error('Microphone permission was blocked.', {
          description: 'Allow Microphone in browser settings to dictate prompts.',
          action: {
            label: 'How to Fix 🎙️',
            onClick: () => setShowPermissionModal(true),
          },
        });
      }
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;

      const settings = getSettings();
      const preferredLang = settings.voiceInputLanguage || 'en-US';
      const actualLang = preferredLang === 'auto'
        ? (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US')
        : preferredLang;

      recognition.lang = actualLang;

      recognition.onstart = () => {
        setIsListening(true);
        onListeningStateChange?.(true);
        emitRobotEvent('VOICE_LISTENING_STARTED');
        window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'listening' }));
        toast.info('🎙️ Listening... Speak into microphone', { duration: 3000 });
      };

      recognition.onresult = async (event: any) => {
        const { finalTranscript, fullTranscript } = extractTranscriptFromResults(event.results);

        if (!fullTranscript) return;

        // Provide real-time live transcription to input area (auto-filling)
        onTranscript(fullTranscript);

        if (finalTranscript.trim()) {
          const transcript = finalTranscript.trim();
          const settings = getSettings();
          const policy = settings.toolApprovalPolicy || 'ask_sensitive';

          // Check for voice/device commands
          const cmd = matchVoiceCommand(transcript);
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
              voicePersona: settings.voicePersona,
              rate: settings.speechSpeed,
              pitch: settings.voicePitch,
            });

            onExecuteCommand?.(cmd);
            return;
          }

          toast.success(`Dictated: "${transcript}"`);
          const shouldAutoSubmit = autoSubmitOnSpeech || settings.enableHandsFreeVoice;
          if (shouldAutoSubmit && onAutoSubmit) {
            onAutoSubmit(transcript);
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          console.warn('[Voice Recognition] Permission blocked:', event.error);
          setShowPermissionModal(true);
          toast.error('Microphone permission was blocked.', {
            description: 'Allow Microphone for this site in browser settings, then try again.',
            action: {
              label: 'Unblock Guide 🎙️',
              onClick: () => setShowPermissionModal(true),
            },
            duration: 8000,
          });
          emitRobotEvent('TASK_FAILED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
        } else if (event.error === 'audio-capture') {
          console.warn('[Voice Recognition] Audio capture error:', event.error);
          setShowPermissionModal(true);
          toast.error('No microphone found or another app is using it.', {
            action: {
              label: 'Troubleshoot',
              onClick: () => setShowPermissionModal(true),
            },
            duration: 6000,
          });
          emitRobotEvent('TASK_FAILED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('[Voice Recognition]', event.error);
          toast.error(`Microphone error: ${event.error}`);
          emitRobotEvent('TASK_FAILED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
        } else {
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
        }
        setIsListening(false);
        onListeningStateChange?.(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        onListeningStateChange?.(false);
        emitRobotEvent('VOICE_LISTENING_STOPPED');
        window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Speech recognition error:', err);
      if (err?.name === 'NotAllowedError' || err?.message?.includes('denied') || err?.message?.includes('not-allowed')) {
        setShowPermissionModal(true);
        toast.error('Microphone permission was blocked.', {
          description: 'Allow Microphone in browser settings to speak to Manus.',
          action: {
            label: 'Unblock Guide 🎙️',
            onClick: () => setShowPermissionModal(true),
          },
          duration: 8000,
        });
      } else {
        toast.error('Could not start microphone');
      }
      setIsListening(false);
      onListeningStateChange?.(false);
      window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={toggleListening}
        aria-label={isListening ? 'Stop listening' : 'Start voice command or speech input'}
        title={isListening ? 'Listening... click to stop' : 'Voice command or question (e.g. "Open YouTube", "Weather in Paris")'}
        className={cn(
          "relative flex items-center justify-center rounded-full transition-all cursor-pointer shrink-0 active:scale-95",
          isListening
            ? "bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30 ring-2 ring-rose-400"
            : "hover:bg-[var(--fill-tsp-gray-main)] dark:hover:bg-accent text-[var(--icon-primary)] dark:text-foreground",
          className
        )}
      >
        {isListening ? <MicOff size={size} className="shrink-0" /> : <Mic size={size} className="shrink-0" />}
      </button>

      <MicrophonePermissionModal 
        isOpen={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        onPermissionGranted={() => {
          setShowPermissionModal(false);
          setTimeout(() => {
            toggleListening();
          }, 300);
        }}
      />
    </>
  );
}

