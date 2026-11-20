import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Mic,
  MicOff,
  Info,
  Send,
  Volume2,
  RotateCcw,
  Keyboard,
  AlertCircle,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FuturisticVoiceOrb } from './FuturisticVoiceOrb';
import {
  VoiceCallState,
  getVoiceCallStatusLabel,
  detectVoiceSearchIntent,
  createBargeInTracker,
  detectSpeechBargeIn,
  SentenceStreamQueue,
} from '@/lib/voiceCallEngine';
import { matchVoiceCommand, executeOpenUrl, executeDeviceCommand } from '@/lib/voiceCommands';
import { extractWeatherQuery, fetchWeatherByCity, type WeatherData } from '@/lib/weatherService';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';
import { createConversation, saveMessage } from '@/lib/chatDatabase';
import { getFirebaseAuthorizationHeader } from '@/lib/firebaseAuthorization';
import { auth } from '@/lib/firebase';
import { longTermMemory } from '@/lib/longTermMemory';
import { requestMicrophonePermission } from '@/lib/permissionsManager';
import { getActivePerformanceProfile } from '@/lib/performanceEngine';
import { MicrophonePermissionModal } from './MicrophonePermissionModal';
import { toast } from 'sonner';

function getSpeechRecognitionConstructor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionConstructor());
}

function getBestRecognitionLang(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-US';
}

function formatSpokenWeather(data: WeatherData): string {
  const city = data.locationName || 'your area';
  const temp = Math.round(data.temperature);
  const condition = data.condition || 'clear';
  const humidity = data.humidity;
  return `In ${city}, it is currently ${temp} degrees Celsius with ${condition.toLowerCase()} and ${humidity}% humidity.`;
}

export interface VoiceMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  time: string;
}

export interface VoiceHistoryItem {
  id: string;
  text: string;
  time: string;
}

export interface ConversationContextMessage {
  id?: string;
  role: string;
  content: string;
}

interface VoiceCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendMessageToChat?: (text: string) => void;
  /** Existing chat messages from the active conversation so Voice Mode preserves context */
  conversationMessages?: ConversationContextMessage[];
  /** Active task/conversation ID if opened from an existing chat thread */
  activeTaskId?: string | null;
  /** Syncs completed voice turns back into the active chat conversation */
  onVoiceExchangeComplete?: (userText: string, aiText: string) => void;
}

const VOICE_OPTIONS = [
  { id: 'aura', name: 'Aura', desc: 'Warm & calm' },
  { id: 'sol', name: 'Sol', desc: 'Clear & conversational' },
  { id: 'atlas', name: 'Atlas', desc: 'Deep & steady' },
  { id: 'nova', name: 'Nova', desc: 'Bright & concise' },
];

const VOICE_HISTORY_KEY = 'manus_voice_call_history_v1';

/**
 * Splits a caption into a prominent first sentence/clause (crisp white)
 * and a softer trailing continuation (muted silver-grey) matching the reference screen.
 */
function splitCaptionHierarchy(text: string): { primary: string; secondary: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return { primary: '', secondary: '' };

  const sentenceBreak = clean.search(/[.!?]\s+/);
  if (sentenceBreak > 12 && sentenceBreak < clean.length - 4) {
    return {
      primary: clean.slice(0, sentenceBreak + 1).trim(),
      secondary: clean.slice(sentenceBreak + 1).trim(),
    };
  }

  if (clean.length > 74) {
    const splitIdx = clean.lastIndexOf(' ', 68);
    if (splitIdx > 24) {
      return {
        primary: clean.slice(0, splitIdx).trim(),
        secondary: clean.slice(splitIdx).trim(),
      };
    }
  }

  return { primary: clean, secondary: '' };
}

export function VoiceCallModal({
  isOpen,
  onClose,
  onSendMessageToChat,
  conversationMessages,
  activeTaskId,
  onVoiceExchangeComplete,
}: VoiceCallModalProps) {
  const [callState, setCallState] = useState<VoiceCallState>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [activeCaption, setActiveCaption] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Bottom drawer overlays (Info sheet & Text Message input bar)
  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const [showTextComposer, setShowTextComposer] = useState(false);
  const [textInput, setTextInput] = useState('');

  // Voice settings
  const [selectedVoice, setSelectedVoice] = useState(() => {
    try {
      return localStorage.getItem('manus_voice_persona') || 'aura';
    } catch {
      return 'aura';
    }
  });
  const [speechRate, setSpeechRate] = useState(() => {
    try {
      return localStorage.getItem('manus_voice_rate') || '1.0';
    } catch {
      return '1.0';
    }
  });
  const [interruptOnSpeech, setInterruptOnSpeech] = useState(true);

  // Microphone permission modal fallback
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);

  // Session messages (seeded with recent turns from existing chat if present)
  const [messages, setMessages] = useState<VoiceMessage[]>([]);

  // Refs for clean async lifecycle & zero-thrash audio visualization
  const orbHostRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentenceQueueRef = useRef<SentenceStreamQueue | null>(null);
  const bargeInTrackerRef = useRef(createBargeInTracker());
  const sessionChatIdRef = useRef<string | null>(null);
  const messagesRef = useRef<VoiceMessage[]>([]);
  const callStateRef = useRef<VoiceCallState>('connecting');
  const isMutedRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const hasMicPermissionRef = useRef(false);
  const isRecognitionRunningRef = useRef(false);
  const isRecognitionStartingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const interruptOnSpeechRef = useRef(interruptOnSpeech);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    interruptOnSpeechRef.current = interruptOnSpeech;
  }, [interruptOnSpeech]);

  useEffect(() => {
    try {
      localStorage.setItem('manus_voice_persona', selectedVoice);
      localStorage.setItem('manus_voice_rate', speechRate);
    } catch {
      // ignore storage restrictions
    }
    sentenceQueueRef.current?.updateOptions({
      voicePersona: selectedVoice,
      rate: parseFloat(speechRate) || 1.0,
    });
  }, [selectedVoice, speechRate]);

  // Monitor online/offline state for real connection indicator
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setErrorMessage((prev) =>
        prev?.toLowerCase().includes('offline') ? null : prev
      );
    };
    const handleOffline = () => {
      setIsOnline(false);
      setCallState('error');
      setErrorMessage('You appear to be offline. Reconnect to continue your voice session.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Direct DOM CSS custom property update — avoids 60fps React re-renders
  const setOrbLevel = useCallback((level: number) => {
    const host = orbHostRef.current;
    if (!host) return;
    const clamped = Math.max(0, Math.min(1, level));
    host.style.setProperty('--orb-level', clamped.toFixed(3));
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopRecognitionSafely = useCallback(() => {
    clearRestartTimer();
    isRecognitionStartingRef.current = false;
    try {
      if (recognitionRef.current && isRecognitionRunningRef.current) {
        recognitionRef.current.stop();
      }
    } catch {
      // ignore stop errors when already stopped
    }
  }, [clearRestartTimer]);

  const startRecognitionSafely = useCallback(() => {
    if (
      !isOpenRef.current ||
      !hasMicPermissionRef.current ||
      isMutedRef.current ||
      isSpeakingRef.current ||
      isProcessingRef.current
    ) {
      return;
    }

    const recognition = recognitionRef.current;
    if (!recognition || isRecognitionRunningRef.current || isRecognitionStartingRef.current) {
      return;
    }

    clearRestartTimer();
    isRecognitionStartingRef.current = true;
    try {
      recognition.start();
    } catch (err: any) {
      isRecognitionStartingRef.current = false;
      if (err?.name === 'InvalidStateError') {
        isRecognitionRunningRef.current = true;
      }
    }
  }, [clearRestartTimer]);

  const scheduleRecognitionRestart = useCallback(
    (delayMs = 350) => {
      clearRestartTimer();
      if (
        !isOpenRef.current ||
        !hasMicPermissionRef.current ||
        isMutedRef.current ||
        isSpeakingRef.current ||
        isProcessingRef.current
      ) {
        return;
      }
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        startRecognitionSafely();
      }, delayMs);
    },
    [clearRestartTimer, startRecognitionSafely]
  );

  // Interrupt AI speech & abort any in-flight stream cleanly (used for barge-in & tap-to-interrupt)
  const interruptAiResponse = useCallback(
    (resumeListeningAfter = true) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      sentenceQueueRef.current?.interrupt();
      stopCleanSpeech();
      isSpeakingRef.current = false;
      isProcessingRef.current = false;
      setOrbLevel(0);

      if (resumeListeningAfter && isOpenRef.current && hasMicPermissionRef.current && !isMutedRef.current) {
        setCallState('listening');
        setErrorMessage(null);
        scheduleRecognitionRestart(160);
      } else if (isOpenRef.current) {
        setCallState(isMutedRef.current ? 'idle' : 'idle');
      }
    },
    [scheduleRecognitionRestart, setOrbLevel]
  );

  // Persist standalone voice call conversation (when opened from Home without an existing activeTaskId)
  const persistStandaloneVoiceConversation = useCallback(
    async (userText: string, aiText: string) => {
      if (activeTaskId) return;
      const cleanUser = userText.trim();
      const cleanAi = aiText.trim();
      if (!cleanUser && !cleanAi) return;

      const userId = auth.currentUser?.uid || 'usr_manus_default';
      const title = `Voice: ${cleanUser.slice(0, 50)}${cleanUser.length > 50 ? '...' : ''}`;

      try {
        if (!sessionChatIdRef.current) {
          const created = await createConversation({
            title,
            userId,
            mode: 'chat',
          });
          sessionChatIdRef.current = created.id;
        }
        const convId = sessionChatIdRef.current;
        const now = Date.now();
        if (cleanUser) {
          await saveMessage({
            conversationId: convId,
            userId,
            role: 'user',
            content: cleanUser,
            timestamp: new Date(now).toISOString(),
            status: 'success',
          });
        }
        if (cleanAi) {
          await saveMessage({
            conversationId: convId,
            userId,
            role: 'assistant',
            content: cleanAi,
            timestamp: new Date(now + 1).toISOString(),
            status: 'success',
          });
        }
      } catch (err) {
        console.warn('[Voice Call] Failed to persist standalone conversation:', err);
      }
    },
    [activeTaskId]
  );

  const appendHistoryEntry = useCallback((text: string) => {
    try {
      const raw = localStorage.getItem(VOICE_HISTORY_KEY);
      const parsed: VoiceHistoryItem[] = raw ? JSON.parse(raw) : [];
      const item: VoiceHistoryItem = {
        id: Date.now().toString(),
        text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      localStorage.setItem(VOICE_HISTORY_KEY, JSON.stringify([item, ...parsed].slice(0, 30)));
    } catch {
      // ignore storage errors
    }
  }, []);

  // Build full conversational history combining prior chat messages + current voice session
  const buildBackendHistory = useCallback(
    (currentQuery: string) => {
      const priorFromChat = (conversationMessages || [])
        .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
        .slice(-10)
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content.trim(),
        }));

      const voiceTurns = messagesRef.current.slice(-10).map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      // Deduplicate consecutive identical turns
      const combined = [...priorFromChat, ...voiceTurns];
      const deduped: Array<{ role: string; content: string }> = [];
      for (const item of combined) {
        const prev = deduped[deduped.length - 1];
        if (prev && prev.role === item.role && prev.content === item.content) continue;
        deduped.push(item);
      }

      const last = deduped[deduped.length - 1];
      if (!last || last.role !== 'user' || last.content !== currentQuery) {
        deduped.push({ role: 'user', content: currentQuery });
      }
      return deduped.slice(-14);
    },
    [conversationMessages]
  );

  // Process user speech or typed voice-mode message through the real backend
  const handleUserPrompt = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || !isOpenRef.current) return;

      // Cancel any ongoing AI speech/stream cleanly before handling new turn
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      sentenceQueueRef.current?.interrupt();
      stopCleanSpeech();
      stopRecognitionSafely();

      isProcessingRef.current = true;
      isSpeakingRef.current = false;
      setErrorMessage(null);
      setLastFailedPrompt(null);
      setLiveTranscript('');
      setActiveCaption(query);

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const userMsg: VoiceMessage = {
        id: `voice-user-${Date.now()}`,
        sender: 'user',
        text: query,
        time: nowTime,
      };
      setMessages((prev) => {
        const next = [...prev, userMsg];
        messagesRef.current = next;
        return next;
      });
      appendHistoryEntry(query);

      // Capture explicit memory requests seamlessly in Voice Call Mode too
      const activeUserId = auth.currentUser?.uid || 'usr_manus_default';
      void longTermMemory
        .captureFromUserMessage({ userId: activeUserId, message: query })
        .catch(() => {});

      const finalizeTurn = (aiReply: string) => {
        const replyClean = aiReply.trim();
        if (!replyClean) return;
        const aiMsg: VoiceMessage = {
          id: `voice-ai-${Date.now() + 1}`,
          sender: 'ai',
          text: replyClean,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => {
          const next = [...prev, aiMsg];
          messagesRef.current = next;
          return next;
        });
        void persistStandaloneVoiceConversation(query, replyClean);
        setActiveCaption(replyClean);
        onVoiceExchangeComplete?.(query, replyClean);
      };

      // 1. Check built-in voice commands (open website / device controls)
      const voiceCmd = matchVoiceCommand(query);
      if (voiceCmd?.matched) {
        if ((voiceCmd.action === 'open_url' || voiceCmd.action === 'search') && voiceCmd.url) {
          executeOpenUrl(voiceCmd.url);
        } else {
          void executeDeviceCommand(voiceCmd).catch(() => {});
        }
        const reply = voiceCmd.feedbackSpeech || `Opening ${voiceCmd.targetName || 'that'} now.`;
        finalizeTurn(reply);
        isProcessingRef.current = false;
        isSpeakingRef.current = true;
        setCallState('speaking');
        sentenceQueueRef.current?.speakFull(reply);
        return;
      }

      // 2. Live weather intent -> Searching...
      const weatherQuery = extractWeatherQuery(query);
      if (weatherQuery.isWeather && weatherQuery.city) {
        setCallState('searching');
        try {
          const weatherData = await fetchWeatherByCity(weatherQuery.city);
          if (weatherData) {
            const reply = formatSpokenWeather(weatherData);
            finalizeTurn(reply);
            isProcessingRef.current = false;
            isSpeakingRef.current = true;
            setCallState('speaking');
            sentenceQueueRef.current?.speakFull(reply);
            return;
          }
        } catch (err) {
          console.warn('[Voice Call] Weather lookup failed, falling through to AI stream:', err);
        }
      }

      // 3. Real-time streaming AI generation via existing /api/gemini/stream
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        isProcessingRef.current = false;
        setCallState('error');
        setLastFailedPrompt(query);
        setErrorMessage('You are currently offline. Reconnect and tap Retry.');
        return;
      }

      setCallState(detectVoiceSearchIntent(query) ? 'searching' : 'thinking');

      const controller = new AbortController();
      abortControllerRef.current = controller;
      let voiceInactivityTimer: ReturnType<typeof setTimeout> | null = null;
      const resetVoiceInactivity = () => {
        if (voiceInactivityTimer !== null) clearTimeout(voiceInactivityTimer);
        voiceInactivityTimer = setTimeout(() => {
          try {
            controller.abort(new DOMException('Voice stream timed out', 'TimeoutError'));
          } catch {
            controller.abort();
          }
        }, 45000);
      };
      resetVoiceInactivity();

      let fullReply = '';
      try {
        const authHeader = await getFirebaseAuthorizationHeader();
        const memoryContext = await longTermMemory
          .getRelevantContext(activeUserId, query)
          .catch(() => '');
        const historyPayload = buildBackendHistory(query);

        const baseSystemInstruction =
          'You are a warm, intelligent AI voice assistant in a live full-screen voice call. Give concise, natural, clear spoken responses in 2 to 4 sentences without markdown tables, code fences, or bullet symbols. Respond directly to the user.';
        const systemInstruction = memoryContext
          ? `${baseSystemInstruction}\n\n${memoryContext}`
          : baseSystemInstruction;

        const response = await fetch('/api/gemini/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify({
            messages: historyPayload,
            systemInstruction,
            mode: 'chat',
          }),
          signal: controller.signal,
        });
        resetVoiceInactivity();

        if (!response.ok || !response.body) {
          const errPayload = await response.json().catch(() => null);
          const msg =
            errPayload?.error ||
            (response.status === 401
              ? 'Please sign in to continue your AI voice call.'
              : `AI voice service returned an error (${response.status}).`);
          throw new Error(msg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let startedSpeakingStream = false;

        sentenceQueueRef.current?.startStream();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (controller.signal.aborted) break;
          resetVoiceInactivity();

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.slice(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'heartbeat' || parsed.type === 'ping' || parsed.type === 'stream-open') {
                continue;
              }
              if (parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
                fullReply += parsed.delta;
                setActiveCaption(fullReply);
                if (!startedSpeakingStream) {
                  startedSpeakingStream = true;
                  isSpeakingRef.current = true;
                  setCallState('speaking');
                }
                sentenceQueueRef.current?.pushDelta(parsed.delta);
              } else if (parsed.type === 'error' && !fullReply.trim()) {
                throw new Error(parsed.error || 'Streaming AI response failed.');
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) {
                // ignore partial SSE JSON chunk
              } else {
                throw parseErr;
              }
            }
          }
        }

        if (controller.signal.aborted && !fullReply.trim()) {
          return;
        }

        const finalText = fullReply.trim();
        if (!finalText) {
          throw new Error('No response received from the AI service. Please try again.');
        }

        finalizeTurn(finalText);
        isProcessingRef.current = false;
        isSpeakingRef.current = true;
        setCallState('speaking');
        sentenceQueueRef.current?.finishStream();
      } catch (err: any) {
        if (fullReply.trim()) {
          // Preserve partial voice response cleanly
          finalizeTurn(fullReply.trim());
          isProcessingRef.current = false;
          isSpeakingRef.current = true;
          setCallState('speaking');
          sentenceQueueRef.current?.finishStream();
          return;
        }
        const abortReasonName = controller.signal.reason?.name || err?.name || '';
        if (abortReasonName === 'AbortError' && abortReasonName !== 'TimeoutError') {
          isProcessingRef.current = false;
          return;
        }
        console.warn('[Voice Call] Backend request failed:', err);
        isProcessingRef.current = false;
        isSpeakingRef.current = false;
        setCallState('error');
        setLastFailedPrompt(query);
        setErrorMessage(
          abortReasonName === 'TimeoutError'
            ? 'The AI response timed out. Tap Retry to try again.'
            : (err?.message || 'Unable to reach the AI assistant right now. Please try again.')
        );
      } finally {
        if (voiceInactivityTimer !== null) clearTimeout(voiceInactivityTimer);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      appendHistoryEntry,
      buildBackendHistory,
      onVoiceExchangeComplete,
      persistStandaloneVoiceConversation,
      stopRecognitionSafely,
    ]
  );

  // Keep latest handleUserPrompt accessible inside SpeechRecognition handlers
  const handleUserPromptRef = useRef(handleUserPrompt);
  useEffect(() => {
    handleUserPromptRef.current = handleUserPrompt;
  }, [handleUserPrompt]);

  // Real microphone audio-level monitor + VAD barge-in interruption
  const startAudioMonitor = useCallback(
    async (stream: MediaStream) => {
      try {
        const AudioContextCtor =
          window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return;

        const ctx = new AudioContextCtor();
        audioCtxRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const timeDomain = new Uint8Array(analyser.fftSize);
        let smoothedLevel = 0;
        let lastFrameAt = 0;
        const perfProfile = getActivePerformanceProfile();
        const minFrameIntervalMs = perfProfile === 'ultra-lite' ? 64 : 24;

        const tick = (now: number) => {
          if (!isOpenRef.current) return;
          animFrameRef.current = requestAnimationFrame(tick);

          if (now - lastFrameAt < minFrameIntervalMs) return;
          lastFrameAt = now;

          if (!analyserRef.current) return;

          // When AI is speaking, only run mic sampling for barge-in detection if enabled & unmuted
          analyserRef.current.getByteTimeDomainData(timeDomain);
          let sumSq = 0;
          for (let i = 0; i < timeDomain.length; i++) {
            const centered = (timeDomain[i] - 128) / 128;
            sumSq += centered * centered;
          }
          const rms = Math.sqrt(sumSq / timeDomain.length);

          if (isSpeakingRef.current) {
            // Barge-in: if user speaks clearly while AI is talking, interrupt TTS smoothly
            if (
              interruptOnSpeechRef.current &&
              !isMutedRef.current &&
              detectSpeechBargeIn(rms, bargeInTrackerRef.current, {
                threshold: 0.24,
                requiredFrames: perfProfile === 'ultra-lite' ? 4 : 6,
                now,
              })
            ) {
              interruptAiResponse(true);
            }
            return;
          }

          if (callStateRef.current === 'listening' && !isMutedRef.current) {
            const target = Math.min(1, rms * 4.4);
            smoothedLevel = smoothedLevel * 0.65 + target * 0.35;
            setOrbLevel(smoothedLevel);
          } else if (
            callStateRef.current !== 'speaking' &&
            smoothedLevel > 0.005
          ) {
            smoothedLevel *= 0.8;
            setOrbLevel(smoothedLevel < 0.005 ? 0 : smoothedLevel);
          }
        };

        animFrameRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.warn('[Voice Call] Web Audio analyser unavailable:', err);
      }
    },
    [interruptAiResponse, setOrbLevel]
  );

  // Initialize SpeechRecognition instance
  const setupSpeechRecognition = useCallback(() => {
    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) {
      setErrorMessage(
        'Voice recognition is not supported in this browser. Tap the send icon below to type in Voice Mode.'
      );
      setCallState('idle');
      return false;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = getBestRecognitionLang();

    recognition.onstart = () => {
      isRecognitionStartingRef.current = false;
      isRecognitionRunningRef.current = true;
      if (!isSpeakingRef.current && !isProcessingRef.current && !isMutedRef.current) {
        setCallState('listening');
      }
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          finalChunk += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim.trim()) {
        // If AI is somehow still speaking when recognition picks up speech, interrupt immediately
        if (isSpeakingRef.current && interruptOnSpeechRef.current) {
          interruptAiResponse(false);
        }
        setLiveTranscript(interim.trim());
        setActiveCaption(interim.trim());
      }

      if (finalChunk.trim()) {
        setLiveTranscript('');
        void handleUserPromptRef.current(finalChunk.trim());
      }
    };

    recognition.onerror = (event: any) => {
      isRecognitionStartingRef.current = false;
      isRecognitionRunningRef.current = false;

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        hasMicPermissionRef.current = false;
        setCallState('error');
        setErrorMessage('Microphone access was blocked. Allow microphone access or use keyboard input.');
        setIsPermissionModalOpen(true);
        return;
      }

      if (event.error === 'network') {
        setErrorMessage('Speech recognition lost network connection. Retrying...');
        scheduleRecognitionRestart(1200);
        return;
      }

      if (event.error === 'no-speech' || event.error === 'aborted') {
        if (
          isOpenRef.current &&
          hasMicPermissionRef.current &&
          !isMutedRef.current &&
          !isSpeakingRef.current &&
          !isProcessingRef.current
        ) {
          scheduleRecognitionRestart(420);
        }
      }
    };

    recognition.onend = () => {
      isRecognitionStartingRef.current = false;
      isRecognitionRunningRef.current = false;
      if (
        isOpenRef.current &&
        hasMicPermissionRef.current &&
        !isMutedRef.current &&
        !isSpeakingRef.current &&
        !isProcessingRef.current
      ) {
        scheduleRecognitionRestart(380);
      }
    };

    recognitionRef.current = recognition;
    return true;
  }, [interruptAiResponse, scheduleRecognitionRestart]);

  // Clean up all audio streams, recognition, synthesis, and timers
  const cleanupAllResources = useCallback(() => {
    clearRestartTimer();
    isRecognitionStartingRef.current = false;
    isRecognitionRunningRef.current = false;
    isSpeakingRef.current = false;
    isProcessingRef.current = false;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    sentenceQueueRef.current?.dispose();
    sentenceQueueRef.current = null;
    stopCleanSpeech();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore stop errors
      }
      recognitionRef.current = null;
    }

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }

    if (audioCtxRef.current) {
      if (audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setOrbLevel(0);
  }, [clearRestartTimer, setOrbLevel]);

  // Connect microphone & start session
  const connectVoiceSession = useCallback(async () => {
    setCallState('connecting');
    setErrorMessage(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hasMicPermissionRef.current = false;
      setCallState('error');
      setErrorMessage('Microphone API is unavailable in this browser. You can still type below.');
      return;
    }

    const granted = await requestMicrophonePermission();
    if (!isOpenRef.current) return;

    if (!granted) {
      hasMicPermissionRef.current = false;
      setCallState('error');
      setErrorMessage('Microphone permission is required for live voice conversation.');
      setIsPermissionModalOpen(true);
      return;
    }

    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err: any) {
      hasMicPermissionRef.current = false;
      setCallState('error');
      setErrorMessage(
        err?.message || 'Could not access your microphone. Check device permissions or type below.'
      );
      setIsPermissionModalOpen(true);
      return;
    }

    if (!isOpenRef.current) {
      mediaStream.getTracks().forEach((t) => t.stop());
      return;
    }

    hasMicPermissionRef.current = true;
    streamRef.current = mediaStream;
    setIsPermissionModalOpen(false);
    setIsMuted(false);
    isMutedRef.current = false;

    await startAudioMonitor(mediaStream);

    const hasSpeechApi = isSpeechRecognitionSupported() && setupSpeechRecognition();
    if (hasSpeechApi) {
      setCallState('listening');
      startRecognitionSafely();
    } else {
      setCallState('idle');
    }
  }, [setupSpeechRecognition, startAudioMonitor, startRecognitionSafely]);

  // Mount/unmount lifecycle when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      cleanupAllResources();
      return;
    }

    sessionChatIdRef.current = null;
    setMessages([]);
    messagesRef.current = [];
    setLiveTranscript('');
    setShowInfoSheet(false);
    setShowTextComposer(false);
    setErrorMessage(null);
    setLastFailedPrompt(null);

    // Seed caption with last message from active conversation if available, else crisp prompt
    const lastChatMsg = conversationMessages?.[conversationMessages.length - 1];
    if (lastChatMsg?.content?.trim()) {
      setActiveCaption(lastChatMsg.content.trim().slice(0, 180));
    } else {
      setActiveCaption('Ask anything or speak freely to start.');
    }

    // Initialize streaming sentence TTS queue
    sentenceQueueRef.current = new SentenceStreamQueue({
      voicePersona: selectedVoice,
      rate: parseFloat(speechRate) || 1.0,
      volume: 1.0,
      speakFn: speakCleanHumanVoice,
      stopFn: stopCleanSpeech,
      onSpeakingStart: () => {
        if (!isOpenRef.current) return;
        isSpeakingRef.current = true;
        setCallState('speaking');
        stopRecognitionSafely();
      },
      onSpeechLevel: (level) => {
        if (!isOpenRef.current) return;
        if (isSpeakingRef.current) {
          setOrbLevel(level);
        }
      },
      onSpeakingEnd: () => {
        if (!isOpenRef.current) return;
        isSpeakingRef.current = false;
        setOrbLevel(0);
        if (hasMicPermissionRef.current && !isMutedRef.current) {
          setCallState('listening');
          scheduleRecognitionRestart(380);
        } else {
          setCallState('idle');
        }
      },
      onError: (err) => {
        console.warn('[Voice Call] Speech playback warning:', err);
      },
    });

    void connectVoiceSession();

    // Prevent background body scroll while fullscreen voice mode is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
      cleanupAllResources();
    };
  }, [isOpen]);

  // Escape key closes voice call cleanly
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showInfoSheet) {
          setShowInfoSheet(false);
        } else if (showTextComposer) {
          setShowTextComposer(false);
        } else {
          handleCloseChat();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showInfoSheet, showTextComposer]);

  // Focus text input when Send/Message composer opens
  useEffect(() => {
    if (showTextComposer) {
      setTimeout(() => textInputRef.current?.focus(), 60);
    }
  }, [showTextComposer]);

  // Mute / Unmute / Interrupt microphone button handler
  const handleMicToggle = () => {
    // If currently speaking or thinking, tapping the glowing mic immediately interrupts & listens
    if (callState === 'speaking' || callState === 'thinking' || callState === 'searching') {
      if (isMutedRef.current) {
        setIsMuted(false);
        isMutedRef.current = false;
        streamRef.current?.getAudioTracks().forEach((t) => {
          t.enabled = true;
        });
      }
      interruptAiResponse(true);
      return;
    }

    // If mic permission wasn't granted yet, request it cleanly
    if (!hasMicPermissionRef.current) {
      void connectVoiceSession();
      return;
    }

    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;

    // Physically mute/unmute the MediaStream audio track
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    if (nextMuted) {
      stopRecognitionSafely();
      setOrbLevel(0);
      setCallState('idle');
    } else {
      setErrorMessage(null);
      setCallState('listening');
      startRecognitionSafely();
    }
  };

  // Tapping the 3D orb interrupts AI speech or toggles listening
  const handleOrbTap = () => {
    if (callState === 'speaking' || callState === 'thinking' || callState === 'searching') {
      interruptAiResponse(true);
      return;
    }
    handleMicToggle();
  };

  const handleCloseChat = () => {
    cleanupAllResources();
    onClose();
  };

  const handleSendTextMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed) return;
    setTextInput('');
    setShowTextComposer(false);
    void handleUserPrompt(trimmed);
  };

  const handleSendTranscriptToChat = () => {
    if (!onSendMessageToChat) return;
    const latestUser = [...messages].reverse().find((m) => m.sender === 'user');
    if (latestUser) {
      onSendMessageToChat(latestUser.text);
      toast.success('Copied prompt to chat composer');
    }
  };

  // Derived real connection status indicator
  const connectionStatus = useMemo(() => {
    if (!isOnline) return { label: 'Offline', dotClass: 'bg-red-500' };
    if (callState === 'connecting') return { label: 'Connecting', dotClass: 'bg-amber-400 animate-pulse' };
    if (callState === 'error') return { label: 'Attention needed', dotClass: 'bg-red-500' };
    if (isMuted) return { label: 'Mic muted', dotClass: 'bg-white/45' };
    return { label: 'Connected', dotClass: 'bg-emerald-400' };
  }, [isOnline, callState, isMuted]);

  const statusLabel = getVoiceCallStatusLabel(callState);
  const captionDisplay = liveTranscript || activeCaption;
  const { primary: captionPrimary, secondary: captionSecondary } = useMemo(
    () => splitCaptionHierarchy(captionDisplay),
    [captionDisplay]
  );

  if (!isOpen) return null;

  const isMicActive =
    !isMuted &&
    hasMicPermissionRef.current &&
    (callState === 'listening' || callState === 'connecting');

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Voice Call"
      className="fixed inset-0 z-[100] h-screen h-[100dvh] w-full bg-[#000000] text-white flex flex-col justify-between overflow-hidden select-none font-sans animate-in fade-in duration-200"
    >
      {/* Ambient Warm Orange / Amber / Deep-Red Edge Glow Framing Pure Black Core */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {/* Top warm orange-amber atmospheric wash */}
        <div
          className="absolute inset-x-[-18%] top-[-16%] h-[54%]"
          style={{
            background:
              callState === 'error'
                ? 'radial-gradient(ellipse 85% 70% at 50% 0%, rgba(220,38,38,0.52) 0%, rgba(153,27,27,0.22) 48%, rgba(0,0,0,0) 78%)'
                : 'radial-gradient(ellipse 85% 70% at 50% 0%, rgba(255,112,24,0.62) 0%, rgba(186,42,8,0.3) 44%, rgba(0,0,0,0) 78%)',
          }}
        />

        {/* Left vertical warm ember rim glow */}
        <div
          className="absolute inset-y-0 left-[-14%] w-[36%]"
          style={{
            background:
              callState === 'error'
                ? 'radial-gradient(ellipse 65% 80% at 0% 52%, rgba(185,28,28,0.42) 0%, rgba(0,0,0,0) 74%)'
                : 'radial-gradient(ellipse 65% 80% at 0% 52%, rgba(214,68,14,0.48) 0%, rgba(124,26,6,0.18) 46%, rgba(0,0,0,0) 74%)',
          }}
        />

        {/* Right vertical warm ember rim glow */}
        <div
          className="absolute inset-y-0 right-[-14%] w-[36%]"
          style={{
            background:
              callState === 'error'
                ? 'radial-gradient(ellipse 65% 80% at 100% 52%, rgba(185,28,28,0.42) 0%, rgba(0,0,0,0) 74%)'
                : 'radial-gradient(ellipse 65% 80% at 100% 52%, rgba(214,68,14,0.48) 0%, rgba(124,26,6,0.18) 46%, rgba(0,0,0,0) 74%)',
          }}
        />

        {/* Bottom warm red-orange corner halo */}
        <div
          className="absolute inset-x-[-14%] bottom-[-14%] h-[34%]"
          style={{
            background:
              callState === 'error'
                ? 'radial-gradient(ellipse 80% 70% at 50% 100%, rgba(185,28,28,0.34) 0%, rgba(0,0,0,0) 72%)'
                : 'radial-gradient(ellipse 80% 70% at 50% 100%, rgba(196,52,12,0.36) 0%, rgba(105,20,4,0.15) 45%, rgba(0,0,0,0) 72%)',
          }}
        />
      </div>

      {/* TOP BAR: Floating "✕ Close chat" Button & Subtle Live Connection Indicator */}
      <header className="relative z-20 flex flex-col items-center justify-center pt-[max(18px,env(safe-area-inset-top))] px-5 shrink-0 gap-2">
        <button
          type="button"
          onClick={handleCloseChat}
          className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-full bg-white/10 hover:bg-white/16 active:scale-95 border border-white/15 backdrop-blur-md text-[13px] sm:text-sm font-medium text-white/95 tracking-tight shadow-[0_6px_24px_rgba(0,0,0,0.28)] cursor-pointer transition-all"
          aria-label="Close chat"
        >
          <X size={15} strokeWidth={2.2} className="text-white/90" />
          <span>Close chat</span>
        </button>

        {/* Small real connection indicator */}
        <div
          className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-white/60"
          aria-live="polite"
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', connectionStatus.dotClass)} />
          <span>{connectionStatus.label}</span>
        </div>
      </header>

      {/* CENTER STAGE: 3D Volumetric Glowing Orb, Live Status, Minimal Two-Tone Transcript */}
      <main className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-6 sm:px-10 text-center gap-5 sm:gap-7">
        <FuturisticVoiceOrb
          state={callState}
          orbRef={orbHostRef}
          onTap={handleOrbTap}
          ariaLabel={
            callState === 'speaking'
              ? 'Tap orb to interrupt AI speech'
              : isMuted
                ? 'Tap orb to unmute microphone'
                : 'Tap orb to toggle microphone'
          }
        />

        {/* Live Status Label directly beneath the orb */}
        <div className="flex flex-col items-center gap-3.5 max-w-[460px] w-full">
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'text-[13px] sm:text-sm font-medium tracking-wide transition-colors duration-300',
              callState === 'error'
                ? 'text-red-400'
                : callState === 'speaking'
                  ? 'text-amber-200/80'
                  : 'text-white/50'
            )}
          >
            {statusLabel}
          </p>

          {/* Minimal Centered Transcript / AI Response Typography */}
          {captionDisplay && (
            <div className="max-h-[156px] overflow-y-auto no-scrollbar px-2">
              <p className="text-[20px] sm:text-[24px] leading-[1.32] font-medium tracking-[-0.015em] text-balance">
                <span className="text-white">{captionPrimary}</span>
                {captionSecondary && (
                  <>
                    {' '}
                    <span className="text-white/45">{captionSecondary}</span>
                  </>
                )}
              </p>
            </div>
          )}

          {/* Actionable Error Banner (Mic denied, offline, or backend failure) */}
          {errorMessage && (
            <div
              role="alert"
              className="mt-1 flex flex-col items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/[0.06] border border-red-500/30 backdrop-blur-md max-w-[380px] w-full"
            >
              <div className="flex items-start gap-2 text-left text-xs text-red-200/90 leading-relaxed">
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-400" />
                <span>{errorMessage}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (lastFailedPrompt) {
                      void handleUserPrompt(lastFailedPrompt);
                    } else {
                      void connectVoiceSession();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/12 hover:bg-white/20 text-xs font-medium text-white cursor-pointer"
                >
                  <RotateCcw size={12} />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowTextComposer(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/8 hover:bg-white/16 text-xs font-medium text-white/85 cursor-pointer"
                >
                  <Keyboard size={12} />
                  <span>Type message</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* BOTTOM CONTROLS: Optional Translucent Composer + 3-Button Voice Dock */}
      <footer className="relative z-20 flex flex-col items-center w-full px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-2 shrink-0 gap-4">
        {/* Inline Translucent Text Input Bar (toggled by Right Send/Message Button) */}
        {showTextComposer && (
          <form
            onSubmit={handleSendTextMessage}
            className="w-full max-w-[420px] flex items-center gap-2 px-3 py-2 rounded-full bg-white/[0.08] border border-white/15 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.45)] animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            <input
              ref={textInputRef}
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Send a message in voice mode..."
              className="flex-1 bg-transparent border-0 outline-none text-sm text-white placeholder:text-white/40 px-2.5 py-1.5 min-w-0"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              aria-label="Send message"
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all cursor-pointer',
                textInput.trim()
                  ? 'bg-gradient-to-br from-amber-400 via-orange-500 to-red-600 text-white shadow-[0_0_18px_rgba(249,115,22,0.5)]'
                  : 'bg-white/10 text-white/35 cursor-not-allowed'
              )}
            >
              <Send size={15} />
            </button>
          </form>
        )}

        {/* Primary 3-Control Bottom Dock (Info — Glowing Microphone — Send/Message) */}
        <div className="w-full max-w-[320px] flex items-center justify-between">
          {/* Left: Information Button */}
          <button
            type="button"
            onClick={() => {
              setShowTextComposer(false);
              setShowInfoSheet((prev) => !prev);
            }}
            aria-label="Voice call information and controls"
            aria-expanded={showInfoSheet}
            className={cn(
              'w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-md transition-all cursor-pointer active:scale-95',
              showInfoSheet
                ? 'bg-white/20 border-white/30 text-white'
                : 'bg-white/[0.06] border-white/12 text-white/65 hover:text-white hover:bg-white/12'
            )}
          >
            <Info size={20} strokeWidth={1.8} />
          </button>

          {/* Center: Large Circular Glowing Microphone Button with Subtle Animated Rings */}
          <div className="relative flex items-center justify-center w-[98px] h-[98px]">
            {/* Subtle outer circular guide ring matching reference screenshot */}
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-0 rounded-full border transition-colors duration-300',
                isMuted ? 'border-white/10' : 'border-white/14'
              )}
            />

            {/* Subtle expanding circular ripple animation when listening/active */}
            {isMicActive && (
              <>
                <span
                  aria-hidden="true"
                  className="voice-mic-ripple pointer-events-none absolute inset-[8px] rounded-full border border-orange-400/45"
                />
                <span
                  aria-hidden="true"
                  className="voice-mic-ripple pointer-events-none absolute inset-[8px] rounded-full border border-amber-300/30"
                  style={{ animationDelay: '1.05s' }}
                />
              </>
            )}

            <button
              type="button"
              onClick={handleMicToggle}
              aria-label={
                callState === 'speaking'
                  ? 'Interrupt AI and speak'
                  : isMuted
                    ? 'Unmute microphone'
                    : 'Mute microphone'
              }
              aria-pressed={!isMuted}
              className={cn(
                'relative z-10 w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400',
                isMuted
                  ? 'bg-white/12 border border-white/20 text-white/75 shadow-[0_0_24px_rgba(0,0,0,0.5)]'
                  : 'text-white shadow-[0_0_32px_rgba(249,115,22,0.58),0_0_64px_rgba(220,38,38,0.3)]'
              )}
              style={
                isMuted
                  ? undefined
                  : {
                      background:
                        'radial-gradient(circle at 35% 28%, #ffb443 0%, #f96815 44%, #d92d0e 86%, #991b0b 100%)',
                    }
              }
            >
              {isMuted ? (
                <MicOff size={26} strokeWidth={2.1} />
              ) : (
                <Mic size={27} strokeWidth={2.1} />
              )}
            </button>
          </div>

          {/* Right: Send / Message Button */}
          <button
            type="button"
            onClick={() => {
              setShowInfoSheet(false);
              setShowTextComposer((prev) => !prev);
            }}
            aria-label="Send text message in voice mode"
            aria-expanded={showTextComposer}
            className={cn(
              'w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-md transition-all cursor-pointer active:scale-95',
              showTextComposer
                ? 'bg-white/20 border-white/30 text-white'
                : 'bg-white/[0.06] border-white/12 text-white/65 hover:text-white hover:bg-white/12'
            )}
          >
            <Send size={19} strokeWidth={1.8} />
          </button>
        </div>
      </footer>

      {/* Translucent Information & Voice Controls Sheet (opened via Left Info Button) */}
      {showInfoSheet && (
        <div
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setShowInfoSheet(false)}
        >
          <div
            className="w-full max-w-[400px] max-h-[78dvh] overflow-y-auto rounded-3xl bg-[#0D0A09]/95 border border-white/12 p-5 text-white shadow-[0_24px_64px_rgba(0,0,0,0.75)] flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-white">
                  Voice Call Info
                </h2>
                <p className="text-xs text-white/50 mt-0.5">
                  Tap the orb or speak anytime to interrupt.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInfoSheet(false)}
                aria-label="Close voice info"
                className="w-8 h-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/80 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Voice Persona Selector */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-white/60">
                <Volume2 size={13} />
                <span>Assistant Voice</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {VOICE_OPTIONS.map((v) => {
                  const active = selectedVoice === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVoice(v.id)}
                      className={cn(
                        'flex items-center justify-between px-3 py-2.5 rounded-2xl border text-left transition-all cursor-pointer',
                        active
                          ? 'bg-orange-500/18 border-orange-400/50 text-white'
                          : 'bg-white/[0.04] border-white/10 text-white/75 hover:bg-white/[0.08]'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{v.name}</div>
                        <div className="text-[11px] text-white/45 truncate">{v.desc}</div>
                      </div>
                      {active && <Check size={14} className="text-orange-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Speech Speed & Barge-in Controls */}
            <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] border border-white/10 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/75 font-medium">Speech speed</span>
                <div className="flex items-center gap-1.5">
                  {['0.9', '1.0', '1.15', '1.3'].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setSpeechRate(rate)}
                      className={cn(
                        'px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors',
                        speechRate === rate
                          ? 'bg-orange-500 text-white'
                          : 'bg-white/8 text-white/65 hover:text-white'
                      )}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10">
                <span className="text-white/75 font-medium">Interrupt AI when speaking</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={interruptOnSpeech}
                  onClick={() => setInterruptOnSpeech((prev) => !prev)}
                  className={cn(
                    'w-10 h-6 rounded-full p-0.5 transition-colors cursor-pointer',
                    interruptOnSpeech ? 'bg-orange-500' : 'bg-white/20'
                  )}
                >
                  <span
                    className={cn(
                      'block w-5 h-5 rounded-full bg-white transition-transform',
                      interruptOnSpeech ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Live Session Transcript Preview */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/60">
                  Session transcript ({messages.length})
                </span>
                {onSendMessageToChat && messages.some((m) => m.sender === 'user') && (
                  <button
                    type="button"
                    onClick={handleSendTranscriptToChat}
                    className="text-[11px] font-medium text-orange-300 hover:text-orange-200 cursor-pointer"
                  >
                    Copy last prompt to chat
                  </button>
                )}
              </div>
              {messages.length === 0 ? (
                <p className="text-xs text-white/40 py-2">
                  Conversation turns spoken in this call appear here and sync automatically with your chat.
                </p>
              ) : (
                <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
                  {messages.slice(-8).map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'px-3 py-2 rounded-xl text-xs leading-relaxed',
                        msg.sender === 'user'
                          ? 'bg-white/10 text-white self-end max-w-[85%]'
                          : 'bg-orange-500/10 border border-orange-500/20 text-white/85 self-start max-w-[90%]'
                      )}
                    >
                      <span className="block text-[10px] uppercase tracking-wider text-white/40 mb-0.5">
                        {msg.sender === 'user' ? 'You' : 'Assistant'} · {msg.time}
                      </span>
                      {msg.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Microphone Permission Recovery Modal */}
      <MicrophonePermissionModal
        isOpen={isPermissionModalOpen}
        onClose={() => setIsPermissionModalOpen(false)}
        onPermissionGranted={() => {
          void connectVoiceSession();
        }}
      />
    </div>
  );

  return createPortal(modalContent, document.body);
}
