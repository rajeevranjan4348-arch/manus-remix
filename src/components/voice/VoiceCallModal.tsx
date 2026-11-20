import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  MessageSquare, 
  History, 
  SlidersHorizontal, 
  X, 
  Search, 
  Trash2, 
  RotateCcw, 
  Mic, 
  MicOff,
  Keyboard, 
  Sparkles,
  Volume2,
  ExternalLink,
  Zap
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { GrokAvatarStyle, GrokColorTheme } from './Grok3DAvatar';
import { VoicePulseOrb } from './VoicePulseOrb';
import { CobpChatInput } from './CobpChatInput';
import { HorizontalLoader } from '../common/HorizontalLoader';
import { blink } from '@/lib/blink';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';
import { matchVoiceCommand, executeOpenUrl, executeDeviceCommand } from '@/lib/voiceCommands';
import { extractWeatherQuery, fetchWeatherByCity } from '@/lib/weatherService';
import { requestMicrophonePermission } from '@/lib/permissionsManager';
import { getSettings, saveSettings } from '@/lib/settingsStore';
import { getFirebaseAuthorizationHeader } from '@/lib/firebaseAuthorization';
import { readVoiceResponse } from './voiceCallStream';
import './VoiceCallModal.css';

const LazyGrok3DAvatar = React.lazy(() =>
  import('./Grok3DAvatar').then((module) => ({ default: module.Grok3DAvatar })),
);

export interface VoiceMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  time: string;
}

export interface VoiceHistoryItem {
  id: string;
  text: string;
  time: string;
  date: string;
}

interface VoiceCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendMessageToChat?: (text: string) => void;
  initialContextMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

type VoiceCallStatus = 'connecting' | 'listening' | 'thinking' | 'searching' | 'speaking' | 'ready' | 'paused' | 'error';

const DEFAULT_VOICES = [
  { id: 'marcus', name: 'Marcus (Human Male)' },
  { id: 'onyx', name: 'Onyx (Deep Male)' },
  { id: 'echo', name: 'Echo (Smooth Male)' },
  { id: 'tintin', name: 'Tintin (Natural Male)' },
  { id: 'nova', name: 'Nova (Warm Female)' },
  { id: 'alloy', name: 'Alloy (Balanced)' },
  { id: 'shimmer', name: 'Shimmer (Energetic)' },
];

export function VoiceCallModal({ isOpen, onClose, onSendMessageToChat, initialContextMessages = [] }: VoiceCallModalProps) {
  // Call States
  const [callStatus, setCallStatus] = useState<VoiceCallStatus>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const messagesRef = useRef<VoiceMessage[]>(messages);
  messagesRef.current = messages;
  const [liveTranscript, setLiveTranscript] = useState('');
  const [statusText, setStatusText] = useState('Connecting to your voice session…');
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Drawers & Overlays
  const [activeOverlay, setActiveOverlay] = useState<'none' | 'transcript' | 'history' | 'settings' | 'info'>('none');
  const [historySearch, setHistorySearch] = useState('');
  const [showKeyboardInput, setShowKeyboardInput] = useState(false);
  // Voice sessions are persisted in the same task store used by normal chat history.
  const [voiceTaskId, setVoiceTaskId] = useState<string | null>(null);
  const voiceTaskIdRef = useRef<string | null>(null);

  // Settings State
  const [speechRate, setSpeechRate] = useState('1.0');
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return getSettings().voicePersona || 'marcus';
  });
  const [openingEnabled, setOpeningEnabled] = useState(true);
  const [voiceInterruptEnabled, setVoiceInterruptEnabled] = useState(true);
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);
  const [avatarStyle, setAvatarStyle] = useState<GrokAvatarStyle>(() => {
    return (localStorage.getItem('grok_avatar_style') as GrokAvatarStyle) || 'sphere';
  });
  const [colorTheme, setColorTheme] = useState<GrokColorTheme>(() => {
    return (localStorage.getItem('grok_color_theme') as GrokColorTheme) || 'obsidian-gold';
  });
  const [frameRateBoost, setFrameRateBoost] = useState<boolean>(() => {
    return getSettings().experimentalFrameRateBoost ?? true;
  });
  const contextMessagesRef = useRef(initialContextMessages);
  contextMessagesRef.current = initialContextMessages;
  const speechSettingsRef = useRef({ selectedVoice, speechRate });
  speechSettingsRef.current = { selectedVoice, speechRate };
  const [voiceHistory, setVoiceHistory] = useState<VoiceHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('manus_voice_history');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Speech Recognition & Synthesis references
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const isListeningRef = useRef(false);
  const isRecognitionStartingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const hasMicPermissionRef = useRef(false);
  const isCallPausedRef = useRef(false);
  const activeVoiceRequestIdRef = useRef(0);
  const activeVoiceAbortRef = useRef<AbortController | null>(null);
  const assistantSpeechTextRef = useRef('');
  const restartTimerRef = useRef<number | null>(null);

  // Maintain a single restart timer to prevent overlapping start/stop loops.
  const clearRecognitionRestart = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const startRecognitionSafely = () => {
    const recognition = recognitionRef.current;
    if (!recognition || !isOpen || !hasMicPermissionRef.current ||
        isCallPausedRef.current ||
        isListeningRef.current || isRecognitionStartingRef.current) return;
    clearRecognitionRestart();
    isRecognitionStartingRef.current = true;
    try {
      recognition.start();
    } catch (error) {
      isRecognitionStartingRef.current = false;
      console.warn('[Speech Recognition] Start deferred:', error);
    }
  };

  const scheduleRecognitionRestart = (delay = 500) => {
    clearRecognitionRestart();
    if (!isOpen || !hasMicPermissionRef.current || isCallPausedRef.current) return;
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      startRecognitionSafely();
    }, delay);
  };

  const abortAssistantSpeech = () => {
    activeVoiceRequestIdRef.current += 1;
    activeVoiceAbortRef.current?.abort();
    activeVoiceAbortRef.current = null;
    stopCleanSpeech();
    isSpeakingRef.current = false;
    assistantSpeechTextRef.current = '';
    setCallStatus('listening');
    setStatusText('Listening… speak now');
  };

  const isAssistantEcho = (candidate: string) => {
    const candidateWords = candidate.toLowerCase().match(/[a-z0-9']+/g) || [];
    const spokenWords = assistantSpeechTextRef.current.toLowerCase().match(/[a-z0-9']+/g) || [];
    if (candidateWords.length < 3 || candidateWords.length > spokenWords.length) return false;
    return spokenWords.some((_, start) =>
      candidateWords.every((word, index) => spokenWords[start + index] === word),
    );
  };

  // Live Audio Level Analysis for Sphere & Visual Feedback
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let micStream: MediaStream | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let animFrameId: number | null = null;

    if (isOpen && !isMuted && micPermissionGranted) {
      const startAudioAnalysis = async () => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) return;
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioCtx) return;

          audioCtx = new AudioCtx();
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          sourceNode = audioCtx.createMediaStreamSource(micStream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.75;
          sourceNode.connect(analyser);

          const dataArray = new Uint8Array(analyser.fftSize);

          let lastUiUpdate = 0;
          const updateLevel = (timestamp: number) => {
            if (!analyser) return;
            analyser.getByteTimeDomainData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const sample = (dataArray[i] - 128) / 128;
              sum += sample * sample;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const rawLevel = Math.min(1.0, rms * 3.2);

            if (timestamp - lastUiUpdate >= 72) {
              lastUiUpdate = timestamp;
              setAudioLevel(prev => {
                const target = rawLevel < 0.03 ? 0 : rawLevel;
                return prev + (target - prev) * (target > prev ? 0.45 : 0.18);
              });

            }

            animFrameId = requestAnimationFrame(updateLevel);
          };

          animFrameId = requestAnimationFrame(updateLevel);
        } catch (err) {
          console.warn('[Voice Call] Audio level monitor unavailable:', err);
        }
      };

      void startAudioAnalysis();
    } else {
      setAudioLevel(0);
    }

    return () => {
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        try { void audioCtx.close(); } catch {}
      }
    };
  }, [isOpen, isMuted, micPermissionGranted]);

  // Initialize Speech
  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = true;
          rec.maxAlternatives = 1;
          const settings = getSettings();
          const preferredLang = settings.voiceInputLanguage || 'auto';
          rec.lang = preferredLang === 'auto'
            ? (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-IN')
            : preferredLang;

          rec.onstart = () => {
            isRecognitionStartingRef.current = false;
            isListeningRef.current = true;
            if (!isSpeakingRef.current && !isCallPausedRef.current) {
              setCallStatus('listening');
              setStatusText('Listening… speak now');
            }
          };

          rec.onresult = (event: any) => {
            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                final += event.results[i][0].transcript;
              } else {
                interim += event.results[i][0].transcript;
              }
            }

            if (interim) {
              const assistantEcho = isSpeakingRef.current && isAssistantEcho(interim);
              if (!assistantEcho) {
                if (isSpeakingRef.current && voiceInterruptEnabled) abortAssistantSpeech();
                setLiveTranscript(interim);
                setStatusText(`“${interim}”`);
              }
            }

            if (final.trim()) {
              if (isSpeakingRef.current && isAssistantEcho(final)) return;
              if (isSpeakingRef.current && voiceInterruptEnabled) abortAssistantSpeech();
              handleUserSpoken(final.trim());
            }
          };

          rec.onerror = (e: any) => {
            const error = String(e?.error || 'unknown');
            console.warn('[Voice Recognition]', error);

            if (error === 'no-speech') {
              setStatusText('I didn’t hear speech. Please speak clearly and try again.');
              return;
            }

            if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') {
              hasMicPermissionRef.current = false;
              setMicPermissionGranted(false);
              isCallPausedRef.current = true;
              setIsMuted(true);
              setCallStatus('error');
              setStatusText(error === 'audio-capture'
                ? 'Microphone is unavailable. Check Android microphone access and try again.'
                : 'Speech recognition is blocked. Allow microphone access for this site and try again.');
              toast.error(error === 'audio-capture'
                ? 'The browser cannot capture audio. Check Android and Chrome microphone permissions.'
                : 'Speech recognition was blocked. Allow microphone access in Chrome site settings.');
              return;
            }

            if (error === 'network') {
              setCallStatus('error');
              setStatusText('Speech recognition needs a working internet connection.');
              toast.error('Speech recognition network error. Check your internet connection and try again.');
            } else {
              setStatusText('Speech recognition stopped. Please try speaking again.');
            }
          };

          rec.onend = () => {
            isListeningRef.current = false;
            isRecognitionStartingRef.current = false;
            // Keep the recognizer available during TTS for barge-in where the browser allows it.
            if (isCallPausedRef.current) return;
            scheduleRecognitionRestart(500);
          };

          recognitionRef.current = rec;
          if (isOpen && hasMicPermissionRef.current && !isCallPausedRef.current) {
            scheduleRecognitionRestart(100);
          }
        } catch (e) {
          console.warn('[Speech Recognition init failed]', e);
        }
      }
    }

    return () => {
      try {
        if (recognitionRef.current) recognitionRef.current.stop();
        if (synthRef.current) synthRef.current.cancel();
      } catch {}
    };
  }, [isOpen, voiceInterruptEnabled]);

  // When call starts, obtain permission from an explicit user action before
  // starting browser speech recognition. Stop the preflight stream immediately.
  useEffect(() => {
    let cancelled = false;

    if (isOpen) {
      isCallPausedRef.current = false;
      hasMicPermissionRef.current = false;
      setMicPermissionGranted(false);
      setIsMuted(false);
      setCallStatus('connecting');
      setStatusText('Requesting microphone access...');
      setLiveTranscript('');

      const startVoiceCall = async () => {
        const granted = await requestMicrophonePermission();
        if (cancelled || !isOpen) return;

        if (!granted) {
          setIsMuted(true);
          isCallPausedRef.current = true;
          setCallStatus('error');
          setStatusText('Allow microphone access to start voice chat');
          if (!window.isSecureContext) {
            toast.error('Microphone access requires HTTPS.');
          } else if (!navigator.mediaDevices?.getUserMedia) {
            toast.error('This browser or embedded preview does not support microphone access.');
          } else {
            toast.error('Microphone access is blocked in browser settings.');
          }
          return;
        }

        if (!recognitionRef.current) {
          setCallStatus('error');
          setIsMuted(true);
          isCallPausedRef.current = true;
          setStatusText('Voice recognition is not supported in this browser');
          toast.error('Voice recognition is not supported here. Please use an up-to-date Chrome or Edge browser over HTTPS.');
          return;
        }

        hasMicPermissionRef.current = true;
        setMicPermissionGranted(true);
        setCallStatus('ready');
        setStatusText('Ready when you are');

        if (openingEnabled) {
          startRecognitionSafely();
          void generateVoiceReply(
            'Open this voice conversation with a short, warm greeting and ask what the user would like help with.',
            [],
            true,
          );
        } else {
          startRecognitionSafely();
        }
      };

      void startVoiceCall();
    } else {
      hasMicPermissionRef.current = false;
      setMicPermissionGranted(false);
      isCallPausedRef.current = false;
      activeVoiceRequestIdRef.current += 1;
      activeVoiceAbortRef.current?.abort();
      activeVoiceAbortRef.current = null;
      isListeningRef.current = false;
      isRecognitionStartingRef.current = false;
      isSpeakingRef.current = false;
      clearRecognitionRestart();
      try {
        if (recognitionRef.current) recognitionRef.current.stop();
        if (synthRef.current) synthRef.current.cancel();
      } catch {}
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Save history to storage
  const saveHistory = (newHistory: VoiceHistoryItem[]) => {
    setVoiceHistory(newHistory);
    try {
      localStorage.setItem('manus_voice_history', JSON.stringify(newHistory));
    } catch {}
  };

  // Persist the complete voice transcript as a normal Manus chat/task.
  // This makes voice conversations appear in the same History panel as text chats.
  const persistVoiceConversation = async (conversation: VoiceMessage[], preferredTitle?: string) => {
    if (!conversation.length) return;

    const firstUser = conversation.find(m => m.sender === 'user');
    const title = (preferredTitle || firstUser?.text || 'Voice conversation').trim().slice(0, 160);
    const normalizedMessages = conversation.map(m => ({
      id: m.id,
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
      createdAt: m.time,
      source: 'voice',
    }));

    const resultPayload = {
      type: 'report',
      content: conversation.filter(m => m.sender === 'ai').map(m => m.text).join('\\n\\n') || 'Voice conversation',
      messages: normalizedMessages,
      voiceConversation: true,
      voiceMessages: conversation,
    };

    try {
      let id = voiceTaskIdRef.current;

      if (!id) {
        let activeUser = null;
        try {
          activeUser = await blink.auth.me();
        } catch {
          activeUser = null;
        }
        const task = await (blink.db as any).tasks.create({
          userId: activeUser?.id || 'usr_manus_default',
          prompt: title,
          outputFormat: 'report',
          chartType: 'auto',
          status: 'completed',
          result: JSON.stringify(resultPayload),
          steps: JSON.stringify([]),
        });
        id = task.id;
        voiceTaskIdRef.current = id;
        setVoiceTaskId(id);
      } else {
        await (blink.db as any).tasks.update(id, {
          prompt: title,
          status: 'completed',
          result: JSON.stringify(resultPayload),
        });
      }
    } catch (e) {
      console.warn('[Voice History] Failed to persist voice conversation:', e);
    }
  };

  // Handle User Speech
  const handleUserSpoken = (userText: string) => {
    const cleanText = userText.trim();
    if (!cleanText) return;

    if (activeVoiceAbortRef.current || isSpeakingRef.current) abortAssistantSpeech();

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: VoiceMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: cleanText,
      time,
    };
    const nextConversation = [...messagesRef.current, userMsg];
    messagesRef.current = nextConversation;
    setMessages(nextConversation);
    void persistVoiceConversation(nextConversation, cleanText);
    setLiveTranscript('');
    setStatusText('Thinking…');
    setCallStatus('thinking');

    const historyItem: VoiceHistoryItem = {
      id: Date.now().toString(),
      text: cleanText,
      time,
      date: 'Today',
    };
    setVoiceHistory(prev => {
      const next = [historyItem, ...prev.slice(0, 25)];
      try { localStorage.setItem('manus_voice_history', JSON.stringify(next)); } catch {}
      return next;
    });
    void generateVoiceReply(cleanText, nextConversation);
  };

  const appendAssistantMessage = (text: string) => {
    const aiMsg: VoiceMessage = {
      id: (Date.now() + 1).toString(),
      sender: 'ai',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const next = [...messagesRef.current, aiMsg];
    messagesRef.current = next;
    setMessages(next);
    void persistVoiceConversation(next);
    speakText(text);
  };

  // Use the same signed-in AI streaming route as text chat; every spoken answer
  // is model output or a real result from the existing command/weather tools.
  const generateVoiceReply = async (
    query: string,
    conversation: VoiceMessage[] = messagesRef.current,
    isSessionGreeting = false,
  ) => {
    if (!isSessionGreeting) {
      const cmd = matchVoiceCommand(query);
      if (cmd && cmd.matched) {
        try {
          if (cmd.action === 'open_url' || cmd.action === 'search') {
            if (cmd.url) executeOpenUrl(cmd.url);
          } else {
            await executeDeviceCommand(cmd);
          }
          const reply = cmd.feedbackSpeech;
          toast.success(`${cmd.targetName}: ${reply}`, {
            icon: <ExternalLink size={16} />,
            duration: 4000,
          });
          appendAssistantMessage(`${reply} ${cmd.url ? `(${cmd.url})` : ''}`);
          return;
        } catch (error) {
          console.warn('[Voice Call] Command failed:', error);
          setCallStatus('error');
          setStatusText('That device action could not be completed.');
          toast.error('The requested device action could not be completed.');
          return;
        }
      }

      const weatherCheck = extractWeatherQuery(query);
      if (weatherCheck.isWeather && weatherCheck.city) {
        setCallStatus('searching');
        setStatusText(`Checking the weather in ${weatherCheck.city}…`);
        try {
          const weather = await fetchWeatherByCity(weatherCheck.city);
          if (weather) {
            const reply = `Currently in ${weather.locationName}, it is ${weather.temperature} degrees Celsius with ${weather.condition.toLowerCase()}. Humidity is ${weather.humidity} percent and wind speed is ${weather.windSpeed} kilometers per hour.`;
            appendAssistantMessage(reply);
            return;
          }
        } catch (error) {
          console.warn('[Voice Call] Live weather lookup failed:', error);
        }
      }
    }

    const requestId = ++activeVoiceRequestIdRef.current;
    const controller = new AbortController();
    activeVoiceAbortRef.current = controller;
    assistantSpeechTextRef.current = '';
    setCallStatus('thinking');
    setStatusText(isSessionGreeting ? 'Preparing a welcome…' : 'Thinking…');

    let speechBuffer = '';
    let speechAvailable = true;
    let speechUnavailable = false;
    let streamComplete = false;

    const completePlayback = () => {
      if (requestId !== activeVoiceRequestIdRef.current || !streamComplete) return;
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
      if (synth?.speaking || synth?.pending) return;
      isSpeakingRef.current = false;
      assistantSpeechTextRef.current = '';
      if (!isOpen || isCallPausedRef.current) return;
      setCallStatus('listening');
      setStatusText('Listening… speak now');
      scheduleRecognitionRestart(250);
    };

    const queueSpeechChunk = (chunk: string) => {
      if (!speechAvailable || !chunk.trim()) return;
      const started = speakCleanHumanVoice(chunk.trim(), {
        queue: true,
        voicePersona: speechSettingsRef.current.selectedVoice,
        rate: parseFloat(speechSettingsRef.current.speechRate) || 1.0,
        volume: 1.0,
        onStart: () => {
          if (requestId !== activeVoiceRequestIdRef.current) return;
          isSpeakingRef.current = true;
          setCallStatus('speaking');
          setStatusText('Speaking…');
        },
        onEnd: completePlayback,
        onError: (error) => {
          if (requestId !== activeVoiceRequestIdRef.current) return;
          console.warn('[Voice Call] Streamed text-to-speech failed:', error);
          isSpeakingRef.current = false;
          setCallStatus('error');
          setStatusText('Audio playback failed. You can still read the reply.');
          toast.error('Could not play the AI audio reply. Check your media volume and try again.');
        },
      });
      if (!started) {
        speechAvailable = false;
        speechUnavailable = true;
      }
    };

    const consumeSpeechText = (delta: string, flush = false) => {
      speechBuffer += delta;
      let boundary = /[.!?](?:["')\]]+)?(?=\s|$)/.exec(speechBuffer);
      while (boundary) {
        const end = boundary.index + boundary[0].length;
        queueSpeechChunk(speechBuffer.slice(0, end));
        speechBuffer = speechBuffer.slice(end).trimStart();
        boundary = /[.!?](?:["')\]]+)?(?=\s|$)/.exec(speechBuffer);
      }
      while (speechBuffer.length > 190) {
        const splitAt = speechBuffer.lastIndexOf(' ', 180);
        if (splitAt < 80) break;
        queueSpeechChunk(speechBuffer.slice(0, splitAt));
        speechBuffer = speechBuffer.slice(splitAt).trimStart();
      }
      if (flush && speechBuffer.trim()) {
        queueSpeechChunk(speechBuffer);
        speechBuffer = '';
      }
    };

    try {
      const authorization = await getFirebaseAuthorizationHeader();
      if (!authorization) throw new Error('Please sign in to use voice AI.');

      const contextMessages = contextMessagesRef.current
        .filter(message => (message.role === 'user' || message.role === 'assistant') && message.content?.trim())
        .slice(-12);
      const requestMessages = [
        ...contextMessages,
        ...conversation.slice(-8).map(message => ({
          role: message.sender === 'user' ? 'user' as const : 'assistant' as const,
          content: message.text,
        })),
      ];
      const latestVoiceMessage = conversation[conversation.length - 1];
      if (latestVoiceMessage?.sender !== 'user' || latestVoiceMessage.text !== query) {
        requestMessages.push({ role: 'user', content: query });
      }
      const response = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        signal: controller.signal,
        body: JSON.stringify({
          requestId: `voice_${Date.now()}_${requestId}`,
          messages: requestMessages,
          prompt: query,
          model: 'gemini-3.8-flash',
          systemInstruction: 'You are an AI assistant in voice-call mode. Give a concise, warm, natural, helpful spoken answer in 2 to 4 sentences. Avoid markdown lists, code blocks, and unsupported claims.',
        }),
      });

      const fullReply = await readVoiceResponse(response, {
        onTextDelta: (delta, fullText) => {
          if (requestId !== activeVoiceRequestIdRef.current) return;
          assistantSpeechTextRef.current = fullText;
          if (!isSpeakingRef.current) {
            setCallStatus('thinking');
            setStatusText('Thinking…');
          }
          consumeSpeechText(delta);
        },
        onResearchStage: () => {
          if (requestId !== activeVoiceRequestIdRef.current) return;
          setCallStatus('searching');
          setStatusText('Searching…');
        },
      });
      if (requestId !== activeVoiceRequestIdRef.current) return;

      const aiMsg: VoiceMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: fullReply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      const nextConversation = [...messagesRef.current, aiMsg];
      messagesRef.current = nextConversation;
      setMessages(nextConversation);
      void persistVoiceConversation(nextConversation);

      assistantSpeechTextRef.current = fullReply;
      consumeSpeechText('', true);
      streamComplete = true;
      activeVoiceAbortRef.current = null;
      if (speechUnavailable) {
        setCallStatus('listening');
        setStatusText('AI reply ready. Speech playback is unavailable in this browser.');
        toast.error('The AI reply is ready as text, but this browser cannot play speech audio.');
        isSpeakingRef.current = false;
      } else {
        completePlayback();
      }
    } catch (error: any) {
      if (controller.signal.aborted || requestId !== activeVoiceRequestIdRef.current) return;
      console.warn('[Voice Call] AI response failed:', error);
      stopCleanSpeech();
      isSpeakingRef.current = false;
      activeVoiceAbortRef.current = null;
      const message = error?.message || 'The AI service could not complete the response.';
      setCallStatus('error');
      setStatusText(message);
      toast.error(message);
    } finally {
      if (requestId === activeVoiceRequestIdRef.current && activeVoiceAbortRef.current === controller) {
        activeVoiceAbortRef.current = null;
      }
    }
  };

  // Speak deterministic results (for example, a completed device action or live weather lookup).
  const speakText = (text: string) => {
    const cleanedText = text?.trim();
    if (!cleanedText) return;

    activeVoiceAbortRef.current?.abort();
    activeVoiceAbortRef.current = null;
    activeVoiceRequestIdRef.current += 1;
    assistantSpeechTextRef.current = cleanedText;
    isSpeakingRef.current = true;
    setCallStatus('speaking');
    setStatusText('Preparing audio reply…');
    stopCleanSpeech();

    const resumeListening = () => {
      isSpeakingRef.current = false;
      assistantSpeechTextRef.current = '';
      if (!isOpen || !hasMicPermissionRef.current || isCallPausedRef.current) return;
      setCallStatus('listening');
      setStatusText('Listening… speak now');
      scheduleRecognitionRestart(250);
    };

    const started = speakCleanHumanVoice(cleanedText, {
      voicePersona: speechSettingsRef.current.selectedVoice,
      rate: parseFloat(speechSettingsRef.current.speechRate) || 1.0,
      volume: 1.0,
      onStart: () => {
        setCallStatus('speaking');
        setStatusText('Speaking…');
      },
      onEnd: resumeListening,
      onError: (error) => {
        console.warn('[Voice Call] Text-to-speech failed:', error);
        resumeListening();
        toast.error('Could not play the AI audio reply. Check your phone media volume and try again.');
      },
    });

    if (!started) {
      resumeListening();
      toast.error('Speech audio is unavailable in this browser.');
    }
  };

  const toggleMicrophone = async () => {
    if (!isMuted) {
      setIsMuted(true);
      isCallPausedRef.current = true;
      clearRecognitionRestart();
      activeVoiceAbortRef.current?.abort();
      activeVoiceAbortRef.current = null;
      activeVoiceRequestIdRef.current += 1;
      isSpeakingRef.current = false;
      assistantSpeechTextRef.current = '';
      stopCleanSpeech();
      try { recognitionRef.current?.stop(); } catch {}
      setCallStatus('paused');
      setStatusText('Microphone muted');
      setAudioLevel(0);
      toast.info('Microphone muted');
      return;
    }

    setIsMuted(false);
    isCallPausedRef.current = false;
    if (!hasMicPermissionRef.current) {
      setCallStatus('connecting');
      setStatusText('Requesting microphone access…');
      const granted = await requestMicrophonePermission();
      if (!granted) {
        setIsMuted(true);
        setMicPermissionGranted(false);
        isCallPausedRef.current = true;
        setCallStatus('error');
        setStatusText('Microphone access is blocked or unavailable. Check your browser permissions.');
        toast.error('Microphone access is required for voice conversation.');
        return;
      }
      hasMicPermissionRef.current = true;
      setMicPermissionGranted(true);
    }
    if (!recognitionRef.current) {
      setIsMuted(true);
      setMicPermissionGranted(false);
      hasMicPermissionRef.current = false;
      isCallPausedRef.current = true;
      setCallStatus('error');
      setStatusText('Voice recognition is not supported in this browser.');
      toast.error('Use a browser that supports speech recognition, or send a text message instead.');
      return;
    }
    setCallStatus('ready');
    setStatusText('Ready when you are');
    startRecognitionSafely();
    toast.info('Microphone unmuted');
  };

  const handleCloseChat = async () => {
    clearRecognitionRestart();
    activeVoiceRequestIdRef.current += 1;
    activeVoiceAbortRef.current?.abort();
    activeVoiceAbortRef.current = null;
    isSpeakingRef.current = false;
    stopCleanSpeech();
    try { recognitionRef.current?.stop(); } catch {}
    if (messagesRef.current.length) {
      await persistVoiceConversation(messagesRef.current);
      toast.success('Voice conversation saved to chat history');
    }
    onClose();
  };

  // Re-send from History
  const handleResendHistory = (item: VoiceHistoryItem) => {
    handleUserSpoken(item.text);
    setActiveOverlay('none');
    toast.success(`Resent: "${item.text}"`);
  };

  // Filtered History
  const filteredHistory = voiceHistory.filter(h => 
    h.text.toLowerCase().includes(historySearch.toLowerCase())
  );

  const statusLabel: Record<VoiceCallStatus, string> = {
    connecting: 'Connecting…',
    ready: 'Ready',
    listening: 'Listening…',
    thinking: 'Thinking…',
    searching: 'Searching…',
    speaking: 'Speaking…',
    paused: 'Microphone muted',
    error: 'Needs attention',
  };
  const visualCallStatus = callStatus === 'speaking'
    ? 'speaking'
    : callStatus === 'thinking' || callStatus === 'searching'
      ? 'thinking'
      : callStatus === 'paused' || callStatus === 'error'
        ? 'paused'
        : 'listening';

  if (!isOpen) return null;

  const modalContent = (
    <div className="voice-call-shell fixed inset-0 z-[100] h-screen h-[100dvh] min-h-0 w-full overflow-hidden bg-[#050505] text-white flex flex-col select-none font-sans animate-in fade-in duration-200 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <header className="relative z-20 h-14 sm:h-16 px-3 sm:px-6 flex items-center justify-between shrink-0 w-full">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleCloseChat}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-full border border-white/10 bg-white/[0.045] text-white/80 hover:bg-white/10 hover:text-white transition-colors cursor-pointer shrink-0"
            aria-label="Close chat"
          >
            <X size={15} />
            <span className="text-xs font-medium">Close chat</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveOverlay(activeOverlay === 'history' ? 'none' : 'history')}
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center border border-white/10 transition-colors cursor-pointer shrink-0 relative',
              activeOverlay === 'history' ? 'bg-white/15 text-white' : 'bg-white/[0.035] text-white/70 hover:bg-white/10',
            )}
            title="Voice history"
            aria-label="Voice history"
          >
            <History size={16} />
            {voiceHistory.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-black text-[9px] font-bold flex items-center justify-center">
                {voiceHistory.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveOverlay(activeOverlay === 'transcript' ? 'none' : 'transcript')}
            className={cn(
              'hidden sm:flex w-9 h-9 rounded-full items-center justify-center border border-white/10 transition-colors cursor-pointer shrink-0',
              activeOverlay === 'transcript' ? 'bg-white/15 text-white' : 'bg-white/[0.035] text-white/70 hover:bg-white/10',
            )}
            title="Call transcript"
            aria-label="Call transcript"
          >
            <MessageSquare size={16} />
          </button>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center justify-center min-w-0 text-center pointer-events-none">
          <h2 className="text-[13px] sm:text-sm font-semibold tracking-wide text-white">AI Voice</h2>
          <div className="flex items-center gap-1.5 text-[10px] text-white/55">
            <span className={cn(
              'w-1.5 h-1.5 rounded-full',
              callStatus === 'error' ? 'bg-red-400' : callStatus === 'connecting' ? 'bg-amber-300 animate-pulse' : callStatus === 'paused' ? 'bg-white/35' : 'bg-emerald-400',
            )} />
            <span>{statusLabel[callStatus]}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setActiveOverlay(activeOverlay === 'settings' ? 'none' : 'settings')}
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center border border-white/10 transition-colors cursor-pointer shrink-0',
            activeOverlay === 'settings' ? 'bg-white/15 text-white' : 'bg-white/[0.035] text-white/70 hover:bg-white/10',
          )}
          title="Voice settings"
          aria-label="Voice settings"
        >
          <SlidersHorizontal size={16} />
        </button>
      </header>

      {activeOverlay !== 'none' && (
        <div
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px] transition-opacity duration-200"
          onClick={() => setActiveOverlay('none')}
          aria-hidden="true"
        />
      )}

      <main className="relative z-10 flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-y-auto overscroll-contain px-4 py-2 sm:px-6">
        <div className="relative flex items-center justify-center shrink-0 max-w-full my-auto">
          {avatarStyle === 'sphere' ? (
            <VoicePulseOrb callStatus={callStatus} audioLevel={audioLevel} />
          ) : (
            <React.Suspense fallback={<VoicePulseOrb callStatus={callStatus} audioLevel={audioLevel} />}>
              <LazyGrok3DAvatar
                callStatus={visualCallStatus}
                audioLevel={audioLevel}
                liveTranscript={liveTranscript}
                initialStyle={avatarStyle}
                initialColor={colorTheme}
                experimentalFrameRateBoost={frameRateBoost}
                onStyleChange={(style) => {
                  setAvatarStyle(style);
                  localStorage.setItem('grok_avatar_style', style);
                }}
                onColorChange={(color) => {
                  setColorTheme(color);
                  localStorage.setItem('grok_color_theme', color);
                }}
              />
            </React.Suspense>
          )}
        </div>

        <div className="relative z-10 text-center space-y-2 mt-1 sm:mt-2 max-w-md w-full px-2 shrink-0">
          <p className={cn(
            'text-base sm:text-lg md:text-xl font-medium tracking-tight line-clamp-2 min-h-6',
            callStatus === 'error' ? 'text-red-200' : liveTranscript ? 'text-white' : 'text-white/90',
          )} aria-live="polite">
            {liveTranscript ? `“${liveTranscript}”` : statusText}
          </p>
          {(callStatus === 'thinking' || callStatus === 'searching') ? (
            <div className="flex justify-center pt-1">
              <HorizontalLoader label={callStatus === 'searching' ? 'Searching' : 'Thinking'} />
            </div>
          ) : (
            <p className="text-[10px] text-white/40 tracking-[.18em] uppercase font-medium">
              {liveTranscript ? 'Live transcription' : statusLabel[callStatus]}
            </p>
          )}
        </div>

        {showKeyboardInput && keyboardEnabled && (
          <div className="relative z-10 w-full max-w-md mt-4 shrink-0">
            <CobpChatInput
              onSubmit={(text) => handleUserSpoken(text)}
              placeholder="Type a message…"
            />
          </div>
        )}
      </main>

      <footer className="voice-call-controls relative z-20 shrink-0 w-full pt-4 pb-4 sm:pb-7 px-4 flex flex-col items-center gap-3">
        <div className="flex items-center justify-center gap-8 sm:gap-12">
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveOverlay(activeOverlay === 'info' ? 'none' : 'info')}
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center border border-white/12 bg-white/[.045] text-white/75 hover:bg-white/10 hover:text-white transition-colors cursor-pointer',
                activeOverlay === 'info' && 'bg-white/15 text-white',
              )}
              aria-label="Voice call information"
            >
              <span className="text-sm font-semibold">i</span>
            </button>
            <span className="text-[10px] text-white/50 font-medium">Info</span>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={toggleMicrophone}
              aria-pressed={isMuted}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              className={cn(
                'voice-call-mic-button w-[68px] h-[68px] sm:w-[74px] sm:h-[74px] rounded-full flex items-center justify-center transition-all active:scale-95 cursor-pointer border',
                isMuted
                  ? 'border-white/15 bg-[#24201e] text-white/80'
                  : 'border-orange-200/30 bg-gradient-to-br from-[#ffac4a] via-[#f46c2c] to-[#c72e24] text-white',
              )}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <span className="text-[10px] text-white/65 font-medium">{isMuted ? 'Unmute' : 'Microphone'}</span>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (keyboardEnabled) setShowKeyboardInput(open => !open);
                else setActiveOverlay(activeOverlay === 'transcript' ? 'none' : 'transcript');
              }}
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center border border-white/12 bg-white/[.045] text-white/75 hover:bg-white/10 hover:text-white transition-colors cursor-pointer',
                showKeyboardInput && 'bg-white/15 text-white',
              )}
              aria-label={showKeyboardInput ? 'Hide message input' : 'Send a text message'}
            >
              {showKeyboardInput ? <Keyboard size={18} /> : <MessageSquare size={18} />}
            </button>
            <span className="text-[10px] text-white/50 font-medium">{showKeyboardInput ? 'Hide' : 'Message'}</span>
          </div>
        </div>
        <p className="text-[10px] text-white/30 tracking-wide">You can mute or switch to text at any time</p>
      </footer>

      {activeOverlay === 'info' && (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-info-title"
          className="fixed z-50 left-4 right-4 top-1/2 -translate-y-1/2 mx-auto max-w-sm rounded-3xl border border-white/10 bg-[#15100e] p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 id="voice-info-title" className="text-sm font-semibold text-white">About voice chat</h3>
            <button
              type="button"
              onClick={() => setActiveOverlay('none')}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white"
              aria-label="Close voice information"
            >
              <X size={17} />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-white/70">Speak naturally to get a live transcription. Replies come from the signed-in AI chat service and can be spoken aloud with your device’s speech engine.</p>
          <p className="text-xs leading-relaxed text-white/55 mt-3">When opened from a text conversation, recent messages are included as context. Mute the microphone whenever you like, or use the transcript panel to transfer this call back to text chat.</p>
          <button
            type="button"
            onClick={() => setActiveOverlay('none')}
            className="mt-4 w-full rounded-xl bg-white text-black py-2.5 text-xs font-semibold hover:bg-white/90 transition-colors"
          >
            Got it
          </button>
        </section>
      )}

      {/* OVERLAY 1: Live Call Transcript Drawer */}
      {activeOverlay === 'transcript' && (
        <div className="fixed inset-y-0 left-0 w-full sm:w-96 bg-[#121316] border-r border-white/10 z-50 flex flex-col shadow-2xl animate-in slide-in-from-left duration-300 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center shrink-0">
                <MessageSquare size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-white truncate">Live Call Transcript</h3>
                <p className="text-[11px] text-white/40 truncate">{messages.length} messages in call</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveOverlay('none')}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors shrink-0"
              aria-label="Close transcript"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4 min-h-0">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "p-3.5 rounded-2xl border transition-all",
                  msg.sender === 'ai'
                    ? "bg-white/5 border-white/10 text-white"
                    : "bg-white/10 border-white/20 text-white ml-4"
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-xs text-white/80">
                    {msg.sender === 'ai' ? 'AI assistant' : 'You'}
                  </span>
                  <span className="text-[10px] text-white/40">{msg.time}</span>
                </div>
                <p className="text-sm leading-relaxed text-white/90">{msg.text}</p>
              </div>
            ))}
          </div>

          {onSendMessageToChat && messages.length > 1 && (
            <div className="p-3 border-t border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const summary = messages.map(m => `${m.sender.toUpperCase()}: ${m.text}`).join('\n');
                  onSendMessageToChat(summary);
                  onClose();
                  toast.success('Transcript copied to chat');
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-white/90 text-black text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <MessageSquare size={14} />
                <span>Transfer Transcript to Chat</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* OVERLAY 2: Voice History Drawer */}
      {activeOverlay === 'history' && (
        <div className="fixed inset-y-0 left-0 w-full sm:w-96 bg-[#121316] border-r border-white/10 z-50 flex flex-col shadow-2xl animate-in slide-in-from-left duration-300 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-black border border-white/10 text-white flex items-center justify-center shrink-0">
                <History size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-white truncate">Voice History</h3>
                <p className="text-[11px] text-white/40 truncate">{voiceHistory.length} saved transcriptions</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  saveHistory([]);
                  toast.info('Voice history cleared');
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-red-400 transition-colors"
                title="Clear History"
                aria-label="Clear History"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                onClick={() => setActiveOverlay('none')}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                aria-label="Close history"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="p-4 pb-2 shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl">
              <Search size={14} className="text-white/40 shrink-0" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search past transcriptions..."
                className="bg-transparent border-none text-xs text-white placeholder:text-white/30 focus:outline-none w-full"
              />
            </div>
          </div>

          {/* Past Voice Items List */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3 min-h-0">
            {filteredHistory.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all space-y-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-black border border-white/10 text-white flex items-center justify-center shrink-0 mt-0.5">
                    <Mic size={14} />
                  </div>
                  <p className="text-sm font-medium text-white leading-snug">
                    "{item.text}"
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-white/40">{item.time}</span>
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-medium text-white/70">
                      In Chat
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleResendHistory(item)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black hover:bg-neutral-900 border border-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>Re-send</span>
                  </button>
                </div>
              </div>
            ))}

            {filteredHistory.length === 0 && (
              <div className="text-center py-12 text-white/30 text-xs">
                No past transcriptions found
              </div>
            )}
          </div>
        </div>
      )}

      {/* OVERLAY 3: Call Settings Popover */}
      {activeOverlay === 'settings' && (
        <div className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] sm:top-[calc(4rem+env(safe-area-inset-top))] right-3 sm:right-6 w-[min(20rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain bg-[#16171B] border border-white/10 rounded-3xl p-4 sm:p-5 z-50 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
            <div>
              <h3 className="font-bold text-sm text-white">Call Settings</h3>
              <p className="text-[11px] text-white/40">AI voice configuration</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveOverlay('none')}
              className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              aria-label="Close settings"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4 pt-4">
            {/* Speech rate */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
                <Volume2 size={16} className="text-white/60" />
                <span>Speech rate</span>
              </div>
              <Select value={speechRate} onValueChange={setSpeechRate}>
                <SelectTrigger className="w-24 h-8 bg-white/5 border-white/10 text-xs text-white rounded-xl">
                  <SelectValue placeholder="1.0x" />
                </SelectTrigger>
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white z-[150]">
                  <SelectItem value="0.8">0.8x</SelectItem>
                  <SelectItem value="1.0">1.0x</SelectItem>
                  <SelectItem value="1.2">1.2x</SelectItem>
                  <SelectItem value="1.5">1.5x</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Voice playback */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
                <Mic size={16} className="text-white/60" />
                <span>Voice playback</span>
              </div>
              <Select 
                value={selectedVoice} 
                onValueChange={(val) => {
                  setSelectedVoice(val);
                  saveSettings({ voicePersona: val as any });
                  const vName = DEFAULT_VOICES.find(v => v.id === val)?.name || val;
                  speakCleanHumanVoice(`Voice changed to ${vName}.`, {
                    voicePersona: val,
                    rate: parseFloat(speechRate) || 1.0,
                    volume: 1.0,
                  });
                }}
              >
                <SelectTrigger className="w-36 h-8 bg-white/5 border-white/10 text-xs text-white rounded-xl">
                  <SelectValue placeholder="Marcus" />
                </SelectTrigger>
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white z-[150]">
                  {DEFAULT_VOICES.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 3D Avatar Model */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
                <Sparkles size={16} className="text-white/60" />
                <span>3D Avatar Style</span>
              </div>
              <Select 
                value={avatarStyle} 
                onValueChange={(val: GrokAvatarStyle) => {
                  setAvatarStyle(val);
                  localStorage.setItem('grok_avatar_style', val);
                }}
              >
                <SelectTrigger className="w-32 h-8 bg-white/5 border-white/10 text-xs text-white rounded-xl">
                  <SelectValue placeholder="Orbit Sphere" />
                </SelectTrigger>
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white z-[150]">
                  <SelectItem value="sphere">Orbit Sphere</SelectItem>
                  <SelectItem value="geometric">Obsidian Core</SelectItem>
                  <SelectItem value="bot">Cyber Bot</SelectItem>
                  <SelectItem value="hologram">Holo Matrix</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 3D Avatar Aura Color */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
                <span className="w-4 h-4 rounded-full bg-gradient-to-br from-[#ffac4a] to-[#c72e24] inline-block border border-white/40 shadow-xs" />
                <span>Aura Color</span>
              </div>
              <Select 
                value={colorTheme} 
                onValueChange={(val: GrokColorTheme) => {
                  setColorTheme(val);
                  localStorage.setItem('grok_color_theme', val);
                }}
              >
                <SelectTrigger className="w-32 h-8 bg-white/5 border-white/10 text-xs text-white rounded-xl">
                  <SelectValue placeholder="Amber Obsidian" />
                </SelectTrigger>
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white z-[150]">
                  <SelectItem value="electric-blue">Electric Blue</SelectItem>
                  <SelectItem value="cyber-cyan">Cyber Cyan</SelectItem>
                  <SelectItem value="neon-purple">Neon Violet</SelectItem>
                  <SelectItem value="obsidian-gold">Amber Obsidian</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Optional device-dependent rendering enhancement */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Zap size={14} className="text-amber-400 fill-amber-400/30" />
                  Enhanced animation mode
                </span>
                <p className="text-[10px] text-white/50">Optional WebGL optimization; frame rate varies by device</p>
              </div>
              <Switch
                checked={frameRateBoost}
                onCheckedChange={(checked) => {
                  setFrameRateBoost(checked);
                  saveSettings({ experimentalFrameRateBoost: checked });
                  if (checked) {
                    toast.success('Enhanced animation mode enabled');
                  } else {
                    toast.info('Enhanced animation mode disabled');
                  }
                }}
              />
            </div>

            {/* Toggles */}
            <div className="pt-2 space-y-3.5 border-t border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/80">Opening</span>
                <Switch checked={openingEnabled} onCheckedChange={setOpeningEnabled} />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/80">Voice Interrupt</span>
                <Switch checked={voiceInterruptEnabled} onCheckedChange={setVoiceInterruptEnabled} />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/80">Dark mode</span>
                <Switch checked={true} disabled />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/80">Keyboard input</span>
                <Switch checked={keyboardEnabled} onCheckedChange={setKeyboardEnabled} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
