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
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { toast } from 'sonner';

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
}

export function Home({ onStartTask }: HomeProps) {
  const [prompt, setPrompt] = useState('');
  const [activeIntent, setActiveIntent] = useState<{ label: string, icon: any, placeholder?: string } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [selectedChart, setSelectedChart] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      gsap.from(containerRef.current.querySelectorAll('.animate-on-load'), {
        y: 20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.8,
        ease: 'power3.out'
      });
    }
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsExtracting(true);
    
    try {
      const fileName = file.name.toLowerCase();
      
      // Handle CSV files - use FileReader (no auth required)
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
      
      // Handle JSON files - use FileReader (no auth required)
      if (fileName.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          try {
            // Validate it's valid JSON
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
      
      // Handle plain text files - use FileReader (no auth required)
      if (fileName.endsWith('.txt')) {
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
      
      // Handle Excel files (.xlsx, .xls) - try to read as text/binary
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        // For Excel files, we'll read as text which gives limited results
        // but works without auth. For full Excel parsing, auth is needed.
        const reader = new FileReader();
        reader.onload = async (event) => {
          // Try extractFromBlob with auth if available
          try {
            const { blink } = await import('@/lib/blink');
            const text = await blink.data.extractFromBlob(file);
            
            if (typeof text === 'string') {
              setFileData(text);
            } else if (Array.isArray(text)) {
              setFileData(text.join('\n'));
            }
            
            toast.success(`Loaded ${file.name}`);
            if (!prompt.trim()) {
              setPrompt(`Analyze the content of ${file.name} and provide insights`);
            }
          } catch (error: any) {
            // If 401, suggest using CSV instead
            if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
              toast.error('Please sign in to upload Excel files, or convert to CSV');
            } else {
              toast.error('Failed to read Excel file. Try converting to CSV format.');
            }
          }
          setIsExtracting(false);
        };
        reader.onerror = () => {
          toast.error('Failed to read Excel file. Try converting to CSV format.');
          setIsExtracting(false);
        };
        reader.readAsArrayBuffer(file);
        return;
      }
      
      // Handle PDF files - requires authentication
      if (fileName.endsWith('.pdf')) {
        try {
          const { blink } = await import('@/lib/blink');
          const text = await blink.data.extractFromBlob(file);
          
          if (typeof text === 'string') {
            setFileData(text);
          } else if (Array.isArray(text)) {
            setFileData(text.join('\n'));
          }
          
          toast.success(`Loaded ${file.name}`);
          if (!prompt.trim()) {
            setPrompt(`Analyze the content of ${file.name} and provide insights`);
          }
        } catch (error: any) {
          if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
            toast.error('Please sign in to upload PDF files');
          } else {
            toast.error('Failed to extract content from PDF');
          }
        }
        setIsExtracting(false);
        return;
      }
      
      // Unsupported file type
      toast.error('Unsupported file type. Please use CSV, JSON, TXT, or PDF files.');
      setIsExtracting(false);
      
    } catch (error) {
      console.error('File extraction error:', error);
      toast.error('Failed to process file. Please try a different format.');
      setIsExtracting(false);
    }
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    setFileData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleStart = () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    const options: any = { 
      format: selectedFormat || 'report', 
      chartType: selectedChart || 'auto',
      intent: activeIntent?.label
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
    <div ref={containerRef} className="flex-1 flex flex-col items-center justify-center p-6 bg-manus-cream min-h-full">
      <div className="w-full max-w-4xl space-y-12">
        <div className="text-center space-y-4 animate-on-load">
          <h1 className="text-6xl font-serif font-bold tracking-tight text-foreground">
            What can I do for you?
          </h1>
          <p className="text-muted-foreground text-lg">Assign a task, and I'll handle the rest.</p>
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

          <div className="flex flex-col gap-3 rounded-[22px] transition-all relative bg-[var(--fill-input-chat)] py-3 max-h-[312px] w-full z-[2] shadow-[0px_12px_32px_0px_rgba(0,0,0,0.02)] border border-black/8 dark:border-[var(--border-main)]">
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
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleStart();
                  }
                }}
                className="flex border-none focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 overflow-hidden bg-transparent px-0 w-full placeholder:text-[var(--text-disable)] text-lg shadow-none resize-none leading-relaxed min-h-[48px]" 
                rows={1}
                placeholder={activeIntent?.placeholder || "Assign a task or ask anything"} 
              />
            </div>
            <div className="px-3 flex gap-2 item-center">
              <div className="flex gap-2 items-center flex-shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.pdf,.txt,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isExtracting}
                  className="rounded-full border border-[var(--border-main)] inline-flex items-center justify-center gap-1 clickable cursor-pointer text-xs text-[var(--text-secondary)] hover:bg-[var(--fill-tsp-gray-main)] w-8 h-8 p-0 data-[popover-trigger]:bg-[var(--fill-tsp-gray-main)] shrink-0 relative" 
                  aria-expanded="false" 
                  aria-haspopup="dialog"
                >
                  <Plus size={18} className="text-[var(--icon-primary)]"/>
                  {uploadedFile && (
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-[2px] bg-blue-600 rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                  )}
                </button>
                <div className="flex items-center gap-[4px] p-[8px] pl-[8px] cursor-pointer rounded-[100px] border border-[var(--border-main)] hover:bg-[var(--fill-tsp-gray-main)] relative" aria-expanded="false" aria-haspopup="dialog">
                  <div className="flex items-center gap-[4px]">
                    <Cable size={16} className="text-[var(--icon-primary)]"/>
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

          <div className="flex flex-wrap justify-center gap-3">
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
                className="manus-pill action-chip text-muted-foreground hover:text-foreground hover:border-primary/20 flex items-center gap-2"
              >
                <chip.icon size={14} />
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-on-load">
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Choose output format</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {OUTPUT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  onClick={() => setSelectedFormat(format.id)}
                  className={cn(
                    "flex items-start gap-4 p-4 rounded-2xl border transition-all text-left group",
                    selectedFormat === format.id 
                      ? "bg-white border-primary shadow-lg ring-1 ring-primary/10 -translate-y-1" 
                      : "bg-white/50 border-border hover:bg-white hover:border-primary/20 hover:-translate-y-0.5"
                  )}
                >
                  <div className={cn(
                    "p-2.5 rounded-xl transition-colors",
                    selectedFormat === format.id ? "bg-primary text-primary-foreground" : "bg-manus-soft text-muted-foreground group-hover:bg-manus-cream"
                  )}>
                    <format.icon size={20} />
                  </div>
                  <div>
                    <div className="font-bold text-sm tracking-tight">{format.label}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{format.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Preferred charts gallery</h3>
            <div className="grid grid-cols-3 gap-3">
              {CHART_TYPES.map((chart) => (
                <button
                  key={chart.id}
                  onClick={() => setSelectedChart(chart.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border bg-white transition-all group",
                    selectedChart === chart.id 
                      ? "border-primary shadow-lg ring-1 ring-primary/10 -translate-y-1" 
                      : "border-border hover:border-primary/20 hover:-translate-y-0.5"
                  )}
                >
                  <div className={cn(
                    "p-2 rounded-lg transition-colors",
                    selectedChart === chart.id ? "bg-primary/5 text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}>
                    <chart.icon size={22} />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider">{chart.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
