import React from 'react';
import { 
  Download, 
  Share2, 
  ArrowLeft,
  Settings2,
  FileText,
  BarChart3,
  Check,
  X,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { Timeline, Step } from './Timeline';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { ChartResult } from './ChartResult';
import { MarkdownRenderer } from './MarkdownRenderer';

interface AgentViewProps {
  prompt: string;
  steps: Step[];
  result?: any;
  status: 'running' | 'completed' | 'error';
  onReset: () => void;
  onExport?: () => void;
  options: any;
  chartData?: any;
}

export function AgentView({ prompt, steps, result, status, onReset, onExport, options, chartData }: AgentViewProps) {
  const [showSettings, setShowSettings] = React.useState(false);
  const [isRefining, setIsRefining] = React.useState(false);
  const resultRef = React.useRef<HTMLDivElement>(null);
  const sidebarRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // animate sidebar only
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

  return (
    <div className="flex-1 flex flex-col h-full bg-manus-cream overflow-hidden">
      <div className="h-16 border-b border-border/50 bg-white/50 backdrop-blur-md px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <button 
            onClick={onReset}
            className="p-2 -ml-2 hover:bg-manus-soft rounded-full transition-colors text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex flex-col">
            <span className="text-sm font-medium truncate max-w-md text-foreground">{prompt}</span>
            {status === 'running' && (
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="text-[10px] uppercase tracking-wider font-bold text-primary">Processing Task</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {status === 'completed' && (
            <>
              <button 
                onClick={onExport}
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-white text-xs font-medium hover:bg-manus-soft transition-all shadow-sm hover:shadow"
              >
                <Download size={14} />
                Export
              </button>
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-xs font-medium",
                  showSettings ? "bg-primary text-primary-foreground border-primary" : "bg-white border-border hover:bg-manus-soft"
                )}
              >
                <Settings2 size={14} />
                Refine
              </button>
            </>
          )}
          <button className="p-2 hover:bg-manus-soft rounded-full transition-colors text-muted-foreground hover:text-foreground">
            <Share2 size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 grid grid-cols-1 lg:grid-cols-[380px_1fr] h-full">
          {/* Timeline Sidebar - Left Side */}
          <div ref={sidebarRef} className="h-full border-r border-border/50 bg-white/30 backdrop-blur-sm p-6 overflow-y-auto custom-scrollbar">
            <div className="space-y-8 max-w-sm mx-auto">
              <div className="space-y-2 pb-4 border-b border-border/50">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                  <Sparkles size={12} className="text-primary" />
                  Task Runner
                </h3>
              </div>
              
              <Timeline steps={steps} />
              
              {status === 'running' && (
                <div className="p-6 rounded-2xl bg-white border border-border/50 shadow-sm animate-pulse flex flex-col items-center gap-3 text-center">
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 rounded-full blur-lg animate-pulse"></div>
                    <RefreshCw size={32} className="text-primary animate-spin relative z-10" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Analyzing request...</p>
                    <p className="text-xs text-muted-foreground">Identifying the best tools for the job</p>
                  </div>
                </div>
              )}

              {/* Inline settings if needed */}
              {showSettings && (
                <div className="manus-card space-y-4 animate-fade-in bg-white shadow-lg border-primary/20">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold uppercase tracking-wider">Refine Task</h4>
                    <button onClick={() => setShowSettings(false)}><X size={14} /></button>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase">Format</label>
                      <select className="w-full bg-white border border-border rounded-lg text-xs p-2 focus:ring-0 focus:outline-none">
                        <option>Report</option>
                        <option>Slides</option>
                        <option>Website</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase">Chart Style</label>
                      <div className="grid grid-cols-3 gap-1">
                        {['Bar', 'Line', 'Pie'].map(c => (
                          <button key={c} className="text-[10px] py-1 border border-border rounded bg-white hover:bg-primary hover:text-white transition-colors">
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button className="w-full py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90 transition-all shadow-sm">
                      Re-run Analysis
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Result Area - Right Side */}
          <div className="h-full overflow-y-auto p-8 lg:p-12 custom-scrollbar bg-manus-cream/50">
            <div className="max-w-4xl mx-auto space-y-8">
              {status === 'running' ? (
                <div className="flex flex-col items-center justify-center h-[60vh] space-y-6 text-center opacity-50">
                  <div className="w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center animate-bounce">
                    <FileText size={32} className="text-primary/50" />
                  </div>
                  <div className="space-y-2 max-w-sm">
                    <h2 className="text-xl font-serif font-bold text-foreground/70">Working on it...</h2>
                    <p className="text-sm text-muted-foreground">
                      Manus is analyzing your data, computing statistics, and generating the optimal visualization.
                    </p>
                  </div>
                </div>
              ) : result ? (
                <div ref={resultRef} className="space-y-8 animate-fade-in">
                  {/* Result content will be rendered here */}
                  <div className="manus-card space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-lg">Analysis Summary</h4>
                      <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full font-medium">
                        <Check size={12} /> Complete
                      </span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      The agent has successfully analyzed your request and generated the requested output format. 
                      Below you can find the detailed analysis, charts, and exportable files.
                    </p>
                  </div>

                  {(result.type === 'graph' || chartData || options.chartType) && (
                    <div className="manus-card !p-0 overflow-hidden border border-border/50 shadow-sm">
                      <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between bg-white">
                        <div className="flex items-center gap-3">
                          <div className="p-1.5 rounded-md bg-primary/5 text-primary">
                            <BarChart3 size={16} />
                          </div>
                          <span className="font-serif font-medium text-foreground">
                            {(result.detectedChartType || options.chartType || 'bar').charAt(0).toUpperCase() + (result.detectedChartType || options.chartType || 'bar').slice(1)} Visualization
                          </span>
                        </div>
                        <button 
                          onClick={() => setShowSettings(!showSettings)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium flex items-center gap-1"
                        >
                          <Settings2 size={12} />
                          Customize
                        </button>
                      </div>
                      <div className="p-6 h-[400px] bg-white">
                        <ChartResult 
                          type={result.detectedChartType || options.chartType || 'bar'} 
                          data={chartData || result.chartData} 
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Report Section */}
                  <div className="space-y-6">
                    <h3 className="font-serif text-xl font-bold">Analysis Report</h3>
                    <div className="manus-card p-8 bg-white border border-border shadow-sm rounded-3xl">
                      <MarkdownRenderer 
                        content={result.content || 'Processing analysis...'} 
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 space-y-4">
                  <FileText size={48} className="mx-auto text-muted-foreground/20" />
                  <p className="text-muted-foreground">No result generated yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
