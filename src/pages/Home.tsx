import React, { useState, useRef } from 'react';
import { RobotHead } from 'robot-heads';
import { 
  Mic, 
  Layout, 
  FileText, 
  ChartBar as BarChart3, 
  Globe, 
  Table as TableIcon,
  ChartPie as PieChart,
  ChartLine as LineChart,
  ChartScatter as ScatterChart,
  Flame,
  Link as LinkIcon,
  X,
  Gauge,
  Brain,
  MessageSquare,
  Mail,
  Briefcase,
  Upload,
  AtSign,
  Plug,
  Settings,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { Plus, ArrowUp } from 'pulsoicon-react';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { toast } from 'sonner';
import { AttachmentMenu } from '@/components/chat/AttachmentMenu';
import { VoiceInputButton, formatSpeechAutoFill } from '@/components/voice/VoiceInputButton';
import { VoiceTranscriptionIndicator } from '@/components/voice/VoiceTranscriptionIndicator';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';
import { validateFile, formatFileSize, compressImageForAI } from '@/lib/fileValidation';
import { ConnectorsPopupMenu } from '@/components/chat/ConnectorsPopupMenu';
import { WorkspaceMentionPicker, WORKSPACE_CONNECTOR_OPTIONS, WorkspaceConnectorOption } from '@/components/chat/WorkspaceMentionPicker';
import { GoogleDriveFileItem } from '@/lib/workspaceTools';
import { getSettings } from '@/lib/settingsStore';
import { getDraftPrompt, saveDraftPrompt, clearDraftPrompt } from '@/lib/draftStorage';
import { getActivePerformanceProfile } from '@/lib/performanceEngine';
import { getHomeActionDefaults } from '@/lib/homeActionDefaults';
import {
  AMBIENT_ROBOT_EXPRESSION_SEQUENCE,
  getNextCycledRobotState,
  resolveContextualRobotState,
} from '@/lib/robotAnimationEngine';
import { buildWritingAssistantPrompt } from '@/lib/writingAssistant';
const ConnectorsStorePanel = React.lazy(() =>
  import('@/components/connectors/ConnectorsStorePanel').then((m) => ({ default: m.ConnectorsStorePanel }))
);
const ConnectorConfigModal = React.lazy(() =>
  import('@/components/connectors/ConnectorConfigModal').then((m) => ({ default: m.ConnectorConfigModal }))
);
const GoogleDrivePickerModal = React.lazy(() =>
  import('@/components/workspace/GoogleDrivePickerModal').then((m) => ({ default: m.GoogleDrivePickerModal }))
);

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
  { label: 'Pure Black', shell: '#000000', trim: '#777777', screen: '#FAFAFA' },
  { label: 'Graphite', shell: '#111111', trim: '#777777', screen: '#F2F2F2' },
  { label: 'Slate Gray', shell: '#333333', trim: '#AAAAAA', screen: '#FFFFFF' },
  { label: 'Silver Mono', shell: '#777777', trim: '#E0E0E0', screen: '#FFFFFF' },
];

const CHAT_WORK_MODES = [
  { id: 'chat' as PersonalityMode, label: 'Chat', icon: MessageSquare, desc: 'Normal conversation' },
  { id: 'work' as PersonalityMode, label: 'Work', icon: Briefcase, desc: 'Autonomous task mode' },
];

const ACTION_CHIPS = [
  { label: "Build website", icon: Globe },
  { label: "Data analysis", icon: BarChart3 },
  { label: "Research link", icon: LinkIcon },
  { label: "Write for me", icon: Mail }
];

const WRITING_STARTERS = [
  { label: 'Email', prompt: 'Draft a clear, polite email about:\n' },
  { label: 'Chat message', prompt: 'Draft a natural chat or WhatsApp message about:\n' },
  { label: 'Improve text', prompt: 'Improve this text for clarity and grammar without changing its meaning:\n\n' },
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
  const [ambientRobotState, setAmbientRobotState] = useState<RobotHeadState>('idle');
  const [manualOverrideState, setManualOverrideState] = useState<RobotHeadState | null>(null);
  const [isTypingPrompt, setIsTypingPrompt] = useState(false);
  const [showIndiaClock, setShowIndiaClock] = useState(false);
  const [indiaClockTime, setIndiaClockTime] = useState('');
  const [indiaClockDate, setIndiaClockDate] = useState('');
  const robotTapCountRef = useRef(0);
  const manualOverrideTimerRef = useRef<number | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Ambient multi-expression cycle (normal/idle -> thinking 🤔 -> happy 😊 -> searching -> working)
  React.useEffect(() => {
    if (robotPaused || robotState !== 'idle') return;
    let stepIndex = 0;
    let timerId: number;

    const scheduleNextExpression = () => {
      const currentStep = AMBIENT_ROBOT_EXPRESSION_SEQUENCE[stepIndex];
      setAmbientRobotState(currentStep.state);
      timerId = window.setTimeout(() => {
        stepIndex = (stepIndex + 1) % AMBIENT_ROBOT_EXPRESSION_SEQUENCE.length;
        scheduleNextExpression();
      }, currentStep.durationMs);
    };

    scheduleNextExpression();
    return () => window.clearTimeout(timerId);
  }, [robotPaused, robotState]);

  // Trigger typing animation state when user types in the prompt
  React.useEffect(() => {
    if (!prompt.trim()) {
      setIsTypingPrompt(false);
      return;
    }
    setIsTypingPrompt(true);
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = window.setTimeout(() => {
      setIsTypingPrompt(false);
    }, 2400);
    return () => {
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
      }
    };
  }, [prompt]);

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
      setManualOverrideState(null);
      return;
    }

    const nextState = getNextCycledRobotState(
      manualOverrideState || (isHappyExpression ? 'happy' : ambientRobotState)
    );
    setManualOverrideState(nextState);
    if (manualOverrideTimerRef.current) {
      window.clearTimeout(manualOverrideTimerRef.current);
    }
    manualOverrideTimerRef.current = window.setTimeout(() => {
      setManualOverrideState(null);
      robotTapCountRef.current = 0;
    }, 4500);
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
  const [voiceAudioLevel, setVoiceAudioLevel] = useState<number>(0);

  const [chatWorkMode, setChatWorkMode] = useState<PersonalityMode>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        return (localStorage.getItem('manus_chat_work_mode') as PersonalityMode) || personality || 'chat';
      }
    } catch {}
    return personality || 'chat';
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const speechBasePromptRef = useRef<string>('');

  const containerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wordCount = React.useMemo(() => {
    const trimmed = prompt.trim();
    return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  }, [prompt]);

  // Measure every prompt: even short text can wrap on a narrow screen.
  React.useEffect(() => {
    if (wordCount < 50 && isExpanded) {
      setIsExpanded(false);
    }
    const el = textareaRef.current;
    if (!el) return;
    const rafId = window.requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.style.height = 'auto';
      const scrollHeight = node.scrollHeight;
      const maxHeight = isExpanded ? 460 : 280;
      const targetHeight = Math.max(Math.min(scrollHeight, maxHeight), 28);
      node.style.height = `${targetHeight}px`;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [prompt, wordCount, isExpanded]);

  // Local storage persistence: save draft prompt so navigating away or refreshing restores it
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDraftPrompt(prompt);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [prompt]);

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
    if (getActivePerformanceProfile() === 'ultra-lite') {
      return;
    }
    if (containerRef.current) {
      const ctx = gsap.context(() => {
        gsap.fromTo(
          '.animate-on-load',
          { y: 10 },
          {
            y: 0,
            stagger: 0.06,
            duration: 0.35,
            ease: 'power2.out',
            clearProps: 'transform'
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
      
      // Handle images (from Camera or Photos) — compress to keep payload fast and responsive
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await compressImageForAI(file);
          setFileData(dataUrl);
          toast.success(`Attached photo: ${file.name}`);
          if (!prompt.trim()) {
            setPrompt('Examine and analyze this image in detail');
          }
        } catch {
          toast.error('Failed to read image');
        } finally {
          setIsExtracting(false);
        }
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

  const handleStart = (overridePrompt?: string | React.MouseEvent) => {
    if (isListening) {
      window.dispatchEvent(new CustomEvent('manus_stop_voice_input'));
    }
    const rawPrompt = typeof overridePrompt === 'string' ? overridePrompt : prompt;
    const effectivePrompt = rawPrompt.trim() || (uploadedFile ? `Examine and analyze ${uploadedFile.name} in detail` : '');
    if (!effectivePrompt) {
      toast.error('Please enter a prompt');
      return;
    }

    const isWritingAssistant = activeIntent?.label === 'Writing assistant';
    const taskPrompt = isWritingAssistant ? buildWritingAssistantPrompt(effectivePrompt) : effectivePrompt;

    const options: any = { 
      format: isWritingAssistant ? 'chat' : selectedFormat || 'report',
      chartType: selectedChart || 'auto',
      intent: activeIntent?.label,
      thinkHarder: isThinkHarder,
      plugins: activePlugins,
      connectorTags: activeConnectorTags,
      mode: isWritingAssistant ? 'chat' : chatWorkMode,
    };

    if (fileData) {
      options.fileData = fileData;
      options.fileName = uploadedFile?.name;
      options.isImage = Boolean(uploadedFile?.type.startsWith('image/') || fileData.startsWith('data:image/'));
    }

    // If intent is website, the prompt IS the website name
    if (activeIntent?.label === 'Website') {
      options.websiteName = effectivePrompt;
    }

    // If intent is research, the prompt IS the URL
    if (activeIntent?.label === 'Research') {
      options.url = effectivePrompt;
    }

    clearDraftPrompt();
    setPrompt('');
    speechBasePromptRef.current = '';
    setInterimSpeech('');
    setUploadedFile(null);
    setFileData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onStartTask(taskPrompt, options);
    setIsExpanded(false);
  };

  const effectiveRobotState = resolveContextualRobotState({
    baseState: robotState,
    manualOverrideState,
    ambientState: ambientRobotState,
    isHappyExpression,
    isExtracting,
    isListening,
    isThinkHarder,
    isTypingPrompt,
    promptText: prompt,
    activeIntentLabel: activeIntent?.label ?? null,
    chatWorkMode,
  });

  return (
    <div ref={containerRef} className="w-full h-full overflow-y-auto overscroll-y-contain flex flex-col items-center px-4 py-6 sm:px-6 md:py-10 bg-manus-cream dark:bg-background">
      <div className="w-full max-w-4xl space-y-5 sm:space-y-7 my-auto">
        <div className="flex flex-col items-center animate-on-load" aria-label="Manus AI robot assistant">
          <div
            className="relative shrink-0 cursor-pointer select-none manus-hero-float"
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
              state={effectiveRobotState}
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
              aria-label={`Manus AI robot assistant, ${effectiveRobotState}`}
              data-hero-robot-shape={robotShape}
              data-robot-state={effectiveRobotState}
              className={`shrink-0 transform transition-transform manus-hero-robot-gloss ${robotPaused ? '' : 'manus-hero-robot-breathe'} ${showIndiaClock ? 'opacity-20' : ''}`}
            />
            {showIndiaClock && (
              <div
                className="manus-dropdown-spring absolute inset-x-3 top-1/2 -translate-y-1/2 z-10 rounded-xl border border-[#333333] bg-[#000000] text-[#FFFFFF] px-2 py-3 text-center shadow-lg pointer-events-none"
                aria-live="off"
              >
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#AAAAAA]">INDIA · IST</div>
                <div className="font-mono text-[17px] font-bold leading-6 tabular-nums">{indiaClockTime}</div>
                <div className="text-[9px] leading-3 text-[#E0E0E0]">{indiaClockDate}</div>
                <div className="mt-1 text-[8px] tracking-wide text-[#777777]">UTC+05:30</div>
              </div>
            )}
          </div>
        </div>

        <div className="w-full max-w-3xl mx-auto space-y-5 sm:space-y-6 animate-on-load">
          {/* File Upload indicators */}
          {uploadedFile && (
            <div className="flex gap-2 justify-center flex-wrap">
              <div className="manus-tag-pop flex max-w-full min-w-0 items-center gap-2 px-3 py-2 bg-white dark:bg-card rounded-full border border-primary/20 shadow-sm">
                <FileText size={18} strokeWidth={2.4} className="text-primary" />
                <span className="min-w-0 truncate text-sm font-medium">{uploadedFile.name}</span>
                {isExtracting ? (
                  <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                ) : (
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="manus-touch-target min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 -m-2 sm:m-0 p-0.5 hover:bg-manus-soft rounded-full transition-colors inline-flex items-center justify-center"
                    title="Remove file"
                    aria-label="Remove file"
                  >
                    <X size={16} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div 
            data-testid="manus-input-container"
            data-listening={isListening ? "true" : "false"}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "manus-input-container w-full bg-[#FFFFFF] dark:bg-[#111111] rounded-[1.75rem] shadow-lg border border-[#E0E0E0] dark:border-[#333333] px-3.5 py-2.5 sm:px-4.5 sm:py-3 flex flex-col gap-1.5 sm:gap-2 transition-[box-shadow,border-color,background-color,transform] duration-200 ease-out focus-within:ring-2 focus-within:ring-[#000000]/15 dark:focus-within:ring-[#FFFFFF]/15 relative z-[2] gpu-accelerated ultra-smooth-composer",
              isDragging && "ring-2 ring-foreground border-foreground bg-[#FAFAFA] dark:bg-[#171717]",
              isListening && "ring-2 ring-[#000000]/30 dark:ring-[#FFFFFF]/30 border-[#000000] dark:border-[#FFFFFF] shadow-lg"
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
            <VoiceTranscriptionIndicator
              isListening={isListening}
              interimSpeech={interimSpeech}
              currentText={prompt}
              audioLevel={voiceAudioLevel}
              canSendNow={Boolean(prompt.trim())}
              onClear={() => {
                setPrompt('');
                speechBasePromptRef.current = '';
                setInterimSpeech('');
              }}
              onStop={() => window.dispatchEvent(new CustomEvent('manus_stop_voice_input'))}
              onSendNow={() => {
                window.dispatchEvent(new CustomEvent('manus_stop_voice_input'));
                handleStart(prompt);
              }}
              className="mb-1"
            />

            {/* Top Row: Textarea */}
            <div className="w-full flex flex-col min-h-[28px]">
              <textarea 
                ref={textareaRef}
                value={prompt}
                onChange={handlePromptChange}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
                  "w-full bg-transparent border-none outline-none resize-none text-[#000000] dark:text-[#FFFFFF] placeholder:text-[#777777] dark:placeholder:text-[#AAAAAA] text-base leading-snug sm:leading-relaxed p-0 focus:ring-0 focus:outline-none min-h-[28px] custom-scrollbar",
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
                    className="manus-touch-target group w-11 h-11 sm:w-9 sm:h-9 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-full border border-[#E0E0E0] dark:border-[#333333] bg-[#F2F2F2] dark:bg-[#171717] hover:bg-[#E0E0E0] dark:hover:bg-[#333333] transition-colors flex items-center justify-center text-[#000000] dark:text-[#FFFFFF] shadow-2xs cursor-pointer active:scale-95 shrink-0"
                    title="Add attachments or connectors"
                    aria-label="Add attachments or options"
                  >
                    <Plus animated={false} size={18} strokeWidth={2.4} className="manus-plus-rotate text-[#000000] dark:text-[#FFFFFF] shrink-0"/>
                  </button>
                </AttachmentMenu>

                {/* Selected Connector Tags */}
                {activeConnectorTags.length > 0 && (
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
                    {activeConnectorTags.map((tagId) => {
                      const opt = WORKSPACE_CONNECTOR_OPTIONS.find(o => o.id === tagId) || { id: tagId, label: tagId.replace(/_/g, ' '), icon: Plug };
                      const IconComp = opt.icon;
                      const rawName = opt.label || tagId;
                      const cleanName = rawName.replace(/^Google\s+/, '').replace(/^@/, '');
                      const displayName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

                      return (
                        <div 
                          key={tagId} 
                          onClick={() => setSelectedConfigConnectorId(tagId)}
                          className="manus-tag-pop inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#F2F2F2] dark:bg-[#171717] border border-[#E0E0E0] dark:border-[#333333] text-[#000000] dark:text-[#FFFFFF] font-semibold text-xs rounded-full cursor-pointer hover:opacity-80 transition-opacity select-none shrink-0 whitespace-nowrap"
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
                            className="manus-touch-target min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 -m-2 sm:m-0 p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-current/70 hover:text-current ml-0.5 shrink-0 inline-flex items-center justify-center"
                            title="Remove connector"
                            aria-label={`Remove ${displayName} connector`}
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
                  <div className="manus-tag-pop inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] border border-[#000000] dark:border-[#FFFFFF] rounded-full text-xs font-medium shrink-0 max-w-full select-none whitespace-nowrap shadow-2xs">
                    <activeIntent.icon size={14} strokeWidth={2.4} className="shrink-0 text-current" />
                    <span className="shrink-0 truncate">{activeIntent.label}</span>
                    <button 
                      type="button"
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
                      className="manus-touch-target min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 -m-2 sm:m-0 p-0.5 hover:bg-white/15 dark:hover:bg-black/15 rounded-full transition-colors ml-0.5 shrink-0 inline-flex items-center justify-center"
                      title="Clear intent"
                      aria-label="Clear intent"
                    >
                      <X size={13} strokeWidth={2.4} />
                    </button>
                  </div>
                )}

                {isThinkHarder && (
                  <div className="manus-tag-pop inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] border border-[#000000] dark:border-[#FFFFFF] rounded-full text-xs font-semibold shrink-0 max-w-full select-none whitespace-nowrap">
                    <Brain size={14} strokeWidth={2.4} className="text-current animate-pulse shrink-0" />
                    <span className="shrink-0">Deep reasoning</span>
                    <button 
                      type="button"
                      onClick={() => setIsThinkHarder(false)} 
                      className="manus-touch-target min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 -m-2 sm:m-0 p-0.5 hover:bg-white/15 dark:hover:bg-black/15 rounded-full transition-colors ml-0.5 shrink-0 inline-flex items-center justify-center"
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
                {wordCount >= 50 && (
                  <button
                    type="button"
                    onClick={() => setIsExpanded(prev => !prev)}
                    className="manus-touch-target w-11 h-11 sm:w-9 sm:h-9 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-full hover:bg-slate-100 dark:hover:bg-accent transition-colors flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer animate-in fade-in zoom-in-95 duration-150 shrink-0"
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
                      setVoiceAudioLevel(0);
                    }
                  }}
                  onInterimChange={(interim) => {
                    setInterimSpeech(interim);
                  }}
                  onAudioLevelChange={setVoiceAudioLevel}
                  onTranscript={(dictatedText) => {
                    const base = speechBasePromptRef.current;
                    setPrompt(formatSpeechAutoFill(base, dictatedText));
                  }}
                  onAutoSubmit={(dictatedText) => {
                    const finalPrompt = formatSpeechAutoFill(speechBasePromptRef.current, dictatedText).trim();
                    if (finalPrompt) {
                      handleStart(finalPrompt);
                    }
                  }}
                  className="manus-touch-target w-11 h-11 sm:w-9 sm:h-9 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-full hover:bg-[#F2F2F2] dark:hover:bg-[#171717] transition-colors flex items-center justify-center text-[#000000] dark:text-[#FFFFFF] cursor-pointer shrink-0"
                  size={18}
                />
                <button 
                  type="button"
                  onClick={handleStart}
                  className={cn(
                    "manus-touch-target group w-11 h-11 sm:w-9 sm:h-9 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer shadow-md shrink-0",
                    (prompt.trim() || uploadedFile || activeConnectorTags.length > 0)
                      ? "manus-send-btn-ready bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] hover:scale-105 active:scale-95 shadow-lg opacity-100"
                      : "bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] opacity-90 hover:opacity-100"
                  )}
                  title="Send message"
                  aria-label="Send message"
                >
                  <ArrowUp size={18} strokeWidth={2.6} className="font-bold shrink-0 transition-transform duration-150 group-hover:-translate-y-0.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center gap-3.5 sm:gap-4 w-full">
            {/* Chat / Work mode switch centered in the middle */}
            <div className="flex justify-center w-full px-2">
              <div 
                className="relative inline-flex items-center p-1 rounded-full border border-[#E0E0E0] dark:border-[#333333] bg-[#FFFFFF] dark:bg-[#171717] shadow-xs backdrop-blur-md overflow-hidden select-none max-w-full"
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
                        "group relative z-10 inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[#000000]",
                        active
                          ? "bg-[#000000] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#000000] shadow-sm"
                          : "bg-transparent text-[#000000] dark:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#111111]"
                      )}
                    >
                      <Icon size={16} strokeWidth={2.2} className="manus-icon-spring shrink-0" />
                      <span className="shrink-0 leading-none">{mode.label}</span>
                      {active && (
                        <span 
                          className="manus-tag-pop w-1.5 h-1.5 rounded-full bg-[#FFFFFF] dark:bg-[#000000] shrink-0 ml-0.5" 
                          aria-hidden="true" 
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Work actions plus the writing shortcut in Chat mode */}
            <>
              <div className="flex min-w-0 w-full box-border items-center justify-start sm:justify-center gap-2 sm:gap-2.5 overflow-x-auto overscroll-x-contain scroll-px-2 no-scrollbar px-2 sm:px-4 py-1.5 whitespace-nowrap">
                {ACTION_CHIPS.filter((chip) => chatWorkMode === 'work' || chip.label === 'Write for me').map((chip, chipIdx) => (
                  <button
                    key={chip.label}
                    style={{ animationDelay: `${chipIdx * 45}ms` }}
                    onClick={() => {
                      const defaults = getHomeActionDefaults(chip.label);
                      setSelectedFormat(defaults.format);
                      setSelectedChart(defaults.chartType);
                      if (chip.label === "Research link") {
                        setActiveIntent({ 
                          label: "Research", 
                          icon: chip.icon,
                          placeholder: "Enter URL to research (e.g., https://example.com)"
                        });
                        setPrompt('');
                      } else if (chip.label === "Build website") {
                        setActiveIntent({ 
                          label: "Website", 
                          icon: chip.icon,
                          placeholder: "Enter website name (e.g., My Portfolio, Coffee Shop)"
                        });
                        setPrompt('');
                      } else if (chip.label === "Data analysis") {
                        setActiveIntent({ 
                          label: "Data analysis", 
                          icon: chip.icon,
                          placeholder: "Describe the data you want to analyze or upload a file"
                        });
                        setPrompt('');
                      } else if (chip.label === "Write for me") {
                        setActiveIntent({
                          label: "Writing assistant",
                          icon: chip.icon,
                          placeholder: "What do you need to write? Share the key points, recipient, and tone..."
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
                    className="manus-chip-stagger group shrink-0 inline-flex items-center justify-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium border border-border bg-white dark:bg-card text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-slate-50 dark:hover:bg-accent/80 hover:-translate-y-0.5 transition-all duration-150 cursor-pointer whitespace-nowrap shadow-xs active:scale-95 select-none"
                  >
                    <chip.icon size={16} strokeWidth={2.2} className="shrink-0 w-4 h-4 text-primary/80 transition-transform duration-200 group-hover:scale-110" />
                    <span className="shrink-0 leading-none">{chip.label}</span>
                  </button>
                ))}
              </div>
              {activeIntent?.label === 'Writing assistant' && (
                <div className="flex min-w-0 w-full items-center justify-center gap-2 overflow-x-auto overscroll-x-contain no-scrollbar px-2 py-1" role="group" aria-label="Writing starters">
                  {WRITING_STARTERS.map((starter) => (
                    <button
                      key={starter.label}
                      type="button"
                      onClick={() => {
                        setPrompt(starter.prompt);
                        window.requestAnimationFrame(() => {
                          textareaRef.current?.focus();
                          const cursor = starter.prompt.length;
                          textareaRef.current?.setSelectionRange(cursor, cursor);
                        });
                      }}
                      className="shrink-0 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-slate-50 hover:text-foreground dark:bg-card dark:hover:bg-accent"
                    >
                      {starter.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          </div>
        </div>

        {/* Building agent features (Output formats and Chart gallery) shown ONLY in Work mode */}
        {chatWorkMode === 'work' && activeIntent?.label !== 'Writing assistant' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 animate-on-load animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="space-y-4">
              <h3 className="font-sans text-xs font-bold text-slate-500 dark:text-muted-foreground uppercase tracking-widest px-1">Choose output format</h3>
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2 sm:gap-3">
                {OUTPUT_FORMATS.map((format, formatIdx) => (
                  <button
                    key={format.id}
                    style={{ animationDelay: `${formatIdx * 55}ms` }}
                    onClick={() => setSelectedFormat(format.id)}
                    aria-pressed={selectedFormat === format.id}
                    className={cn(
                      "manus-card-stagger manus-hover-lift flex min-w-0 items-start gap-2.5 sm:gap-4 p-3 sm:p-4 rounded-2xl border text-left group cursor-pointer",
                      selectedFormat === format.id 
                        ? "bg-white dark:bg-card border-primary shadow-md ring-1 ring-primary/10 -translate-y-0.5" 
                        : "bg-white dark:bg-card border-slate-200 dark:border-border hover:border-primary/40 dark:hover:border-primary/50 shadow-xs"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 p-2 sm:p-2.5 rounded-xl transition-colors",
                      selectedFormat === format.id 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground group-hover:bg-slate-200 dark:group-hover:bg-accent"
                    )}>
                      <format.icon size={23} strokeWidth={2.4} className="manus-icon-spring" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-sm tracking-tight text-foreground break-words">{format.label}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{format.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-sans text-xs font-bold text-slate-500 dark:text-muted-foreground uppercase tracking-widest px-1">Preferred charts gallery</h3>
              <div className="grid grid-cols-3 gap-3">
                {CHART_TYPES.map((chart, chartIdx) => (
                  <button
                    key={chart.id}
                    style={{ animationDelay: `${chartIdx * 45}ms` }}
                    onClick={() => setSelectedChart(chart.id)}
                    aria-pressed={selectedChart === chart.id}
                    className={cn(
                      "manus-card-stagger manus-hover-lift flex min-w-0 flex-col items-center justify-center gap-2 p-2 sm:p-4 rounded-2xl border bg-white dark:bg-card group cursor-pointer",
                      selectedChart === chart.id 
                        ? "border-primary shadow-md ring-1 ring-primary/10 -translate-y-0.5" 
                        : "border-slate-200 dark:border-border hover:border-primary/40 dark:hover:border-primary/50 shadow-xs"
                    )}
                  >
                    <div className={cn(
                      "p-2 rounded-lg transition-colors",
                      selectedChart === chart.id 
                        ? "bg-primary/10 text-primary" 
                        : "text-slate-700 dark:text-muted-foreground group-hover:text-foreground"
                    )}>
                      <chart.icon size={25} strokeWidth={2.4} className="manus-icon-spring" />
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
      {isDrivePickerOpen && (
        <React.Suspense fallback={null}>
          <GoogleDrivePickerModal
            isOpen={isDrivePickerOpen}
            onClose={() => setIsDrivePickerOpen(false)}
            onSelectFile={handleDriveFileSelect}
          />
        </React.Suspense>
      )}

      {/* Connectors & Plugins Store Panel */}
      {isConnectorsStoreOpen && (
        <React.Suspense fallback={null}>
          <ConnectorsStorePanel
            isOpen={isConnectorsStoreOpen}
            onClose={() => setIsConnectorsStoreOpen(false)}
            activeConnectors={activePlugins}
            onToggleConnector={handleTogglePlugin}
          />
        </React.Suspense>
      )}

      {/* Interactive Connector Details & Configuration Modal */}
      {selectedConfigConnectorId && (
        <React.Suspense fallback={null}>
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
        </React.Suspense>
      )}
    </div>
  );
}
