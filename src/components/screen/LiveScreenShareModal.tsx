import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  MonitorUp,
  MonitorOff,
  X,
  RefreshCw,
  Pause,
  Play,
  Send,
  Paperclip,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ShieldAlert,
  AlertCircle,
  Image as ImageIcon,
  Square,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';
import { getFirebaseAuthorizationHeader } from '@/lib/firebaseAuthorization';
import { speakCleanHumanVoice, stopCleanSpeech } from '@/lib/speechSynthesis';
import {
  type ScreenShareStatus,
  isScreenShareSupported,
  classifyScreenShareError,
  captureVideoFrameToDataUrl,
  captureVideoFrameToFile,
  buildScreenSharePromptPayload,
  parseGeminiStreamSseLine,
  formatDisplaySurfaceLabel,
} from '@/lib/screenShareEngine';

interface ScreenQaTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface LiveScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  conversationMessages?: Array<{ id?: string; role: string; content: string }>;
  onExchangeComplete?: (userText: string, aiText: string) => void;
}

function getSpeechRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function LiveScreenShareModal({
  isOpen,
  onClose,
  onCapture,
  conversationMessages = [],
  onExchangeComplete,
}: LiveScreenShareModalProps) {
  const [status, setStatus] = useState<ScreenShareStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [surfaceLabel, setSurfaceLabel] = useState<string>('Live Screen');
  const [resolutionLabel, setResolutionLabel] = useState<string>('');
  const [pausedFrameUrl, setPausedFrameUrl] = useState<string | null>(null);
  const [questionInput, setQuestionInput] = useState('');
  const [turns, setTurns] = useState<ScreenQaTurn[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');
  const [speakResponses, setSpeakResponses] = useState(false);
  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [isAttachingFrame, setIsAttachingFrame] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const fallbackFileInputRef = useRef<HTMLInputElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const hasAutoPromptedRef = useRef(false);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
      recognitionRef.current = null;
    }
    setIsListeningVoice(false);
  }, []);

  const stopMediaStream = useCallback(() => {
    const active = streamRef.current;
    if (active) {
      active.getTracks().forEach((track) => {
        try {
          track.onended = null;
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const cleanupAll = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        // Ignore abort errors
      }
      abortRef.current = null;
    }
    stopSpeechRecognition();
    stopCleanSpeech();
    stopMediaStream();
    setIsAnalyzing(false);
    setStreamingReply('');
    setPausedFrameUrl(null);
  }, [stopMediaStream, stopSpeechRecognition]);

  const handleClose = useCallback(() => {
    cleanupAll();
    onClose();
  }, [cleanupAll, onClose]);

  const startScreenShare = useCallback(async () => {
    setErrorMessage(null);
    setPausedFrameUrl(null);

    if (!isScreenShareSupported()) {
      setStatus('unavailable');
      setErrorMessage(
        !window.isSecureContext
          ? 'Live screen sharing requires a secure HTTPS or localhost connection.'
          : 'Live screen sharing is not supported in this browser. You can upload a screenshot instead.',
      );
      return;
    }

    stopMediaStream();
    setStatus('requesting');

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      const videoTrack = displayStream.getVideoTracks()[0];
      if (!videoTrack) {
        displayStream.getTracks().forEach((t) => t.stop());
        setStatus('unavailable');
        setErrorMessage('No video track was returned from the selected display.');
        return;
      }

      const settings = videoTrack.getSettings?.() || {};
      setSurfaceLabel(formatDisplaySurfaceLabel((settings as any).displaySurface));
      if (settings.width && settings.height) {
        setResolutionLabel(`${settings.width} × ${settings.height}`);
      } else {
        setResolutionLabel('');
      }

      videoTrack.onended = () => {
        streamRef.current = null;
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        setPausedFrameUrl(null);
        setStatus('ended');
      };

      streamRef.current = displayStream;
      setStatus('sharing');

      requestAnimationFrame(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      const classified = classifyScreenShareError(err);
      setStatus(classified.status);
      setErrorMessage(classified.message);
    }
  }, [stopMediaStream]);

  // Attach stream to video element whenever ref mounts during sharing state
  useEffect(() => {
    if (status === 'sharing' && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [status]);

  // Launch screen picker automatically once on modal open
  useEffect(() => {
    if (isOpen) {
      if (!hasAutoPromptedRef.current) {
        hasAutoPromptedRef.current = true;
        void startScreenShare();
      }
    } else {
      hasAutoPromptedRef.current = false;
      cleanupAll();
      setStatus('idle');
      setErrorMessage(null);
    }
  }, [isOpen, startScreenShare, cleanupAll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAll();
    };
  }, [cleanupAll]);

  // Escape key closes modal cleanly
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  // Scroll Q&A transcript to latest entry
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, streamingReply]);

  const handleTogglePause = () => {
    if (status === 'sharing') {
      if (videoRef.current && canvasRef.current) {
        const snapshot = captureVideoFrameToDataUrl(videoRef.current, canvasRef.current, 1280, 0.85);
        setPausedFrameUrl(snapshot);
      }
      setStatus('paused');
    } else if (status === 'paused' && streamRef.current) {
      setPausedFrameUrl(null);
      setStatus('sharing');
    }
  };

  const handleStopSharing = () => {
    stopMediaStream();
    setPausedFrameUrl(null);
    setStatus('ended');
  };

  const handleAttachFrameToChat = async () => {
    if (!canvasRef.current) return;
    setIsAttachingFrame(true);
    try {
      let file: File | null = null;
      if (status === 'paused' && pausedFrameUrl) {
        const res = await fetch(pausedFrameUrl);
        const blob = await res.blob();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        file = new File([blob], `screen_share_${timestamp}.jpg`, { type: 'image/jpeg' });
      } else if (videoRef.current && status === 'sharing') {
        file = await captureVideoFrameToFile(videoRef.current, canvasRef.current, 1600, 0.88);
      }

      if (!file) {
        toast.error('Could not capture a screen frame yet. Wait a moment for the preview to load.');
        return;
      }

      saveSharedFileToLibrary(file, 'Screen Share Capture').catch(console.error);
      cleanupAll();
      onCapture(file);
      onClose();
      toast.success('Live screen frame attached to chat.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to capture screen frame.');
    } finally {
      setIsAttachingFrame(false);
    }
  };

  const handleFallbackScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      saveSharedFileToLibrary(file, 'Screen Share Capture').catch(console.error);
      cleanupAll();
      onCapture(file);
      onClose();
      toast.success('Screenshot attached to chat.');
    }
    e.target.value = '';
  };

  const handleAnalyzeScreen = useCallback(
    async (explicitPrompt?: string) => {
      const promptText = (explicitPrompt ?? questionInput).trim() || 'What is on my screen right now? Summarize what you see and suggest next steps if helpful.';
      if (isAnalyzing) return;

      let frameDataUrl: string | null = null;
      if (status === 'paused' && pausedFrameUrl) {
        frameDataUrl = pausedFrameUrl;
      } else if (videoRef.current && canvasRef.current && status === 'sharing') {
        frameDataUrl = captureVideoFrameToDataUrl(videoRef.current, canvasRef.current, 1280, 0.82);
      }

      if (!frameDataUrl) {
        toast.error('Start screen sharing first so Deku AI can see your screen.');
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        toast.error('You are currently offline.');
        return;
      }

      stopCleanSpeech();
      setQuestionInput('');
      setIsAnalyzing(true);
      setStreamingReply('');

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const userTurn: ScreenQaTurn = {
        id: `scr_u_${Date.now()}`,
        role: 'user',
        text: promptText,
        timestamp: nowTime,
      };
      setTurns((prev) => [...prev, userTurn]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const authHeader = await getFirebaseAuthorizationHeader();
        const recentChatHistory = [
          ...conversationMessages.slice(-4).map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || '').slice(0, 1500),
          })),
          ...turns.slice(-4).map((t) => ({
            role: t.role,
            content: t.text,
          })),
          {
            role: 'user',
            content: buildScreenSharePromptPayload(frameDataUrl, promptText),
          },
        ];

        const systemInstruction =
          'You are assisting the user during a live screen share session. Inspect the attached live screenshot carefully and answer the user directly, accurately, and concisely. Read visible text, UI elements, code, or errors faithfully without inventing unseen details. Do not prepend unsolicited greetings or self-introductions.';

        const payload = JSON.stringify({
          messages: recentChatHistory,
          systemInstruction,
          mode: 'chat',
        });

        const requestHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        };

        let response = await fetch('/api/gemini/stream', {
          method: 'POST',
          headers: requestHeaders,
          body: payload,
          signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') || '';
        if ((response.status === 404 || contentType.includes('text/html')) && !controller.signal.aborted) {
          response = await fetch('/.netlify/functions/agent', {
            method: 'POST',
            headers: requestHeaders,
            body: payload,
            signal: controller.signal,
          });
        }

        if (!response.ok || !response.body) {
          const errJson = await response.json().catch(() => null);
          throw new Error(
            errJson?.error ||
              (response.status === 401
                ? 'Please sign in to analyze your live screen.'
                : `Screen analysis request failed (${response.status}).`),
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done || controller.signal.aborted) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const parsed = parseGeminiStreamSseLine(line);
            if (parsed.kind === 'delta' && parsed.text) {
              accumulated += parsed.text;
              setStreamingReply(accumulated);
            } else if (parsed.kind === 'error' && !accumulated.trim()) {
              throw new Error(parsed.error || 'Screen analysis failed.');
            }
          }
        }

        const finalReply = accumulated.trim();
        if (!finalReply) {
          throw new Error('No response was returned. Try asking again.');
        }

        setTurns((prev) => [
          ...prev,
          {
            id: `scr_a_${Date.now()}`,
            role: 'assistant',
            text: finalReply,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        setStreamingReply('');

        onExchangeComplete?.(`[Live Screen Share] ${promptText}`, finalReply);

        if (speakResponses) {
          try {
            speakCleanHumanVoice(finalReply, { rate: 1.05 });
          } catch {
            // Ignore speech synthesis errors
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          const msg = err?.message || 'Unable to analyze screen right now.';
          toast.error(msg);
          setTurns((prev) => [
            ...prev,
            {
              id: `scr_e_${Date.now()}`,
              role: 'assistant',
              text: `Could not complete analysis: ${msg}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
        setStreamingReply('');
      } finally {
        abortRef.current = null;
        setIsAnalyzing(false);
      }
    },
    [
      questionInput,
      isAnalyzing,
      status,
      pausedFrameUrl,
      conversationMessages,
      turns,
      onExchangeComplete,
      speakResponses,
    ],
  );

  const handleToggleVoiceQuestion = () => {
    if (isListeningVoice) {
      stopSpeechRecognition();
      return;
    }
    const SpeechRec = getSpeechRecognitionCtor();
    if (!SpeechRec) {
      toast.error('Voice dictation is not supported in this browser.');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      let finalTranscript = '';

      rec.onstart = () => setIsListeningVoice(true);
      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const transcript = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interim += transcript;
          }
        }
        setQuestionInput((finalTranscript + interim).trim());
      };
      rec.onerror = () => {
        setIsListeningVoice(false);
      };
      rec.onend = () => {
        setIsListeningVoice(false);
        recognitionRef.current = null;
        if (finalTranscript.trim()) {
          void handleAnalyzeScreen(finalTranscript.trim());
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      setIsListeningVoice(false);
      toast.error('Could not start microphone dictation.');
    }
  };

  if (!isOpen) return null;

  const isLiveOrPaused = status === 'sharing' || status === 'paused';

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-white animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label="Live Screen Share"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <MonitorUp size={18} className="text-white shrink-0" />
            <h2 className="text-sm font-semibold tracking-tight truncate">Live Screen Share</h2>
            {isLiveOrPaused && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-zinc-400 truncate">
                <span aria-hidden="true">·</span>
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    status === 'sharing' ? 'bg-red-500 animate-pulse' : 'bg-amber-400',
                  )}
                />
                <span>{status === 'sharing' ? 'Live' : 'Paused'}</span>
                <span aria-hidden="true">·</span>
                <span>{surfaceLabel}</span>
                {resolutionLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{resolutionLabel}</span>
                  </>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const next = !speakResponses;
                setSpeakResponses(next);
                if (!next) stopCleanSpeech();
              }}
              className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title={speakResponses ? 'Mute spoken answers' : 'Read AI answers aloud'}
              aria-label={speakResponses ? 'Mute spoken answers' : 'Read AI answers aloud'}
            >
              {speakResponses ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              aria-label="Close live screen share"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Main Workspace Split: Live Preview + Live AI Q&A */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left: Live Screen Viewport */}
          <div className="flex-1 min-h-[220px] lg:min-h-[420px] bg-zinc-900 flex flex-col justify-between relative overflow-hidden">
            <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
              {status === 'sharing' && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    if (v.videoWidth && v.videoHeight) {
                      setResolutionLabel(`${v.videoWidth} × ${v.videoHeight}`);
                    }
                  }}
                  className="w-full h-full object-contain"
                />
              )}

              {status === 'paused' && pausedFrameUrl && (
                <img
                  src={pausedFrameUrl}
                  alt="Paused screen frame"
                  className="w-full h-full object-contain opacity-90"
                />
              )}

              {status === 'requesting' && (
                <div className="p-6 text-center space-y-2.5 max-w-sm">
                  <MonitorUp size={28} className="mx-auto text-zinc-300 animate-pulse" />
                  <p className="text-sm font-medium text-white">Choose a screen, window, or tab</p>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Select what you want to share in the browser picker to begin live AI screen viewing.
                  </p>
                </div>
              )}

              {(status === 'idle' || status === 'ended') && (
                <div className="p-6 text-center space-y-3 max-w-sm">
                  <div className="w-12 h-12 mx-auto rounded-full bg-zinc-800 flex items-center justify-center text-zinc-200">
                    {status === 'ended' ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
                  </div>
                  <h3 className="text-sm font-semibold text-white">
                    {status === 'ended' ? 'Screen Sharing Stopped' : 'Ready to Share Your Screen'}
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {errorMessage ||
                      'Share a browser tab, window, or full screen so Deku AI can inspect what you see in real time.'}
                  </p>
                  <div className="pt-1 flex flex-col sm:flex-row items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void startScreenShare()}
                      className="w-full sm:w-auto py-2 px-4 rounded-xl bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
                    >
                      {status === 'ended' ? 'Share Screen Again' : 'Start Screen Share'}
                    </button>
                    <button
                      type="button"
                      onClick={() => fallbackFileInputRef.current?.click()}
                      className="w-full sm:w-auto py-2 px-4 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-xs text-zinc-200 font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <ImageIcon size={14} />
                      <span>Upload Screenshot</span>
                    </button>
                  </div>
                </div>
              )}

              {status === 'denied' && (
                <div className="p-6 text-center space-y-3 max-w-sm">
                  <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <ShieldAlert size={22} />
                  </div>
                  <h3 className="text-sm font-semibold text-white">Screen Share Permission Needed</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {errorMessage || 'Allow screen capture permission in your browser settings and retry.'}
                  </p>
                  <div className="pt-1 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void startScreenShare()}
                      className="w-full py-2 px-4 rounded-xl bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
                    >
                      Retry Screen Share
                    </button>
                    <button
                      type="button"
                      onClick={() => fallbackFileInputRef.current?.click()}
                      className="w-full py-2 px-4 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-xs text-zinc-200 font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <ImageIcon size={14} />
                      <span>Upload Screenshot Instead</span>
                    </button>
                  </div>
                </div>
              )}

              {status === 'unavailable' && (
                <div className="p-6 text-center space-y-3 max-w-sm">
                  <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                    <AlertCircle size={22} />
                  </div>
                  <h3 className="text-sm font-semibold text-white">Screen Share Unavailable</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {errorMessage || 'Live screen capture is unavailable in this browser.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => fallbackFileInputRef.current?.click()}
                    className="w-full py-2 px-4 rounded-xl bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <ImageIcon size={14} />
                    <span>Attach Screenshot from Device</span>
                  </button>
                </div>
              )}

              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Preview Toolbar */}
            {isLiveOrPaused && (
              <div className="px-4 py-3 border-t border-zinc-800/80 bg-zinc-950 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePause}
                    className="py-1.5 px-3 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-200 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    {status === 'sharing' ? <Pause size={13} /> : <Play size={13} />}
                    <span>{status === 'sharing' ? 'Pause' : 'Resume'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void startScreenShare()}
                    className="py-1.5 px-3 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-200 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw size={13} />
                    <span>Switch Screen</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopSharing}
                    className="py-1.5 px-3 rounded-xl border border-red-900/60 bg-red-950/40 hover:bg-red-900/50 text-xs font-medium text-red-300 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Square size={12} />
                    <span>Stop</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void handleAttachFrameToChat()}
                  disabled={isAttachingFrame}
                  className="py-1.5 px-3.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Paperclip size={13} />
                  <span>{isAttachingFrame ? 'Capturing…' : 'Attach Frame to Chat'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Right: Live AI Screen Assistant */}
          <div className="w-full lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-zinc-800/80 bg-zinc-950 flex flex-col max-h-[40vh] lg:max-h-none">
            <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Eye size={15} className="text-zinc-300" />
                <span className="text-xs font-semibold text-white">Live Screen Assistant</span>
              </div>
              {isLiveOrPaused && (
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() =>
                    void handleAnalyzeScreen(
                      'Analyze my current screen clearly and point out any errors, key details, or next steps.',
                    )
                  }
                  className="text-xs font-medium text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer disabled:opacity-40"
                >
                  Analyze now
                </button>
              )}
            </div>

            {/* Live Q&A Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {turns.length === 0 && !streamingReply && (
                <div className="text-zinc-400 leading-relaxed space-y-2 py-2">
                  <p className="text-zinc-300 font-medium">Ask anything about what is on your screen.</p>
                  <p>
                    Each question captures your latest live frame automatically—great for debugging errors,
                    reviewing designs, reading charts, or walking through workflows step by step.
                  </p>
                </div>
              )}

              {turns.map((turn) => (
                <div
                  key={turn.id}
                  className={cn(
                    'space-y-1',
                    turn.role === 'user' ? 'text-right' : 'text-left',
                  )}
                >
                  <div className="text-[10px] text-zinc-500">
                    {turn.role === 'user' ? 'You' : 'Deku AI'} · {turn.timestamp}
                  </div>
                  <div
                    className={cn(
                      'inline-block rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-left max-w-full',
                      turn.role === 'user'
                        ? 'bg-white text-black font-medium'
                        : 'bg-zinc-900 text-zinc-100 border border-zinc-800/80',
                    )}
                  >
                    {turn.text}
                  </div>
                </div>
              ))}

              {streamingReply && (
                <div className="space-y-1 text-left">
                  <div className="text-[10px] text-zinc-500">Deku AI · Live</div>
                  <div className="inline-block rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap bg-zinc-900 text-zinc-100 border border-zinc-800/80 max-w-full">
                    {streamingReply}
                  </div>
                </div>
              )}

              {isAnalyzing && !streamingReply && (
                <div className="text-xs text-zinc-400 animate-pulse">Inspecting live screen frame…</div>
              )}

              <div ref={transcriptEndRef} />
            </div>

            {/* Ask Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAnalyzeScreen();
              }}
              className="p-3 border-t border-zinc-800/80 flex items-center gap-2 shrink-0 bg-zinc-950"
            >
              <button
                type="button"
                onClick={handleToggleVoiceQuestion}
                disabled={!isLiveOrPaused || isAnalyzing}
                className={cn(
                  'p-2 rounded-xl border transition-colors cursor-pointer disabled:opacity-40 shrink-0',
                  isListeningVoice
                    ? 'border-red-500/60 bg-red-500/20 text-red-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800',
                )}
                title={isListeningVoice ? 'Stop voice question' : 'Ask by voice'}
                aria-label={isListeningVoice ? 'Stop voice question' : 'Ask by voice'}
              >
                {isListeningVoice ? <MicOff size={15} /> : <Mic size={15} />}
              </button>

              <input
                type="text"
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                disabled={!isLiveOrPaused || isAnalyzing}
                placeholder={isLiveOrPaused ? 'Ask about your screen…' : 'Start sharing to ask…'}
                className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
              />

              <button
                type="submit"
                disabled={!isLiveOrPaused || isAnalyzing}
                className="p-2 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                title="Ask Deku AI about current screen"
                aria-label="Send screen question"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </div>

        {/* Hidden screenshot upload fallback */}
        <input
          ref={fallbackFileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFallbackScreenshotUpload}
          className="hidden"
        />
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
