import React, { useState, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  ShieldAlert, 
  RefreshCw, 
  X, 
  ExternalLink, 
  Copy, 
  Check, 
  Smartphone, 
  Laptop, 
  Compass,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface MicrophonePermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPermissionGranted?: () => void;
}

export function MicrophonePermissionModal({
  isOpen,
  onClose,
  onPermissionGranted,
}: MicrophonePermissionModalProps) {
  const [deviceTab, setDeviceTab] = useState<'android' | 'desktop' | 'safari'>(() => {
    if (typeof navigator === 'undefined') return 'android';
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua) || (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android'))) {
      return 'safari';
    }
    if (/android|mobile/.test(ua)) {
      return 'android';
    }
    return 'desktop';
  });

  const [isRetrying, setIsRetrying] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        setIsInIframe(window.self !== window.top);
      } catch {
        setIsInIframe(true);
      }
    }
  }, []);

  if (!isOpen) return null;

  const handleCopyUrl = () => {
    if (typeof window !== 'undefined') {
      const url = window.location.href;
      navigator.clipboard?.writeText(url).then(() => {
        setCopiedUrl(true);
        toast.success('App address copied to clipboard');
        setTimeout(() => setCopiedUrl(false), 2500);
      }).catch(() => {
        toast.info(url);
      });
    }
  };

  const handleOpenStandalone = () => {
    if (typeof window !== 'undefined') {
      try {
        window.open(window.location.href, '_blank');
      } catch {
        window.location.reload();
      }
    }
  };

  const handleRetryPermission = async () => {
    setIsRetrying(true);
    setRetryError(null);

    try {
      // 1. First test navigator.mediaDevices.getUserMedia
      if (navigator.mediaDevices?.getUserMedia) {
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (stream) {
            stream.getTracks().forEach(t => t.stop());
            toast.success('Microphone permission granted! 🎙️', { icon: '🎙️' });
            onPermissionGranted?.();
            onClose();
            return;
          }
        } catch (err: any) {
          const errName = err?.name || '';
          if (errName !== 'NotAllowedError' && errName !== 'PermissionDeniedError') {
            // Might be hardware or already used
          }
        }
      }

      // 2. Also test SpeechRecognition if available
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const testRec = new SpeechRecognition();
          testRec.continuous = false;
          testRec.interimResults = false;
          
          let resolved = false;
          await new Promise<boolean>((resolve) => {
            testRec.onstart = () => {
              if (!resolved) {
                resolved = true;
                testRec.abort();
                resolve(true);
              }
            };
            testRec.onerror = (e: any) => {
              if (!resolved) {
                resolved = true;
                if (e.error === 'not-allowed') {
                  resolve(false);
                } else {
                  // other errors like no-speech mean permission was granted
                  resolve(true);
                }
              }
            };
            try {
              testRec.start();
              setTimeout(() => {
                if (!resolved) {
                  resolved = true;
                  try { testRec.abort(); } catch {}
                  resolve(false);
                }
              }, 1800);
            } catch {
              resolve(false);
            }
          }).then((granted) => {
            if (granted) {
              toast.success('Microphone permission granted! 🎙️', { icon: '🎙️' });
              onPermissionGranted?.();
              onClose();
              return;
            }
          });
        } catch {}
      }

      // Check navigator.permissions query
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: 'microphone' as any });
          if (status.state === 'granted') {
            toast.success('Microphone permission granted! 🎙️', { icon: '🎙️' });
            onPermissionGranted?.();
            onClose();
            return;
          }
        } catch {}
      }

      setRetryError('Microphone is still blocked. Please allow access in your browser settings above and tap Try Again.');
      toast.error('Permission still blocked. Follow the steps above in your browser URL bar.');
    } catch (e: any) {
      setRetryError(e.message || 'Could not verify microphone access.');
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md rounded-2xl bg-[#1e1e1e] text-white border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mic-permission-modal-title"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start justify-between border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <ShieldAlert size={22} />
            </div>
            <div>
              <h2 id="mic-permission-modal-title" className="text-base font-semibold text-white tracking-tight">
                Microphone Access Blocked
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Enable microphone in browser settings to speak to Manus
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-zinc-300">
          {isInIframe && (
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-[13px]">
                <ExternalLink size={15} />
                <span>Embedded Preview Detected</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-blue-200/90">
                Browsers often restrict microphone access inside embedded preview frames. Opening Manus directly in a new browser tab ensures full microphone access.
              </p>
              <button
                type="button"
                onClick={handleOpenStandalone}
                className="mt-1 w-full py-1.5 px-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ExternalLink size={14} />
                <span>Open Direct in Chrome / Browser</span>
              </button>
            </div>
          )}

          {/* Device Tabs */}
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 mb-2">
              Select your browser / device:
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/5">
              <button
                type="button"
                onClick={() => setDeviceTab('android')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  deviceTab === 'android'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Smartphone size={14} />
                <span>Android</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceTab('desktop')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  deviceTab === 'desktop'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Laptop size={14} />
                <span>Chrome/PC</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceTab('safari')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  deviceTab === 'safari'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Compass size={14} />
                <span>Safari/iOS</span>
              </button>
            </div>
          </div>

          {/* Instructions Box */}
          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2.5">
            {deviceTab === 'android' && (
              <>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span>How to unblock in Android Chrome:</span>
                </div>
                <ol className="space-y-2 list-decimal list-inside text-zinc-300 leading-relaxed text-[12px]">
                  <li>
                    Tap the <strong className="text-white">tune / page info icon (🎛️ or 🔒)</strong> on the left side of Chrome address bar.
                  </li>
                  <li>
                    Tap <strong className="text-white">Permissions</strong> (or <strong className="text-white">Site settings</strong>).
                  </li>
                  <li>
                    Tap <strong className="text-white">Microphone</strong> and choose <strong className="text-amber-300">Allow</strong> (or tap <strong className="text-white">Reset permissions</strong>).
                  </li>
                  <li>
                    If blocked by phone system: Open Android <strong className="text-white">Settings → Apps → Chrome → Permissions → Microphone → Allow</strong>.
                  </li>
                </ol>
              </>
            )}

            {deviceTab === 'desktop' && (
              <>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span>How to unblock in Chrome / Edge / Brave:</span>
                </div>
                <ol className="space-y-2 list-decimal list-inside text-zinc-300 leading-relaxed text-[12px]">
                  <li>
                    Click the <strong className="text-white">padlock or tune icon (🔒 / 🎛️)</strong> on the left of the address bar.
                  </li>
                  <li>
                    Locate <strong className="text-white">Microphone</strong> in the popup.
                  </li>
                  <li>
                    Switch the dropdown or toggle to <strong className="text-amber-300">Allow</strong>.
                  </li>
                  <li>
                    Return to Manus and click <strong className="text-white">Try Again</strong> below.
                  </li>
                </ol>
              </>
            )}

            {deviceTab === 'safari' && (
              <>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span>How to unblock in Safari (iOS / macOS):</span>
                </div>
                <ol className="space-y-2 list-decimal list-inside text-zinc-300 leading-relaxed text-[12px]">
                  <li>
                    Tap the <strong className="text-white">aA</strong> icon in the Safari search/address bar.
                  </li>
                  <li>
                    Select <strong className="text-white">Website Settings</strong>.
                  </li>
                  <li>
                    Set <strong className="text-white">Microphone</strong> to <strong className="text-amber-300">Allow</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-white">Done</strong> and click <strong className="text-white">Try Again</strong> below.
                  </li>
                </ol>
              </>
            )}
          </div>

          {retryError && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
              <span>{retryError}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-black/40 border-t border-white/10 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleRetryPermission}
            disabled={isRetrying}
            className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRetrying ? 'animate-spin' : ''} />
            <span>{isRetrying ? 'Checking Access...' : 'Try Again / Test Mic 🎙️'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyUrl}
            className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 active:scale-[0.98] text-zinc-200 text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            title="Copy app URL to open in Chrome"
          >
            {copiedUrl ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-3 rounded-xl hover:bg-white/10 active:scale-[0.98] text-zinc-400 hover:text-white text-xs font-medium transition-all cursor-pointer text-center"
          >
            Type Instead
          </button>
        </div>
      </div>
    </div>
  );
}
