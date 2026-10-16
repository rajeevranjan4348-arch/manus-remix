import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  PhoneCall, 
  PhoneOff, 
  Pause, 
  Play, 
  MessageSquare, 
  History, 
  SlidersHorizontal, 
  X, 
  Search, 
  Trash2, 
  RotateCcw, 
  Mic, 
  Keyboard, 
  Send, 
  Check, 
  Sparkles,
  Volume2,
  ExternalLink
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Grok3DAvatar, GrokAvatarStyle, GrokColorTheme } from './Grok3DAvatar';
import { VoicePulseOrb } from './VoicePulseOrb';
import { CobpChatInput } from './CobpChatInput';
import { HorizontalLoader } from '../common/HorizontalLoader';
import { blink } from '@/lib/blink';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';
import { matchVoiceCommand, executeOpenUrl, executeDeviceCommand } from '@/lib/voiceCommands';
import { extractWeatherQuery, fetchWeatherByCity } from '@/lib/weatherService';
import { requestMicrophonePermission } from '@/lib/permissionsManager';
import { getSettings, saveSettings } from '@/lib/settingsStore';
import { MicrophonePermissionModal } from './MicrophonePermissionModal';

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
}

const DEFAULT_VOICES = [
  { id: 'marcus', name: 'Marcus (Human Male)' },
  { id: 'onyx', name: 'Onyx (Deep Male)' },
  { id: 'echo', name: 'Echo (Smooth Male)' },
  { id: 'tintin', name: 'Tintin (Natural Male)' },
  { id: 'nova', name: 'Nova (Warm Female)' },
  { id: 'alloy', name: 'Alloy (Balanced)' },
  { id: 'shimmer', name: 'Shimmer (Energetic)' },
];

export function VoiceCallModal({ isOpen, onClose, onSendMessageToChat }: VoiceCallModalProps) {
  // Call States
  const [callStatus, setCallStatus] = useState<'listening' | 'speaking' | 'thinking' | 'paused'>('listening');
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<VoiceMessage[]>([
    {
      id: '1',
      sender: 'ai',
      text: 'Good to hear your voice! How can I help you today?',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [statusText, setStatusText] = useState('Start speaking...');
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Drawers & Overlays
  const [activeOverlay, setActiveOverlay] = useState<'none' | 'transcript' | 'history' | 'settings'>('none');
  const [historySearch, setHistorySearch] = useState('');
  const [showKeyboardInput, setShowKeyboardInput] = useState(false);
  const [textInput, setTextInput] = useState('');
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
    return (localStorage.getItem('grok_color_theme') as GrokColorTheme) || 'electric-blue';
  });
  const [voiceHistory, setVoiceHistory] = useState<VoiceHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('manus_voice_history');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      { id: 'h1', text: 'What is the words', time: '05:33 PM', date: 'Today' },
      { id: 'h2', text: 'Hi', time: '05:32 PM', date: 'Today' },
      { id: 'h3', text: 'Can you analyze quarterly trends?', time: '03:12 PM', date: 'Today' },
      { id: 'h4', text: 'Hello', time: '02:43 PM', date: 'Today' },
    ];
  });

  // Speech Recognition & Synthesis references
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const isListeningRef = useRef(false);
  const isRecognitionStartingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const hasMicPermissionRef = useRef(false);
  const isCallPausedRef = useRef(false);
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
        isCallPausedRef.current || isSpeakingRef.current ||
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
    if (!isOpen || !hasMicPermissionRef.current || isCallPausedRef.current || isSpeakingRef.current) return;
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      startRecognitionSafely();
    }, delay);
  };

  // Live Audio Level Analysis for Sphere & Visual Feedback
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let micStream: MediaStream | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let animFrameId: number | null = null;

    if (isOpen) {
      const startAudioAnalysis = async () => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) return;
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateLevel = () => {
            if (!analyser) return;
            analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            // Scale average volume (0-255) to range 0.0 - 1.0 with responsive curve
            const rawLevel = Math.min(1.0, (average / 110) * 1.4);

            setAudioLevel(prev => {
              const target = rawLevel < 0.03 ? 0 : rawLevel;
              // Smooth attack and decay
              return prev + (target - prev) * (target > prev ? 0.45 : 0.18);
            });

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
  }, [isOpen]);

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
            setCallStatus('listening');
            setStatusText('Listening… speak now');
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
              setLiveTranscript(interim);
              setStatusText(`"${interim}"`);
              // Voice Interrupt if AI is speaking
              if (voiceInterruptEnabled && synthRef.current?.speaking) {
                synthRef.current.cancel();
                setCallStatus('listening');
              }
            }

            if (final.trim()) {
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
              isCallPausedRef.current = true;
              setCallStatus('paused');
              setStatusText(error === 'audio-capture'
                ? 'Microphone is unavailable. Check Android microphone access and try again.'
                : 'Speech recognition is blocked. Allow microphone access for this site and try again.');
              toast.error(error === 'audio-capture'
                ? 'The browser cannot capture audio. Check Android and Chrome microphone permissions.'
                : 'Speech recognition was blocked. Allow microphone access in Chrome site settings.');
              return;
            }

            if (error === 'network') {
              setStatusText('Speech recognition needs a working internet connection.');
              toast.error('Speech recognition network error. Check your internet connection and try again.');
            } else {
              setStatusText('Speech recognition stopped. Please try speaking again.');
            }
          };

          rec.onend = () => {
            isListeningRef.current = false;
            isRecognitionStartingRef.current = false;
            // TTS playback resumes recognition itself; do not race it here.
            if (isSpeakingRef.current || isCallPausedRef.current) return;
            scheduleRecognitionRestart(500);
          };

          recognitionRef.current = rec;
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
      setCallStatus('listening');
      setStatusText('Requesting microphone access...');
      setLiveTranscript('');

      const startVoiceCall = async () => {
        const granted = await requestMicrophonePermission();
        if (cancelled || !isOpen) return;

        if (!granted) {
          setCallStatus('paused');
          isCallPausedRef.current = true;
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
          setCallStatus('paused');
          isCallPausedRef.current = true;
          setStatusText('Voice recognition is not supported in this browser');
          toast.error('Voice recognition is not supported here. Please use an up-to-date Chrome or Edge browser over HTTPS.');
          return;
        }

        hasMicPermissionRef.current = true;
        setStatusText('Start speaking...');

        // Play the greeting before opening recognition; the browser may silence
        // speech synthesis if recognition grabs the audio session first.
        if (openingEnabled) {
          speakText('Good to hear your voice! How are you?');
        } else {
          startRecognitionSafely();
        }
      };

      void startVoiceCall();
    } else {
      hasMicPermissionRef.current = false;
      isCallPausedRef.current = false;
      isListeningRef.current = false;
      isRecognitionStartingRef.current = false;
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
    if (!userText.trim()) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: VoiceMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: userText,
      time
    };

    setMessages(prev => {
      const next = [...prev, userMsg];
      void persistVoiceConversation(next, userText);
      return next;
    });
    setLiveTranscript('');
    setStatusText('Thinking...');
    setCallStatus('thinking');

    // Add to Voice History
    const historyItem: VoiceHistoryItem = {
      id: Date.now().toString(),
      text: userText,
      time,
      date: 'Today'
    };
    saveHistory([historyItem, ...voiceHistory.slice(0, 25)]);

    // Generate intelligent AI Voice Reply
    setTimeout(() => {
      generateVoiceReply(userText);
    }, 600);
  };

  // Generate Conversational Reply
  const generateVoiceReply = async (query: string) => {
    // 1. Check for voice/phone command (e.g. "open youtube", "call 123", "vibrate", "check battery")
    const cmd = matchVoiceCommand(query);
    if (cmd && cmd.matched) {
      if (cmd.action === 'open_url' || cmd.action === 'search') {
        if (cmd.url) executeOpenUrl(cmd.url);
      } else {
        await executeDeviceCommand(cmd);
      }

      const reply = cmd.feedbackSpeech;
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      toast.success(`${cmd.targetName}: ${reply}`, {
        icon: <ExternalLink size={16} />,
        duration: 4000,
      });

      const aiMsg: VoiceMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: `${reply} ${cmd.url ? `(${cmd.url})` : ''}`,
        time,
      };

      setMessages(prev => {
        const next = [...prev, aiMsg];
        void persistVoiceConversation(next);
        return next;
      });

      speakText(reply);
      return;
    }

    // 2. Check for live weather query
    const weatherCheck = extractWeatherQuery(query);
    if (weatherCheck.isWeather && weatherCheck.city) {
      setStatusText(`Checking weather in ${weatherCheck.city}...`);
      const wData = await fetchWeatherByCity(weatherCheck.city);
      if (wData) {
        const reply = `Currently in ${wData.locationName}, it's ${wData.temperature} degrees Celsius with ${wData.condition.toLowerCase()}. Humidity is ${wData.humidity} percent and wind speed is ${wData.windSpeed} kilometers per hour.`;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const aiMsg: VoiceMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: reply,
          time,
        };
        setMessages(prev => {
          const next = [...prev, aiMsg];
          void persistVoiceConversation(next);
          return next;
        });
        speakText(reply);
        return;
      }
    }

    // 3. Query Gemini for authentic, intelligent conversational response
    setStatusText('Gemini is responding...');
    try {
      const response = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...messages.slice(-4).map(m => ({
              role: m.sender === 'user' ? 'user' : 'assistant',
              content: m.text,
            })),
            { role: 'user', content: query }
          ],
          prompt: query,
          systemInstruction: 'You are Manus in Voice Call mode. Give a concise, warm, natural, and helpful spoken answer in 2 to 4 sentences without code blocks or markdown lists.',
        }),
      });

      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullReply = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') break;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type === 'text-delta' && parsed.delta) {
                  fullReply += parsed.delta;
                }
              } catch {}
            }
          }
        }

        if (fullReply.trim()) {
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const aiMsg: VoiceMessage = {
            id: (Date.now() + 1).toString(),
            sender: 'ai',
            text: fullReply.trim(),
            time,
          };
          setMessages(prev => {
            const next = [...prev, aiMsg];
            void persistVoiceConversation(next);
            return next;
          });
          speakText(fullReply.trim());
          return;
        }
      }
    } catch (err) {
      console.warn('[Voice Call] Gemini stream fallback:', err);
    }

    // 4. Fallback intelligent response if stream was unreachable
    const q = query.toLowerCase();
    let reply = "I'm on it. I'll analyze that and give you the key insights.";

    if (q.includes('how are you') || q.includes('how r u')) {
      reply = "I'm doing great and ready to help. What task should we tackle?";
    } else if (q.includes('hello') || q.includes('hi')) {
      reply = "Hello there! Assign me any research, report, or data task, and I'll handle the rest.";
    } else if (q.includes('what can you do') || q.includes('who are you')) {
      reply = "I am Manus, your autonomous AI workspace agent. I build websites, analyze data, generate reports, and research the web.";
    } else {
      reply = `Understood. I've noted "${query}" and I am ready for your next request.`;
    }

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const aiMsg: VoiceMessage = {
      id: (Date.now() + 1).toString(),
      sender: 'ai',
      text: reply,
      time
    };

    setMessages(prev => {
      const next = [...prev, aiMsg];
      void persistVoiceConversation(next);
      return next;
    });
    speakText(reply);
  };

  // Text-to-Speech Playback
  const speakText = (text: string) => {
    const cleanedText = text?.trim();
    if (!cleanedText) return;

    isSpeakingRef.current = true;
    setCallStatus('speaking');
    setStatusText('Preparing audio reply…');

    // Release the speech-recognition audio session before TTS playback.
    try {
      if (recognitionRef.current && isListeningRef.current) {
        recognitionRef.current.stop();
      }
    } catch (error) {
      console.warn('[Voice Call] Could not pause recognition for audio playback:', error);
    }

    stopCleanSpeech();
    const resumeListening = () => {
      isSpeakingRef.current = false;
      if (!isOpen || !hasMicPermissionRef.current || isCallPausedRef.current) return;
      setCallStatus('listening');
      setStatusText('Listening… speak now');
      scheduleRecognitionRestart(500);
    };

    const started = speakCleanHumanVoice(cleanedText, {
      voicePersona: selectedVoice,
      rate: parseFloat(speechRate) || 1.0,
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

  // Pause / Resume Toggle
  const togglePause = () => {
    if (callStatus === 'paused') {
      isCallPausedRef.current = false;
      setCallStatus('listening');
      setStatusText('Start speaking...');
      startRecognitionSafely();
      toast.info('Voice call resumed');
    } else {
      isCallPausedRef.current = true;
      clearRecognitionRestart();
      isRecognitionStartingRef.current = false;
      setCallStatus('paused');
      setStatusText('Call paused');
      try {
        if (recognitionRef.current) recognitionRef.current.stop();
        if (synthRef.current) synthRef.current.cancel();
      } catch {}
      toast.info('Voice call paused');
    }
  };

  // End Call
  const handleEndCall = () => {
    try {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (synthRef.current) synthRef.current.cancel();
    } catch {}
    // The conversation is already persisted after each turn; this final save
    // ensures the latest transcript is also present before the modal closes.
    void persistVoiceConversation(messages);
    toast.success('Voice call saved to chat history');
    onClose();
  };

  // Send Text via Keyboard
  const handleSendKeyboardInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    handleUserSpoken(textInput.trim());
    setTextInput('');
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

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[100] h-screen h-[100dvh] min-h-0 w-full min-w-0 max-w-full bg-[#0B0C0E] text-white flex flex-col justify-between overflow-hidden select-none font-sans animate-in fade-in duration-200 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      
      {/* Top Header Bar */}
      <div className="h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between shrink-0 z-20 min-w-0 w-full">
        {/* Left Icons: History & Live Transcript */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveOverlay(activeOverlay === 'history' ? 'none' : 'history')}
            className={cn(
              "w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all relative border border-white/10 cursor-pointer",
              activeOverlay === 'history' ? "bg-white/20 text-white" : "bg-white/5 text-white/80 hover:bg-white/10"
            )}
            title="Voice History"
            aria-label="Voice History"
          >
            <History size={18} />
            {voiceHistory.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white text-black text-[10px] font-bold flex items-center justify-center">
                {voiceHistory.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveOverlay(activeOverlay === 'transcript' ? 'none' : 'transcript')}
            className={cn(
              "w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all border border-white/10 cursor-pointer",
              activeOverlay === 'transcript' ? "bg-white/20 text-white" : "bg-white/5 text-white/80 hover:bg-white/10"
            )}
            title="Live Call Transcript"
            aria-label="Live Call Transcript"
          >
            <MessageSquare size={18} />
          </button>
        </div>

        {/* Center: Assistant Branding */}
        <div className="flex flex-col items-center justify-center min-w-0 px-2 text-center">
          <h2 className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-1.5 truncate">
            Manus AI
          </h2>
          <span className="text-[10px] sm:text-[11px] text-white/40 tracking-wide font-medium truncate">
            {callStatus === 'paused' ? 'Paused' : 'Generated by Manus AI'}
          </span>
        </div>

        {/* Right Icon: Call Settings */}
        <button
          type="button"
          onClick={() => setActiveOverlay(activeOverlay === 'settings' ? 'none' : 'settings')}
          className={cn(
            "w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all border border-white/10 cursor-pointer shrink-0",
            activeOverlay === 'settings' ? "bg-white/20 text-white" : "bg-white/5 text-white/80 hover:bg-white/10"
          )}
          title="Call Settings"
          aria-label="Call Settings"
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {/* Backdrop for active overlays */}
      {activeOverlay !== 'none' && (
        <div 
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200"
          onClick={() => setActiveOverlay('none')}
          aria-hidden="true"
        />
      )}

      {/* Main Center Stage: Grok 3D Interactive Avatar & Uiverse 3D Sphere */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-4 sm:px-6 py-2 min-h-0 min-w-0 w-full overflow-y-auto overscroll-contain">
        
        {/* Interactive Avatar / Sphere Stage */}
        <div className="relative my-auto flex items-center justify-center shrink-0 max-w-full">
          {avatarStyle === 'sphere' ? (
            <VoicePulseOrb
              callStatus={callStatus}
              audioLevel={audioLevel}
              className="voice-call-main-orb"
            />
          ) : (
            <Grok3DAvatar
              callStatus={callStatus}
              audioLevel={audioLevel}
              liveTranscript={liveTranscript}
              initialStyle={avatarStyle}
              initialColor={colorTheme}
              onStyleChange={(st) => {
                setAvatarStyle(st);
                localStorage.setItem('grok_avatar_style', st);
              }}
              onColorChange={(col) => {
                setColorTheme(col);
                localStorage.setItem('grok_color_theme', col);
              }}
            />
          )}
        </div>

        {/* Status Text & Live Transcript */}
        <div className="text-center space-y-2 sm:space-y-3 mt-4 sm:mt-6 max-w-md w-full px-2 shrink-0">
          <p className="text-lg sm:text-xl md:text-2xl font-semibold text-white tracking-tight line-clamp-2">
            {liveTranscript ? `"${liveTranscript}"` : statusText}
          </p>

          {callStatus === 'thinking' ? (
            <div className="flex justify-center pt-1">
              <HorizontalLoader 
                label={
                  liveTranscript.toLowerCase().includes('image')
                    ? "Generating Image"
                    : liveTranscript.toLowerCase().includes('graph') || liveTranscript.toLowerCase().includes('chart')
                      ? "Generating Graph"
                      : "Generating"
                } 
              />
            </div>
          ) : (
            <p className="text-xs text-white/50 tracking-wide uppercase font-medium">
              {callStatus === 'listening' ? 'Start speaking' : callStatus === 'speaking' ? 'Manus speaking' : 'Paused'}
            </p>
          )}

          {/* Audio Waveform Dots */}
          <div className="flex items-center justify-center gap-2 pt-1 sm:pt-2">
            {[0.25, 0.55, 0.85, 1.0, 0.85, 0.55, 0.25].map((heightMultiplier, i) => {
              const isSpeaking = callStatus === 'speaking';
              const isListening = callStatus === 'listening';

              let currentHeight = 4;
              if (isSpeaking) {
                currentHeight = Math.sin((Date.now() / 120) + i) * 10 + 14;
              } else if (isListening) {
                currentHeight = Math.max(4, audioLevel * heightMultiplier * 26 + 4);
              }

              return (
                <span
                  key={i}
                  className={cn(
                    "w-1.5 rounded-full transition-all duration-75",
                    isSpeaking 
                      ? "bg-white animate-pulse" 
                      : isListening && audioLevel > 0.05
                        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                        : isListening
                          ? "bg-white/70"
                          : "bg-white/20"
                  )}
                  style={{
                    height: `${currentHeight}px`,
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Inline Keyboard Text Input (Uiverse Cobp Chatbot Component) */}
        {showKeyboardInput && (
          <div className="w-full max-w-md mt-4 shrink-0">
            <CobpChatInput
              onSubmit={(text) => handleUserSpoken(text)}
              placeholder="Imagine Something...✦˚"
            />
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="pb-4 sm:pb-8 pt-2 sm:pt-4 px-4 sm:px-6 flex flex-col items-center gap-3 sm:gap-5 shrink-0 z-20 min-w-0 w-full">
        <div className="flex items-center justify-center gap-8 sm:gap-10">
          {/* Pause / Resume Button */}
          <div className="flex flex-col items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={togglePause}
              className={cn(
                "w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg shrink-0",
                callStatus === 'paused'
                  ? "bg-white text-black ring-4 ring-white/20"
                  : "bg-[#1E2024] text-white hover:bg-white/15"
              )}
              aria-label={callStatus === 'paused' ? 'Resume call' : 'Pause call'}
            >
              {callStatus === 'paused' ? <Play size={22} className="sm:w-6 sm:h-6" /> : <Pause size={22} className="sm:w-6 sm:h-6" />}
            </button>
            <span className="text-xs text-white/60 font-medium">
              {callStatus === 'paused' ? 'Resume' : 'Pause'}
            </span>
          </div>

          {/* End Call Button */}
          <div className="flex flex-col items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handleEndCall}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#E11D48] text-white flex items-center justify-center transition-all hover:bg-rose-700 active:scale-95 shadow-lg shadow-rose-900/30 cursor-pointer shrink-0"
              aria-label="End call"
            >
              <PhoneOff size={24} className="sm:w-6 sm:h-6" />
            </button>
            <span className="text-xs text-white/60 font-medium">End</span>
          </div>
        </div>

        {/* Tap to show keyboard */}
        {keyboardEnabled && (
          <button
            type="button"
            onClick={() => setShowKeyboardInput(!showKeyboardInput)}
            className="flex items-center gap-2 text-xs text-white/50 hover:text-white transition-colors cursor-pointer py-1"
          >
            <Keyboard size={14} />
            <span>{showKeyboardInput ? 'Hide keyboard' : 'Tap to show keyboard'}</span>
          </button>
        )}
      </div>

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
                    {msg.sender === 'ai' ? 'Manus AI' : 'You'}
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
              <p className="text-[11px] text-white/40">Manus AI Voice Configuration</p>
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
                  <SelectItem value="geometric">Grok Core</SelectItem>
                  <SelectItem value="bot">Cyber Bot</SelectItem>
                  <SelectItem value="hologram">Holo Matrix</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 3D Avatar Aura Color */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
                <span className="w-4 h-4 rounded-full bg-black inline-block border border-white/40 shadow-xs" />
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
                  <SelectValue placeholder="Obsidian Black" />
                </SelectTrigger>
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white z-[150]">
                  <SelectItem value="electric-blue">Obsidian Black</SelectItem>
                  <SelectItem value="cyber-cyan">Cyber Cyan</SelectItem>
                  <SelectItem value="neon-purple">Neon Violet</SelectItem>
                  <SelectItem value="obsidian-gold">Grok Obsidian</SelectItem>
                </SelectContent>
              </Select>
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
