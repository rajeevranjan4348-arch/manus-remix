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
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { toast } from 'sonner';
import { AttachmentMenu } from '@/components/chat/AttachmentMenu';
import { VoiceInputButton } from '@/components/voice/VoiceInputButton';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';
import { ConnectorsPopupMenu } from '@/components/chat/ConnectorsPopupMenu';
import { ConnectorsStorePanel, CONNECTOR_CATALOG } from '@/components/connectors/ConnectorsStorePanel';
import { ConnectorConfigModal } from '@/components/connectors/ConnectorConfigModal';
import { GoogleDrivePickerModal } from '@/components/workspace/GoogleDrivePickerModal';
import { WorkspaceMentionPicker, WORKSPACE_CONNECTOR_OPTIONS, WorkspaceConnectorOption } from '@/components/chat/WorkspaceMentionPicker';
import { GoogleDriveFileItem } from '@/lib/workspaceTools';
import { getSettings } from '@/lib/settingsStore';

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
  const [prompt, setPrompt] = useState('');
  const [robotState, setRobotState] = useState<RobotHeadState>(() => (getSettings().robotState as RobotHeadState) || 'idle');
  const [robotShape, setRobotShape] = useState<RobotHeadShape>(() => (getSettings().robotShape as RobotHeadShape) || 'rectangle');
  const [robotTheme, setRobotTheme] = useState(() => getSettings().robotTheme ?? 0);
  const [robotSpeed, setRobotSpeed] = useState(() => getSettings().robotSpeed ?? 1);
  const [robotPaused, setRobotPaused] = useState(() => getSettings().robotPaused ?? false);
  const [robotInteractive, setRobotInteractive] = useState(() => getSettings().robotInteractive ?? true);
  const [robotAntenna, setRobotAntenna] = useState(() => getSettings().robotAntenna ?? true);
  const [robotFloorShadow, setRobotFloorShadow] = useState(() => getSettings().robotFloorShadow ?? true);
  const [robotSeed, setRobotSeed] = useState(() => getSettings().robotSeed ?? 0.3);
  const [isHappyExpression, setIsHappyExpression] = useState(false);

  const handleRobotTap = () => {
    setIsHappyExpression(true);
    toast.success("Robot is happy! 😊", {
      icon: "😊",
      duration: 2500,
    });
    window.dispatchEvent(new CustomEvent('manus_open_settings', { detail: { tab: 'robot' } }));
    setTimeout(() => {
      setIsHappyExpression(false);
    }, 3500);
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

  const [chatWorkMode, setChatWorkMode] = useState<PersonalityMode>(() => {
    return (localStorage.getItem('manus_chat_work_mode') as PersonalityMode) || personality || 'chat';
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleDriveFileSelect = (driveFile: GoogleDriveFileItem) => {
    const driveText = `[Selected Google Drive File: ${driveFile.name}]\nLink: ${driveFile.webViewLink || 'N/A'}\nType: ${driveFile.mimeType}`;
    setPrompt(prev => prev ? `${prev}\n${driveText}` : driveText);
    toast.success(`Attached Google Drive file: ${driveFile.name}`);
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

    onStartTask(prompt, options);
  };

  return (
    <div ref={containerRef} className="w-full h-full overflow-y-auto flex flex-col items-center p-6 md:py-10 bg-manus-cream dark:bg-background">
      <div className="w-full max-w-4xl space-y-10 my-auto">
        <div className="text-center space-y-3 animate-on-load">
          <h1 className="text-5xl md:text-6xl font-serif font-bold tracking-tight text-foreground">
            {chatWorkMode === 'chat' ? 'How can I help you today?' : 'What building task can I do for you?'}
          </h1>
          <p className="text-muted-foreground text-base md:text-lg">
            {chatWorkMode === 'chat' 
              ? 'Ask questions, brainstorm ideas, or share files for instant chat.' 
              : "Assign an autonomous task, build a website, or analyze datasets."}
          </p>
        </div>

        <div className="flex flex-col items-center -my-5 animate-on-load" aria-label="Manus AI robot assistant">
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
            className="shrink-0 cursor-pointer transform hover:scale-105 active:scale-95 transition-transform"
            onClick={handleRobotTap}
          />
        </div>

        <div className="space-y-6 animate-on-load">
          {/* File Upload indicators */}
          {uploadedFile && (
            <div className="flex gap-2 justify-center flex-wrap">
              <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-full border border-primary/20 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
                <FileText size={16} className="text-primary" />
                <span className="text-sm font-medium">{uploadedFile.name}</span>
                {isExtracting ? (
                  <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                ) : (
                  <button onClick={handleRemoveFile} className="p-0.5 hover:bg-manus-soft rounded-full transition-colors">
                    <X size={14} />
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
              "flex flex-col gap-3 rounded-[22px] transition-all relative bg-[var(--fill-input-chat)] py-3 max-h-[312px] w-full z-[2] shadow-[0px_12px_32px_0px_rgba(0,0,0,0.04)] border border-slate-200 dark:border-[var(--border-main)]",
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
              <div className="absolute inset-0 bg-slate-100/95 dark:bg-slate-900/95 border-2 border-dashed border-foreground rounded-[22px] flex items-center justify-center gap-3 z-30 backdrop-blur-xs transition-all animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Upload className="w-6 h-6 text-foreground animate-bounce" />
                <span className="font-semibold text-sm text-foreground">Drop files, images or datasets here</span>
              </div>
            )}
            <div className="overflow-y-auto px-3 py-1 relative flex items-center gap-2.5 flex-wrap min-h-[52px]">
              {/* Left Attachment (+) Button */}
              <div className="flex items-center shrink-0 relative">
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
                    disabled={isExtracting}
                    className="rounded-full border border-white/10 hover:border-white/20 inline-flex items-center justify-center clickable cursor-pointer text-white/90 hover:bg-white/10 w-8 h-8 p-0 shrink-0 relative transition-transform active:scale-95" 
                    title="Add attachments or connectors"
                    aria-label="Add attachments or options"
                  >
                    <Plus size={20} className="text-foreground dark:text-white"/>
                  </button>
                </AttachmentMenu>

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
              </div>

              {/* Selected Connector Tag (Matches Reference Screenshot: Icon + Connector Name in Light Blue Text) */}
              {activeConnectorTags.length > 0 && (
                <div className="flex items-center gap-2 shrink-0">
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
                        className="inline-flex items-center gap-2 text-[#93c5fd] font-semibold text-base sm:text-lg cursor-pointer hover:opacity-80 transition-opacity select-none shrink-0"
                        title="Click to view connector parameters or details"
                      >
                        <IconComp className="w-5 h-5 text-[#93c5fd] shrink-0" />
                        <span>{displayName}</span>
                        <button 
                          type="button" 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeConnectorTag(tagId);
                          }}
                          className="p-0.5 hover:bg-white/10 rounded-full text-[#93c5fd]/70 hover:text-[#93c5fd]"
                          title="Remove connector"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Badges for active intent or deep reasoning */}
              {activeIntent && (
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-white text-black dark:bg-white dark:text-black rounded-full text-xs font-medium shrink-0 animate-in fade-in zoom-in duration-200">
                  <activeIntent.icon size={12} />
                  <span>{activeIntent.label}</span>
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
                    className="p-0.5 hover:bg-black/10 rounded-full transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}

              {isThinkHarder && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-500/20 text-purple-300 border border-purple-400/30 rounded-full text-xs font-semibold shrink-0 animate-in fade-in zoom-in duration-200">
                  <Brain size={14} className="text-purple-400 animate-pulse" />
                  <span>Deep reasoning</span>
                  <button 
                    onClick={() => setIsThinkHarder(false)} 
                    className="p-0.5 hover:bg-purple-500/20 rounded-full transition-colors ml-0.5"
                    title="Remove deep reasoning"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}

              {/* Text Area */}
              <textarea 
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
                className="flex-1 border-none focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 overflow-hidden bg-transparent px-1 min-w-[120px] placeholder:text-muted-foreground text-foreground text-base sm:text-lg shadow-none resize-none leading-relaxed py-1" 
                rows={1}
                placeholder={activeIntent?.placeholder || (chatWorkMode === 'chat' ? "Type a message or ask anything, type @ for connectors..." : (isThinkHarder ? "Assign a deep reasoning task or question..." : "Assign a building task or ask anything, type @ for connectors..."))} 
              />

              {/* Right Controls: Voice Mic & Send Button */}
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <VoiceInputButton 
                  onTranscript={(text) => setPrompt(prev => prev ? `${prev} ${text}` : text)}
                  className="size-8 text-foreground/80 hover:text-foreground dark:text-white/80 dark:hover:text-white transition-colors"
                  size={18}
                />
                <button 
                  onClick={handleStart}
                  disabled={!prompt.trim() && activeConnectorTags.length === 0}
                  className={cn(
                    "inline-flex items-center justify-center font-medium transition-transform active:scale-95 bg-foreground text-background dark:bg-white dark:text-black gap-1 rounded-full w-8 h-8 shrink-0",
                    (prompt.trim() || activeConnectorTags.length > 0) ? "opacity-100 cursor-pointer" : "opacity-50 cursor-not-allowed"
                  )}
                >
                  <ArrowUp size={18} className="text-background dark:text-black font-bold" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center gap-4 w-full">
            {/* Chat / Work mode switch centered in the middle */}
            <div className="flex justify-center w-full">
              <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-border bg-white/80 dark:bg-card/80 p-1 shadow-xs backdrop-blur-sm">
                {CHAT_WORK_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const active = chatWorkMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handleChatWorkMode(mode.id)}
                      title={mode.desc}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer",
                        active
                          ? "bg-[var(--Button-primary-black)] text-[var(--text-onblack)] shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-tsp-gray-main)]"
                      )}
                    >
                      <Icon size={14} />
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action chips displayed together in a single row line when in Work mode */}
            {chatWorkMode === 'work' && (
              <div className="flex items-center justify-center gap-2.5 sm:gap-3 w-full overflow-x-auto no-scrollbar py-0.5 whitespace-nowrap">
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
                    className="manus-pill action-chip shrink-0 text-muted-foreground hover:text-foreground hover:border-primary/20 flex items-center gap-2 cursor-pointer animate-in fade-in zoom-in duration-200"
                  >
                    <chip.icon size={14} />
                    {chip.label}
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
                      <format.icon size={20} />
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
                      <chart.icon size={22} />
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
