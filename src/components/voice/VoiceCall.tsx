import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Info, Mic, MicOff, PhoneOff, X } from 'lucide-react';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';

type VoiceStatus = 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'error';
type RecognitionResult = { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionResult) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

interface VoiceCallProps {
  messages: any[];
  isLoading: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

const SpeechRecognitionApi = typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : undefined;

export function VoiceCall({ messages, isLoading, onSubmit, onClose }: VoiceCallProps) {
  const [status, setStatus] = useState<VoiceStatus>('connecting');
  const [muted, setMuted] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const listeningRef = useRef(false);
  const lastSpokenRef = useRef('');
  const statusRef = useRef(status);
  statusRef.current = status;

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    try { recognitionRef.current?.stop(); } catch {}
  }, []);

  const startListening = useCallback(async () => {
    if (muted || !SpeechRecognitionApi) {
      setError('Speech recognition is not supported in this browser. You can still type a message.');
      setStatus('error');
      return;
    }
    stopCleanSpeech();
    try {
      setError('');
      setTranscript('');
      setStatus('connecting');
      // Request permission explicitly; SpeechRecognition then uses the granted microphone.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      const recognition = new SpeechRecognitionApi() as RecognitionInstance;
      recognition.lang = navigator.language || 'en-IN';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
          const item = event.results[i];
          if (!item?.[0]?.transcript) continue;
          if (item.isFinal) finalText += item[0].transcript;
          else interimText += item[0].transcript;
        }
        setTranscript((finalText || interimText).trim());
        if (finalText.trim()) {
          listeningRef.current = false;
          setTranscript('');
          setStatus('thinking');
          onSubmit(finalText.trim());
        }
      };
      recognition.onerror = (event) => {
        listeningRef.current = false;
        const message = event.error === 'not-allowed'
          ? 'Microphone permission was denied. Allow microphone access in browser settings.'
          : event.error === 'no-speech' ? 'No speech detected. Tap the microphone and try again.'
          : 'Microphone recognition failed. Please try again or type a message.';
        setError(message);
        setStatus('error');
      };
      recognition.onend = () => {
        listeningRef.current = false;
        setStatus(current => current === 'listening' ? 'ready' : current);
      };
      recognitionRef.current?.abort();
      recognitionRef.current = recognition;
      listeningRef.current = true;
      setStatus('listening');
      recognition.start();
    } catch (cause: any) {
      setStatus('error');
      setError(cause?.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow microphone access and try again.'
        : 'Could not access the microphone. Check your device and browser permissions.');
    }
  }, [muted, onSubmit, stopListening]);

  useEffect(() => {
    setStatus('ready');
    return () => {
      listeningRef.current = false;
      try { recognitionRef.current?.abort(); } catch {}
      recognitionRef.current = null;
      stopCleanSpeech();
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      stopListening();
      stopCleanSpeech();
      setStatus('thinking');
      return;
    }
    const latest = [...(messages || [])].reverse().find(message =>
      message?.role === 'assistant' && typeof message.content === 'string' && message.content.trim()
    );
    if (!latest) {
      if (statusRef.current === 'thinking') setStatus('ready');
      return;
    }
    const id = String(latest.id || latest.content);
    if (id === lastSpokenRef.current) return;
    lastSpokenRef.current = id;
    const text = latest.content.trim();
    const started = speakCleanHumanVoice(text, {
      onStart: () => setStatus('speaking'),
      onEnd: () => setStatus('ready'),
      onError: () => setStatus('ready'),
    });
    if (!started) setStatus('ready');
  }, [messages, isLoading, stopListening]);

  useEffect(() => {
    const interrupt = () => {
      if (statusRef.current === 'speaking') stopCleanSpeech();
    };
    window.addEventListener('pointerdown', interrupt, { passive: true });
    return () => window.removeEventListener('pointerdown', interrupt);
  }, []);

  const submitText = (event: React.FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value || isLoading) return;
    stopListening();
    stopCleanSpeech();
    setDraft('');
    setStatus('thinking');
    onSubmit(value);
  };

  const toggleMic = () => {
    if (listeningRef.current) {
      stopListening();
      setStatus('ready');
      return;
    }
    void startListening();
  };

  const statusLabel: Record<VoiceStatus, string> = {
    connecting: 'Connecting…', ready: 'Ready', listening: 'Listening…',
    thinking: 'Thinking…', speaking: 'Speaking…', error: 'Voice unavailable',
  };

  return (
    <section className="voice-call-screen relative flex h-[100dvh] min-h-[520px] w-full flex-col items-center overflow-hidden bg-[#080605] text-white">
      <style>{`
        .voice-call-screen:before,.voice-call-screen:after{content:"";position:absolute;inset:-18%;pointer-events:none;border-radius:50%;filter:blur(70px);opacity:.32;background:radial-gradient(ellipse at 50% 48%,rgba(255,82,18,.22),transparent 48%),radial-gradient(ellipse at 12% 70%,rgba(180,28,18,.18),transparent 42%);animation:voiceAmbient 12s ease-in-out infinite alternate}
        .voice-call-screen:after{opacity:.22;animation-delay:-5s;transform:scale(1.15)}
        .voice-orb{position:relative;width:min(62vw,330px);height:min(62vw,330px);max-height:38vh;max-width:38vh;border-radius:50%;background:radial-gradient(circle at 34% 27%,#fff4d8 0%,#ffbd70 5%,#fa6a27 16%,#a72b18 38%,#35100d 63%,#090707 78%);box-shadow:inset -24px -30px 55px #050303,inset 13px 12px 30px rgba(255,238,204,.48),0 0 35px rgba(255,95,35,.48),0 0 110px rgba(255,58,20,.24);animation:orbFloat 6s ease-in-out infinite;will-change:transform}
        .voice-orb:before{content:"";position:absolute;inset:8%;border-radius:50%;background:conic-gradient(from 20deg,transparent 0 18%,rgba(255,220,172,.3) 27%,transparent 38% 62%,rgba(255,107,54,.4) 74%,transparent 86%);filter:blur(12px);animation:orbRotate 12s linear infinite}
        .voice-orb:after{content:"";position:absolute;inset:15%;border-radius:50%;background:radial-gradient(ellipse at 35% 28%,rgba(255,255,255,.65),transparent 24%),radial-gradient(ellipse at 70% 75%,rgba(255,62,32,.32),transparent 45%);mix-blend-mode:screen}
        .voice-orb[data-state="listening"]{animation:orbListen 1.4s ease-in-out infinite}
        .voice-orb[data-state="thinking"]{animation:orbThink 3s ease-in-out infinite}
        .voice-orb[data-state="speaking"]{animation:orbSpeak .9s ease-in-out infinite}
        .voice-orb[data-state="error"]{box-shadow:0 0 40px rgba(239,68,68,.4),inset -24px -30px 55px #050303}
        .voice-ring{position:absolute;inset:-15%;border:1px solid rgba(255,145,87,.3);border-radius:50%;animation:ringPulse 3s ease-out infinite}
        .voice-ring:nth-child(2){animation-delay:1s}.voice-ring:nth-child(3){animation-delay:2s}
        @keyframes voiceAmbient{to{transform:translate3d(3%, -2%,0) scale(1.08)}}
        @keyframes orbFloat{50%{transform:translateY(-9px) rotate(2deg)}}
        @keyframes orbRotate{to{transform:rotate(360deg)}}
        @keyframes orbListen{50%{transform:scale(1.045)}}
        @keyframes orbThink{50%{transform:rotate(8deg) scale(.97)}}
        @keyframes orbSpeak{50%{transform:scale(1.07)}}
        @keyframes ringPulse{0%{transform:scale(.82);opacity:.7}100%{transform:scale(1.35);opacity:0}}
        @media(prefers-reduced-motion:reduce){.voice-call-screen:before,.voice-call-screen:after,.voice-orb,.voice-orb:before,.voice-ring{animation:none!important}}
      `}</style>
      <div className="relative z-10 flex w-full items-center justify-between px-5 pt-[max(22px,env(safe-area-inset-top))] sm:px-8">
        <button onClick={onClose} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.07] px-4 py-2.5 text-sm text-white/85 backdrop-blur-xl transition hover:bg-white/10" aria-label="Close chat">
          <X size={16} /> Close chat
        </button>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70 backdrop-blur-xl">
          <span className={`h-2 w-2 rounded-full ${status === 'error' ? 'bg-red-400' : 'bg-emerald-400'}`} />
          {status === 'error' ? 'Connection issue' : 'Secure connection'}
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-5">
        <div className="relative flex items-center justify-center">
          <div className="voice-ring" /><div className="voice-ring" /><div className="voice-ring" />
          <div className="voice-orb" data-state={status} role="img" aria-label={`AI orb: ${statusLabel[status]}`} />
        </div>
        <div className="space-y-2 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[.34em] text-orange-200/65">MANUS VOICE</p>
          <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">{statusLabel[status]}</h1>
          <p className="min-h-5 max-w-sm text-sm text-white/45">{transcript || (status === 'listening' ? 'I’m listening. Go ahead.' : status === 'thinking' ? 'Working on your response' : status === 'speaking' ? 'Tap anywhere to interrupt' : 'Your conversation stays in sync with chat.')}</p>
          {error && <p role="alert" className="max-w-sm text-xs text-red-300">{error}</p>}
        </div>
      </div>

      <div className="relative z-10 w-full px-5 pb-[max(28px,env(safe-area-inset-bottom))] sm:px-8">
        <div className="mx-auto flex max-w-md items-center justify-center gap-8 pb-6">
          <button onClick={() => setInfoOpen(value => !value)} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[.07] text-white/75 backdrop-blur-xl hover:bg-white/10" aria-label="Voice mode information"><Info size={19} /></button>
          <button onClick={toggleMic} disabled={isLoading} className={`relative flex h-[76px] w-[76px] items-center justify-center rounded-full border border-orange-200/30 bg-gradient-to-br from-[#ffb35b] via-[#f36a2e] to-[#a92b1b] text-white shadow-[0_0_28px_rgba(255,100,38,.42)] transition active:scale-95 disabled:opacity-50 ${status === 'listening' ? 'ring-8 ring-orange-400/10' : ''}`} aria-label={listeningRef.current ? 'Stop listening' : 'Start listening'}>
            <span className="absolute inset-[-9px] rounded-full border border-orange-300/30 animate-ping [animation-duration:2.8s]" />
            {listeningRef.current ? <MicOff size={27} /> : <Mic size={27} />}
          </button>
          <button onClick={() => { setMuted(value => !value); if (!muted) stopListening(); }} className={`flex h-12 w-12 items-center justify-center rounded-full border border-white/10 backdrop-blur-xl ${muted ? 'bg-red-500/20 text-red-200' : 'bg-white/[.07] text-white/75 hover:bg-white/10'}`} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}><Mic size={19} /></button>
        </div>
        <form onSubmit={submitText} className="mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-white/10 bg-white/[.07] p-2 backdrop-blur-xl">
          <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Send a text message…" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/35" aria-label="Text message" />
          <button type="submit" disabled={!draft.trim() || isLoading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white transition hover:bg-orange-400 disabled:opacity-40" aria-label="Send message"><ArrowUp size={19} /></button>
        </form>
        <div className="mt-3 flex justify-center">
          <button onClick={onClose} className="flex items-center gap-2 text-xs text-white/45 transition hover:text-white/80"><PhoneOff size={13} /> End voice session</button>
        </div>
      </div>
      {infoOpen && <div className="absolute bottom-40 left-1/2 z-20 w-[min(90vw,360px)] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#17100e]/95 p-4 text-sm text-white/75 shadow-2xl backdrop-blur-2xl"><div className="mb-2 flex items-center justify-between text-white"><strong>Voice mode</strong><button onClick={() => setInfoOpen(false)} aria-label="Close information"><X size={16} /></button></div><p>Speak naturally, or type a message. Voice and text share the same chat history and AI session. Microphone access is only requested when you tap the microphone.</p></div>}
    </section>
  );
}
