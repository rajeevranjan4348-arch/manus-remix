import React, { useRef, useEffect, useState } from 'react';
import { 
  ArrowUp,
  ArrowDown,
  Square, 
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
  Zap,
  AlertCircle,
  RotateCw,
  GripVertical
} from 'lucide-react';
import { ConnectorsPopupMenu } from '../chat/ConnectorsPopupMenu';
import { ConnectorsStorePanel, CONNECTOR_CATALOG } from '../connectors/ConnectorsStorePanel';
import { ConnectorConfigModal } from '../connectors/ConnectorConfigModal';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';
import { readFileForAI, formatFileSize } from '@/lib/fileValidation';
import { cn } from '@/lib/utils';
import { Logo, ManusLogo } from '../layout/Logo';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ChartResult } from './ChartResult';
import { FileAttachments } from './FileAttachments';
import { ContextualThinking } from './ContextualThinking';
import { AttachmentMenu } from '../chat/AttachmentMenu';
import { ThoughtProcess } from './ThoughtProcess';
import { ConversationActionBar } from './ConversationActionBar';
import { VoiceInputButton, formatSpeechAutoFill } from '../voice/VoiceInputButton';
import { SourceCitations, parseSourcesFromMarkdown } from './SourceCitations';
import { WeatherWidgetCard } from './WeatherWidgetCard';
import { ToolApprovalCard } from './ToolApprovalCard';
import { extractWeatherQuery, fetchWeatherByCity, WeatherData } from '@/lib/weatherService';
import { executeOpenUrl, executeDeviceCommand, VoiceCommandResult } from '@/lib/voiceCommands';
import { GoogleDrivePickerModal } from '../workspace/GoogleDrivePickerModal';
import { WorkspaceToolCard } from '../workspace/WorkspaceToolCard';
import { GoogleMapWidgetCard } from '../maps/GoogleMapWidgetCard';
import { RoutePlannerCard } from '../maps/RoutePlannerCard';
import { GoogleDriveFileItem } from '@/lib/workspaceTools';
import { WorkspaceMentionPicker, WORKSPACE_CONNECTOR_OPTIONS, WorkspaceConnectorOption } from '../chat/WorkspaceMentionPicker';
import { fetchWorkspaceContextSummary } from '@/lib/workspaceContextService';
import { Step } from '@/hooks/useAgentTask';
import { gsap } from 'gsap';
import { toast } from 'sonner';
import { getChatViewDraft, saveChatViewDraft, clearChatViewDraft } from '@/lib/draftStorage';
import { useAutoSaveChatInput } from '@/hooks/useAutoSaveChatInput';
import { getSettings } from '@/lib/settingsStore';


type ManusMapRequest =
  | { kind: 'route'; origin: string; destination: string }
  | { kind: 'location'; location: string };

function extractManusMapRequest(rawPrompt: string): ManusMapRequest | null {
  const text = String(rawPrompt || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const clean = (value: string) => value.replace(/\b(?:please|on the map|on map)\b/ig, '').replace(/[?.!,;]+$/, '').trim();

  const routePatterns = [
    /\bdistance\s+from\s+(.+?)\s+to\s+(.+?)(?:[?.!,;]|$)/i,
    /\b(?:route|directions|navigate)\s+from\s+(.+?)\s+to\s+(.+?)(?:[?.!,;]|$)/i,
    /\bhow\s+far\s+is\s+(.+?)\s+from\s+(.+?)(?:[?.!,;]|$)/i,
    /\bdistance\s+between\s+(.+?)\s+and\s+(.+?)(?:[?.!,;]|$)/i,
  ];
  for (let i = 0; i < routePatterns.length; i++) {
    const match = text.match(routePatterns[i]);
    if (match) {
      const from = clean(match[1]);
      const to = clean(match[2]);
      if (from && to) return { kind: 'route', origin: from, destination: to };
    }
  }

  const locationPatterns = [
    /\bwhere\s+(?:is|are)\s+(.+?)\s+(?:located|situated)(?:\s|$|[?.!,;])/i,
    /\bwhere\s+(.+?)\s+located(?:\s|$|[?.!,;])/i,
    /\bwhere\s+(.+?)\s+(?:is|are)\s+(?:located|situated)(?:\s|$|[?.!,;])/i,
    /\b(?:show|display|open)\s+(?:me\s+)?(?:the\s+)?map(?:\s+(?:of|for))?\s+(.+?)(?:[?.!,;]|$)/i,
    /\bmap\s+of\s+(.+?)(?:[?.!,;]|$)/i,
    /\bwhere\s+(?:is|are)\s+(.+?)(?:[?.!,;]|$)/i,
    /\b(?:locate|find)\s+(.+?)\s+on\s+(?:the\s+)?map(?:[?.!,;]|$)/i,
  ];
  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      const location = clean(match[1].replace(/\b(?:on the map|on map)\b/ig, ''));
      if (location) return { kind: 'location', location };
    }
  }
  if (/\bshow\s+(?:me\s+)?(?:the\s+)?map\b/i.test(text)) return { kind: 'location', location: 'India' };
  return null;
}

/**
 * Smoothly centers a target element vertically within its scrolling container.
 */
export function centerElementInContainer(
  container: HTMLElement,
  target: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
): number {
  if (!container || !target) return 0;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // Target's top relative to the container scroll coordinate space
  const relativeTargetTop = (targetRect.top - containerRect.top) + container.scrollTop;

  // Compute scroll offset to vertically center the target inside the container viewport
  const centeredTop = relativeTargetTop - (container.clientHeight / 2) + (targetRect.height / 2);
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const finalTop = Math.max(0, Math.min(centeredTop, maxScroll));

  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: finalTop, behavior });
  } else {
    container.scrollTop = finalTop;
  }

  return finalTop;
}

/**
 * Locates the primary search content element in the view.
 * Prioritizes verified source citations, search visual cards, search trace pills, or search assistant messages.
 */
export function findSearchContentElement(container: HTMLElement): HTMLElement | null {
  if (!container) return null;

  // 1. Prioritize verified search source citations
  const citations = container.querySelectorAll<HTMLElement>(
    '[data-testid="search-citations"], .search-content-result, [data-search-citations="true"]'
  );
  if (citations.length > 0) {
    return citations[citations.length - 1];
  }

  // 2. Search result visual cards (charts/files/data visualizations)
  const resultCards = container.querySelectorAll<HTMLElement>(
    '[data-testid="task-result-content"], [data-result-card="true"]'
  );
  if (resultCards.length > 0) {
    return resultCards[resultCards.length - 1];
  }

  // 3. Search step / trace badges
  const searchTraces = container.querySelectorAll<HTMLElement>(
    '[data-search-content="true"], [data-search-step="true"], [data-search-trace="true"]'
  );
  if (searchTraces.length > 0) {
    return searchTraces[searchTraces.length - 1];
  }

  // 4. Any assistant message that answered a search query
  const searchMessages = container.querySelectorAll<HTMLElement>(
    '[data-search-message="true"]'
  );
  if (searchMessages.length > 0) {
    return searchMessages[searchMessages.length - 1];
  }

  return null;
}

export interface ChatViewProps {
  prompt: string;
  messages: any[];
  steps: Step[];
  onReorderSteps?: (newSteps: Step[]) => void;
  result: any;
  chartData?: any;
  status: 'idle' | 'running' | 'completed' | 'error';
  onReset: () => void;
  onExport?: () => void;
  onSubmit: (prompt: string) => void;
  onStop?: () => void;
  isLoading: boolean;
  autoScrollToResults?: boolean;
}

export function ChatView({ 
  prompt, 
  messages, 
  steps, 
  onReorderSteps,
  result, 
  chartData,
  status, 
  onReset, 
  onExport, 
  onSubmit,
  onStop,
  isLoading,
  autoScrollToResults,
}: ChatViewProps) {
  const [input, setInput] = React.useState<string>(() => getChatViewDraft());

  // Local storage persistence: auto-save ChatView draft prompt whenever the user pauses typing for > 500ms
  useAutoSaveChatInput({
    value: input,
    onSave: saveChatViewDraft,
    delay: 500,
  });
  const [localSteps, setLocalSteps] = React.useState<Step[]>(steps);
  const [draggedStepIndex, setDraggedStepIndex] = React.useState<number | null>(null);
  const [dragOverStepIndex, setDragOverStepIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  const handleReorderStep = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= localSteps.length || toIndex >= localSteps.length) return;
    const updated = [...localSteps];
    const [movedItem] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, movedItem);
    setLocalSteps(updated);
    if (onReorderSteps) {
      onReorderSteps(updated);
    }
    toast.success(`Moved step "${movedItem.label}" to #${toIndex + 1}`);
  };

  const [expandedSteps, setExpandedSteps] = React.useState<Record<string, boolean>>({});
  const [isThinkHarder, setIsThinkHarder] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [activePlugins, setActivePlugins] = useState<string[]>(['web_search', 'code_sandbox', 'charts']);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<VoiceCommandResult | null>(null);
  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherData>>({});
  const [completedTypewriters, setCompletedTypewriters] = useState<Record<string, boolean>>({});

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
  const [isListening, setIsListening] = useState<boolean>(false);
  const [interimSpeech, setInterimSpeech] = useState<string>('');
  const dragCounterRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const speechBaseInputRef = useRef<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize chat typing area smoothly as user types while keeping initial height compact
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const targetHeight = Math.max(Math.min(scrollHeight, 90), 22);
      textareaRef.current.style.height = `${targetHeight}px`;
    }
  }, [input]);

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

  const handleDriveFileSelect = (driveFile: GoogleDriveFileItem, contextString?: string) => {
    const textToSend = contextString || `[Selected Google Drive File: ${driveFile.name}]\nLink: ${driveFile.webViewLink || 'N/A'}\nType: ${driveFile.mimeType}`;
    onSubmit(textToSend);
    toast.success(`Sent "${driveFile.name}" as context to AI Agent`);
  };

  // Check user queries for live weather data
  useEffect(() => {
    messages.forEach(async (m, idx) => {
      const msgKey = m.id || m.content;
      if (!weatherMap[msgKey]) {
        const query = extractWeatherQuery(m.content || '');
        if (query.isWeather && query.city) {
          const data = await fetchWeatherByCity(query.city);
          if (data) {
            setWeatherMap(prev => ({
              ...prev,
              [msgKey]: data,
              [query.city!.toLowerCase()]: data,
              [data.locationName.toLowerCase()]: data,
            }));
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
        const aiFile = await readFileForAI(attachedFile);
        if (aiFile.dataUrl) {
          // Multimodal image attachment for vision analysis
          message = `${aiFile.summary}\n[Attached Image Data URL: ${aiFile.dataUrl.slice(0, 100)}...]\n${message}`.trim();
        } else {
          message = `${aiFile.summary}\n${message}`.trim();
        }
      } catch (err: any) {
        console.warn('File reading error:', err);
        message = `[Attached File: ${attachedFile.name} (${formatFileSize(attachedFile.size)})]\n${message}`.trim();
      }
    }
    if (isThinkHarder) {
      message = `[Think Harder / Deep Reasoning Mode]\n${message}`;
    }
    onSubmit(message);
    clearChatViewDraft();
    setInput('');
    setAttachedFile(null);
    setActiveConnectorTags([]);
    setShowMentionPicker(false);
  };

  // Smart auto-follow: follow streamed output while the reader stays near the bottom.
  // If they scroll upward to read earlier messages, stop forcing the scroll position.
  const shouldAutoScrollRef = React.useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const displayMessages = React.useMemo(() => {
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
    return list;
  }, [messages]);

  // Determine if the agent is actively streaming a response
  const isStreamingResponse = React.useMemo(() => {
    if (isLoading || status === 'running') return true;
    const hasRunningStep = steps.some(s => s.status === 'running');
    if (hasRunningStep) return true;
    const lastMsg = displayMessages[displayMessages.length - 1];
    if (lastMsg?.role === 'assistant' && (lastMsg.status === 'streaming' || (lastMsg as any).isStreaming)) {
      return true;
    }
    return false;
  }, [isLoading, status, steps, displayMessages]);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = containerRef.current;
    if (container) {
      shouldAutoScrollRef.current = true;
      setShowScrollToBottom(false);
      if (behavior === 'smooth') {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, []);

  const handleTypewriterComplete = React.useCallback((msgKey: string) => {
    setCompletedTypewriters(prev => prev[msgKey] ? prev : { ...prev, [msgKey]: true });
    if (isStreamingResponse && shouldAutoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [isStreamingResponse]);

  const handleConversationScroll = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceFromBottom < 80;
    shouldAutoScrollRef.current = isAtBottom;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  // When a streaming response begins, reset auto-scroll lock to true and align to bottom.
  // When the stream finishes, automatically center the search content in the view.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreamingResponse && !prevStreamingRef.current) {
      shouldAutoScrollRef.current = true;
      setShowScrollToBottom(false);
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    } else if (!isStreamingResponse && prevStreamingRef.current) {
      // The stream just finished! Trigger Auto-scroll to results if enabled
      const userSettings = getSettings();
      const shouldAutoScrollToResults = autoScrollToResults ?? (userSettings.autoScrollToResults !== false);
      if (shouldAutoScrollToResults) {
        const timer = setTimeout(() => {
          if (containerRef.current) {
            const searchTarget = findSearchContentElement(containerRef.current);
            if (searchTarget) {
              centerElementInContainer(containerRef.current, searchTarget, 'smooth');
            }
          }
        }, 120);
        return () => clearTimeout(timer);
      }
    }
    prevStreamingRef.current = isStreamingResponse;
  }, [isStreamingResponse, autoScrollToResults]);

  // Keep scroll position at the bottom during active streaming token/step updates
  useEffect(() => {
    if (isStreamingResponse && shouldAutoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, steps, result, isStreamingResponse]);

  // Auto-scroll observer for the ChatView component:
  // Keeps the scroll position at the bottom ONLY when the agent is streaming a response.
  // Observes content mutations and dimensional resizes while streaming, disconnecting when idle.
  useEffect(() => {
    const container = containerRef.current;
    // Disconnect and do nothing when not streaming - allowing user to freely browse past messages
    if (!container || !isStreamingResponse) return;

    let rafId: number | null = null;
    const scrollDownIfAllowed = () => {
      if (!shouldAutoScrollRef.current || !container) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    };

    // 1. ResizeObserver: Observes height expansion of container and child elements as tokens stream in
    const resizeObserver = new ResizeObserver(() => {
      scrollDownIfAllowed();
    });

    resizeObserver.observe(container);
    Array.from(container.children).forEach(child => resizeObserver.observe(child));

    // 2. MutationObserver: Observes characterData and childList updates for real-time text streaming
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            resizeObserver.observe(node);
          }
        });
      }
      scrollDownIfAllowed();
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Ensure immediate bottom alignment on observer mount
    scrollDownIfAllowed();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [isStreamingResponse]);

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
        clearChatViewDraft();
        setInput('');
      }
    }
  };

  // Helper to clean message content (hide raw JSON outputs that are rendered as UI)
  const cleanMessageContent = (content: any) => {
    if (!content) return '';
    let text = typeof content === 'string' ? content : (typeof content === 'object' ? JSON.stringify(content) : String(content));
    
    // Remove raw planner/step_index log lines if present
    text = text.replace(/\{"step_index"[\s\S]*?\}/g, '');
    text = text.replace(/^\{.*?"source"\s*:\s*"(?:MODEL|PLANNER_RESPONSE)".*?\}$/gm, '');
    
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
  const renderStep = (step: Step, index: number) => {
    const isCompleted = step.status === 'completed';
    const isRunning = step.status === 'running';
    const isExpanded = expandedSteps[step.id] || isRunning;
    const isDragging = draggedStepIndex === index;
    const isDragOver = dragOverStepIndex === index && draggedStepIndex !== index;
    const isSearchStep = /search|research|query|google|web/i.test(step.label || '') || Boolean(step.trace?.some(t => /search/i.test(t)));

    return (
      <div 
        key={step.id} 
        draggable={true}
        data-search-step={isSearchStep ? "true" : undefined}
        data-search-content={isSearchStep ? "true" : undefined}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', String(index));
          setDraggedStepIndex(index);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverStepIndex !== index) {
            setDragOverStepIndex(index);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (draggedStepIndex !== null) {
            handleReorderStep(draggedStepIndex, index);
            setDraggedStepIndex(null);
            setDragOverStepIndex(null);
          }
        }}
        onDragEnd={() => {
          setDraggedStepIndex(null);
          setDragOverStepIndex(null);
        }}
        className={cn(
          "relative border border-border/40 rounded-xl bg-card/60 dark:bg-card/60 backdrop-blur-xs overflow-hidden my-2 transition-all group",
          isDragging && "opacity-40 ring-2 ring-primary/40 border-dashed scale-[0.99]",
          isDragOver && "border-primary ring-1 ring-primary/30 shadow-md",
          "animate-in fade-in slide-in-from-bottom-2"
        )}
      >
        {isDragOver && (
          <div className="absolute top-0 inset-x-0 h-1 bg-primary rounded-full z-20 shadow-xs" />
        )}

        <div className="flex items-center">
          {/* Drag Handle */}
          <div 
            className="pl-2.5 pr-1 py-3 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-foreground transition-colors touch-none select-none"
            title="Drag to reorder step"
          >
            <GripVertical size={14} />
          </div>

          <button 
            type="button"
            onClick={() => toggleStep(step.id)}
            className="flex-1 flex items-center justify-between p-3 pl-1 hover:bg-manus-soft/50 transition-colors text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[10px] font-mono text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40 font-semibold shrink-0">
                #{index + 1}
              </span>
              <div className={cn(
                "flex items-center justify-center w-5 h-5 rounded-full border shrink-0",
                isCompleted ? "bg-green-500 border-green-500 text-white" : 
                isRunning ? "border-primary border-t-transparent animate-spin" : "border-muted-foreground/30 text-muted-foreground/30"
              )}>
                {isCompleted && <Check size={12} />}
              </div>
              <span className={cn(
                "text-sm font-medium truncate",
                isCompleted || isRunning ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.label}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Quick accessible move buttons for touch & keyboard */}
              <div 
                className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReorderStep(index, index - 1);
                  }}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors"
                  title="Move step up"
                  aria-label="Move step up"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  disabled={index === localSteps.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReorderStep(index, index + 1);
                  }}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors"
                  title="Move step down"
                  aria-label="Move step down"
                >
                  <ChevronDown size={13} />
                </button>
              </div>

              {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
            </div>
          </button>
        </div>

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
                <div 
                  key={idx} 
                  data-search-content={type === 'search' ? "true" : undefined}
                  data-search-trace={type === 'search' ? "true" : undefined}
                  className="flex items-center gap-2"
                >
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
  const hasVisibleAssistantMessage = displayMessages.some((m: any) => {
    if (m?.role !== 'assistant') return false;
    const raw = m.content || '';
    const { thought, content: extracted } = extractThoughtProcess(raw);
    const cleanedContent = cleanMessageContent(extracted || raw);
    return Boolean(cleanedContent || thought);
  });
  const activeRunningStep = steps.find(s => s.status === 'running');
  const latestUserMsg = [...displayMessages].reverse().find((m: any) => m?.role === 'user')?.content || prompt;
  const weatherQuery = extractWeatherQuery(latestUserMsg);

  let typingStatus = activeRunningStep?.label;
  if (!typingStatus && isAssistantWorking) {
    if (weatherQuery.isWeather && weatherQuery.city) {
      typingStatus = `Searching weather data for ${weatherQuery.city}...`;
    } else if (weatherQuery.isWeather) {
      typingStatus = 'Searching weather data...';
    } else if (/(search|google|news|latest|breaking|fact|verify)/i.test(latestUserMsg)) {
      typingStatus = 'Searching live web sources...';
    } else if (/@[\w_]+/.test(latestUserMsg)) {
      typingStatus = 'Connecting to workspace tools...';
    } else if (isThinkHarder) {
      typingStatus = 'Manus is reasoning deeply...';
    } else {
      typingStatus = 'Manus is thinking...';
    }
  }

  return (
    <div className="flex flex-col h-full bg-manus-cream dark:bg-background relative">
      {/* Chat Area */}
      <div ref={containerRef} onScroll={handleConversationScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-20 pt-6 pb-40 space-y-8 custom-scrollbar">
        
        {/* Render Conversation Messages in Chronological Order */}
        {displayMessages.map((msg, i) => {
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
            const isLatestAssistant = i === displayMessages.length - 1 || (i === displayMessages.length - 2 && displayMessages[displayMessages.length - 1]?.role !== 'assistant');
            const shouldAnimate = !isCompleted && isLatestAssistant;

            const prevUserMsg = i > 0 ? displayMessages[i - 1] : null;
            const hasSources = parsedSources.sources.length > 0;
            const isSearchRelated = hasSources || 
              Boolean(prevUserMsg && /(search|google|news|latest|breaking|find|who is|what is|verify|weather)/i.test(prevUserMsg.content || '')) ||
              /(search results|sources|citations|found from web)/i.test(cleanedContent || '');

            return (
              <div 
                key={msg.id || i} 
                data-search-content={isSearchRelated ? "true" : undefined}
                data-search-message={isSearchRelated ? "true" : undefined}
                className="flex gap-4 max-w-3xl mx-auto my-3 chat-message-enter"
              >
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
                        onTypewriterTick={() => {
                          if (isStreamingResponse && shouldAutoScrollRef.current && containerRef.current) {
                            containerRef.current.scrollTop = containerRef.current.scrollHeight;
                          }
                        }}
                      />
                    </div>
                  ) : null}

                  {/* Google Calendar Tool Card Detection */}
                  {/(schedule|calendar event|meeting|add event to calendar)/i.test(cleanedContent || '') && (
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
                  {/(draft email|email draft|save draft|gmail draft)/i.test(cleanedContent || '') && (
                    <WorkspaceToolCard
                      type="gmail_draft"
                      data={{
                        subject: 'Project Status & Follow-up',
                        body: 'Hi Team,\n\nHere is the updated summary and action items discussed in our current session.\n\nBest regards,\nManus AI',
                      }}
                    />
                  )}

                  {/* Google Doc Tool Card Detection */}
                  {/(create google doc|new google doc|doc proposal|draft document)/i.test(cleanedContent || '') && (
                    <WorkspaceToolCard
                      type="google_doc"
                      data={{
                        title: 'Workspace Document',
                        content: cleanedContent.slice(0, 300) + '...',
                      }}
                    />
                  )}

                  {/* Google Sheet Tool Card Detection */}
                  {/(create google sheet|spreadsheet proposal|new spreadsheet)/i.test(cleanedContent || '') && (
                    <WorkspaceToolCard
                      type="google_sheet"
                      data={{
                        title: 'Workspace Spreadsheet',
                        values: [['Item', 'Category', 'Status', 'Date']],
                      }}
                    />
                  )}

                  {/* Google Slide Tool Card Detection */}
                  {/(create presentation|slides presentation|new google slide)/i.test(cleanedContent || '') && (
                    <WorkspaceToolCard
                      type="google_slide"
                      data={{
                        title: 'Workspace Presentation Deck',
                      }}
                    />
                  )}

                  {/* Google Meet Tool Card Detection */}
                  {/(google meet|instant meeting|video call link)/i.test(cleanedContent || '') && (
                    <WorkspaceToolCard
                      type="google_meet"
                      data={{
                        summary: 'Manus Video Meeting',
                        startDateTime: new Date().toISOString(),
                        endDateTime: new Date(Date.now() + 3600000).toISOString(),
                      }}
                    />
                  )}

                  {/* Google Task Tool Card Detection */}
                  {/(add to-do|create task|new task list|google task)/i.test(cleanedContent || '') && (
                    <WorkspaceToolCard
                      type="google_task"
                      data={{
                        title: 'Follow-up Task',
                        notes: 'Created via Manus Assistant',
                      }}
                    />
                  )}

                  {/* Map intent comes from the user's question, while the assistant response remains the direct answer. */}
                  {isLatestAssistant && (() => {
                    const latestUserMessage = [...messages].reverse().find((message: any) => message?.role === 'user')?.content;
                    const latestUserPrompt = typeof latestUserMessage === 'string' ? latestUserMessage : (latestUserMessage?.text || prompt || '');
                    const mapRequest = extractManusMapRequest(String(latestUserPrompt));
                    if (!mapRequest) return null;
                    if (mapRequest.kind === 'route') {
                      return <RoutePlannerCard key={`route-${mapRequest.origin}-${mapRequest.destination}`} initialOrigin={mapRequest.origin} initialDestination={mapRequest.destination} autoCalculate />;
                    }
                    return <GoogleMapWidgetCard key={`location-${mapRequest.location}`} locationName={mapRequest.location} zoom={12} />;
                  })()}

                  {/* Weather Widget Card Detection */}
                  {(() => {
                    const prevUserMsg = i > 0 ? displayMessages[i - 1] : null;
                    const wData = weatherMap[msg.id] || 
                      weatherMap[msg.content] || 
                      (prevUserMsg ? (weatherMap[prevUserMsg.id] || weatherMap[prevUserMsg.content]) : null) ||
                      (Object.keys(weatherMap).length > 0 ? Object.values(weatherMap)[0] : null);
                    
                    const isWeatherContent = /(weather|temperature|forecast|humidity|celsius|fahrenheit|open-meteo|climate)/i.test(cleanedContent || '') ||
                      (prevUserMsg && /(weather|temperature|forecast|delhi|mumbai|london|tokyo|city)/i.test(prevUserMsg.content || ''));

                    if (wData && isWeatherContent) {
                      return <WeatherWidgetCard data={wData} className="my-3 animate-weather-card" />;
                    }
                    return null;
                  })()}

                  {parsedSources.sources.length > 0 && (
                    <SourceCitations sources={parsedSources.sources} />
                  )}

                  {isAssistantWorking && isLatestAssistant && (
                    <div className="pt-1">
                      <ContextualThinking
                        prompt={messages.filter((message: any) => message?.role === 'user').slice(-1)[0]?.content || prompt}
                        activeStep={activeRunningStep?.label}
                        deepMode={isThinkHarder}
                      />
                    </div>
                  )}

                  {cleanedContent ? (
                    <div className="pt-0.5">
                      <ConversationActionBar 
                        content={cleanedContent}
                        onRegenerate={() => {
                          const lastUser = displayMessages.slice(0, i).reverse().find((m: any) => m.role === 'user');
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
        })}

        {/* Live tool-call progress; automatically disappears on success, stop, or error. */}
        {isAssistantWorking && activeRunningStep && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-3 max-w-3xl mx-auto my-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm animate-in fade-in slide-in-from-bottom-2"
          >
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full bg-primary/20 animate-ping" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            <span className="min-w-0">
              <span className="font-medium text-foreground">
                {(() => {
                  const label = activeRunningStep.label || 'Processing request';
                  if (/weather/i.test(label)) return 'Searching weather data...';
                  if (/search|research|web/i.test(label)) return 'Searching the web...';
                  if (/tool|connector|calendar|gmail|drive/i.test(label)) return `Running tool: ${label}...`;
                  if (/fetch|load|read/i.test(label)) return `Fetching data: ${label}...`;
                  return `${label}...`;
                })()}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">Manus is working on this step</span>
            </span>
          </div>
        )}

        {/* Steps / Task Progress */}
        {localSteps.length > 0 && (
          <div className="flex gap-4 max-w-3xl mx-auto my-2">
             <div className="w-8 shrink-0" /> {/* Spacer for alignment */}
             <div className="flex-1 min-w-0">
               <div className="flex items-center justify-between pb-1.5 px-1 text-xs text-muted-foreground font-medium select-none">
                 <div className="flex items-center gap-1.5">
                   <Workflow size={13} className="text-primary" />
                   <span>Execution Steps ({localSteps.length})</span>
                 </div>
                 <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                   <GripVertical size={12} className="text-muted-foreground/50" />
                   <span className="hidden sm:inline">Drag handle or use arrows to reorder</span>
                   <span className="sm:hidden">Drag to reorder</span>
                 </div>
               </div>
               {localSteps.map((step, idx) => renderStep(step, idx))}
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
            <div 
              data-search-content="true"
              data-testid="task-result-content"
              className="flex gap-4 max-w-3xl mx-auto my-4 animate-in fade-in slide-in-from-bottom-3 duration-500"
            >
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
        {isAssistantWorking && !hasVisibleAssistantMessage && (
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

        {/* Error State Card with Retry & Reset Controls */}
        {status === 'error' && !isAssistantWorking && (
          <div className="flex gap-4 max-w-3xl mx-auto my-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="w-8 shrink-0 flex items-start pt-1">
              <div className="w-8 h-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <AlertCircle size={16} />
              </div>
            </div>
            <div className="flex-1 space-y-2.5 min-w-0">
              <div className="p-4 rounded-2xl bg-destructive/5 border border-destructive/20 text-sm">
                <p className="font-semibold text-destructive mb-1">Execution Interrupted</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  The stream was interrupted or the AI provider is temporarily unavailable. Check your connection and API key/provider settings, then select Retry.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const lastUser = [...displayMessages].reverse().find((m: any) => m.role === 'user');
                      const promptToRetry = lastUser?.content ? cleanUserMessage(lastUser.content) : prompt;
                      if (promptToRetry) onSubmit(promptToRetry);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-white hover:bg-destructive/90 text-xs font-medium transition-all shadow-xs cursor-pointer"
                  >
                    <RotateCw size={13} />
                    <span>Retry Request</span>
                  </button>
                  <button
                    type="button"
                    onClick={onReset}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium transition-all cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    <span>Reset</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-36 shrink-0" /> {/* Spacer for bottom input */}
      </div>

      {/* Floating Scroll-to-bottom and Center Search Results buttons when user scrolled up */}
      {showScrollToBottom && (
        <div className="absolute bottom-44 right-4 sm:right-12 z-30 flex items-center gap-2">
          {(() => {
            const hasSearch = containerRef.current && findSearchContentElement(containerRef.current);
            if (!hasSearch) return null;
            return (
              <button
                type="button"
                onClick={() => {
                  if (containerRef.current) {
                    const el = findSearchContentElement(containerRef.current);
                    if (el) centerElementInContainer(containerRef.current, el, 'smooth');
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white dark:bg-card border border-border/80 text-foreground shadow-md hover:shadow-lg hover:border-primary/50 hover:scale-105 active:scale-95 transition-all text-xs font-semibold cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-200"
                title="Center search results in view"
                aria-label="Center search results in view"
              >
                <Search size={13} className="text-primary" />
                <span>Center search results</span>
              </button>
            );
          })()}
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all text-xs font-semibold cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-200"
            title="Scroll to latest message"
            aria-label="Scroll to latest message"
          >
            <ArrowDown size={14} className="animate-bounce" />
            <span>Latest message</span>
          </button>
        </div>
      )}

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
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white dark:bg-card border border-border rounded-full text-xs font-medium shadow-md animate-in fade-in zoom-in duration-200">
                <FileText size={13} className="text-primary" />
                <span className="truncate max-w-[150px] font-semibold">{attachedFile.name}</span>
                <span className="text-[10px] text-muted-foreground uppercase">({formatFileSize(attachedFile.size)})</span>
                <button onClick={() => setAttachedFile(null)} className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full ml-1" title="Remove attachment">
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
            "w-full max-w-3xl bg-white dark:bg-[#1a1b1e] rounded-[1.75rem] sm:rounded-[2rem] shadow-xl border border-slate-200/80 dark:border-border/60 px-3.5 py-2.5 sm:px-4.5 sm:py-3 flex flex-col gap-1.5 sm:gap-2 transition-[box-shadow,border-color,background-color] duration-200 ease-out focus-within:ring-2 focus-within:ring-primary/20 relative gpu-accelerated",
            isDragging && "ring-2 ring-foreground border-foreground bg-slate-50 dark:bg-slate-900/30",
            isListening && "ring-2 ring-rose-500/40 border-rose-400 dark:border-rose-500/60 shadow-lg shadow-rose-500/10"
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
            <div className="absolute inset-0 bg-slate-100/95 dark:bg-slate-900/95 border-2 border-dashed border-foreground rounded-[1.75rem] sm:rounded-[2rem] flex items-center justify-center gap-3 z-30 backdrop-blur-xs transition-all animate-in fade-in zoom-in duration-200 pointer-events-none">
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

          {/* Visual Indicator for Speech Recognition Listening State */}
          {isListening && (
            <div 
              data-testid="speech-listening-indicator"
              className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium animate-in fade-in slide-in-from-top-1 duration-200 select-none shadow-2xs"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
                <span className="font-semibold truncate">
                  {interimSpeech ? `"${interimSpeech}"` : "Listening... Speak your prompt..."}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <div className="flex items-center gap-0.5">
                  <span className="w-0.5 h-2.5 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-0.5 h-4 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-0.5 h-2 bg-rose-500 rounded-full animate-bounce"></span>
                </div>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('manus_stop_voice_input'))}
                  className="px-2 py-0.5 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-600 dark:text-rose-300 text-[10px] font-bold cursor-pointer transition-colors"
                  title="Finish speech dictation"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Top Row: Textarea for typing message */}
          <div className="w-full flex flex-col min-h-[26px] sm:min-h-[28px]">
            <textarea
              ref={textareaRef}
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
              placeholder={
                isListening 
                  ? "Listening... speak now to auto-fill prompt..." 
                  : isThinkHarder 
                    ? "Ask with deep reasoning..." 
                    : "Type a message or ask anything..."
              }
              className="w-full bg-transparent border-none outline-none resize-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-[14px] sm:text-[15px] leading-snug p-0 focus:ring-0 focus:outline-none min-h-[22px] sm:min-h-[24px] max-h-[90px] custom-scrollbar"
              disabled={isLoading}
            />
          </div>

          {/* Bottom Row: Controls */}
          <div className="flex items-center justify-between gap-2 sm:gap-3 pt-1 border-t border-transparent min-w-0 w-full">
            {/* Left Controls: Circular + Button & Attached Connector Tags */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 flex-1">
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
                <button 
                  type="button"
                  className="w-9 h-9 rounded-full border border-slate-200/90 dark:border-white/15 bg-white dark:bg-[#141518] hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center justify-center text-slate-700 dark:text-slate-200 shadow-2xs cursor-pointer active:scale-95 shrink-0"
                  title="Add attachments or options"
                  aria-label="Add attachments or options"
                >
                  <Plus size={18} strokeWidth={2.4} className="text-slate-800 dark:text-slate-200 shrink-0" />
                </button>
              </AttachmentMenu>

              {/* Selected Connector Tags */}
              {activeConnectorTags.length > 0 && (
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
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
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 text-[#2563eb] dark:text-[#93c5fd] font-semibold text-xs rounded-full cursor-pointer hover:opacity-80 transition-opacity select-none shrink-0 whitespace-nowrap"
                        title="Click to view connector parameters or details"
                      >
                        <IconComp strokeWidth={2.4} className="w-3.5 h-3.5 shrink-0" />
                        <span className="shrink-0">{displayName}</span>
                        <button 
                          type="button" 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeConnectorTag(tagId);
                          }}
                          className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-current/70 hover:text-current ml-0.5 shrink-0"
                          title="Remove connector"
                        >
                          <X size={13} strokeWidth={2.4} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Controls: Mic & Circular Send Button */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
              <VoiceInputButton
                onListeningStateChange={(listening) => {
                  setIsListening(listening);
                  if (listening) {
                    speechBaseInputRef.current = input.trim();
                  } else {
                    setInterimSpeech('');
                  }
                }}
                onInterimChange={(interim) => {
                  setInterimSpeech(interim);
                }}
                onTranscript={(dictatedText) => {
                  const base = speechBaseInputRef.current;
                  setInput(formatSpeechAutoFill(base, dictatedText));
                }}
                onAutoSubmit={(finalText) => {
                  if (finalText.trim()) {
                    onSubmit(finalText.trim());
                    clearChatViewDraft();
                    setInput('');
                    setInterimSpeech('');
                  }
                }}
                className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-accent transition-colors flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer shrink-0"
                size={18}
              />
              <button 
                type="button"
                onClick={() => {
                  if (isLoading || status === 'running') {
                    if (onStop) {
                      onStop();
                      toast.info('Response stopped');
                    }
                  } else {
                    handleSend();
                  }
                }}
                disabled={(!isLoading && status !== 'running') && (!input.trim() && !attachedFile && activeConnectorTags.length === 0)}
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 shadow-2xs shrink-0 cursor-pointer",
                  isLoading || status === 'running'
                    ? "bg-foreground text-background dark:bg-white dark:text-black hover:scale-105 active:scale-95 shadow-md"
                    : (input.trim() || attachedFile || activeConnectorTags.length > 0)
                      ? "bg-foreground text-background dark:bg-white dark:text-black hover:scale-105 active:scale-95 shadow-md opacity-100"
                      : "bg-[#e2e8f0]/80 dark:bg-muted text-slate-400 dark:text-muted-foreground cursor-not-allowed opacity-50"
                )}
                title={isLoading || status === 'running' ? "Stop response" : "Send message"}
                aria-label={isLoading || status === 'running' ? "Stop response" : "Send message"}
              >
                {isLoading || status === 'running'
                  ? <Square size={13} fill="currentColor" strokeWidth={2.5} className="shrink-0" />
                  : <ArrowUp size={18} strokeWidth={2.6} className="font-bold shrink-0" />}
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
