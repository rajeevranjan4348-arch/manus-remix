import React from 'react';
import { 
  ArrowLeft,
  Globe,
  ExternalLink,
  RefreshCw,
  Monitor,
  Smartphone,
  Check,
  Loader2
} from 'lucide-react';
import { Timeline } from './Timeline';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import type { WebsiteStep } from '@/hooks/useWebsiteBuilder';

interface WebsiteBuilderViewProps {
  websiteName: string;
  steps: WebsiteStep[];
  status: 'running' | 'completed' | 'error';
  onReset: () => void;
  previewUrl: string;
  isLoading: boolean;
}

export function WebsiteBuilderView({ 
  websiteName, 
  steps, 
  status, 
  onReset, 
  previewUrl,
  isLoading
}: WebsiteBuilderViewProps) {
  const [viewMode, setViewMode] = React.useState<'desktop' | 'mobile'>('desktop');
  const [trustDelayPassed, setTrustDelayPassed] = React.useState(false);
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const previewRef = React.useRef<HTMLDivElement>(null);

  // Trust delay for preview - only set when status is completed AND previewUrl is ready
  React.useEffect(() => {
    if (status === 'completed' && previewUrl) {
      // Wait 3s after completion before showing preview
      const timer = setTimeout(() => setTrustDelayPassed(true), 3000);
      return () => clearTimeout(timer);
    } else {
      setTrustDelayPassed(false);
    }
  }, [status, previewUrl]);

  React.useEffect(() => {
    if (sidebarRef.current) {
      gsap.from(sidebarRef.current.children, {
        x: -20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.8,
        ease: 'power3.out'
      });
    }
  }, []);

  React.useEffect(() => {
    if (previewRef.current && previewUrl) {
      gsap.from(previewRef.current, {
        opacity: 0,
        scale: 0.98,
        duration: 0.6,
        ease: 'power2.out'
      });
    }
  }, [previewUrl]);

  const showPreview = trustDelayPassed && previewUrl && status === 'completed';

  return (
    <div className="flex-1 flex flex-col h-full bg-manus-cream overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border bg-white/50 backdrop-blur px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={onReset}
            className="p-2 hover:bg-manus-soft rounded-full transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-primary" />
            <span className="text-sm font-medium">{websiteName}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {status === 'completed' && previewUrl && (
            <>
              <div className="flex items-center gap-1 px-2 py-1 bg-white border border-border rounded-full">
                <button
                  onClick={() => setViewMode('desktop')}
                  className={cn(
                    "p-1.5 rounded-full transition-colors",
                    viewMode === 'desktop' ? "bg-primary text-primary-foreground" : "hover:bg-manus-soft"
                  )}
                >
                  <Monitor size={14} />
                </button>
                <button
                  onClick={() => setViewMode('mobile')}
                  className={cn(
                    "p-1.5 rounded-full transition-colors",
                    viewMode === 'mobile' ? "bg-primary text-primary-foreground" : "hover:bg-manus-soft"
                  )}
                >
                  <Smartphone size={14} />
                </button>
              </div>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-white text-xs font-medium hover:bg-manus-soft transition-all"
              >
                <ExternalLink size={14} />
                Open in New Tab
              </a>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar - Timeline */}
        <div className="w-80 border-r border-border bg-white/30 backdrop-blur overflow-y-auto">
          <div ref={sidebarRef} className="p-6 space-y-8">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Build Progress</h3>
              <p className="text-xs text-muted-foreground">Step-by-step website creation</p>
            </div>
            
            <Timeline steps={steps} />
            
            {status === 'running' && (
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="text-primary animate-spin" />
                  <p className="text-xs text-primary font-medium">Building your website...</p>
                </div>
              </div>
            )}

            {status === 'completed' && !previewUrl && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="text-amber-600 animate-spin" />
                  <p className="text-xs text-amber-600 font-medium">Preparing preview...</p>
                </div>
              </div>
            )}

            {status === 'completed' && previewUrl && !trustDelayPassed && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="text-amber-600 animate-spin" />
                  <p className="text-xs text-amber-600 font-medium">Starting server...</p>
                </div>
              </div>
            )}

            {status === 'completed' && previewUrl && trustDelayPassed && (
              <div className="p-4 rounded-2xl bg-green-50 border border-green-200">
                <div className="flex items-center gap-2">
                  <Check size={14} className="text-green-600" />
                  <p className="text-xs text-green-600 font-medium">Website is live!</p>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200">
                <div className="flex items-center gap-2">
                  <RefreshCw size={14} className="text-red-600" />
                  <p className="text-xs text-red-600 font-medium">Build failed. Please try again.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Preview Area */}
        <div className="flex-1 bg-manus-cream p-8 overflow-hidden">
          <div className="h-full flex items-center justify-center">
            {!showPreview ? (
              <div className="text-center space-y-4">
                {status === 'completed' && previewUrl && !trustDelayPassed ? (
                  <>
                    <Loader2 size={48} className="mx-auto text-primary animate-spin" />
                    <p className="text-muted-foreground">Starting preview server...</p>
                    <p className="text-xs text-muted-foreground/60">This may take a few seconds</p>
                  </>
                ) : status === 'running' || isLoading ? (
                  <>
                    <Globe size={48} className="mx-auto text-muted-foreground/30" />
                    <p className="text-muted-foreground">Building website...</p>
                    <p className="text-xs text-muted-foreground/60">Preview will appear when ready</p>
                  </>
                ) : status === 'error' ? (
                  <>
                    <Globe size={48} className="mx-auto text-red-300" />
                    <p className="text-red-500">Build failed</p>
                    <p className="text-xs text-muted-foreground/60">Please try again</p>
                  </>
                ) : (
                  <>
                    <Globe size={48} className="mx-auto text-muted-foreground/20" />
                    <p className="text-muted-foreground">Preview will appear here</p>
                  </>
                )}
              </div>
            ) : (
              <div 
                ref={previewRef}
                className={cn(
                  "h-full bg-white rounded-3xl shadow-2xl border border-border overflow-hidden transition-all duration-500",
                  viewMode === 'desktop' ? "w-full" : "w-96 max-w-full"
                )}
              >
                <div className="h-10 bg-manus-soft border-b border-border flex items-center px-4 gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 mx-4 bg-white rounded px-3 py-1 text-xs text-muted-foreground truncate">
                    {previewUrl}
                  </div>
                </div>
                <iframe
                  src={previewUrl}
                  className="w-full h-[calc(100%-2.5rem)] border-0"
                  title="Website Preview"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
