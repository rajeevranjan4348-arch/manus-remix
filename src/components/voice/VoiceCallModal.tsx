import React, { useState, useEffect, useRef } from 'react';
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
  { id: 'tintin', name: 'Tintin (Natural)' },
  { id: 'nova', name: 'Nova (Warm)' },
  { id: 'alloy', name: 'Alloy (Balanced)' },
  { id: 'echo', name: 'Echo (Calm)' },
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
  const [selectedVoice, setSelectedVoice] = useState('tintin');
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
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const isListeningRef = useRef(false);

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
          rec.lang = 'en-US';

          rec.onstart = () => {
            isListeningRef.current = true;
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
            if (e.error !== 'no-speech') {
              console.warn('[Voice Recognition]', e.error);
            }
          };

          rec.onend = () => {
            isListeningRef.current = false;
            // Restart if call is still active and not paused
            if (isOpen && callStatus !== 'paused') {
              try {
                rec.start();
              } catch {}
            }
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

  // When call starts
  useEffect(() => {
    if (isOpen) {
      setCallStatus('listening');
      setStatusText('Start speaking...');
      setLiveTranscript('');

      // Speak initial greeting if enabled
      if (openingEnabled) {
        speakText('Good to hear your voice! How are you?');
      }

      // Start recognition
      try {
        if (recognitionRef.current && !isListeningRef.current) {
          recognitionRef.current.start();
        }
      } catch {}
    } else {
      // Cleanup on modal close
      try {
        if (recognitionRef.current) recognitionRef.current.stop();
        if (synthRef.current) synthRef.current.cancel();
      } catch {}
    }
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
        const user = await blink.auth.me();
        const task = await (blink.db as any).tasks.create({
          userId: user?.id || 'usr_manus_default',
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
    stopCleanSpeech();
    setCallStatus('speaking');
    setStatusText(text);

    const started = speakCleanHumanVoice(text, {
      voicePersona: selectedVoice,
      rate: parseFloat(speechRate) || 1.0,
      volume: 1.0, // Maximum loud, crisp human audio
      onEnd: () => {
        setCallStatus('listening');
        setStatusText('Start speaking...');
      },
      onError: () => {
        setCallStatus('listening');
        setStatusText('Start speaking...');
      },
    });

    if (!started) {
      setCallStatus('listening');
      setStatusText('Start speaking...');
    }
  };

  // Pause / Resume Toggle
  const togglePause = () => {
    if (callStatus === 'paused') {
      setCallStatus('listening');
      setStatusText('Start speaking...');
      try {
        if (recognitionRef.current) recognitionRef.current.start();
      } catch {}
      toast.info('Voice call resumed');
    } else {
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

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0C0E] text-white flex flex-col justify-between overflow-hidden select-none font-sans animate-in fade-in zoom-in-95 duration-300">
      
      {/* Top Header Bar */}
      <div className="h-16 px-6 flex items-center justify-between shrink-0 z-20">
        {/* Left Icons: History & Live Transcript */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveOverlay(activeOverlay === 'history' ? 'none' : 'history')}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-all relative border border-white/10",
              activeOverlay === 'history' ? "bg-white/20 text-white" : "bg-white/5 text-white/80 hover:bg-white/10"
            )}
            title="Voice History"
          >
            <History size={18} />
            {voiceHistory.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white text-black text-[10px] font-bold flex items-center justify-center">
                {voiceHistory.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveOverlay(activeOverlay === 'transcript' ? 'none' : 'transcript')}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-all border border-white/10",
              activeOverlay === 'transcript' ? "bg-white/20 text-white" : "bg-white/5 text-white/80 hover:bg-white/10"
            )}
            title="Live Call Transcript"
          >
            <MessageSquare size={18} />
          </button>
        </div>

        {/* Center: Assistant Branding */}
        <div className="flex flex-col items-center">
          <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
            Manus AI
          </h2>
          <span className="text-[11px] text-white/40 tracking-wide font-medium">
            {callStatus === 'paused' ? 'Paused' : 'Generated by Manus AI'}
          </span>
        </div>

        {/* Right Icon: Call Settings */}
        <button
          onClick={() => setActiveOverlay(activeOverlay === 'settings' ? 'none' : 'settings')}
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center transition-all border border-white/10",
            activeOverlay === 'settings' ? "bg-white/20 text-white" : "bg-white/5 text-white/80 hover:bg-white/10"
          )}
          title="Call Settings"
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {/* Main Center Stage: Grok 3D Interactive Avatar & Uiverse 3D Sphere */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-6">
        
        {/* Interactive Avatar / Sphere Stage */}
        <div className="relative my-auto flex items-center justify-center">
          {avatarStyle === 'sphere' ? (
            <VoicePulseOrb
              callStatus={callStatus}
              className="voice-call-main-orb"
            />
          ) : (
            <Grok3DAvatar
              callStatus={callStatus}
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
        <div className="text-center space-y-3 mt-6 max-w-md w-full px-4">
          <p className="text-xl sm:text-2xl font-semibold text-white tracking-tight line-clamp-2">
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
          <div className="flex items-center justify-center gap-2 pt-2">
            {[0.2, 0.5, 0.8, 1.0, 0.8, 0.5, 0.2].map((height, i) => (
              <span
                key={i}
                className={cn(
                  "w-1.5 rounded-full transition-all duration-300",
                  callStatus === 'speaking' 
                    ? "bg-white animate-pulse" 
                    : callStatus === 'listening'
                      ? "bg-white/70"
                      : "bg-white/20"
                )}
                style={{
                  height: callStatus === 'speaking' 
                    ? `${height * 18 + 4}px` 
                    : callStatus === 'listening' 
                      ? `${height * 8 + 4}px` 
                      : '4px',
                  animationDelay: `${i * 100}ms`
                }}
              />
            ))}
          </div>
        </div>

        {/* Inline Keyboard Text Input (Uiverse Cobp Chatbot Component) */}
        {showKeyboardInput && (
          <CobpChatInput
            onSubmit={(text) => handleUserSpoken(text)}
            placeholder="Imagine Something...✦˚"
          />
        )}
      </div>

      {/* Bottom Controls */}
      <div className="pb-8 pt-4 px-6 flex flex-col items-center gap-5 shrink-0 z-20">
        <div className="flex items-center gap-10">
          {/* Pause / Resume Button */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={togglePause}
              className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg",
                callStatus === 'paused'
                  ? "bg-white text-black ring-4 ring-white/20"
                  : "bg-[#1E2024] text-white hover:bg-white/15"
              )}
            >
              {callStatus === 'paused' ? <Play size={24} /> : <Pause size={24} />}
            </button>
            <span className="text-xs text-white/60 font-medium">
              {callStatus === 'paused' ? 'Resume' : 'Pause'}
            </span>
          </div>

          {/* End Call Button */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleEndCall}
              className="w-16 h-16 rounded-full bg-[#E11D48] text-white flex items-center justify-center transition-all hover:bg-rose-700 active:scale-95 shadow-lg shadow-rose-900/30 cursor-pointer"
            >
              <PhoneOff size={26} />
            </button>
            <span className="text-xs text-white/60 font-medium">End</span>
          </div>
        </div>

        {/* Tap to show keyboard */}
        {keyboardEnabled && (
          <button
            onClick={() => setShowKeyboardInput(!showKeyboardInput)}
            className="flex items-center gap-2 text-xs text-white/50 hover:text-white transition-colors cursor-pointer py-1"
          >
            <Keyboard size={14} />
            <span>{showKeyboardInput ? 'Hide keyboard' : 'Tap to show keyboard'}</span>
          </button>
        )}
      </div>

      {/* OVERLAY 1: Live Call Transcript Drawer (Matches Image 4) */}
      {activeOverlay === 'transcript' && (
        <div className="absolute inset-y-0 left-0 w-full sm:w-96 bg-[#121316] border-r border-white/10 z-40 flex flex-col shadow-2xl animate-in slide-in-from-left duration-300">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center">
                <MessageSquare size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Live Call Transcript</h3>
                <p className="text-[11px] text-white/40">{messages.length} messages in call</p>
              </div>
            </div>
            <button
              onClick={() => setActiveOverlay('none')}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
            <div className="p-3 border-t border-white/10">
              <button
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

      {/* OVERLAY 2: Voice History Drawer (Matches Image 3) */}
      {activeOverlay === 'history' && (
        <div className="absolute inset-y-0 left-0 w-full sm:w-96 bg-[#121316] border-r border-white/10 z-40 flex flex-col shadow-2xl animate-in slide-in-from-left duration-300">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-black border border-white/10 text-white flex items-center justify-center">
                <History size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Voice History</h3>
                <p className="text-[11px] text-white/40">{voiceHistory.length} saved transcriptions</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  saveHistory([]);
                  toast.info('Voice history cleared');
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-red-400 transition-colors"
                title="Clear History"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => setActiveOverlay('none')}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="p-4 pb-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl">
              <Search size={14} className="text-white/40" />
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
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                    onClick={() => handleResendHistory(item)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black hover:bg-neutral-900 border border-white/15 text-white text-xs font-semibold transition-colors"
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

      {/* OVERLAY 3: Call Settings Popover (Matches Image 2) */}
      {activeOverlay === 'settings' && (
        <div className="absolute top-16 right-6 w-80 bg-[#16171B] border border-white/10 rounded-3xl p-5 z-40 shadow-2xl animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <h3 className="font-bold text-sm text-white">Call Settings</h3>
              <p className="text-[11px] text-white/40">Manus AI Voice Configuration</p>
            </div>
            <button
              onClick={() => setActiveOverlay('none')}
              className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
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
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white">
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
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger className="w-28 h-8 bg-white/5 border-white/10 text-xs text-white rounded-xl">
                  <SelectValue placeholder="Tintin" />
                </SelectTrigger>
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white">
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
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white">
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
                <SelectContent className="bg-[#1C1E22] border-white/10 text-white">
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
}
