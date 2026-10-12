import React, { useRef, useEffect, useState } from 'react';
import { 
  ArrowUp,
  Square,
  SquarePen,
  MoreVertical, 
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
  Upload,
  AtSign,
  Plug,
  Settings,
  Zap
} from 'lucide-react';
import { ConnectorsPopupMenu } from '../chat/ConnectorsPopupMenu';
import { ConnectorsStorePanel, CONNECTOR_CATALOG } from '../connectors/ConnectorsStorePanel';
import { ConnectorConfigModal } from '../connectors/ConnectorConfigModal';
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
import { VoiceInputButton } from '../voice/VoiceInputButton';
import { SourceCitations, parseSourcesFromMarkdown } from './SourceCitations';
import { WeatherWidgetCard } from './WeatherWidgetCard';
import { ToolApprovalCard } from './ToolApprovalCard';
import { extractWeatherQuery, fetchWeatherByCity, WeatherData } from '@/lib/weatherService';
import { executeOpenUrl, executeDeviceCommand, VoiceCommandResult } from '@/lib/voiceCommands';
import { GoogleDrivePickerModal } from '../workspace/GoogleDrivePickerModal';
import { WorkspaceToolCard } from '../workspace/WorkspaceToolCard';
import { GoogleMapWidgetCard } from '../maps/GoogleMapWidgetCard';
import { GoogleDriveFileItem } from '@/lib/workspaceTools';
import { WorkspaceMentionPicker, WORKSPACE_CONNECTOR_OPTIONS, WorkspaceConnectorOption } from '../chat/WorkspaceMentionPicker';
import { fetchWorkspaceContextSummary } from '@/lib/workspaceContextService';
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
  onStop: () => void;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLongPrompt = input.length > 120 || input.includes('\n');

  // Grow the composer as the user types or pastes, instead of trapping long prompts in two lines.
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = Math.min(window.innerHeight * 0.45, 420);
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(36, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [expandedSteps, setExpandedSteps] = React.useState<Record<string, boolean>>({});
  const [isThinkHarder, setIsThinkHarder] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [activePlugins, setActivePlugins] = useState<string[]>(['web_search', 'code_sandbox', 'charts']);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<VoiceCommandResult | null>(null);
  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherData>>({});
  const [completedTypewriters, setCompletedTypewriters] = useState<Record<string, boolean>>({});

  const handleTypewriterComplete = React.useCallback((msgKey: string) => {
    setCompletedTypewriters(prev => prev[msgKey] ? prev : { ...prev, [msgKey]: true });
  }, []);

  // Granular robot reaction sync with task status and active execution step
  useEffect(() => {
    if (status === 'error') {
      window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'error' }));
      return;
    }
    
    if (status === 'running' || isLoading) {
      const runningStep = steps.find(s => s.status === 'running');
      if (runningStep) {
        const label = runningStep.label.toLowerCase();
        if (label.includes('search') || label.includes('fetch') || label.includes('research') || label.includes('url')) {
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'searching' }));
        } else if (label.includes('code') || label.includes('data') || label.includes('chart') || label.includes('building') || label.includes('execut') || label.includes('script')) {
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'working' }));
        } else {
          window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'thinking' }));
        }
      } else {
        window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'thinking' }));
      }
      return;
    }

    if (status === 'completed') {
      window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'happy' }));
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [status, isLoading, steps]);
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
  const [isConnectorsMenuOpen, setIsConnectorsMenuOpen] = useState(false);
  const [isConnectorsStoreOpen, setIsConnectorsStoreOpen] = useState(false);
  const [selectedConfigConnectorId, setSelectedConfigConnectorId] = useState<string | null>(null);
  const [activeConnectorTags, setActiveConnectorTags] = useState<string[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState<boolean>(false);
  const [mentionQuery, setMentionQuery] = useState<string>('');
  const [mentionIndex, setMentionIndex] = useState<number>(0);
  const dragCounterRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);

    const lastAt = val.lastIndexOf('@');
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
      const queryAfterAt = val.slice(lastAt);
      if (queryAfterAt.includes(' ')) {
        const potentialTag = queryAfterAt.trim().toLowerCase();
        const matchedOpt = WORKSPACE_CONNECTOR_OPTIONS.find(o => o.tag.toLowerCase() === potentialTag);
        if (matchedOpt) {
          const prefix = val.slice(0, lastAt);
          const suffix = val.slice(lastAt + queryAfterAt.length);
          setInput((prefix + suffix).trimStart());
          setShowMentionPicker(false);
          if (!activeConnectorTags.includes(matchedOpt.id)) {
            setActiveConnectorTags(prev => [...prev, matchedOpt.id]);
            toast.success(`Attached ${matchedOpt.label} context`);
          }
          return;
        }
      } else {
        setShowMentionPicker(true);
        setMentionQuery(queryAfterAt);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentionPicker(false);
  };

  const handleSelectConnectorOption = (option: WorkspaceConnectorOption) => {
    const lastAt = input.lastIndexOf('@');
    let newInput = input;
    if (lastAt !== -1) {
      newInput = input.slice(0, lastAt);
    }
    setInput(newInput.trimStart());
    setShowMentionPicker(false);

    if (!activeConnectorTags.includes(option.id)) {
      setActiveConnectorTags(prev => [...prev, option.id]);
      toast.success(`Attached ${option.label} context`);
    }
  };

  const removeConnectorTag = (tagId: string) => {
    setActiveConnectorTags(prev => prev.filter(t => t !== tagId));
  };

  const handleDriveFileSelect = (driveFile: GoogleDriveFileItem) => {
    const driveText = `[Selected Google Drive File: ${driveFile.name}]\nLink: ${driveFile.webViewLink || 'N/A'}\nType: ${driveFile.mimeType}`;
    onSubmit(driveText);
  };

  // Check user queries for live weather data
  useEffect(() => {
    messages.forEach(async (m) => {
      if (m.role === 'user' && !weatherMap[m.id || m.content]) {
        const query = extractWeatherQuery(m.content || '');
        if (query.isWeather && query.city) {
          const data = await fetchWeatherByCity(query.city);
          if (data) {
            setWeatherMap(prev => ({ ...prev, [m.id || m.content]: data }));
          }
        }
      }
    });
  }, [messages]);

  const handleApproveTool = async () => {
    if (!pendingApproval) return;
    try {
      if (pendingApproval.action === 'open_url' || pendingApproval.action === 'search') {
        if (pendingApproval.url) executeOpenUrl(pendingApproval.url);
      } else {
        await executeDeviceCommand(pendingApproval);
      }
      toast.success(`Executed: ${pendingApproval.targetName}`);
    } catch {
      toast.error('Failed to execute command');
    } finally {
      setPendingApproval(null);
    }
  };

  const handleRejectTool = () => {
    toast.info('Action cancelled');
    setPendingApproval(null);
  };

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
    setActivePlugins(prev => {
      const isPresent = prev.includes(pluginId);
      if (isPresent) {
        setActiveConnectorTags(tags => tags.filter(t => t !== pluginId));
        return prev.filter(p => p !== pluginId);
      } else {
        setActiveConnectorTags(tags => tags.includes(pluginId) ? tags : [...tags, pluginId]);
        return [...prev, pluginId];
      }
    });
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
    if (!input.trim() && !attachedFile && activeConnectorTags.length === 0) return;
    let message = input.trim();

    // Check input or active tags for connectors (@calendar, @gmail, @drive, @workspace, @docs, @sheets, @tasks)
    const detectedTags = new Set<string>(activeConnectorTags);
    const mentions = message.match(/@(github|calendar|gmail|drive|docs|sheets|tasks|workspace|all|schedule|mail)/gi);
    if (mentions) {
      mentions.forEach(m => detectedTags.add(m.replace('@', '').toLowerCase()));
    }

    if (detectedTags.size > 0) {
      const tagsArray = Array.from(detectedTags);
      const workspaceTags = tagsArray.filter(tag =>
        ['calendar', 'gmail', 'drive', 'docs', 'sheets', 'tasks', 'workspace', 'all', 'schedule', 'mail'].includes(tag)
      );
      const appConnectorTags = tagsArray.filter(tag => !workspaceTags.includes(tag));
      if (workspaceTags.length > 0) {
        const toastId = toast.loading(`Fetching live ${workspaceTags.join(', ')} context...`);
        try {
          const workspaceContext = await fetchWorkspaceContextSummary(workspaceTags);
          if (workspaceContext) {
            message = `${message}\n${workspaceContext}`.trim();
            toast.success(`Connected Google Workspace context (${workspaceTags.join(', ')})`, { id: toastId });
          } else {
            toast.dismiss(toastId);
          }
        } catch (err: any) {
          toast.error(`Workspace Context Warning: ${err.message || 'Failed to pull Google context'}`, { id: toastId });
        }
      }

      // Keep non-Workspace connector selections attached to the request instead of
      // silently dropping them when there is no Google Workspace context to append.
      if (appConnectorTags.length > 0) {
        const connectorNames = appConnectorTags.map(tag => {
          const option = WORKSPACE_CONNECTOR_OPTIONS.find(item => item.id === tag) ||
            CONNECTOR_CATALOG.find(item => item.id === tag);
          return option && 'label' in option ? option.label : (option && 'name' in option ? option.name : tag);
        });
        message = `[Requested connectors: ${connectorNames.join(', ')}. Use only integrations/tools that are actually connected and available. If an integration is unavailable, say so clearly and do not claim to have accessed it.]\n${message}`.trim();
      }
    }

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
    setActiveConnectorTags([]);
    setShowMentionPicker(false);
  };

  // Smart auto-follow: follow streamed output while the reader stays near the bottom.
  // If they scroll upward to read earlier messages, stop forcing the scroll position.
  const shouldAutoScrollRef = React.useRef(true);

  const handleConversationScroll = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 120;
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
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
  // Rich results are finalized only after the response lifecycle completes. This prevents
  // out-of-band visualizations/files from appearing while later assistant text is still streaming.
  const isResponseSettled = status === 'completed' && !isLoading;
  const activeRunningStep = steps.find(s => s.status === 'running');
  const typingStatus = activeRunningStep 
    ? activeRunningStep.label 
    : isThinkHarder 
      ? "Manus is reasoning deeply..." 
      : "Manus is thinking...";

  return (
    <div className="flex flex-col h-full bg-manus-cream dark:bg-background relative">
      {/* Chat page actions: new chat and overflow menu */}
      <div className="absolute top-3 right-4 z-30 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setShowChatMenu(false);
            setInput('');
            setAttachedFile(null);
            setActiveConnectorTags([]);
            onReset();
          }}
          className="h-11 w-11 rounded-full flex items-center justify-center bg-white/90 dark:bg-[#292929] text-foreground border border-border/50 shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          title="New chat"
          aria-label="New chat"
        >
          <SquarePen size={21} strokeWidth={2.2} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowChatMenu(prev => !prev)}
            className="h-11 w-11 rounded-full flex items-center justify-center bg-white/90 dark:bg-[#292929] text-foreground border border-border/50 shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            title="Chat options"
            aria-label="Chat options"
            aria-expanded={showChatMenu}
          >
            <MoreVertical size={21} strokeWidth={2.2} />
          </button>
          {showChatMenu && (
            <div className="absolute right-0 top-12 min-w-44 rounded-xl border border-border bg-white dark:bg-[#242424] p-1.5 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setShowChatMenu(false);
                  setInput('');
                  setAttachedFile(null);
                  setActiveConnectorTags([]);
                  onReset();
                }}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              >
                <SquarePen size={16} />
                <span>New chat</span>
              </button>
              {onExport && (
                <button
                  type="button"
                  onClick={() => {
                    setShowChatMenu(false);
                    onExport();
                  }}
                  className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                >
                  <FileText size={16} />
                  <span>Export conversation</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Chat Area */}
      <div ref={containerRef} onScroll={handleConversationScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-20 pt-6 pb-40 space-y-8 custom-scrollbar scroll-smooth">
        
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
                <div key={msg.id || i} className="flex justify-end my-2 chat-message-enter">
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
              const parsedSources = parseSourcesFromMarkdown(cleanedContent);
              // While a response is streaming, the hook may include an empty assistant placeholder.
              // Do not render its Manus header alongside the dedicated thinking indicator.
              if (!cleanedContent && !thought && isAssistantWorking) return null;
              if (!cleanedContent && !thought && raw && (result || chartData)) return null;

              const msgKey = msg.id || `msg-${i}-${cleanedContent.slice(0, 20)}`;
              const isCompleted = Boolean(completedTypewriters[msgKey]);
              const isLatestAssistant = i === list.length - 1 || (i === list.length - 2 && list[list.length - 1]?.role !== 'assistant');
              const shouldAnimate = !isCompleted && isLatestAssistant;

              return (
                <div key={msg.id || i} className="flex gap-4 max-w-3xl mx-auto my-3 chat-message-enter">
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
                        <MarkdownRenderer 
                          content={parsedSources.cleanedContent} 
                          animateTypewriter={shouldAnimate}
                          onTypewriterComplete={() => handleTypewriterComplete(msgKey)}
                        />
                      </div>
                    ) : null}

                    {/* Google Calendar Tool Card Detection */}
                    {isResponseSettled && /(schedule|calendar event|meeting|add event to calendar)/i.test(cleanedContent || '') && (
                      <WorkspaceToolCard
                        type="calendar_event"
                        data={{
                          summary: 'Team Sync & Project Discussion',
                          description: 'Scheduled via Manus Workspace AI Assistant',
                          startDateTime: new Date(Date.now() + 86400000).toISOString(),
                          endDateTime: new Date(Date.now() + 90000000).toISOString(),
                        }}
                      />
                    )}

                    {/* Gmail Draft Tool Card Detection */}
                    {isResponseSettled && /(draft email|email draft|save draft|gmail draft)/i.test(cleanedContent || '') && (
                      <WorkspaceToolCard
                        type="gmail_draft"
                        data={{
                          subject: 'Project Status & Follow-up',
                          body: 'Hi Team,\n\nHere is the updated summary and action items discussed in our current session.\n\nBest regards,\nManus AI',
                        }}
                      />
                    )}

                    {/* Google Maps Widget Detection */}
                    {isResponseSettled && /(map of|location of|show map|google map)/i.test(cleanedContent || '') && (
                      <GoogleMapWidgetCard locationName="Google Headquarters, Mountain View" latitude={37.4220} longitude={-122.0841} />
                    )}

                    {isResponseSettled && parsedSources.sources.length > 0 && (
                      <SourceCitations sources={parsedSources.sources} />
                    )}

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

          if (!isResponseSettled || !result || (!hasChart && !hasFiles)) return null;

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

        <div ref={bottomRef} className="h-36 shrink-0" /> {/* Spacer for bottom input */}
      </div>

      {/* Input Area - Floating Bottom */}
      <div className="absolute bottom-3 left-0 right-0 px-4 flex flex-col items-center gap-2 z-20">
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
            "w-full min-w-0 max-w-3xl box-border bg-[#303030] dark:bg-[#303030] rounded-full shadow-xl border border-white/10 px-3 sm:px-6 py-3 sm:py-3.5 flex flex-row gap-2 sm:gap-4 transition-all focus-within:ring-2 focus-within:ring-primary/20 relative",
            isLongPrompt ? "rounded-3xl items-end" : "items-center",
            isDragging && "ring-2 ring-foreground border-foreground bg-slate-50 dark:bg-slate-900/30"
          )}
        >
          {showMentionPicker && (
            <WorkspaceMentionPicker
              query={mentionQuery}
              selectedIndex={mentionIndex}
              onSelect={handleSelectConnectorOption}
              activeConnectors={activePlugins}
            />
          )}

          {isDragging && (
            <div className="absolute inset-0 bg-slate-100/95 dark:bg-slate-900/95 border-2 border-dashed border-foreground rounded-full flex items-center justify-center gap-3 z-30 backdrop-blur-xs transition-all animate-in fade-in zoom-in duration-200 pointer-events-none">
              <Upload className="w-5 h-5 text-foreground animate-bounce" />
              <span className="font-semibold text-sm text-foreground">Drop files, images or datasets here</span>
            </div>
          )}

          {/* Connectors & Plugins Popup Menu */}
          <ConnectorsPopupMenu
            isOpen={isConnectorsMenuOpen}
            onOpenChange={setIsConnectorsMenuOpen}
            activeConnectors={activePlugins}
            onToggleConnector={handleTogglePlugin}
            onOpenStore={() => setIsConnectorsStoreOpen(true)}
            onOpenConfigModal={(id) => setSelectedConfigConnectorId(id)}
          />

          {/* Compact pill composer: attachment action */}
          <AttachmentMenu
            onFileSelect={handleFileSelect}
            isThinkHarder={isThinkHarder}
            onToggleThinkHarder={() => setIsThinkHarder(prev => !prev)}
            activePlugins={activePlugins}
            onTogglePlugin={handleTogglePlugin}
            onSendMessageToChat={(text) => onSubmit(text)}
            onOpenGoogleDrivePicker={() => setIsDrivePickerOpen(true)}
            onOpenConnectors={() => setIsConnectorsMenuOpen(true)}
          >
            <button type="button" className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors active:scale-95" title="Add attachments or options" aria-label="Add attachments or options">
              <Plus size={28} strokeWidth={1.8} />
            </button>
          </AttachmentMenu>
          <div className="flex-1 min-w-0 flex items-center">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => handleInputChange(e as any)}
              onKeyDown={(e) => {
                if (showMentionPicker) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex(prev => prev + 1);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex(prev => Math.max(0, prev - 1));
                    return;
                  }
                  if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault();
                    const searchTerm = mentionQuery.toLowerCase().replace('@', '');
                    const filteredOptions = WORKSPACE_CONNECTOR_OPTIONS.filter(opt => 
                      opt.tag.toLowerCase().includes(searchTerm) || 
                      opt.label.toLowerCase().includes(searchTerm) ||
                      opt.id.toLowerCase().includes(searchTerm)
                    );
                    if (filteredOptions.length > 0) {
                      const selected = filteredOptions[mentionIndex % filteredOptions.length];
                      handleSelectConnectorOption(selected);
                    }
                    return;
                  }
                  if (e.key === 'Escape') {
                    setShowMentionPicker(false);
                    return;
                  }
                }

                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder={isThinkHarder ? "Ask with deep reasoning..." : "Reply to Manus"}
              className="w-full min-w-0 bg-transparent border-none outline-none resize-none text-white placeholder:text-white/60 text-base sm:text-lg leading-relaxed p-0 focus:ring-0 focus:outline-none min-h-[36px] max-h-[45vh] overflow-y-hidden"
              disabled={isLoading}
            />
          </div>

          {/* Right-side controls inside the pill composer */}
          <div className="flex-1 min-w-0 overflow-hidden">
              {/* Selected Connector Tags */}
              {activeConnectorTags.length > 0 && (
                <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
                  {activeConnectorTags.map((tagId) => {
                    const opt = WORKSPACE_CONNECTOR_OPTIONS.find(o => o.id === tagId) || CONNECTOR_CATALOG.find(c => c.id === tagId);
                    if (!opt) return null;
                    const IconComp = opt.icon;
                    const rawName = 'label' in opt ? opt.label : ('name' in opt ? opt.name : tagId);
                    const cleanName = rawName.replace(/^Google\s+/, '').replace(/^@/, '');
                    const displayName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

                    return (
                      <div 
                        key={tagId} 
                        onClick={() => setSelectedConfigConnectorId(tagId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 text-[#2563eb] dark:text-[#93c5fd] font-semibold text-xs rounded-full cursor-pointer hover:opacity-80 transition-opacity select-none shrink-0"
                        title="Click to view connector parameters or details"
                      >
                        <IconComp className="w-3.5 h-3.5 shrink-0" />
                        <span>{displayName}</span>
                        <button 
                          type="button" 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeConnectorTag(tagId);
                          }}
                          className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-current/70 hover:text-current"
                          title="Remove connector"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 sm:gap-3 shrink-0">
              <VoiceInputButton
                onTranscript={(text) => setInput(prev => prev ? `${prev} ${text}` : text)}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full hover:bg-white/10 transition-colors flex items-center justify-center text-white cursor-pointer"
                size={23}
              />
              <button 
                type="button"
                onClick={isLoading || status === 'running' ? onStop : handleSend}
                disabled={!isLoading && status !== 'running' && (!input.trim() && !attachedFile && activeConnectorTags.length === 0)}
                className={cn(
                  "w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all shadow-2xs",
                  isLoading || status === 'running'
                    ? "bg-white text-black dark:bg-white dark:text-black cursor-pointer hover:scale-105 active:scale-95"
                    : (input.trim() || attachedFile || activeConnectorTags.length > 0)
                      ? "bg-white text-black hover:scale-105 active:scale-95 shadow-md cursor-pointer"
                      : "bg-white/15 text-white/45 cursor-not-allowed"
                )}
                title={isLoading || status === 'running' ? "Stop generating" : "Send message"}
                aria-label={isLoading || status === 'running' ? "Stop generating" : "Send message"}
              >
                {isLoading || status === 'running'
                  ? <Square size={15} fill="currentColor" strokeWidth={3.5} />
                  : <ArrowUp size={20} strokeWidth={3} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Google Drive Picker Modal */}
      <GoogleDrivePickerModal
        isOpen={isDrivePickerOpen}
        onClose={() => setIsDrivePickerOpen(false)}
        onSelectFile={handleDriveFileSelect}
      />

      {/* Connectors & Plugins Store Panel */}
      <ConnectorsStorePanel
        isOpen={isConnectorsStoreOpen}
        onClose={() => setIsConnectorsStoreOpen(false)}
        activeConnectors={activePlugins}
        onToggleConnector={handleTogglePlugin}
      />

      {/* Interactive Connector Details & Configuration Modal */}
      <ConnectorConfigModal
        connectorId={selectedConfigConnectorId}
        isOpen={!!selectedConfigConnectorId}
        onClose={() => setSelectedConfigConnectorId(null)}
        onRemoveConnector={(id) => {
          removeConnectorTag(id);
          if (activePlugins.includes(id)) {
            handleTogglePlugin(id);
          }
        }}
        onInsertPrompt={(promptText) => {
          setInput(prev => prev ? `${prev} ${promptText}` : promptText);
        }}
      />
    </div>
  );
}
