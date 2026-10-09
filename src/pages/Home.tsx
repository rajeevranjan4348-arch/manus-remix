import React, { useState, useRef } from 'react';
import { 
  Plus, 
  ArrowUp,
  Mic, 
  Cable,
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
  Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { toast } from 'sonner';
import { AttachmentMenu } from '@/components/chat/AttachmentMenu';
import { saveSharedFileToLibrary } from '@/lib/libraryStore';

export type PersonalityMode = 'chat' | 'work';

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
  const [activeIntent, setActiveIntent] = useState<{ label: string, icon: any, placeholder?: string } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [selectedChart, setSelectedChart] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isThinkHarder, setIsThinkHarder] = useState(false);
  const [activePlugins, setActivePlugins] = useState<string[]>(['web_search', 'code_sandbox', 'charts']);
  const [chatWorkMode, setChatWorkMode] = useState<PersonalityMode>(() => {
    return (localStorage.getItem('manus_chat_work_mode') as PersonalityMode) || personality || 'chat';
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setActivePlugins(prev => 
      prev.includes(pluginId) ? prev.filter(p => p !== pluginId) : [...prev, pluginId]
    );
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
              isDragging && "ring-2 ring-blue-500 border-blue-500 bg-blue-50/50 dark:bg-blue-950/30"
            )}
          >
            {isDragging && (
              <div className="absolute inset-0 bg-blue-50/95 dark:bg-slate-900/95 border-2 border-dashed border-blue-500 rounded-[22px] flex items-center justify-center gap-3 z-30 backdrop-blur-xs transition-all animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Upload className="w-6 h-6 text-blue-600 animate-bounce" />
                <span className="font-semibold text-sm text-blue-700 dark:text-blue-300">Drop files, images or datasets here</span>
              </div>
            )}
            <div className="overflow-y-auto pl-4 pr-2">
              {activeIntent && (
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-600 text-white rounded-full mr-2 mb-2 align-middle animate-in fade-in zoom-in duration-200">
                  <activeIntent.icon size={12} />
                  <span className="text-xs font-medium">{activeIntent.label}</span>
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
                    className="p-0.5 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
              {isThinkHarder && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-500/15 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-400/30 rounded-full mr-2 mb-2 align-middle animate-in fade-in zoom-in duration-200 text-xs font-semibold shadow-xs">
                  <Brain size={14} className="text-purple-600 dark:text-purple-400 animate-pulse" />
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
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleStart();
                  }
                }}
                className="flex border-none focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 overflow-hidden bg-transparent px-0 w-full placeholder:text-[var(--text-disable)] text-foreground text-lg shadow-none resize-none leading-relaxed min-h-[48px]" 
                rows={1}
                placeholder={activeIntent?.placeholder || (chatWorkMode === 'chat' ? "Type a message or ask anything..." : (isThinkHarder ? "Assign a deep reasoning task or question..." : "Assign a building task or ask anything"))} 
              />
            </div>
            <div className="px-3 flex gap-2 item-center">
              <div className="flex gap-2 items-center flex-shrink-0">
                <AttachmentMenu
                  onFileSelect={handleProcessFile}
                  isThinkHarder={isThinkHarder}
                  onToggleThinkHarder={() => setIsThinkHarder(prev => !prev)}
                  activePlugins={activePlugins}
                  onTogglePlugin={handleTogglePlugin}
                  onSendMessageToChat={(text) => setPrompt(text)}
                >
                  <button 
                    disabled={isExtracting}
                    className="rounded-full border border-[var(--border-main)] inline-flex items-center justify-center gap-1 clickable cursor-pointer text-xs text-[var(--text-secondary)] hover:bg-[var(--fill-tsp-gray-main)] w-8 h-8 p-0 data-[popover-trigger]:bg-[var(--fill-tsp-gray-main)] shrink-0 relative transition-transform active:scale-95" 
                    title="Camera, Photos, Files, Plugins, Think harder"
                    aria-label="Add attachments or options"
                  >
                    <Plus size={18} className="text-[var(--icon-primary)]"/>
                    {(uploadedFile || isThinkHarder) && (
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-[2px] bg-blue-600 rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                    )}
                  </button>
                </AttachmentMenu>
                <div 
                  onClick={() => setIsThinkHarder(prev => !prev)}
                  title={isThinkHarder ? "Think harder enabled (click to toggle)" : "Toggle Think harder mode"}
                  className={cn(
                    "flex items-center gap-[4px] p-[8px] pl-[8px] cursor-pointer rounded-[100px] border border-[var(--border-main)] hover:bg-[var(--fill-tsp-gray-main)] relative transition-colors",
                    isThinkHarder && "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30"
                  )} 
                  aria-expanded="false" 
                  aria-haspopup="dialog"
                >
                  <div className="flex items-center gap-[4px]">
                    <Cable size={16} className={cn("text-[var(--icon-primary)]", isThinkHarder && "text-blue-600 dark:text-blue-400")}/>
                  </div>
                  {activeIntent && (
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-[2px] bg-blue-600 rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                  )}
                </div>
              </div>
              <div className="min-w-0 flex gap-2 ml-auto flex-shrink-0 items-center">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center cursor-pointer hover:bg-[var(--fill-tsp-gray-main)] size-8 flex-shrink-0 rounded-full">
                    <Mic size={20} className="text-[var(--icon-primary)]"/>
                  </div>
                  <button 
                    onClick={handleStart}
                    disabled={!prompt.trim()}
                    className={cn(
                      "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors bg-[var(--Button-primary-black)] text-[var(--text-onblack)] gap-[6px] text-sm rounded-full p-0 w-8 h-8 min-w-0 disabled:bg-[var(--fill-tsp-white-dark)] disabled:opacity-100 disabled:hover:opacity-100 disabled:active:opacity-100",
                      prompt.trim() ? "opacity-100 cursor-pointer" : "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <ArrowUp size={15} />
                  </button>
                </div>
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
    </div>
  );
}
