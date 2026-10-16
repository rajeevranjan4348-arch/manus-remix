import React, { useState, useRef } from 'react';
import { RobotHead } from 'robot-heads';
import { 
  Plus, 
  ArrowUp,
  Mic, 
  Layout, 
  FileText, 
  BarChart3, 
  Globe, 
  Table as TableIcon,
  PieChart,
  LineChart,
  ScatterChart,
  Flame,
  Link as LinkIcon,
  X,
  Gauge,
  Brain,
  MessageSquare,
  Briefcase,
  Upload,
  AtSign,
  Plug,
  Settings,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { toast } from 'sonner';
import { AttachmentMenu } from '@/components/chat/AttachmentMenu';
import { VoiceInputButton, formatSpeechAutoFill } from '@/components/voice/VoiceInputButton';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';
import { validateFile, formatFileSize } from '@/lib/fileValidation';
import { ConnectorsPopupMenu } from '@/components/chat/ConnectorsPopupMenu';
import { ConnectorsStorePanel, CONNECTOR_CATALOG } from '@/components/connectors/ConnectorsStorePanel';
import { ConnectorConfigModal } from '@/components/connectors/ConnectorConfigModal';
import { GoogleDrivePickerModal } from '@/components/workspace/GoogleDrivePickerModal';
import { WorkspaceMentionPicker, WORKSPACE_CONNECTOR_OPTIONS, WorkspaceConnectorOption } from '@/components/chat/WorkspaceMentionPicker';
import { GoogleDriveFileItem } from '@/lib/workspaceTools';
import { getSettings } from '@/lib/settingsStore';
import { getDraftPrompt, saveDraftPrompt, clearDraftPrompt } from '@/lib/draftStorage';
import { useAutoSaveChatInput } from '@/hooks/useAutoSaveChatInput';

export type PersonalityMode = 'chat' | 'work';

type RobotHeadState = 'idle' | 'thinking' | 'searching' | 'listening' | 'speaking' | 'working' | 'happy' | 'error' | 'sleeping';
type RobotHeadShape = 'rectangle' | 'square' | 'circle' | 'hexagon';

const ROBOT_STATES: { value: RobotHeadState; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'searching', label: 'Searching' },
  { value: 'listening', label: 'Listening' },
  { value: 'speaking', label: 'Speaking' },
  { value: 'working', label: 'Working' },
  { value: 'happy', label: 'Happy' },
  { value: 'error', label: 'Error' },
  { value: 'sleeping', label: 'Sleeping' },
];

const ROBOT_SHAPES: { value: RobotHeadShape; label: string }[] = [
  { value: 'rectangle', label: 'TV / Rectangle' },
  { value: 'square', label: 'Square' },
  { value: 'circle', label: 'Circle' },
  { value: 'hexagon', label: 'Hexagon' },
];

const ROBOT_THEMES = [
  { label: 'Manus blue', shell: '#2b49a3', trim: '#93a6c8', screen: '#e8f2ff' },
  { label: 'Graphite', shell: '#30343b', trim: '#9299a5', screen: '#e9f1ff' },
  { label: 'Mint', shell: '#176b5b', trim: '#9bd8c7', screen: '#e2fff5' },
  { label: 'Violet', shell: '#593c9b', trim: '#b9a7ed', screen: '#f1eaff' },
];

const CHAT_WORK_MODES = [
  { id: 'chat' as PersonalityMode, label: 'Chat', icon: MessageSquare, desc: 'Normal conversation' },
  { id: 'work' as PersonalityMode, label: 'Work', icon: Briefcase, desc: 'Autonomous task mode' },
];

const ACTION_CHIPS = [
  { label: "Build website", icon: Globe },
  { label: "Data analysis", icon: BarChart3 },
  { label: "Research link", icon: LinkIcon }
];

const OUTPUT_FORMATS = [
  { id: 'graph', label: 'Graph', icon: BarChart3, desc: 'Interactive charts' },
  { id: 'report', label: 'Report', icon: FileText, desc: 'Detailed analysis' },
  { id: 'slides', label: 'Slides', icon: Layout, desc: 'Presentation deck' },
  { id: 'website', label: 'Website', icon: Globe, desc: 'Single page site' },
  { id: 'spreadsheet', label: 'Spreadsheet', icon: TableIcon, desc: 'Tabular data' },
];

const CHART_TYPES = [
  { id: 'bar', label: 'Bar', icon: BarChart3 },
  { id: 'line', label: 'Line', icon: LineChart },
  { id: 'pie', label: 'Pie', icon: PieChart },
  { id: 'scatter', label: 'Scatter', icon: ScatterChart },
  { id: 'area', label: 'Area', icon: Flame },
  { id: 'bubble', label: 'Bubble', icon: PieChart },
];

interface HomeProps {
  onStartTask: (prompt: string, options: any) => void;
  personality?: PersonalityMode;
  onPersonalityChange?: (mode: PersonalityMode) => void;
}

export function Home({ onStartTask, personality, onPersonalityChange }: HomeProps) {
  const initialSettings = getSettings();
  const [prompt, setPrompt] = useState<string>(() => getDraftPrompt());
  const [robotState, setRobotState] = useState<RobotHeadState>(() => (initialSettings.robotState as RobotHeadState) || 'idle');
  const [robotShape, setRobotShape] = useState<RobotHeadShape>(() => (initialSettings.robotShape as RobotHeadShape) || 'rectangle');
  const [robotTheme, setRobotTheme] = useState(() => initialSettings.robotTheme ?? 0);
  const [robotSpeed, setRobotSpeed] = useState(() => initialSettings.robotSpeed ?? 1);
  const [robotPaused, setRobotPaused] = useState(() => initialSettings.robotPaused ?? false);
  const [robotInteractive, setRobotInteractive] = useState(() => initialSettings.robotInteractive ?? true);
  const [robotAntenna, setRobotAntenna] = useState(() => initialSettings.robotAntenna ?? true);
  const [robotFloorShadow, setRobotFloorShadow] = useState(() => initialSettings.robotFloorShadow ?? true);
  const [robotSeed, setRobotSeed] = useState(() => initialSettings.robotSeed ?? 0.3);
  const [isHappyExpression, setIsHappyExpression] = useState(false);
  const [showIndiaClock, setShowIndiaClock] = useState(false);
  const [indiaClockTime, setIndiaClockTime] = useState('');
  const [indiaClockDate, setIndiaClockDate] = useState('');
  const robotTapCountRef = useRef(0);

  React.useEffect(() => {
    if (!showIndiaClock) return;
    const timeFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const dateFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const updateIndiaClock = () => {
      const now = new Date();
      setIndiaClockTime(timeFormatter.format(now));
      setIndiaClockDate(dateFormatter.format(now));
    };
    updateIndiaClock();
    const intervalId = window.setInterval(updateIndiaClock, 1000);
    return () => window.clearInterval(intervalId);
  }, [showIndiaClock]);

  const handleRobotTap = () => {
    robotTapCountRef.current += 1;
    if (robotTapCountRef.current >= 3) {
      robotTapCountRef.current = 0;
      setShowIndiaClock((visible) => !visible);
      setIsHappyExpression(false);
    }
  };

  React.useEffect(() => {
    const handleSettingsUpdated = (e: any) => {
      const s = e.detail || getSettings();
      if (s.robotState) setRobotState(s.robotState as RobotHeadState);
      if (s.robotShape) setRobotShape(s.robotShape as RobotHeadShape);
      if (s.robotTheme !== undefined) setRobotTheme(s.robotTheme);
      if (s.robotSpeed !== undefined) setRobotSpeed(s.robotSpeed);
      if (s.robotPaused !== undefined) setRobotPaused(s.robotPaused);
      if (s.robotInteractive !== undefined) setRobotInteractive(s.robotInteractive);
      if (s.robotAntenna !== undefined) setRobotAntenna(s.robotAntenna);
      if (s.robotFloorShadow !== undefined) setRobotFloorShadow(s.robotFloorShadow);
      if (s.robotSeed !== undefined) setRobotSeed(s.robotSeed);
    };
    const handleRobotStateChange = (e: any) => {
      if (e.detail) {
        setRobotState(e.detail as RobotHeadState);
      }
    };
    window.addEventListener('manus_settings_updated', handleSettingsUpdated);
    window.addEventListener('manus_robot_state_change', handleRobotStateChange);
    return () => {
      window.removeEventListener('manus_settings_updated', handleSettingsUpdated);
      window.removeEventListener('manus_robot_state_change', handleRobotStateChange);
    };
  }, []);

  const [activeIntent, setActiveIntent] = useState<{ label: string, icon: any, placeholder?: string } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [selectedChart, setSelectedChart] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isThinkHarder, setIsThinkHarder] = useState(false);
  const [activePlugins, setActivePlugins] = useState<string[]>([
    'web_search', 'code_sandbox', 'charts', 'deep_research', 
    'google_drive', 'google_calendar', 'gmail', 'google_docs', 
    'google_sheets', 'google_slides', 'google_tasks', 'google_chat', 
    'google_forms', 'google_keep', 'google_meet', 'google_contacts', 'google_classroom'
  ]);
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

  const [chatWorkMode, setChatWorkMode] = useState<PersonalityMode>(() => {
    return (localStorage.getItem('manus_chat_work_mode') as PersonalityMode) || personality || 'chat';
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const speechBasePromptRef = useRef<string>('');

  const containerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize typing area dynamically as user types a big prompt/question
  React.useEffect(() => {
    const wordCount = prompt.trim() ? prompt.trim().split(/\s+/).filter(Boolean).length : 0;
    if (wordCount < 50 && isExpanded) {
      setIsExpanded(false);
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = isExpanded ? 460 : 280;
      const targetHeight = Math.max(Math.min(scrollHeight, maxHeight), 28);
      textareaRef.current.style.height = `${targetHeight}px`;
    }
  }, [prompt, isExpanded]);

  // Local storage persistence: auto-save draft prompt whenever the user pauses typing for > 500ms
  useAutoSaveChatInput({
    value: prompt,
    onSave: saveDraftPrompt,
    delay: 500,
  });

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPrompt(val);

    const lastAt = val.lastIndexOf('@');
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
      const queryAfterAt = val.slice(lastAt);
      if (queryAfterAt.includes(' ')) {
        const potentialTag = queryAfterAt.trim().toLowerCase();
        const matchedOpt = WORKSPACE_CONNECTOR_OPTIONS.find(o => o.tag.toLowerCase() === potentialTag);
        if (matchedOpt) {
          const prefix = val.slice(0, lastAt);
          const suffix = val.slice(lastAt + queryAfterAt.length);
          setPrompt((prefix + suffix).trimStart());
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
    const lastAt = prompt.lastIndexOf('@');
    let newPrompt = prompt;
    if (lastAt !== -1) {
      newPrompt = prompt.slice(0, lastAt);
    }
    setPrompt(newPrompt.trimStart());
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
    const textToInsert = contextString || `[Selected Google Drive File: ${driveFile.name}]\nLink: ${driveFile.webViewLink || 'N/A'}\nType: ${driveFile.mimeType}`;
    setPrompt(prev => prev ? `${prev}\n\n${textToInsert}` : textToInsert);
    toast.success(`Attached "${driveFile.name}" from Google Drive as AI context`);
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
      handleProcessFile(files[0]);
    }
  };

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

  React.useEffect(() => {
    if (containerRef.current) {
      const ctx = gsap.context(() => {
        gsap.fromTo(
          '.animate-on-load',
          { y: 15, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            stagger: 0.08,
            duration: 0.5,
            ease: 'power2.out',
            clearProps: 'all'
          }
        );
      }, containerRef);
      return () => ctx.revert();
    }
  }, []);

  const handleProcessFile = async (file: File) => {
    const val = validateFile(file);
    if (!val.valid) {
      toast.error(val.error);
      return;
    }

    setUploadedFile(file);
    setIsExtracting(true);
    
    // Automatically preserve every file shared with AI in the Library
    saveSharedFileToLibrary(file, 'Shared with AI Chat').catch(err => console.error(err));
    
    try {
      const fileName = file.name.toLowerCase();
      
      // Handle images (from Camera or Photos)
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          setFileData(dataUrl);
          toast.success(`Attached photo: ${file.name}`);
          if (!prompt.trim()) {
            setPrompt('Examine and analyze this image in detail');
          }
          setIsExtracting(false);
        };
        reader.onerror = () => {
          toast.error('Failed to read image');
          setIsExtracting(false);
        };
        reader.readAsDataURL(file);
        return;
      }

      // Handle CSV files
      if (fileName.endsWith('.csv')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setFileData(text);
          toast.success(`Loaded ${file.name}`);
          if (!prompt.trim()) {
            setPrompt('Analyze this CSV data and provide insights');
          }
          setIsExtracting(false);
        };
        reader.onerror = () => {
          toast.error('Failed to read file');
          setIsExtracting(false);
        };
        reader.readAsText(file);
        return;
      }
      
      // Handle JSON files
      if (fileName.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          try {
            JSON.parse(text);
            setFileData(text);
            toast.success(`Loaded ${file.name}`);
            if (!prompt.trim()) {
              setPrompt('Analyze this JSON data and provide insights');
            }
          } catch {
            toast.error('Invalid JSON file');
          }
          setIsExtracting(false);
        };
        reader.onerror = () => {
          toast.error('Failed to read file');
          setIsExtracting(false);
        };
        reader.readAsText(file);
        return;
      }
      
      // Handle plain text files
      if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setFileData(text);
          toast.success(`Loaded ${file.name}`);
          if (!prompt.trim()) {
            setPrompt(`Analyze the content of ${file.name} and provide insights`);
          }
          setIsExtracting(false);
        };
        reader.onerror = () => {
          toast.error('Failed to read file');
          setIsExtracting(false);
        };
        reader.readAsText(file);
        return;
      }

      // Handle PDF and other documents
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setFileData(text || file.name);
        toast.success(`Loaded ${file.name}`);
        if (!prompt.trim()) {
          setPrompt(`Summarize and extract key insights from ${file.name}`);
        }
        setIsExtracting(false);
      };
      reader.onerror = () => {
        toast.error('Failed to read file');
        setIsExtracting(false);
      };
      reader.readAsText(file);
    } catch (error) {
      console.error('File extraction error:', error);
      toast.error('Failed to process file');
      setIsExtracting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleProcessFile(file);
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    setFileData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleChatWorkMode = (mode: PersonalityMode) => {
    setChatWorkMode(mode);
    localStorage.setItem('manus_chat_work_mode', mode);
    if (mode === 'chat') {
      setActiveIntent(null);
      setSelectedFormat(null);
      setSelectedChart(null);
    }
    onPersonalityChange?.(mode);
  };

  const handleStart = () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    const options: any = { 
      format: selectedFormat || 'report', 
      chartType: selectedChart || 'auto',
      intent: activeIntent?.label,
      thinkHarder: isThinkHarder,
      plugins: activePlugins,
      connectorTags: activeConnectorTags,
      mode: chatWorkMode,
    };

    if (fileData) {
      options.fileData = fileData;
      options.fileName = uploadedFile?.name;
    }

    // If intent is website, the prompt IS the website name
    if (activeIntent?.label === 'Website') {
      options.websiteName = prompt.trim();
    }

    // If intent is research, the prompt IS the URL
    if (activeIntent?.label === 'Research') {
      options.url = prompt.trim();
    }

    const taskPrompt = prompt;
    clearDraftPrompt();
    setPrompt('');
    onStartTask(taskPrompt, options);
    setIsExpanded(false);
  };

  return (
    <div ref={containerRef} className="w-full h-full overflow-y-auto flex flex-col items-center p-6 md:py-10 bg-manus-cream dark:bg-background">
      <div className="w-full max-w-4xl space-y-6 sm:space-y-8 my-auto">
        <div className="flex flex-col items-center animate-on-load" aria-label="Manus AI robot assistant">
          <div
            className="relative shrink-0 cursor-pointer select-none"
            onClick={handleRobotTap}
            role="button"
            tabIndex={0}
            aria-label="Manus robot. Tap three times to toggle India time."
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleRobotTap();
              }
            }}
          >
            <RobotHead
              state={isHappyExpression ? 'happy' : isExtracting ? 'thinking' : activeIntent?.label === 'Research' ? 'searching' : chatWorkMode === 'work' && robotState === 'idle' ? 'working' : robotState}
              shape={robotShape}
              size={148}
              color={ROBOT_THEMES[robotTheme]?.shell || ROBOT_THEMES[0].shell}
              trimColor={ROBOT_THEMES[robotTheme]?.trim || ROBOT_THEMES[0].trim}
              screenColor={ROBOT_THEMES[robotTheme]?.screen || ROBOT_THEMES[0].screen}
              speed={robotSpeed}
              paused={robotPaused}
              interactive={robotInteractive}
              antenna={robotAntenna}
              floorShadow={robotFloorShadow}
              seed={robotSeed}
              aria-label={`Manus AI robot assistant, ${isHappyExpression ? 'happy' : robotState}`}
              className={`shrink-0 transform transition-transform ${showIndiaClock ? 'opacity-20' : ''}`}
            />
            {showIndiaClock && (
              <div
                className="absolute inset-x-3 top-1/2 -translate-y-1/2 z-10 rounded-xl border border-sky-300/70 bg-slate-950 text-sky-100 px-2 py-3 text-center shadow-[0_0_18px_rgba(56,189,248,0.45)] pointer-events-none"
                aria-live="off"
              >
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-sky-300">INDIA · IST</div>
                <div className="font-mono text-[17px] font-bold leading-6 tabular-nums">{indiaClockTime}</div>
                <div className="text-[9px] leading-3 text-sky-200/90">{indiaClockDate}</div>
                <div className="mt-1 text-[8px] tracking-wide text-sky-300/80">UTC+05:30</div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 animate-on-load">
          {/* File Upload indicators */}
          {uploadedFile && (
            <div className="flex gap-2 justify-center flex-wrap">
              <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-full border border-primary/20 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
                <FileText size={18} strokeWidth={2.4} className="text-primary" />
                <span className="text-sm font-medium">{uploadedFile.name}</span>
                {isExtracting ? (
                  <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                ) : (
                  <button onClick={handleRemoveFile} className="p-0.5 hover:bg-manus-soft rounded-full transition-colors">
                    <X size={16} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div 
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "w-full bg-white dark:bg-[#1a1b1e] rounded-[1.75rem] shadow-lg border border-slate-200/80 dark:border-border/60 px-3.5 py-2.5 sm:px-4.5 sm:py-3 flex flex-col gap-1.5 sm:gap-2 transition-[box-shadow,border-color,background-color] duration-200 ease-out focus-within:ring-2 focus-within:ring-primary/20 relative z-[2] gpu-accelerated",
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
              <div className="absolute inset-0 bg-slate-100/95 dark:bg-slate-900/95 border-2 border-dashed border-foreground rounded-[1.75rem] flex items-center justify-center gap-3 z-30 backdrop-blur-xs transition-all animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Upload strokeWidth={2.4} className="w-6 h-6 text-foreground animate-bounce" />
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
            >
              <span className="w-0 h-0 inline-block pointer-events-none opacity-0" aria-hidden="true" />
            </ConnectorsPopupMenu>

            {/* Visual Indicator for Speech Recognition Listening State */}
            {isListening && (
              <div 
                data-testid="speech-listening-indicator"
                className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium animate-in fade-in slide-in-from-top-1 duration-200 select-none mb-1 shadow-2xs"
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

            {/* Top Row: Textarea */}
            <div className="w-full flex flex-col min-h-[28px]">
              <textarea 
                ref={textareaRef}
                value={prompt}
                onChange={handlePromptChange}
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
                    handleStart();
                  }
                }}
                className={cn(
                  "w-full bg-transparent border-none outline-none resize-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-base leading-snug sm:leading-relaxed p-0 focus:ring-0 focus:outline-none min-h-[28px] custom-scrollbar transition-[height] duration-150 ease-out",
                  isExpanded ? "max-h-[460px]" : "max-h-[280px]"
                )}
                rows={1}
                placeholder={
                  isListening
                    ? "Listening... speak now to auto-fill prompt..."
                    : activeIntent?.placeholder || (chatWorkMode === 'chat' ? "Type a message or ask anything..." : (isThinkHarder ? "Assign a deep reasoning task or question..." : "Assign a building task or ask anything..."))
                } 
              />
            </div>

            {/* Bottom Row: Actions */}
            <div className="flex items-center justify-between gap-2 sm:gap-3 pt-1 border-t border-transparent min-w-0 w-full">
              {/* Left Side: Circular + Button & Connector Tags / Badges */}
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 overflow-x-auto no-scrollbar py-0.5">
                <AttachmentMenu
                  onFileSelect={handleProcessFile}
                  isThinkHarder={isThinkHarder}
                  onToggleThinkHarder={() => setIsThinkHarder(prev => !prev)}
                  activePlugins={activePlugins}
                  onTogglePlugin={handleTogglePlugin}
                  onSendMessageToChat={(text) => setPrompt(text)}
                  onOpenGoogleDrivePicker={() => setIsDrivePickerOpen(true)}
                  onOpenConnectors={() => {
                    setTimeout(() => setIsConnectorsMenuOpen(true), 10);
                  }}
                >
                  <button 
                    type="button"
                    disabled={isExtracting}
                    className="w-9 h-9 rounded-full border border-slate-200/90 dark:border-white/15 bg-white dark:bg-[#141518] hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center justify-center text-slate-700 dark:text-slate-200 shadow-2xs cursor-pointer active:scale-95 shrink-0"
                    title="Add attachments or connectors"
                    aria-label="Add attachments or options"
                  >
                    <Plus size={18} strokeWidth={2.4} className="text-slate-800 dark:text-slate-200 shrink-0"/>
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

                {/* Badges for active intent or deep reasoning */}
                {activeIntent && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white text-black dark:bg-white dark:text-black border border-slate-200 dark:border-border rounded-full text-xs font-medium shrink-0 max-w-full select-none whitespace-nowrap animate-in fade-in zoom-in duration-200 shadow-2xs">
                    <activeIntent.icon size={14} strokeWidth={2.4} className="shrink-0 text-primary" />
                    <span className="shrink-0 truncate">{activeIntent.label}</span>
                    <button 
                      onClick={() => {
                        if (activeIntent.label === "Data analysis") {
                          setSelectedFormat(null);
                          setSelectedChart(null);
                        }
                        if (activeIntent.label === "Website") {
                          setSelectedFormat(null);
                        }
                        setActiveIntent(null);
                        setPrompt('');
                      }} 
                      className="p-0.5 hover:bg-black/10 dark:hover:bg-white/15 rounded-full transition-colors ml-0.5 shrink-0"
                      title="Clear intent"
                      aria-label="Clear intent"
                    >
                      <X size={13} strokeWidth={2.4} />
                    </button>
                  </div>
                )}

                {isThinkHarder && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/15 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-300/60 dark:border-purple-600/40 rounded-full text-xs font-semibold shrink-0 max-w-full select-none whitespace-nowrap animate-in fade-in zoom-in duration-200">
                    <Brain size={14} strokeWidth={2.4} className="text-purple-600 dark:text-purple-400 animate-pulse shrink-0" />
                    <span className="shrink-0">Deep reasoning</span>
                    <button 
                      onClick={() => setIsThinkHarder(false)} 
                      className="p-0.5 hover:bg-purple-500/20 rounded-full transition-colors ml-0.5 shrink-0"
                      title="Remove deep reasoning"
                      aria-label="Remove deep reasoning"
                    >
                      <X size={13} strokeWidth={2.4} />
                    </button>
                  </div>
                )}
              </div>

              {/* Right Side: Expand (only when question has >= 50 words), Mic & Circular Send Button */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
                {prompt.trim().split(/\s+/).filter(Boolean).length >= 50 && (
                  <button
                    type="button"
                    onClick={() => setIsExpanded(prev => !prev)}
                    className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-accent transition-colors flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer animate-in fade-in zoom-in-95 duration-150 shrink-0"
                    title={isExpanded ? "Collapse typing area" : "Expand typing area"}
                    aria-label={isExpanded ? "Collapse typing area" : "Expand typing area"}
                  >
                    {isExpanded ? <Minimize2 size={18} strokeWidth={2.4} className="shrink-0" /> : <Maximize2 size={18} strokeWidth={2.4} className="shrink-0" />}
                  </button>
                )}
                <VoiceInputButton 
                  onListeningStateChange={(listening) => {
                    setIsListening(listening);
                    if (listening) {
                      speechBasePromptRef.current = prompt.trim();
                    } else {
                      setInterimSpeech('');
                    }
                  }}
                  onInterimChange={(interim) => {
                    setInterimSpeech(interim);
                  }}
                  onTranscript={(dictatedText) => {
                    const base = speechBasePromptRef.current;
                    setPrompt(formatSpeechAutoFill(base, dictatedText));
                  }}
                  className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-accent transition-colors flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer shrink-0"
                  size={18}
                />
                <button 
                  type="button"
                  onClick={handleStart}
                  className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer shadow-md shrink-0",
                    (prompt.trim() || activeConnectorTags.length > 0)
                      ? "bg-foreground text-background dark:bg-white dark:text-black hover:scale-105 active:scale-95 shadow-lg opacity-100"
                      : "bg-foreground/10 text-foreground/40 dark:bg-white/10 dark:text-white/40 hover:bg-foreground/15 dark:hover:bg-white/20"
                  )}
                  title="Send message"
                  aria-label="Send message"
                >
                  <ArrowUp size={18} strokeWidth={2.6} className="font-bold shrink-0" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center gap-3.5 sm:gap-4 w-full">
            {/* Chat / Work mode switch centered in the middle */}
            <div className="flex justify-center w-full px-2">
              <div 
                className="relative inline-flex items-center p-1 rounded-full border border-slate-200/90 dark:border-border/80 bg-white/90 dark:bg-card/90 shadow-xs backdrop-blur-md overflow-hidden select-none max-w-full"
                role="radiogroup"
                aria-label="Agent personality mode"
              >
                {CHAT_WORK_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const active = chatWorkMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      role="radio"
                      onClick={() => handleChatWorkMode(mode.id)}
                      title={mode.desc}
                      aria-checked={active}
                      className={cn(
                        "relative z-10 inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                        active
                          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-accent/60"
                      )}
                    >
                      <Icon size={16} strokeWidth={2.2} className="shrink-0" />
                      <span className="shrink-0 leading-none">{mode.label}</span>
                      {active && (
                        <span 
                          className="w-1.5 h-1.5 rounded-full bg-emerald-400 dark:bg-emerald-500 shrink-0 ml-0.5" 
                          aria-hidden="true" 
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action chips displayed together in a single row line when in Work mode */}
            {chatWorkMode === 'work' && (
              <div className="flex min-w-0 w-full box-border items-center justify-start sm:justify-center gap-2 sm:gap-2.5 overflow-x-auto overscroll-x-contain scroll-px-2 no-scrollbar px-2 sm:px-4 py-1.5 whitespace-nowrap">
                {ACTION_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => {
                      if (chip.label === "Research link") {
                        setActiveIntent({ 
                          label: "Research", 
                          icon: chip.icon,
                          placeholder: "Enter URL to research (e.g., https://example.com)"
                        });
                        setPrompt('');
                      } else if (chip.label === "Build website") {
                        setSelectedFormat('website');
                        setActiveIntent({ 
                          label: "Website", 
                          icon: chip.icon,
                          placeholder: "Enter website name (e.g., My Portfolio, Coffee Shop)"
                        });
                        setPrompt('');
                      } else if (chip.label === "Data analysis") {
                        setSelectedFormat('graph');
                        setSelectedChart('bar');
                        setActiveIntent({ 
                          label: "Data analysis", 
                          icon: chip.icon,
                          placeholder: "Describe the data you want to analyze or upload a file"
                        });
                        setPrompt('');
                      } else {
                        const shortLabel = chip.label.replace('Create ', '').replace('Build ', '').replace('Develop ', '');
                        setActiveIntent({ 
                          label: shortLabel.charAt(0).toUpperCase() + shortLabel.slice(1), 
                          icon: chip.icon,
                          placeholder: `Describe the ${shortLabel} you want to build`
                        });
                        setPrompt('');
                      }
                    }}
                    className="shrink-0 inline-flex items-center justify-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium border border-border bg-white dark:bg-card text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-slate-50 dark:hover:bg-accent/80 transition-all duration-150 cursor-pointer whitespace-nowrap shadow-xs active:scale-95 select-none"
                  >
                    <chip.icon size={16} strokeWidth={2.2} className="shrink-0 w-4 h-4 text-primary/80" />
                    <span className="shrink-0 leading-none">{chip.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Building agent features (Output formats and Chart gallery) shown ONLY in Work mode */}
        {chatWorkMode === 'work' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-on-load animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 dark:text-muted-foreground uppercase tracking-widest px-1">Choose output format</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {OUTPUT_FORMATS.map((format) => (
                  <button
                    key={format.id}
                    onClick={() => setSelectedFormat(format.id)}
                    className={cn(
                      "flex items-start gap-4 p-4 rounded-2xl border transition-all text-left group cursor-pointer",
                      selectedFormat === format.id 
                        ? "bg-white dark:bg-card border-primary shadow-md ring-1 ring-primary/10 -translate-y-0.5" 
                        : "bg-white dark:bg-card border-slate-200 dark:border-border hover:border-primary/40 dark:hover:border-primary/50 hover:-translate-y-0.5 shadow-xs"
                    )}
                  >
                    <div className={cn(
                      "p-2.5 rounded-xl transition-colors",
                      selectedFormat === format.id 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground group-hover:bg-slate-200 dark:group-hover:bg-accent"
                    )}>
                      <format.icon size={23} strokeWidth={2.4} />
                    </div>
                    <div>
                      <div className="font-bold text-sm tracking-tight text-foreground">{format.label}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{format.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 dark:text-muted-foreground uppercase tracking-widest px-1">Preferred charts gallery</h3>
              <div className="grid grid-cols-3 gap-3">
                {CHART_TYPES.map((chart) => (
                  <button
                    key={chart.id}
                    onClick={() => setSelectedChart(chart.id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border bg-white dark:bg-card transition-all group cursor-pointer",
                      selectedChart === chart.id 
                        ? "border-primary shadow-md ring-1 ring-primary/10 -translate-y-0.5" 
                        : "border-slate-200 dark:border-border hover:border-primary/40 dark:hover:border-primary/50 hover:-translate-y-0.5 shadow-xs"
                    )}
                  >
                    <div className={cn(
                      "p-2 rounded-lg transition-colors",
                      selectedChart === chart.id 
                        ? "bg-primary/10 text-primary" 
                        : "text-slate-700 dark:text-muted-foreground group-hover:text-foreground"
                    )}>
                      <chart.icon size={25} strokeWidth={2.4} />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-muted-foreground group-hover:text-foreground">{chart.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
          setPrompt(prev => prev ? `${prev} ${promptText}` : promptText);
        }}
      />
    </div>
  );
}
