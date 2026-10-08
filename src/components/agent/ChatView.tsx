import React, { useRef, useEffect, useState } from 'react';
import { 
  ArrowUp, 
  Plus, 
  Mic, 
  Search, 
  Globe, 
  MousePointer2, 
  FileCode, 
  Check, 
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Workflow,
  Gauge,
  X,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo, ManusLogo } from '../layout/Logo';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ChartResult } from './ChartResult';
import { FileAttachments } from './FileAttachments';
import { HorizontalLoader } from '../common/HorizontalLoader';
import { AttachmentMenu } from '../chat/AttachmentMenu';
import { Step } from '@/hooks/useAgentTask';
import { gsap } from 'gsap';
import { toast } from 'sonner';

interface ChatViewProps {
  prompt: string;
  messages: any[];
  steps: Step[];
  result: any;
  chartData?: any;
  status: 'idle' | 'running' | 'completed' | 'error';
  onReset: () => void;
  onExport?: () => void;
  onSubmit: (prompt: string) => void;
  isLoading: boolean;
}

export function ChatView({ 
  prompt, 
  messages, 
  steps, 
  result, 
  chartData,
  status, 
  onReset, 
  onExport, 
  onSubmit,
  isLoading 
}: ChatViewProps) {
  const [input, setInput] = React.useState('');
  const [expandedSteps, setExpandedSteps] = React.useState<Record<string, boolean>>({});
  const [isThinkHarder, setIsThinkHarder] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [activePlugins, setActivePlugins] = useState<string[]>(['web_search', 'code_sandbox', 'charts']);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTogglePlugin = (pluginId: string) => {
    setActivePlugins(prev => 
      prev.includes(pluginId) ? prev.filter(p => p !== pluginId) : [...prev, pluginId]
    );
  };

  const handleFileSelect = (file: File) => {
    setAttachedFile(file);
    toast.success(`Attached: ${file.name}`);
  };

  const handleSend = () => {
    if (!input.trim() && !attachedFile) return;
    let message = input.trim();
    if (attachedFile) {
      message = `[Attached: ${attachedFile.name}]\n` + message;
    }
    if (isThinkHarder) {
      message = `[Think Harder / Deep Reasoning Mode]\n` + message;
    }
    onSubmit(message);
    setInput('');
    setAttachedFile(null);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, steps, result, isLoading, status]);

  // Initial animation
  useEffect(() => {
    if (containerRef.current) {
      const ctx = gsap.context(() => {
        gsap.fromTo(
          containerRef.current,
          { opacity: 0, y: 15 },
          { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', clearProps: 'all' }
        );
      }, containerRef);
      return () => ctx.revert();
    }
  }, []);

  // Toggle step expansion
  const toggleStep = (id: string) => {
    setExpandedSteps(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) {
        onSubmit(input);
        setInput('');
      }
    }
  };

  // Helper to clean message content (hide raw JSON outputs that are rendered as UI)
  const cleanMessageContent = (content: string) => {
    if (!content) return '';
    // matches ```json ... ``` or ``` ... ```
    return content.replace(/```(json)?\n[\s\S]*?\n```/g, (match) => {
      // Only remove if it looks like our structured output (graph or files)
      if (
        match.includes('"graph"') || 
        match.includes('"labels"') || 
        match.includes('"datasets"') ||
        match.includes('"files"')
      ) {
        return '';
      }
      return match;
    }).trim();
  };

  // Render a single step (Task Progress Item)
  const renderStep = (step: Step) => {
    const isCompleted = step.status === 'completed';
    const isRunning = step.status === 'running';
    const isExpanded = expandedSteps[step.id] || isRunning;

    return (
      <div key={step.id} className="border border-border/50 rounded-xl bg-white overflow-hidden my-2 animate-in fade-in slide-in-from-bottom-2">
        <button 
          onClick={() => toggleStep(step.id)}
          className="w-full flex items-center justify-between p-3 hover:bg-manus-soft/50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex items-center justify-center w-5 h-5 rounded-full border",
              isCompleted ? "bg-green-500 border-green-500 text-white" : 
              isRunning ? "border-primary border-t-transparent animate-spin" : "border-muted-foreground/30 text-muted-foreground/30"
            )}>
              {isCompleted && <Check size={12} />}
            </div>
            <span className={cn(
              "text-sm font-medium",
              isCompleted || isRunning ? "text-foreground" : "text-muted-foreground"
            )}>
              {step.label}
            </span>
          </div>
          {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </button>

        {isExpanded && step.trace && step.trace.length > 0 && (
          <div className="bg-manus-soft/30 p-3 pt-0 space-y-2 border-t border-border/30">
            <div className="h-2" /> {/* Spacer */}
            {step.trace.map((line, idx) => {
              // Parse trace lines for pills
              let icon = <Check size={12} />;
              let text = line;
              let type = 'default';

              if (line.startsWith('Searching for:')) {
                icon = <Search size={12} />;
                text = line.replace('Searching for:', '').trim();
                type = 'search';
              } else if (line.startsWith('Fetching:')) {
                icon = <Globe size={12} />;
                text = line.replace('Fetching:', '').trim();
                type = 'web';
              } else if (line.startsWith('Reading:')) {
                icon = <FileCode size={12} />;
                text = line.replace('Reading:', '').trim();
                type = 'file';
              } else if (line.includes('Clicking')) {
                icon = <MousePointer2 size={12} />;
                type = 'action';
              }

              return (
                <div key={idx} className="flex items-center gap-2">
                  <div className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border max-w-full truncate",
                    type === 'search' ? "bg-blue-50 text-blue-700 border-blue-100" :
                    type === 'web' ? "bg-green-50 text-green-700 border-green-100" :
                    type === 'file' ? "bg-orange-50 text-orange-700 border-orange-100" :
                    type === 'action' ? "bg-purple-50 text-purple-700 border-purple-100" :
                    "bg-white border-border text-muted-foreground"
                  )}>
                    {icon}
                    <span className="truncate">{text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const isAssistantWorking = isLoading || status === 'running';
  const activeRunningStep = steps.find(s => s.status === 'running');
  const typingStatus = activeRunningStep 
    ? activeRunningStep.label 
    : isThinkHarder 
      ? "Manus is reasoning deeply..." 
      : "Manus is thinking...";

  return (
    <div className="flex flex-col h-full bg-manus-cream dark:bg-background relative">
      {/* Chat Area */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 sm:px-20 py-6 space-y-8 custom-scrollbar scroll-smooth">
        
        {/* Render History Messages */}
        {messages.map((msg, i) => {
           if (msg.role === 'user') {
             // User Message (Right or Top) - Manus uses right aligned for user usually, or just simple text
             return (
               <div key={msg.id || i} className="flex justify-end">
                 <div className="bg-manus-soft px-4 py-2 rounded-2xl rounded-tr-sm text-foreground max-w-[80%]">
                   {msg.content}
                 </div>
               </div>
             );
           }
           return null; // Assistant messages are handled below/differently or we assume single turn task for now?
           // Actually, for a full chat, we should render all.
           // But the screenshot shows "I've received your request..." as the main agent response.
           // Let's render assistant messages normally.
        })}
        
        {/* Render Assistant Messages (Interleaved) */}
        {messages.map((msg, i) => {
          if (msg.role === 'assistant') {
             const cleanedContent = cleanMessageContent(msg.content);
             // If message is empty after cleaning (only contained the JSON), don't render empty bubble unless it's the only content
             if (!cleanedContent && msg.content) return null;

             return (
               <div key={msg.id || i} className="flex gap-4 max-w-3xl mx-auto">
                 <div className="flex-1 space-y-4 min-w-0">
                   <div className="flex items-center gap-3">
                     <ManusLogo showBadge={true} />
                   </div>
                   <div className="prose prose-sm max-w-none text-foreground/90">
                     <MarkdownRenderer content={cleanedContent || msg.content} />
                   </div>
                 </div>
               </div>
             );
          }
          return null;
        })}

        {/* Steps / Task Progress */}
        {steps.length > 0 && (
          <div className="flex gap-4 max-w-3xl mx-auto">
             <div className="w-8 shrink-0" /> {/* Spacer for alignment */}
             <div className="flex-1 min-w-0">
               {steps.map(renderStep)}
             </div>
          </div>
        )}

        {/* Final Result (Chart/Report) */}
        {result && (
          <div className="flex gap-4 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="w-8 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="border border-border/50 rounded-2xl bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                {/* Result Header Removed as requested */}
                
                <div className="p-6">
                  {/* Always show content if available */}
                  {(result.content && !result.chartData) && (
                    <div className="prose prose-sm max-w-none text-foreground/90 mb-4">
                      <MarkdownRenderer content={result.content} />
                    </div>
                  )}

                  {/* Show Chart if available */}
                  {(result.type === 'graph' || result.chartData) && (
                    <div className="mb-4">
                      {result.content && result.chartData && (
                        <div className="prose prose-sm max-w-none text-foreground/90 mb-6">
                          <MarkdownRenderer content={result.content} />
                        </div>
                      )}
                      <div className="h-[300px] w-full">
                        <ChartResult 
                          type={result.detectedChartType || result.type} 
                          data={result.chartData || chartData} 
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Show Files if available */}
                  {result.files && result.files.length > 0 && (
                     <FileAttachments files={result.files} />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Horizontal Loader Animation (Uiverse.io by dexter-st) for Image & Graph Generation */}
        {isAssistantWorking && !result && (
          <div className="flex gap-4 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex-1 space-y-2.5 min-w-0">
              <div className="flex items-center gap-2.5">
                <ManusLogo showBadge={true} />
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 animate-pulse">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                  {typingStatus}
                </span>
              </div>
              
              <div className="pt-1">
                <HorizontalLoader 
                  label={
                    typingStatus.toLowerCase().includes('image')
                      ? "Generating Image"
                      : typingStatus.toLowerCase().includes('graph') || typingStatus.toLowerCase().includes('chart') || typingStatus.toLowerCase().includes('data')
                        ? "Generating Graph"
                        : "Generating"
                  } 
                />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-24" /> {/* Spacer for bottom input */}
      </div>

      {/* Input Area - Floating Bottom */}
      <div className="absolute bottom-6 left-0 right-0 px-4 flex flex-col items-center gap-2 z-20">
        {(attachedFile || isThinkHarder) && (
          <div className="flex items-center gap-2 flex-wrap max-w-3xl w-full px-2">
            {isThinkHarder && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white rounded-full text-xs font-semibold shadow-md animate-in fade-in zoom-in duration-200">
                <Gauge size={13} />
                <span>Think harder</span>
                <button onClick={() => setIsThinkHarder(false)} className="p-0.5 hover:bg-white/20 rounded-full ml-1">
                  <X size={10} />
                </button>
              </div>
            )}
            {attachedFile && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-card border border-border rounded-full text-xs font-medium shadow-md animate-in fade-in zoom-in duration-200">
                <FileText size={13} className="text-primary" />
                <span className="truncate max-w-[150px]">{attachedFile.name}</span>
                <button onClick={() => setAttachedFile(null)} className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full ml-1">
                  <X size={10} />
                </button>
              </div>
            )}
          </div>
        )}
        <div className="w-full max-w-3xl bg-white dark:bg-card rounded-[2rem] shadow-xl border border-border/50 p-2 pl-4 flex items-center gap-2 transition-all focus-within:ring-1 focus-within:ring-primary/20">
          <AttachmentMenu
            onFileSelect={handleFileSelect}
            isThinkHarder={isThinkHarder}
            onToggleThinkHarder={() => setIsThinkHarder(prev => !prev)}
            activePlugins={activePlugins}
            onTogglePlugin={handleTogglePlugin}
            onSendMessageToChat={(text) => onSubmit(text)}
          >
            <button 
              className="p-2 hover:bg-manus-soft dark:hover:bg-accent rounded-full transition-colors text-muted-foreground relative"
              title="Camera, Photos, Files, Plugins, Think harder"
              aria-label="Add attachments or options"
            >
              <Plus size={20} />
              {(attachedFile || isThinkHarder) && (
                <div className="absolute bottom-1 right-1 w-2 h-2 bg-blue-600 rounded-full" />
              )}
            </button>
          </AttachmentMenu>
          <button className="p-2 hover:bg-manus-soft dark:hover:bg-accent rounded-full transition-colors text-muted-foreground">
            <Workflow size={20} />
          </button>
          <input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isThinkHarder ? "Ask with deep reasoning..." : "Send message to Manus..."}
            className="flex-1 bg-transparent border-none outline-none text-base placeholder:text-muted-foreground/50 h-10 text-foreground"
            disabled={isLoading}
          />
          <div className="flex items-center gap-1 pr-1">
             <button className="p-2 hover:bg-manus-soft dark:hover:bg-accent rounded-full transition-colors text-muted-foreground">
               <Mic size={20} />
             </button>
             <button 
               onClick={handleSend}
               disabled={(!input.trim() && !attachedFile) || isLoading}
               className={cn(
                 "p-2 rounded-full transition-all flex items-center justify-center w-10 h-10",
                 (input.trim() || attachedFile) ? "bg-primary text-white" : "bg-manus-soft dark:bg-muted text-muted-foreground"
               )}
             >
               <ArrowUp size={20} />
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}
