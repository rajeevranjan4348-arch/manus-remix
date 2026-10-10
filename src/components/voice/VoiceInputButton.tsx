import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, ExternalLink, Phone, Camera, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { matchVoiceCommand, executeOpenUrl, executeDeviceCommand, VoiceCommandResult } from '@/lib/voiceCommands';
import { speakCleanHumanVoice } from '@/lib/speechSynthesis';
import { getSettings } from '@/lib/settingsStore';

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

  const toggleListening = () => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Voice recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        toast.info('Listening... Say "Open YouTube", "Call 123", or ask a question', {
          duration: 3500,
        });
      };

      recognition.onresult = async (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (!transcript) return;

        const settings = getSettings();
        const policy = settings.toolApprovalPolicy || 'ask_sensitive';

        // 1. Check for voice/phone command (e.g. "open youtube", "call...", "check battery")
        const cmd = matchVoiceCommand(transcript);
        if (cmd && cmd.matched) {
          // Check if tool approval is required
          const needsApproval =
            policy === 'ask_all' ||
            (policy === 'ask_sensitive' && cmd.riskLevel === 'sensitive');

          if (needsApproval && onRequestApproval) {
            toast.info(`Approval required for ${cmd.targetName}`);
            onRequestApproval(cmd);
            onTranscript(transcript);
            return;
          }

          // Execute directly
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

          onTranscript(transcript);
          onExecuteCommand?.(cmd);
          return;
        }

        // 2. Regular speech query: send to input or auto-submit for mic -> Gemini -> audio
        onTranscript(transcript);
        toast.success(`Heard: "${transcript}"`);

        const shouldAutoSubmit = autoSubmitOnSpeech || settings.enableHandsFreeVoice;
        if (shouldAutoSubmit && onAutoSubmit) {
          toast.info('Sending to Gemini with auto-audio playback...');
          onAutoSubmit(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.warn('[Voice Recognition]', event.error);
          toast.error(`Voice error: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Speech recognition error:', err);
      toast.error('Could not access microphone');
      setIsListening(false);
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
