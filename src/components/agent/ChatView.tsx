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
  Brain,
  X,
  FileText,
  Upload
} from 'lucide-react';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';
import { cn } from '@/lib/utils';
import { Logo, ManusLogo } from '../layout/Logo';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ChartResult } from './ChartResult';
import { FileAttachments } from './FileAttachments';
import { ContextualThinking } from './ContextualThinking';
import { AttachmentMenu } from '../chat/AttachmentMenu';
import { ThoughtProcess } from './ThoughtProcess';
import { ConversationActionBar } from './ConversationActionBar';
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
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Prevent default browser behavior for global drag/drop to stop browser opening dropped files
  useEffect(() => {
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('dragover', preventDefaults);
    window.addEventListener('drop', preventDefaults);
    return () => {
      window.removeEventListener('dragover', preventDefaults);
      window.removeEventListener('drop', preventDefaults);
    };
  }, []);

  const handleTogglePlugin = (pluginId: string) => {
    setActivePlugins(prev => 
      prev.includes(pluginId) ? prev.filter(p => p !== pluginId) : [...prev, pluginId]
    );
  };

  const handleFileSelect = (file: File) => {
    setAttachedFile(file);
    saveSharedFileToLibrary(file, 'Shared in Chat').catch(err => console.error(err));
    toast.success(`Attached: ${file.name}`);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleSend = async () => {
    if (!input.trim() && !attachedFile) return;
    let message = input.trim();
    if (attachedFile) {
      try {
        const isTextFile = attachedFile.type.startsWith('text/') || 
                           attachedFile.name.endsWith('.csv') || 
                           attachedFile.name.endsWith('.json') || 
                           attachedFile.name.endsWith('.txt') || 
                           attachedFile.name.endsWith('.md') ||
                           attachedFile.name.endsWith('.js') ||
                           attachedFile.name.endsWith('.py');
        if (isTextFile) {
          const textContent = await attachedFile.text();
          const preview = textContent.slice(0, 12000);
          message = `[Attached File: ${attachedFile.name}]\n\`\`\`\n${preview}\n\`\`\`\n${message}`.trim();
        } else {
          message = `[Attached File: ${attachedFile.name} (${(attachedFile.size / 1024).toFixed(1)} KB)]\n${message}`.trim();
        }
      } catch {
        message = `[Attached File: ${attachedFile.name}]\n${message}`.trim();
      }
    }
    if (isThinkHarder) {
      message = `[Think Harder / Deep Reasoning Mode]\n${message}`;
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
  const cleanMessageContent = (content: any) => {
    if (!content) return '';
    const text = typeof content === 'string' ? content : (typeof content === 'object' ? JSON.stringify(content) : String(content));
    return text.replace(/```(json)?\n[\s\S]*?\n```/g, (match) => {
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

  // Helper to extract AI thought process (<think>...</think> or [THOUGHTS]...[/THOUGHTS])
  const extractThoughtProcess = (rawContent: any) => {
    if (!rawContent) return { thought: '', content: '' };
    const rawText = typeof rawContent === 'string' ? rawContent : (typeof rawContent === 'object' ? JSON.stringify(rawContent) : String(rawContent));
    if (!rawText) return { thought: '', content: '' };

    let thought = '';
    let content = rawText;

    // Match closed <think>...</think>
    const thinkMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      thought = thinkMatch[1].trim();
      content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    } else {
      // Match unclosed <think> tag (e.g. streaming thoughts)
      const unclosedMatch = rawText.match(/<think>([\s\S]*)$/i);
      if (unclosedMatch) {
        thought = unclosedMatch[1].trim();
        content = rawText.replace(/<think>[\s\S]*$/i, '').trim();
      }
    }

    // Match [THOUGHTS]...[/THOUGHTS]
    if (!thought) {
      const thoughtsMatch = rawText.match(/\[THOUGHTS?\]([\s\S]*?)\[\/THOUGHTS?\]/i);
      if (thoughtsMatch) {
        thought = thoughtsMatch[1].trim();
        content = rawText.replace(/\[THOUGHTS?\][\s\S]*?\[\/THOUGHTS?\]/gi, '').trim();
      }
    }

    // Strip internal prompt headers if any
    content = content.replace(/^\[MODE:\s*THINK HARDER[^\]]*\]\s*/gi, '').trim();

    return { thought, content };
  };

  // Helper to strip internal prompt instructions or wrappers from user bubbles
  const cleanUserMessage = (raw: any) => {
    if (!raw) return '';
    let text = typeof raw === 'string' ? raw : (typeof raw === 'object' ? JSON.stringify(raw) : String(raw));

    // Strip [Think Harder ...] tags regardless of formatting
    text = text.replace(/^\[Think Harder[^\]]*\]\s*/gi, '');
    text = text.replace(/\[Think Harder[^\]]*\]\s*/gi, '');

    const userMatch = text.match(/(?:User Prompt|User):\s*([\s\S]+)$/i);
    if (userMatch) {
      text = userMatch[1].trim();
    }

    text = text.replace(/\[(?:USER INSTRUCTIONS & PREFERENCES|MODE|USER PROFILE|TONE REQUIREMENT|PROJECT CONTEXT|INSTRUCTION|Attached File)[^\]]*\]\n*/gi, '').trim();

    // Strip any lingering Think Harder mode lines
    text = text.replace(/^\[(?:Think Harder|MODE:[^\]]*THINK HARDER)[^\]]*\]\s*/gim, '').trim();

    const fileHeaderMatch = text.match(/^([\s\S]*?)\n\n(?:File Content to analyze|URL to research):/i);
    if (fileHeaderMatch) {
      text = fileHeaderMatch[1].trim();
    }

    return text || (typeof raw === 'string' ? raw : '');
  };

  // Render a single step (Task Progress Item)
  const renderStep = (step: Step) => {
    const isCompleted = step.status === 'completed';
    const isRunning = step.status === 'running';
    const isExpanded = expandedSteps[step.id] || isRunning;

    return (
      <div key={step.id} className="border border-border/40 rounded-xl bg-card/60 dark:bg-card/60 backdrop-blur-xs overflow-hidden my-2 animate-in fade-in slide-in-from-bottom-2">
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
                    type === 'search' ? "bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white border-slate-200 dark:border-white/10" :
                    type === 'web' ? "bg-green-50 text-green-700 border-green-100" :
                    type === 'file' ? "bg-orange-50 text-orange-700 border-orange-100" :
                    type === 'action' ? "bg-purple-50 text-purple-700 border-purple-100" :
                    "bg-muted/50 border-border/40 text-muted-foreground"
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
        
        {/* Render Conversation Messages in Chronological Order */}
        {(() => {
          const list: any[] = [];
          const seenIds = new Set<string>();
          for (const msg of messages) {
            if (!msg) continue;
            if (msg.id && seenIds.has(msg.id)) continue;
            const prev = list[list.length - 1];
            if (
              prev &&
              prev.role === msg.role &&
              cleanUserMessage(prev.content || '').trim().toLowerCase() === cleanUserMessage(msg.content || '').trim().toLowerCase()
            ) {
              continue;
            }
            if (msg.id) seenIds.add(msg.id);
            list.push(msg);
          }

          return list.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id || i} className="flex justify-end my-2">
                  <div className="bg-primary text-primary-foreground px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm font-medium max-w-[80%] shadow-xs leading-relaxed">
                    {cleanUserMessage(msg.content)}
                  </div>
                </div>
              );
            }

            if (msg.role === 'assistant') {
              const raw = msg.content || '';
              const { thought, content: extracted } = extractThoughtProcess(raw);
              const cleanedContent = cleanMessageContent(extracted || raw);
              // While a response is streaming, the hook may include an empty assistant placeholder.
              // Do not render its Manus header alongside the dedicated thinking indicator.
              if (!cleanedContent && !thought && isAssistantWorking) return null;
              if (!cleanedContent && !thought && raw && (result || chartData)) return null;

              return (
                <div key={msg.id || i} className="flex gap-4 max-w-3xl mx-auto my-3 animate-in fade-in slide-in-from-bottom-1">
                  <div className="flex-1 space-y-3 min-w-0">
                    <div className="flex items-center gap-3">
                      <ManusLogo showBadge={true} />
                    </div>

                    {thought && (
                      <ThoughtProcess
                        thoughtText={thought}
                        defaultExpanded={false}
                      />
                    )}

                    {cleanedContent ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
                        <MarkdownRenderer content={cleanedContent} />
                      </div>
                    ) : null}

                    {cleanedContent ? (
                      <div className="pt-0.5">
                        <ConversationActionBar 
                          content={cleanedContent}
                          onRegenerate={() => {
                            const lastUser = list.slice(0, i).reverse().find((m: any) => m.role === 'user');
                            const promptToReRun = lastUser?.content ? cleanUserMessage(lastUser.content) : prompt;
                            if (promptToReRun) onSubmit(promptToReRun);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }
            return null;
          });
        })()}

        {/* Steps / Task Progress */}
        {steps.length > 0 && (
          <div className="flex gap-4 max-w-3xl mx-auto my-2">
             <div className="w-8 shrink-0" /> {/* Spacer for alignment */}
             <div className="flex-1 min-w-0">
               {steps.map(renderStep)}
             </div>
          </div>
        )}

        {/* Final Result (Chart / Interactive Visualizations / Files) - Only rendered if valid chart or files exist */}
        {(() => {
          const hasChart = Boolean(
            (result?.type === 'graph' || result?.chartData || chartData) &&
            ((result?.chartData?.labels && result.chartData.labels.length > 0) || (chartData?.labels && chartData.labels.length > 0))
          );
          const hasFiles = Boolean(result?.files && Array.isArray(result.files) && result.files.length > 0);

          if (!result || (!hasChart && !hasFiles)) return null;

          return (
            <div className="flex gap-4 max-w-3xl mx-auto my-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <div className="w-8 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="border border-border/60 rounded-2xl bg-white dark:bg-card overflow-hidden shadow-sm hover:shadow-md transition-all p-5">
                  {/* Show Chart if available */}
                  {hasChart && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border/40 pb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-black dark:bg-white inline-block animate-pulse" />
                          {result.detectedChartType ? `${result.detectedChartType.toUpperCase()} CHART` : 'DATA VISUALIZATION'}
                        </span>
                      </div>
                      <div className="h-[320px] w-full pt-2">
                        <ChartResult 
                          type={result.detectedChartType || result.type || 'bar'} 
                          data={result.chartData || chartData} 
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Show Files if available */}
                  {hasFiles && (
                    <div className={cn("pt-2", hasChart && "mt-4 pt-4 border-t border-border/40")}>
                      <FileAttachments files={result.files} />
                    </div>
                  )}

                  {/* Action bar after standalone result */}
                  {!messages.some((m: any) => m?.role === 'assistant') && (
                    <div className="pt-3 mt-3 border-t border-border/40">
                      <ConversationActionBar
                        content={result?.summary || result?.content || result?.text || `${result.detectedChartType || 'Visual'} analysis generated`}
                        onRegenerate={() => onSubmit(cleanUserMessage(prompt))}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Prompt-aware thinking animation: stages adapt to the user's request */}
        {isAssistantWorking && (
          <div className="flex gap-4 max-w-3xl mx-auto my-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex-1 space-y-2.5 min-w-0">
              <div className="flex items-center gap-2.5">
                <ManusLogo showBadge={true} />
              </div>
              <div className="pt-1">
                <ContextualThinking
                  prompt={messages.filter((message: any) => message?.role === 'user').slice(-1)[0]?.content || prompt}
                  activeStep={activeRunningStep?.label}
                  deepMode={isThinkHarder}
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
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-600 text-white rounded-full text-xs font-semibold shadow-md animate-in fade-in zoom-in duration-200">
                <Brain size={14} className="animate-pulse" />
                <span>Deep reasoning</span>
                <button onClick={() => setIsThinkHarder(false)} className="p-0.5 hover:bg-white/20 rounded-full ml-1" title="Remove deep reasoning">
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
        <div 
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "w-full max-w-3xl bg-white dark:bg-card rounded-[2rem] shadow-xl border border-border/50 p-2 pl-4 flex items-center gap-2 transition-all focus-within:ring-1 focus-within:ring-primary/20 relative",
            isDragging && "ring-2 ring-foreground border-foreground bg-slate-50 dark:bg-slate-900/30"
          )}
        >
          {isDragging && (
            <div className="absolute inset-0 bg-slate-100/95 dark:bg-slate-900/95 border-2 border-dashed border-foreground rounded-[2rem] flex items-center justify-center gap-3 z-30 backdrop-blur-xs transition-all animate-in fade-in zoom-in duration-200 pointer-events-none">
              <Upload className="w-5 h-5 text-foreground animate-bounce" />
              <span className="font-semibold text-sm text-foreground">Drop files, images or datasets here</span>
            </div>
          )}
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
            </button>
          </AttachmentMenu>
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
