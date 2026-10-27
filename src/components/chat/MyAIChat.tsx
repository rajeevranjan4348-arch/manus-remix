import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { formatSpokenPunctuation } from '@/components/voice/VoiceInputButton';
import { getSettings } from '@/lib/settingsStore';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface MyAIChatProps {
  onBack?: () => void;
}

export function MyAIChat({ onBack }: MyAIChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef<string>('');
  const silenceTimerRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const activeRequestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (mainRef.current) {
        mainRef.current.scrollTop = mainRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const handleResize = () => scrollToBottom();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      return () => window.visualViewport?.removeEventListener('resize', handleResize);
    }
  }, []);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setSilenceCountdown(null);
  };

  const startSilenceTimer = (textToSubmit: string, delaySec = 7) => {
    clearSilenceTimer();
    let remaining = delaySec;
    setSilenceCountdown(remaining);

    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setSilenceCountdown(remaining);
      } else {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      clearSilenceTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
      }
      setIsListening(false);
      toast.info('Auto-submitted prompt after 7s of silence');
      handleSubmit(undefined, textToSubmit);
    }, delaySec * 1000);
  };

  useEffect(() => {
    return () => {
      activeRequestIdRef.current += 1;
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch (_) {}
        abortControllerRef.current = null;
      }
      clearSilenceTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }
    };
  }, []);

  const toggleListening = () => {
    clearSilenceTimer();
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      baseInputRef.current = input;

      recognition.onstart = () => {
        setIsListening(true);
        toast.info('Listening... Speak your prompt.');
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0]?.transcript || '';
          if (item.isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        const formattedFinal = formatSpokenPunctuation(finalTranscript);
        if (formattedFinal) {
          baseInputRef.current = [baseInputRef.current.trim(), formattedFinal].filter(Boolean).join(' ');
        }

        const liveText = [baseInputRef.current.trim(), interimTranscript].filter(Boolean).join(' ');
        setInput(liveText);

        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
        }

        // Automatic submission if silent for > 7 seconds
        const settings = getSettings();
        const autoSubmitEnabled = settings.autoSubmitVoiceAfterSilence ?? true;
        const delaySec = settings.autoSubmitSilenceDelay ?? 7;

        if (autoSubmitEnabled && liveText.trim()) {
          startSilenceTimer(liveText.trim(), delaySec);
        } else {
          clearSilenceTimer();
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[Web Speech Error]', event.error);
        clearSilenceTimer();
        if (event.error === 'not-allowed') {
          toast.error('Microphone permission was denied. Please allow microphone access.');
        } else if (event.error !== 'no-speech') {
          toast.error(`Voice input error: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      };

      recognition.start();
    } catch (err: any) {
      console.error('[Web Speech Init Error]', err);
      toast.error('Could not initialize speech recognition');
      setIsListening(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    clearSilenceTimer();
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isGenerating) {
        handleSubmit();
      }
    }
  };

  const handleSubmit = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    clearSilenceTimer();
    const query = (overrideText !== undefined ? overrideText : input).trim();
    if (!query || isGenerating) return;

    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      setIsListening(false);
    }

    const userMessage: Message = { role: 'user', content: query };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    baseInputRef.current = '';
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const reqId = ++activeRequestIdRef.current;
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (_) {}
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
    }, 38000);

    setIsGenerating(true);

    const assistantPlaceholder: Message = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantPlaceholder]);

    try {
      const res = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          requestId: `myai_${Date.now()}_${reqId}`,
          messages: updatedMessages,
          model: 'gemini-3.8-flash',
        }),
      });

      if (!res.ok) throw new Error(`API returned ${res.status}`);
      if (!res.body) {
        if (activeRequestIdRef.current === reqId) {
          setMessages([...updatedMessages, { role: 'assistant', content: 'Response received.' }]);
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let lineBuffer = '';

      const processLine = (rawLine: string) => {
        if (activeRequestIdRef.current !== reqId) return;
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') return;

        try {
          const parsed = JSON.parse(dataStr);
          const deltaText = parsed.textDelta ?? parsed.delta ?? parsed.content ?? '';
          if (deltaText && parsed.type !== 'finish') {
            accumulated += String(deltaText);
            setMessages(prev => {
              if (activeRequestIdRef.current !== reqId) return prev;
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: accumulated };
              return next;
            });
            scrollToBottom();
          } else if (parsed.type === 'error' && parsed.error && !accumulated) {
            accumulated = String(parsed.error);
            setMessages(prev => {
              if (activeRequestIdRef.current !== reqId) return prev;
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: accumulated };
              return next;
            });
          }
        } catch (_) {}
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';
          for (const line of lines) {
            processLine(line);
          }
        }
        lineBuffer += decoder.decode();
        if (lineBuffer.trim()) {
          for (const line of lineBuffer.split('\n')) {
            processLine(line);
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (_) {}
      }

      if (!accumulated && activeRequestIdRef.current === reqId) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: 'No response received.' };
          return next;
        });
      }
    } catch (err) {
      if (activeRequestIdRef.current === reqId) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'assistant',
            content: 'I apologize, but I encountered an error connecting to the AI service. Please try again.',
          };
          return next;
        });
      }
    } finally {
      clearTimeout(timeoutId);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (activeRequestIdRef.current === reqId) {
        setIsGenerating(false);
        scrollToBottom();
      }
    }
  };

  const showWelcome = messages.length === 0;

  return (
    <div className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-background text-foreground antialiased selection:bg-neutral-800 selection:text-white font-sans">
      {/* Header */}
      <header className="min-h-[54px] max-h-[54px] flex items-center justify-between px-4 border-b border-border bg-background z-10 shrink-0">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back"
              className="p-1 -ml-1 text-muted-foreground hover:text-foreground rounded-full transition-colors cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="font-bold text-[17px] flex items-center gap-1.5">
            <span>🤖</span>
            <span>My AI</span>
          </div>
        </div>
        <div className={`text-xs font-medium flex items-center gap-1.5 ${isGenerating ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isGenerating ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span>{isGenerating ? 'Thinking...' : 'Ready'}</span>
        </div>
      </header>

      {/* Main chat area */}
      <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-smooth flex flex-col">
        {showWelcome ? (
          <section className="min-h-full flex flex-col items-center justify-center p-6 text-center m-auto animate-in fade-in duration-300">
            <div className="text-[64px] mb-3 select-none">🤖</div>
            <h1 className="text-[clamp(23px,5vw,32px)] font-bold tracking-tight mb-2 text-foreground">
              How can I help you?
            </h1>
            <p className="text-muted-foreground text-[15px] leading-relaxed max-w-sm">
              Ask me anything to get started.
            </p>
          </section>
        ) : (
          <section className="w-full max-w-[760px] mx-auto p-4 sm:p-5 flex flex-col gap-5 flex-1">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex w-full animate-in fade-in duration-200 ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[88%] sm:max-w-[82%] px-4 py-3 rounded-[18px] text-[15px] leading-relaxed break-words whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-muted/80 dark:bg-card border border-border text-foreground rounded-br-xs'
                      : 'bg-transparent text-foreground rounded-bl-xs'
                  }`}
                >
                  {msg.content || (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/60 animate-bounce" />
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </section>
        )}
      </main>

      {/* Composer Area */}
      <div className="shrink-0 px-3.5 py-2.5 pb-[max(12px,env(safe-area-inset-bottom,12px))] bg-background">
        <form
          onSubmit={handleSubmit}
          className="max-w-[760px] mx-auto flex items-end gap-2.5 border border-border rounded-[24px] px-3.5 py-2 shadow-xs bg-background focus-within:ring-1 focus-within:ring-foreground/20"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Message your AI..."
            aria-label="Message your AI"
            className="flex-1 min-w-0 max-h-[120px] resize-none border-0 outline-none bg-transparent text-foreground text-base leading-[1.45] py-1.5 custom-scrollbar"
            required
          />
          {/* Voice Input Button (Web Speech API) */}
          <button
            type="button"
            onClick={toggleListening}
            aria-label={isListening ? "Stop listening" : "Voice input - speak your prompt"}
            title={isListening ? "Listening... Click to stop" : "Speak prompt (Web Speech API)"}
            className={`shrink-0 w-[38px] h-[38px] rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isListening
                ? 'bg-rose-500 text-white animate-pulse shadow-md ring-2 ring-rose-400/40 scale-105'
                : 'text-muted-foreground hover:text-foreground hover:bg-neutral-200/60 dark:hover:bg-neutral-800'
            }`}
          >
            {isListening ? <MicOff size={19} /> : <Mic size={19} />}
          </button>

          <button
            type="submit"
            aria-label="Send message"
            disabled={!input.trim() || isGenerating}
            className="shrink-0 w-[38px] h-[38px] rounded-full bg-foreground text-background flex items-center justify-center text-lg font-bold disabled:opacity-35 disabled:cursor-default hover:scale-105 active:scale-95 transition-all cursor-pointer"
          >
            ↑
          </button>
        </form>
        {isListening && (
          <div className="flex items-center justify-center gap-2 text-xs text-rose-500 font-medium mt-2 animate-in fade-in duration-200">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>Listening... Speak your prompt</span>
            {silenceCountdown !== null && (
              <span className="text-neutral-400 font-normal">
                (auto-submitting in {silenceCountdown}s)
              </span>
            )}
          </div>
        )}
        <div className="text-center text-muted-foreground text-[11px] mt-2">
          AI can make mistakes. Check important information.
        </div>
      </div>
    </div>
  );
}
