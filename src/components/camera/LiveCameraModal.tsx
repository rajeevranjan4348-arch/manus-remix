import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  X, 
  RefreshCw, 
  SwitchCamera, 
  Check, 
  AlertCircle, 
  ShieldAlert, 
  Image as ImageIcon,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';

interface LiveCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function LiveCameraModal({ isOpen, onClose, onCapture }: LiveCameraModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'prompt' | 'granted' | 'denied' | 'unavailable'>('prompt');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileFallbackInputRef = useRef<HTMLInputElement>(null);

  // Stop all camera tracks helper
  const stopAllTracks = (mediaStream?: MediaStream | null) => {
    const s = mediaStream || stream;
    if (s) {
      s.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    }
  };

  // Check available cameras
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length > 1);
      }).catch(() => {});
    }
  }, []);

  // Initialize camera stream
  const startCamera = async (mode: 'environment' | 'user') => {
    stopAllTracks();
    setErrorMessage(null);
    setCapturedDataUrl(null);

    if (!window.isSecureContext) {
      setPermissionStatus('unavailable');
      setErrorMessage('Camera access requires a secure origin (HTTPS or localhost).');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionStatus('unavailable');
      setErrorMessage('Camera access is not supported by this browser.');
      return;
    }

    try {
      setPermissionStatus('prompt');
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      setPermissionStatus('granted');

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      const name = err.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setPermissionStatus('denied');
        setErrorMessage('Camera permission was blocked. Please allow Camera access in your browser site settings.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setPermissionStatus('unavailable');
        setErrorMessage('No camera device was detected on your system.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setPermissionStatus('unavailable');
        setErrorMessage('Camera is currently in use by another application.');
      } else {
        setPermissionStatus('unavailable');
        setErrorMessage(`Could not access camera: ${err.message || 'Unknown error'}`);
      }
    }
  };

  // Launch camera when opened, shut off when closed
  useEffect(() => {
    if (isOpen) {
      startCamera(facingMode);
    } else {
      stopAllTracks();
      setStream(null);
      setCapturedDataUrl(null);
    }

    return () => {
      stopAllTracks();
    };
  }, [isOpen, facingMode]);

  // Flip front / rear camera
  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  // Snap photo to canvas
  const handleSnapPhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsCapturing(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // If front camera, mirror image for natural selfie view
        if (facingMode === 'user') {
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        setCapturedDataUrl(dataUrl);
      }
    } catch (e: any) {
      toast.error('Failed to capture photo: ' + e.message);
    } finally {
      setIsCapturing(false);
    }
  };

  // Retake photo
  const handleRetake = () => {
    setCapturedDataUrl(null);
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  };

  // Confirm photo and attach to conversation
  const handleConfirmPhoto = async () => {
    if (!canvasRef.current || !capturedDataUrl) return;

    canvasRef.current.toBlob(async (blob) => {
      if (!blob) {
        toast.error('Error generating photo file.');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `camera_photo_${timestamp}.jpg`;
      const file = new File([blob], filename, { type: 'image/jpeg' });

      // Save to user library
      saveSharedFileToLibrary(file, 'Camera Capture').catch(console.error);

      // Stop camera tracks immediately
      stopAllTracks();
      onCapture(file);
      onClose();
      toast.success('Photo captured and attached to chat! 📷');
    }, 'image/jpeg', 0.92);
  };

  // Native file input fallback
  const handleFallbackFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      saveSharedFileToLibrary(file, 'Camera Capture').catch(console.error);
      stopAllTracks();
      onCapture(file);
      onClose();
      toast.success('Photo attached from device camera');
    }
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopAllTracks();
          onClose();
        }
      }}
    >
      <div 
        className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-white animate-in zoom-in-95 duration-150 relative"
        role="dialog"
        aria-modal="true"
        aria-label="Camera Capture"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between z-10 bg-zinc-950/80 backdrop-blur-xs">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-emerald-400" />
            <h2 className="text-sm font-semibold tracking-tight">Camera & Vision Capture</h2>
          </div>
          <button 
            type="button"
            onClick={() => {
              stopAllTracks();
              onClose();
            }}
            className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close camera"
          >
            <X size={18} />
          </button>
        </div>

        {/* Video Viewport / Preview Box */}
        <div className="relative aspect-4/3 w-full bg-zinc-900 flex items-center justify-center overflow-hidden">
          {permissionStatus === 'granted' && !capturedDataUrl && (
            <>
              <video 
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn(
                  "w-full h-full object-cover",
                  facingMode === 'user' && "scale-x-[-1]"
                )}
              />
              {/* Flash effect overlay */}
              {isCapturing && (
                <div className="absolute inset-0 bg-white animate-out fade-out duration-200 pointer-events-none" />
              )}
            </>
          )}

          {capturedDataUrl && (
            <img 
              src={capturedDataUrl}
              alt="Captured preview"
              className="w-full h-full object-cover"
            />
          )}

          {/* Hidden Canvas for capture rendering */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Permission Denied Notice */}
          {permissionStatus === 'denied' && (
            <div className="p-6 text-center space-y-3 max-w-xs">
              <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <ShieldAlert size={24} />
              </div>
              <h3 className="text-sm font-semibold">Camera Access Blocked</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Your browser blocked camera permission. To enable, click the lock/settings icon in your browser address bar, set Camera to <strong>Allow</strong>, and retry.
              </p>
              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="w-full py-2 px-3 rounded-xl bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  Retry Camera Access
                </button>
                <button
                  type="button"
                  onClick={() => fileFallbackInputRef.current?.click()}
                  className="w-full py-2 px-3 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-xs text-zinc-300 font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <ImageIcon size={14} />
                  <span>Choose Photo from Device</span>
                </button>
              </div>
            </div>
          )}

          {/* Unavailable / Missing Hardware Notice */}
          {permissionStatus === 'unavailable' && (
            <div className="p-6 text-center space-y-3 max-w-xs">
              <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                <AlertCircle size={24} />
              </div>
              <h3 className="text-sm font-semibold">Camera Unavailable</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {errorMessage || 'Unable to connect to video stream.'}
              </p>
              <button
                type="button"
                onClick={() => fileFallbackInputRef.current?.click()}
                className="w-full py-2 px-3 rounded-xl bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer flex items-center justify-center gap-1.5 mt-2"
              >
                <ImageIcon size={14} />
                <span>Use Device Photo Picker</span>
              </button>
            </div>
          )}
        </div>

        {/* Hidden Fallback Input */}
        <input 
          ref={fileFallbackInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFallbackFileSelect}
          className="hidden"
        />

        {/* Footer Controls */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-950 flex items-center justify-between">
          {!capturedDataUrl ? (
            <>
              {/* Flip camera button */}
              <button
                type="button"
                onClick={toggleFacingMode}
                disabled={permissionStatus !== 'granted'}
                className="p-2.5 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-all cursor-pointer disabled:opacity-40"
                title={`Switch to ${facingMode === 'environment' ? 'Front' : 'Rear'} Camera`}
              >
                <SwitchCamera size={18} />
              </button>

              {/* Shutter capture button */}
              <button
                type="button"
                onClick={handleSnapPhoto}
                disabled={permissionStatus !== 'granted'}
                className="w-14 h-14 rounded-full border-4 border-white/80 p-0.5 flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-40"
                title="Take photo"
                aria-label="Take photo"
              >
                <div className="w-full h-full rounded-full bg-white transition-colors" />
              </button>

              {/* Native picker fallback icon */}
              <button
                type="button"
                onClick={() => fileFallbackInputRef.current?.click()}
                className="p-2.5 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-all cursor-pointer"
                title="Choose from photo library"
              >
                <ImageIcon size={18} />
              </button>
            </>
          ) : (
            <div className="w-full flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleRetake}
                className="flex-1 py-2.5 px-4 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={14} />
                <span>Retake</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmPhoto}
                className="flex-1 py-2.5 px-4 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
              >
                <Check size={14} />
                <span>Attach Photo</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
