import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Mic, MicOff, MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { formatSpokenPunctuation } from '@/components/voice/VoiceInputButton';
import { VoiceTranscriptionIndicator } from '@/components/voice/VoiceTranscriptionIndicator';
import { getSettings } from '@/lib/settingsStore';
import { getFirebaseAuthorizationHeader } from '@/lib/firebaseAuthorization';
import { speakCleanHumanVoice } from '@/lib/speechSynthesis';
import { hasActiveTextSelection } from '@/lib/clipboard';
import { auth } from '@/lib/firebase';
import {
  longTermMemory,
  isExplicitMemoryRecallQuery,
  formatRelevantMemoryBlock,
  MEMORY_BEHAVIOR_POLICY,
  type MessageMemoryUpdate,
} from '@/lib/longTermMemory';
import { ConversationActionBar } from '../agent/ConversationActionBar';
import { MemoryUpdatedIndicator } from '../agent/MemoryUpdatedIndicator';
import { MarkdownRenderer } from '../agent/MarkdownRenderer';
import { normalizeResponseModelMetadata } from '@/lib/responseModelMetadata';
import type { ResponseModelMetadata } from '@/lib/responseModelMetadata';
import { MessageContextMenu, SelectTextModal, ContextMenuAnchor, useMessageLongPressController } from '../agent/MessageContextMenu';
import { MessageEditController } from '../agent/MessageEditController';
import { WritingBlock } from '../agent/WritingBlock';
import { detectWritingBlock } from '@/lib/writingDetector';
import { applyUserMessageEditBranch } from '@/lib/messageBranching';

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  metadata?: Record<string, any>;
  memoryUpdate?: MessageMemoryUpdate;
  responseModel?: ResponseModelMetadata;
}

interface MyAIChatProps {
  onBack?: () => void;
}

export function MyAIChat({ onBack }: MyAIChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimSpeech, setInterimSpeech] = useState('');
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
  const [editingTarget, setEditingTarget] = useState<{ id: string; originalText: string } | null>(null);
  const savedDraftBeforeEditRef = useRef<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    anchor: ContextMenuAnchor | null;
    messageId: string;
    messageText: string;
    timestamp?: string;
    role: 'user' | 'assistant';
  }>({
    isOpen: false,
    anchor: null,
    messageId: '',
    messageText: '',
    role: 'user',
  });
  const [selectTextModalContent, setSelectTextModalContent] = useState<string | null>(null);

  const openUserContextMenu = React.useCallback(
    (payload: {
      anchor: ContextMenuAnchor;
      messageId: string;
      messageText: string;
      timestamp?: string | number | Date;
      role: 'user';
    }) => {
      setContextMenuState({
        isOpen: true,
        anchor: payload.anchor,
        messageId: payload.messageId,
        messageText: payload.messageText,
        timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : undefined,
        role: 'user',
      });
    },
    []
  );

  const { pressedMessageId, getUserMessageGestureProps, clearLongPressTimers } =
    useMessageLongPressController({
      isMenuOpen: contextMenuState.isOpen,
      onOpenMenu: openUserContextMenu,
    });

  const beginEditMessage = (messageId: string, originalText: string) => {
    if (!messageId) return;
    if (savedDraftBeforeEditRef.current === null && !editingTarget) {
      savedDraftBeforeEditRef.current = input;
    }
    setEditingTarget({ id: messageId, originalText });
    setInput(originalText);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(originalText.length, originalText.length);
        } catch {}
      }
    });
  };

  const cancelEditMessage = () => {
    const prev = savedDraftBeforeEditRef.current;
    savedDraftBeforeEditRef.current = null;
    setEditingTarget(null);
    setInput(prev ?? '');
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (mainRef.current && !hasActiveTextSelection(mainRef.current)) {
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
      clearLongPressTimers();
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
      setInterimSpeech('');
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

        const formattedInterim = formatSpokenPunctuation(interimTranscript);
        setInterimSpeech(formattedInterim);

        const liveText = [baseInputRef.current.trim(), formattedInterim].filter(Boolean).join(' ');
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
        setInterimSpeech('');
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimSpeech('');
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
    if (e.key === 'Escape' && editingTarget) {
      e.preventDefault();
      cancelEditMessage();
      return;
    }
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

    const activeEdit = overrideText === undefined ? editingTarget : null;
    let userMsgId: string;
    let updatedMessages: Message[];

    if (activeEdit) {
      const branch = applyUserMessageEditBranch(messages, activeEdit.id, query);
      if (branch.editedMessage) {
        userMsgId = activeEdit.id;
        updatedMessages = branch.updatedMessages;
      } else {
        userMsgId = `myai_u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        updatedMessages = [...messages, { id: userMsgId, role: 'user', content: query, timestamp: new Date().toISOString() }];
      }
      setEditingTarget(null);
      savedDraftBeforeEditRef.current = null;
    } else {
      userMsgId = `myai_u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const userMessage: Message = { id: userMsgId, role: 'user', content: query, timestamp: new Date().toISOString() };
      updatedMessages = [...messages, userMessage];
    }

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
    let inactivityTimerId: ReturnType<typeof setTimeout> | null = null;
    const resetInactivityTimer = () => {
      if (inactivityTimerId !== null) clearTimeout(inactivityTimerId);
      inactivityTimerId = setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {}
      }, 45000);
    };
    resetInactivityTimer();

    setIsGenerating(true);

    const assistantPlaceholder: Message = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantPlaceholder]);

    let accumulated = '';
    let responseModel: ResponseModelMetadata | null = null;
    try {
      const activeUserId = auth?.currentUser?.uid || 'usr_manus_default';
      const captureRes = await longTermMemory.captureFromUserMessage({
        userId: activeUserId,
        message: query,
        sourceMessageId: userMsgId,
      });

      if (captureRes.matched) {
        const memoryUpdate: MessageMemoryUpdate = {
          status: captureRes.persisted ? 'saved' : 'failed',
          action: captureRes.action || 'save',
          recordId: captureRes.record?.id,
          memoryKey: captureRes.record?.key,
          memoryValue: captureRes.record?.value,
          summary: captureRes.summary,
          error: captureRes.error,
          updatedAt: new Date().toISOString(),
          isFresh: true,
        };
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsgId ? { ...m, memoryUpdate } : m))
        );
      }

      const memoryContext = await longTermMemory.getRelevantContext(activeUserId, query).catch(() => '');
      const payloadMessages = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const formattedMemory = memoryContext
        ? formatRelevantMemoryBlock(memoryContext, isExplicitMemoryRecallQuery(query))
        : '';
      const systemInstruction = [
        'You are Deku AI, an intelligent, natural, and helpful conversational assistant. Respond directly and warmly to the user.',
        MEMORY_BEHAVIOR_POLICY,
        formattedMemory,
      ]
        .filter(Boolean)
        .join('\n\n');

      const authorization = await getFirebaseAuthorizationHeader();
      if (!authorization) {
        toast.error('Unable to initialize chat session. Please refresh and try again.');
        throw new Error('Authentication required.');
      }
      const requestIdStr = `myai_${Date.now()}_${reqId}`;
      const requestBody = JSON.stringify({
        requestId: requestIdStr,
        messages: payloadMessages,
        systemInstruction,
      });
      const endpoints = ['/api/gemini/stream', '/.netlify/functions/agent'];
      let res: Response | null = null;
      for (let i = 0; i < endpoints.length; i++) {
        try {
          const candidate = await fetch(endpoints[i], {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Request-ID': requestIdStr,
              Authorization: authorization,
            },
            signal: controller.signal,
            body: requestBody,
          });
          if (candidate.ok || i === endpoints.length - 1 || (candidate.status !== 404 && candidate.status !== 405)) {
            res = candidate;
            break;
          }
        } catch (fetchErr) {
          if (i === endpoints.length - 1) throw fetchErr;
        }
      }
      resetInactivityTimer();

      if (!res || !res.ok) throw new Error(`API returned ${res?.status || 500}`);
      if (!res.body) {
        if (activeRequestIdRef.current === reqId) {
          setMessages([...updatedMessages, { role: 'assistant', content: 'Response received.' }]);
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';

      const processLine = (rawLine: string) => {
        if (activeRequestIdRef.current !== reqId) return;
        resetInactivityTimer();
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') return;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.type === 'response-metadata') {
            responseModel = normalizeResponseModelMetadata(parsed.responseModel ?? parsed.metadata);
            if (responseModel) {
              setMessages(prev => {
                if (activeRequestIdRef.current !== reqId) return prev;
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: accumulated, responseModel };
                return next;
              });
            }
            return;
          }
          if (parsed.type === 'heartbeat' || parsed.type === 'ping' || parsed.type === 'stream-open') {
            return;
          }
          const deltaText = parsed.textDelta ?? parsed.delta ?? parsed.content ?? '';
          if (deltaText && parsed.type !== 'finish') {
            accumulated += String(deltaText);
            setMessages(prev => {
              if (activeRequestIdRef.current !== reqId) return prev;
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: accumulated, responseModel: responseModel || undefined };
              return next;
            });
            scrollToBottom();
          } else if (parsed.type === 'error' && parsed.error && !accumulated) {
            accumulated = String(parsed.error);
            setMessages(prev => {
              if (activeRequestIdRef.current !== reqId) return prev;
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: accumulated, responseModel: responseModel || undefined };
              return next;
            });
          }
        } catch (_) {}
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetInactivityTimer();
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
      } else if (accumulated && activeRequestIdRef.current === reqId) {
        const curSettings = getSettings();
        if (curSettings.autoPlayAudio) {
          speakCleanHumanVoice(accumulated, {
            voicePersona: curSettings.voicePersona,
            rate: curSettings.speechSpeed,
            pitch: curSettings.voicePitch,
          });
        }
      }
    } catch (err) {
      if (activeRequestIdRef.current === reqId && !accumulated.trim()) {
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
      if (inactivityTimerId !== null) clearTimeout(inactivityTimerId);
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
    <div className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-background text-foreground antialiased font-sans">
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
          <section className="min-h-full flex flex-col items-center justify-center p-6 text-center m-auto animate-in fade-in duration-300 manus-welcome-enter">
            <div className="text-[64px] mb-3 select-none manus-float-soft">🤖</div>
            <h1 className="text-[clamp(23px,5vw,32px)] font-bold tracking-tight mb-2 manus-gradient-heading">
              How can I help you?
            </h1>
            <p className="text-muted-foreground text-[15px] leading-relaxed max-w-sm">
              Ask me anything to get started.
            </p>
          </section>
        ) : (
          <section className="w-full max-w-[760px] mx-auto p-4 sm:p-5 flex flex-col gap-5 flex-1">
            {messages.map((msg, index) => {
              const msgId = msg.id || `myai-${msg.role}-${index}`;
              const prevUser = msg.role === 'assistant'
                ? messages.slice(0, index).reverse().find((m) => m.role === 'user')
                : undefined;
              const writingDetection =
                msg.role === 'assistant' && msg.content
                  ? detectWritingBlock(msg.content, prevUser?.content)
                  : null;
              const longPressHandlers =
                msg.role === 'user' && msg.content
                  ? getUserMessageGestureProps({
                      messageId: msgId,
                      messageText: msg.content,
                      timestamp: msg.timestamp,
                    })
                  : {};
              const isEditingThis = editingTarget?.id === msgId;
              const isPressedThis = msg.role === 'user' && pressedMessageId === msgId;
              const isSelectedThis =
                msg.role === 'user' &&
                contextMenuState.isOpen &&
                contextMenuState.messageId === msgId;

              return (
                <React.Fragment key={msgId}>
                  <div
                    className={`flex w-full animate-in fade-in duration-200 ${
                      msg.role === 'user' ? 'justify-end group relative' : 'justify-start group/ai-message relative'
                    }`}
                  >
                    <div className={`flex flex-col max-w-[88%] sm:max-w-[82%] min-w-0 gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={msg.role === 'user' ? 'flex items-center gap-1.5 max-w-full min-w-0' : 'w-full min-w-0'}>
                        {msg.role === 'user' && msg.content && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              data-testid="user-message-menu-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const bubbleEl = e.currentTarget.parentElement?.nextElementSibling as HTMLElement | null;
                                const rect = (bubbleEl || e.currentTarget).getBoundingClientRect();
                                setContextMenuState({
                                  isOpen: true,
                                  anchor: {
                                    x: rect.right,
                                    y: rect.bottom,
                                    rect: {
                                      top: rect.top,
                                      bottom: rect.bottom,
                                      left: rect.left,
                                      right: rect.right,
                                      width: rect.width,
                                      height: rect.height,
                                    },
                                    align: 'right',
                                  },
                                  messageId: msgId,
                                  messageText: msg.content,
                                  timestamp: msg.timestamp,
                                  role: 'user',
                                });
                              }}
                              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-70 transition-opacity p-1.5 rounded-full bg-card/80 hover:bg-card border border-border shadow-xs text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                              title="Message actions"
                              aria-label="Message actions"
                            >
                              <MoreVertical size={13} />
                            </button>
                          </div>
                        )}
                        <div
                          data-testid={msg.role === 'user' ? 'user-message-bubble' : undefined}
                          data-long-press-state={
                            msg.role === 'user'
                              ? isSelectedThis
                                ? 'selected'
                                : isPressedThis
                                  ? 'pressed'
                                  : 'idle'
                              : undefined
                          }
                          style={msg.role === 'user' ? { WebkitTouchCallout: 'none' } : undefined}
                          {...longPressHandlers}
                          className={`w-full max-w-full min-w-0 px-4 py-3 rounded-[18px] text-[15px] leading-relaxed transition-[transform,box-shadow,opacity] duration-150 ease-out ${
                            msg.role === 'user'
                              ? `chat-bubble-hover-user break-words bg-muted/80 dark:bg-card border border-border text-foreground rounded-br-xs whitespace-pre-wrap max-sm:select-none sm:select-text ${isPressedThis ? 'scale-[0.975] opacity-90' : ''} ${isSelectedThis ? 'ring-2 ring-foreground/30 dark:ring-white/40 scale-[1.01]' : ''} ${isEditingThis ? 'ring-2 ring-primary/50 dark:ring-white/40' : ''}`
                              : 'chat-bubble-hover-assistant bg-transparent text-foreground rounded-bl-xs select-text'
                          }`}
                        >
                          {msg.content ? (
                            msg.role === 'assistant' ? (
                              writingDetection?.isWritingBlock ? (
                                <div className="space-y-2.5 min-w-0">
                                  {writingDetection.introText && (
                                    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/95 font-medium">
                                      <MarkdownRenderer content={writingDetection.introText} />
                                    </div>
                                  )}
                                  <WritingBlock
                                    content={writingDetection.writingContent}
                                    title={writingDetection.title}
                                  />
                                  {writingDetection.outroText && (
                                    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
                                      <MarkdownRenderer content={writingDetection.outroText} />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <MarkdownRenderer content={msg.content} />
                              )
                            ) : (
                              msg.content
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <span className="w-1.5 h-1.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-foreground/60 animate-bounce" />
                            </span>
                          )}
                        </div>
                      </div>
                      {msg.role === 'user' && msg.metadata?.edited && (
                        <span className="pr-1 text-[10px] text-muted-foreground select-none">
                          Edited
                        </span>
                      )}
                      {msg.role === 'assistant' && msg.content && (
                        <div className="pl-3 flex items-center gap-1">
                          <ConversationActionBar
                            messageId={`myai-msg-${index}`}
                            content={msg.content}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  {msg.role === 'user' && msg.memoryUpdate && (
                    <div className="w-full -mt-3 flex justify-start">
                      <MemoryUpdatedIndicator memoryUpdate={msg.memoryUpdate} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </section>
        )}
      </main>

      {/* Composer Area */}
      <div className="shrink-0 px-3.5 py-2.5 pb-[max(12px,env(safe-area-inset-bottom,12px))] bg-background">
        <form
          onSubmit={handleSubmit}
          data-testid="manus-input-container"
          data-listening={isListening ? 'true' : 'false'}
          data-generating={isGenerating ? 'true' : 'false'}
          className="manus-input-container max-w-[760px] mx-auto flex flex-col gap-2 border border-border rounded-[24px] px-3.5 py-2 shadow-xs bg-background focus-within:ring-1 focus-within:ring-foreground/20"
        >
          {editingTarget && (
            <MessageEditController
              originalText={editingTarget.originalText}
              currentValue={input}
              isSubmitting={isGenerating}
              onCancel={cancelEditMessage}
              onSave={() => {
                void handleSubmit();
              }}
            />
          )}
          <VoiceTranscriptionIndicator
            isListening={isListening}
            interimSpeech={interimSpeech}
            currentText={input}
            silenceCountdown={silenceCountdown}
            canSendNow={Boolean(input.trim() && !isGenerating)}
            onClear={() => {
              clearSilenceTimer();
              setInput('');
              baseInputRef.current = '';
              setInterimSpeech('');
            }}
            onStop={toggleListening}
            onSendNow={() => handleSubmit()}
          />
          <div className="flex items-end gap-2.5 w-full">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={editingTarget ? "Edit your message..." : isListening ? "Listening... speak now to auto-fill prompt..." : "Message your AI..."}
              aria-label="Message your AI"
              className="flex-1 min-w-0 max-h-[120px] resize-none border-0 outline-none bg-transparent text-foreground text-base leading-[1.45] py-1.5 custom-scrollbar"
              required
            />
            {/* Voice Input Button (Web Speech API) */}
            <button
              type="button"
              data-testid="voice-input-button"
              data-listening={isListening ? 'true' : 'false'}
              onClick={toggleListening}
              aria-label={isListening ? "Stop listening" : "Voice input - speak your prompt"}
              title={isListening ? "Listening... Click to stop" : "Speak prompt (Web Speech API)"}
              className={`manus-mic-button shrink-0 w-[38px] h-[38px] rounded-full flex items-center justify-center transition-all cursor-pointer ${
                isListening
                  ? 'bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] shadow-md ring-2 ring-[#333333] dark:ring-[#E0E0E0]'
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
          </div>
        </form>
        <div className="text-center text-muted-foreground text-[11px] mt-2">
          AI can make mistakes. Check important information.
        </div>
      </div>

      <MessageContextMenu
        isOpen={contextMenuState.isOpen}
        anchor={contextMenuState.anchor}
        messageText={contextMenuState.messageText}
        timestamp={contextMenuState.timestamp}
        role={contextMenuState.role}
        canEdit={contextMenuState.role === 'user' && !isGenerating}
        onClose={() => setContextMenuState((prev) => ({ ...prev, isOpen: false }))}
        onEdit={() => beginEditMessage(contextMenuState.messageId, contextMenuState.messageText)}
        onSelectText={() => setSelectTextModalContent(contextMenuState.messageText)}
      />

      <SelectTextModal
        isOpen={selectTextModalContent !== null}
        text={selectTextModalContent || ''}
        onClose={() => setSelectTextModalContent(null)}
      />
    </div>
  );
}




