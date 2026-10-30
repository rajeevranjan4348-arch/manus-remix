import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface VoiceTranscriptionIndicatorProps {
  isListening: boolean;
  interimSpeech?: string;
  currentText?: string;
  audioLevel?: number;
  silenceCountdown?: number | null;
  canSendNow?: boolean;
  onClear?: () => void;
  onStop?: () => void;
  onSendNow?: () => void;
  className?: string;
}

export function formatRecordingDuration(totalSeconds: number): string {
  const mins = Math.floor(Math.max(0, totalSeconds) / 60);
  const secs = Math.floor(Math.max(0, totalSeconds) % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function VoiceTranscriptionIndicator({
  isListening,
  interimSpeech = '',
  currentText = '',
  audioLevel = 0,
  silenceCountdown = null,
  canSendNow = false,
  onClear,
  onStop,
  onSendNow,
  className,
}: VoiceTranscriptionIndicatorProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isListening) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  if (!isListening) return null;

  const hasContent = Boolean((currentText && currentText.trim()) || (interimSpeech && interimSpeech.trim()));
  const barMultipliers = [0.55, 0.9, 1.25, 0.85, 0.6];

  return (
    <div
      data-testid="speech-listening-indicator"
      data-listening="true"
      role="status"
      aria-live="polite"
      className={cn(
        'manus-voice-banner-enter flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#F2F2F2] dark:bg-[#171717] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF] text-xs font-medium select-none shadow-2xs w-full',
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#000000] dark:bg-[#FFFFFF] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#000000] dark:bg-[#FFFFFF]" />
        </span>

        <span
          data-testid="speech-recording-timer"
          className="font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#E0E0E0] dark:bg-[#111111] text-[#000000] dark:text-[#FFFFFF] shrink-0"
        >
          {formatRecordingDuration(elapsedSeconds)}
        </span>

        <span
          data-testid="speech-live-transcript"
          className="font-semibold truncate text-[#000000] dark:text-[#FFFFFF]"
        >
          {interimSpeech
            ? `"${interimSpeech}"`
            : currentText.trim()
              ? `"${currentText.trim().slice(-80)}"`
              : 'Listening... Speak your prompt...'}
        </span>

        {silenceCountdown !== null && silenceCountdown > 0 && (
          <span className="text-[10px] font-mono text-[#777777] dark:text-[#AAAAAA] shrink-0 hidden sm:inline">
            (auto-send {silenceCountdown}s)
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-1">
        <div
          data-testid="speech-waveform-visualizer"
          className="manus-voice-equalizer text-[#000000] dark:text-[#FFFFFF] flex items-center gap-0.5 h-3.5"
          aria-hidden="true"
        >
          {barMultipliers.map((mult, idx) => {
            const dynamicScale = audioLevel > 0.02
              ? Math.min(1.4, Math.max(0.35, 0.4 + audioLevel * mult))
              : undefined;
            return (
              <span
                key={idx}
                style={
                  dynamicScale
                    ? { transform: `scaleY(${dynamicScale.toFixed(2)})` }
                    : undefined
                }
              />
            );
          })}
        </div>

        {hasContent && onClear && (
          <button
            type="button"
            data-testid="speech-clear-btn"
            onClick={onClear}
            className="px-2 py-0.5 rounded-md bg-[#FFFFFF] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#333333] hover:bg-[#E0E0E0] dark:hover:bg-[#333333] text-[#000000] dark:text-[#FFFFFF] text-[10px] font-semibold cursor-pointer transition-colors"
            title="Clear dictated text"
          >
            Clear
          </button>
        )}

        {onStop && (
          <button
            type="button"
            data-testid="speech-done-btn"
            onClick={onStop}
            className="px-2 py-0.5 rounded-md bg-[#E0E0E0] dark:bg-[#333333] hover:bg-[#333333] hover:text-[#FFFFFF] dark:hover:bg-[#FFFFFF] dark:hover:text-[#000000] text-[#000000] dark:text-[#FFFFFF] text-[10px] font-bold cursor-pointer transition-colors"
            title="Finish speech dictation"
          >
            Done
          </button>
        )}

        {canSendNow && onSendNow && (
          <button
            type="button"
            data-testid="speech-send-now-btn"
            onClick={onSendNow}
            className="px-2.5 py-0.5 rounded-md bg-[#000000] hover:bg-[#333333] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:hover:bg-[#E0E0E0] dark:text-[#000000] text-[10px] font-bold cursor-pointer transition-colors shadow-2xs"
            title="Stop dictation and send prompt immediately"
          >
            Send Now
          </button>
        )}
      </div>
    </div>
  );
}
