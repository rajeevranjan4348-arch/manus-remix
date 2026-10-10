import React, { useRef, useState } from 'react';
import { Camera, Image, Paperclip, Blocks, Gauge, Brain, Check, X, Sparkles, Globe, Terminal, BarChart2, PhoneCall, Plug, HardDrive } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { VoiceCallModal } from '../voice/VoiceCallModal';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';

export interface AttachmentMenuProps {
  onFileSelect: (file: File) => void;
  isThinkHarder: boolean;
  onToggleThinkHarder: () => void;
  activePlugins?: string[];
  onTogglePlugin?: (pluginId: string) => void;
  onSendMessageToChat?: (text: string) => void;
  onOpenGoogleDrivePicker?: () => void;
  children?: React.ReactNode;
}

const AVAILABLE_PLUGINS = [
  { id: 'web_search', name: 'Web Search', desc: 'Real-time search across the live internet', icon: Globe },
  { id: 'code_sandbox', name: 'Python Sandbox', desc: 'Execute code, process datasets, and generate files', icon: Terminal },
  { id: 'charts', name: 'Chart Visualizer', desc: 'Render interactive dynamic charts and graphs', icon: BarChart2 },
  { id: 'deep_research', name: 'Deep Research', desc: 'Multi-source fact aggregation and document synthesis', icon: Sparkles },
];

export function AttachmentMenu({
  onFileSelect,
  isThinkHarder,
  onToggleThinkHarder,
  activePlugins = ['web_search', 'code_sandbox', 'charts'],
  onTogglePlugin,
  onSendMessageToChat,
  onOpenGoogleDrivePicker,
  children,
}: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPluginsOpen, setIsPluginsOpen] = useState(false);
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      saveSharedFileToLibrary(file, 'Camera Capture').catch(console.error);
      onFileSelect(file);
      setIsOpen(false);
      toast.success(`Photo captured & saved to Library: ${file.name}`);
    }
  };

  const handlePhotosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      saveSharedFileToLibrary(file, 'Photo Attachment').catch(console.error);
      onFileSelect(file);
      setIsOpen(false);
      toast.success(`Image attached & saved to Library: ${file.name}`);
    }
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      saveSharedFileToLibrary(file, 'File Attachment').catch(console.error);
      onFileSelect(file);
      setIsOpen(false);
      toast.success(`File attached & saved to Library: ${file.name}`);
    }
  };

  return (
    <>
      {/* Hidden file inputs for Camera, Photos, and Files */}
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
        accept=".csv,.xlsx,.xls,.pdf,.txt,.json,.doc,.docx"
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
            {/* Voice Call Option */}
            <button
              onClick={() => {
                setIsOpen(false);
                setIsVoiceCallOpen(true);
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <PhoneCall size={20} />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Voice call</span>
                <span className="text-[11px] text-muted-foreground leading-tight">Live interactive voice call</span>
              </div>
            </button>

            {/* Camera Option */}
            <button
              onClick={() => {
                cameraInputRef.current?.click();
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform text-slate-800 dark:text-white">
                <Camera size={20} />
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
                <Image size={20} />
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
                <Paperclip size={20} />
              </div>
              <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Files</span>
            </button>

            {/* Connectors Option (replaced Google Drive) */}
            <button
              onClick={() => {
                setIsOpen(false);
                if (onOpenGoogleDrivePicker) {
                  onOpenGoogleDrivePicker();
                } else {
                  toast.info('Opening Connectors...');
                }
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Plug size={20} />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Connectors</span>
                <span className="text-[11px] text-muted-foreground leading-tight">Google Drive & Workspace tools</span>
              </div>
            </button>

            {/* Plugins Option */}
            <button
              onClick={() => {
                setIsOpen(false);
                setIsPluginsOpen(true);
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-left group cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform text-slate-800 dark:text-white">
                  <Blocks size={20} />
                </div>
                <span className="font-semibold text-base text-slate-900 dark:text-white tracking-tight">Plugins</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white font-medium">
                {activePlugins.length} active
              </span>
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
                  <Brain size={20} />
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

      {/* Plugins Dialog */}
      <Dialog open={isPluginsOpen} onOpenChange={setIsPluginsOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 bg-white dark:bg-[#202124] border border-border dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Blocks size={22} className="text-foreground" />
              Manus Agent Plugins
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Select tools and capabilities available to the agent during execution.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            {AVAILABLE_PLUGINS.map((plugin) => {
              const isEnabled = activePlugins.includes(plugin.id);
              const PluginIcon = plugin.icon;
              return (
                <div
                  key={plugin.id}
                  className="flex items-center justify-between p-3.5 rounded-2xl border border-border dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-white flex items-center justify-center">
                      <PluginIcon size={20} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{plugin.name}</p>
                      <p className="text-xs text-muted-foreground">{plugin.desc}</p>
                    </div>
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={() => onTogglePlugin && onTogglePlugin(plugin.id)}
                  />
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Voice Call Modal (Matches Reference Screenshots) */}
      <VoiceCallModal
        isOpen={isVoiceCallOpen}
        onClose={() => setIsVoiceCallOpen(false)}
        onSendMessageToChat={onSendMessageToChat}
      />
    </>
  );
}
