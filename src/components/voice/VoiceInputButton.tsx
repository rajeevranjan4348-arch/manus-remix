import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, ExternalLink, Phone, Camera, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { matchVoiceCommand, executeOpenUrl, executeDeviceCommand, VoiceCommandResult } from '@/lib/voiceCommands';
import { speakCleanHumanVoice } from '@/lib/speechSynthesis';
import { getSettings } from '@/lib/settingsStore';
import { emitRobotEvent } from '@/hooks/useRobotStateController';

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  onAutoSubmit?: (text: string) => void;
  onExecuteCommand?: (cmd: VoiceCommandResult) => void;
  onRequestApproval?: (cmd: VoiceCommandResult) => void;
  className?: string;
  size?: number;
  autoSubmitOnSpeech?: boolean;
}

export function VoiceInputButton({
  onTranscript,
  onAutoSubmit,
  onExecuteCommand,
  onRequestApproval,
  className,
  size = 18,
  autoSubmitOnSpeech = false,
}: VoiceInputButtonProps) {
  const [isListening, setIsListening] = useState(false);
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
      emitRobotEvent('VOICE_LISTENING_STOPPED');
      window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
      return;
    }

    // Request access from the user's click, then release the temporary stream
    // before SpeechRecognition opens its own microphone session.
    if (!window.isSecureContext) {
      toast.error('Microphone access requires HTTPS or localhost. Open Manus through its secure site.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Microphone access is unavailable in this browser. Please use an up-to-date Chrome browser.');
      return;
    }
    let permissionStream: MediaStream | null = null;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        toast.error('Microphone permission was blocked. Allow Microphone for this site in browser settings, then try again.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        toast.error('No microphone was found. Connect or enable a microphone and try again.');
      } else {
        toast.error('Could not access the microphone. Check site permissions and ensure no other app is using it.');
      }
      return;
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        emitRobotEvent('VOICE_LISTENING_STARTED');
        window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'listening' }));
        toast.info('🎙️ Listening... Speak into microphone', { duration: 3000 });
      };

      recognition.onresult = async (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }

        const currentText = (finalTranscript || interimTranscript).trim();
        if (!currentText) return;

        // Provide real-time live transcription to input area
        onTranscript(currentText);

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
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('[Voice Recognition]', event.error);
          toast.error(`Microphone error: ${event.error}`);
          emitRobotEvent('TASK_FAILED');
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
        } else {
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        emitRobotEvent('VOICE_LISTENING_STOPPED');
        window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Speech recognition error:', err);
      toast.error('Could not start microphone');
      setIsListening(false);
      window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
    }
  };

  return (
    <button
      type="button"
      onClick={toggleListening}
      aria-label={isListening ? 'Stop listening' : 'Start voice command or speech input'}
      title={isListening ? 'Listening... click to stop' : 'Voice command or question (e.g. "Open YouTube", "Weather in Paris")'}
      className={cn(
        "relative flex items-center justify-center rounded-full transition-all cursor-pointer",
        isListening
          ? "bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30 ring-2 ring-rose-400"
          : "hover:bg-[var(--fill-tsp-gray-main)] dark:hover:bg-accent text-[var(--icon-primary)] dark:text-foreground",
        className
      )}
    >
      {isListening ? <MicOff size={size} /> : <Mic size={size} />}
    </button>
  );
}
