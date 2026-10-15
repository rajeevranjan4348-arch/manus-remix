import React, { useRef, useState } from 'react';
import { Camera, Image, Paperclip, Brain, Check, PhoneCall, Plug, Sparkles } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { VoiceCallModal } from '@/components/voice/VoiceCallModal';
import { LiveCameraModal } from '@/components/camera/LiveCameraModal';
import { ImageGenerationModal } from '@/components/ImageGenerationMode';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';
import { validateFile } from '@/lib/fileValidation';

export interface AttachmentMenuProps {
  onFileSelect: (file: File) => void;
  isThinkHarder: boolean;
  onToggleThinkHarder: () => void;
  activePlugins?: string[];
  onTogglePlugin?: (pluginId: string) => void;
  onSendMessageToChat?: (text: string) => void;
  onOpenGoogleDrivePicker?: () => void;
  onOpenConnectors?: () => void;
  children?: React.ReactNode;
}

export function AttachmentMenu({
  onFileSelect,
  isThinkHarder,
  onToggleThinkHarder,
  activePlugins = ['web_search', 'code_sandbox', 'charts'],
  onTogglePlugin,
  onSendMessageToChat,
  onOpenGoogleDrivePicker,
  onOpenConnectors,
  children,
}: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const [isLiveCameraOpen, setIsLiveCameraOpen] = useState(false);
  const [isImageGenOpen, setIsImageGenOpen] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const handleCameraClick = async () => {
    try {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        setIsOpen(false);
        setIsLiveCameraOpen(true);
        return;
      }
    } catch {
      // Fallback
    }
    setIsOpen(false);
    cameraInputRef.current?.click();
  };

  const handleCameraChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const val = await validateFile(file, { acceptTypes: 'image' });
      if (!val.valid) {
        toast.error(val.error || 'Invalid photo');
        return;
      }
      try {
        await saveSharedFileToLibrary(file);
        toast.success(`Photo captured & saved to Library: ${val.sanitizedName}`);
      } catch {
        // Continue
      }
      onFileSelect(file);
      setIsOpen(false);
    }
  };

  const handlePhotosChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const val = await validateFile(file, { acceptTypes: 'image' });
      if (!val.valid) {
        toast.error(val.error || 'Invalid photo');
        return;
      }
      try {
        await saveSharedFileToLibrary(file);
        toast.success(`Image attached & saved to Library: ${val.sanitizedName}`);
      } catch {
        // Continue
      }
      onFileSelect(file);
      setIsOpen(false);
    }
    if (photosInputRef.current) photosInputRef.current.value = '';
  };

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    let attachedCount = 0;
    for (const file of files) {
      const val = await validateFile(file, { acceptTypes: 'file' });
      if (!val.valid) {
        toast.error(`${file.name}: ${val.error || 'Invalid file'}`);
        continue;
      }
      try {
        await saveSharedFileToLibrary(file);
      } catch {
        // Continue
      }
      onFileSelect(file);
      attachedCount++;
    }
    if (attachedCount > 0) {
      toast.success(`Attached ${attachedCount} file${attachedCount > 1 ? 's' : ''}`);
      setIsOpen(false);
    }
    if (filesInputRef.current) filesInputRef.current.value = '';
  };

  const handleInsertGeneratedImage = (imageDataUrl: string, _prompt: string) => {
    try {
      const arr = imageDataUrl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/png';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const ext = mime.includes('png') ? 'png' : 'jpg';
      const filename = `ai-art-${Date.now()}.${ext}`;
      const file = new File([u8arr], filename, { type: mime });
      onFileSelect(file);
      toast.success('Generated image attached to chat!');
    } catch {
      toast.error('Failed to attach image to chat');
    }
  };

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraChange}
        className="hidden"
      />
      <input
        ref={photosInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotosChange}
        className="hidden"
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept=".csv,.xlsx,.xls,.pdf,.txt,.json,.doc,.docx,.md,.py,.js,.ts,.tsx,.html,.css"
        onChange={handleFilesChange}
        className="hidden"
      />

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
        <PopoverContent 
          side="top" 
          align="start" 
          sideOffset={12}
          className="w-72 p-2 rounded-[28px] border border-border dark:border-white/10 bg-white dark:bg-[#202124] text-foreground dark:text-white shadow-2xl overflow-hidden backdrop-blur-xl"
        >
          <div className="flex flex-col gap-1">
            {/* AI Image Generator Option */}
            <button
              onClick={() => {
                setIsOpen(false);
                setIsImageGenOpen(true);
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-600 to-pink-500 text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-xs">
                <Sparkles size={22} strokeWidth={2.4} />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5">
                  Image Generator
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-600 dark:text-purple-300 font-bold">AI</span>
                </span>
                <span className="text-[11px] text-muted-foreground leading-tight">Create artwork & illustrations</span>
              </div>
            </button>

            {/* Voice Call Option */}
            <button
              onClick={() => {
                setIsOpen(false);
                setIsVoiceCallOpen(true);
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <PhoneCall size={22} strokeWidth={2.4} />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Voice call</span>
                <span className="text-[11px] text-muted-foreground leading-tight">Live interactive voice call</span>
              </div>
            </button>

            {/* Camera Option */}
            <button
              onClick={() => {
                void handleCameraClick();
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform text-slate-800 dark:text-white">
                <Camera size={22} strokeWidth={2.4} />
              </div>
              <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Camera</span>
            </button>

            {/* Photos Option */}
            <button
              onClick={() => {
                photosInputRef.current?.click();
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform text-slate-800 dark:text-white">
                <Image size={22} strokeWidth={2.4} />
              </div>
              <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Photos</span>
            </button>

            {/* Files Option */}
            <button
              onClick={() => {
                filesInputRef.current?.click();
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform text-slate-800 dark:text-white">
                <Paperclip size={22} strokeWidth={2.4} />
              </div>
              <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Files</span>
            </button>

            {/* Connectors Option */}
            <button
              onClick={() => {
                setIsOpen(false);
                if (onOpenConnectors) {
                  onOpenConnectors();
                } else if (onOpenGoogleDrivePicker) {
                  onOpenGoogleDrivePicker();
                } else {
                  toast.info('Opening Connectors...');
                }
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Plug size={22} strokeWidth={2.4} className="text-slate-800 dark:text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Connectors</span>
                <span className="text-[11px] text-muted-foreground leading-tight">Google Drive & Workspace tools</span>
              </div>
            </button>

            {/* Think Harder Option */}
            <button
              onClick={() => {
                onToggleThinkHarder();
                if (!isThinkHarder) {
                  toast.success('Think harder enabled: extended chain-of-thought reasoning active');
                } else {
                  toast.info('Think harder mode disabled');
                }
              }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 rounded-2xl transition-colors text-left group cursor-pointer",
                isThinkHarder 
                  ? "bg-purple-500/10 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300" 
                  : "hover:bg-slate-100 dark:hover:bg-white/10"
              )}
            >
              <div className="flex items-center gap-3.5">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform",
                  isThinkHarder
                    ? "bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]"
                    : "bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-white"
                )}>
                  <Brain size={22} strokeWidth={2.4} />
                </div>
                <div className="flex flex-col">
                  <span className={cn(
                    "font-semibold text-base tracking-tight",
                    isThinkHarder ? "text-purple-700 dark:text-purple-300" : "text-slate-900 dark:text-white"
                  )}>
                    Think harder
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Deep chain-of-thought & step analysis
                  </span>
                </div>
              </div>
              <div className={cn(
                "w-5 h-5 rounded-full border flex items-center justify-center transition-colors",
                isThinkHarder 
                  ? "border-purple-600 bg-purple-600 text-white" 
                  : "border-slate-300 dark:border-white/20"
              )}>
                {isThinkHarder && <Check size={12} strokeWidth={3} />}
              </div>
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* AI Image Generation Modal */}
      <ImageGenerationModal
        isOpen={isImageGenOpen}
        onClose={() => setIsImageGenOpen(false)}
        onInsertToChat={handleInsertGeneratedImage}
      />

      {/* Fullscreen Voice Call Modal */}
      <VoiceCallModal
        isOpen={isVoiceCallOpen}
        onClose={() => setIsVoiceCallOpen(false)}
        onSendMessageToChat={onSendMessageToChat}
      />

      {/* Live Camera Modal */}
      <LiveCameraModal
        isOpen={isLiveCameraOpen}
        onClose={() => setIsLiveCameraOpen(false)}
        onCapture={(file) => {
          onFileSelect(file);
          setIsOpen(false);
        }}
      />
    </>
  );
}
