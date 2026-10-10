import React from 'react';
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  ChevronRight, 
  Terminal,
  ChevronDown,
  ChevronUp,
  Globe,
  FileCode,
  Search,
  ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  trace?: string[];
}

interface TimelineProps {
  steps: Step[];
  activeStepId?: string;
}

export function Timeline({ steps }: TimelineProps) {
  const [expandedTrace, setExpandedTrace] = React.useState<string | null>(null);

  return (
    <div className="space-y-0 relative pl-4 border-l border-border/40 ml-3">
      {steps.map((step, index) => (
        <div key={step.id} className="relative py-4 first:pt-0 last:pb-0">
          <div className={cn(
            "absolute -left-[21px] top-4 w-3 h-3 rounded-full border-2 transition-all bg-manus-cream z-10",
            step.status === 'completed' ? "border-primary bg-primary" : 
            step.status === 'running' ? "border-primary animate-pulse" : "border-muted-foreground/30"
          )}>
            {step.status === 'completed' && <CheckCircle2 size={12} className="text-white opacity-0" />} 
          </div>
          
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between group">
              <div className="space-y-1">
                <h4 className={cn(
                  "text-sm font-medium transition-colors leading-none",
                  step.status === 'running' ? "text-primary" : 
                  step.status === 'completed' ? "text-foreground" : "text-muted-foreground"
                )}>
                  {step.label}
                </h4>
                {step.status === 'running' && (
                  <span className="text-[10px] text-primary/70 animate-pulse font-medium uppercase tracking-wide">In Progress</span>
                )}
              </div>
            </div>

            {/* Trace / Tool Output Display */}
            {step.trace && step.trace.length > 0 && (
              <div className="space-y-2">
                {/* Always show first trace item if meaningful */}
                <div className="text-xs text-muted-foreground/80 font-mono bg-white/50 p-2 rounded border border-border/40 truncate">
                  {step.trace[0]}
                </div>
                
                {step.trace.length > 1 && (
                  <button 
                    onClick={() => setExpandedTrace(expandedTrace === step.id ? null : step.id)}
                    className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors font-medium uppercase tracking-wide"
                  >
                    {expandedTrace === step.id ? 'Hide Details' : `View ${step.trace.length} Details`}
                    {expandedTrace === step.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                )}

                {expandedTrace === step.id && (
                  <div className="space-y-2 animate-fade-in">
                    {step.trace.map((line, i) => {
                      // Check if line looks like a search query or URL
                      const isSearch = line.startsWith('Searching for:');
                      const isFetch = line.startsWith('Fetching:');
                      const isFile = line.startsWith('Reading:');

                      if (isSearch) {
                        return (
                          <div key={i} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-border/50 shadow-sm">
                            <div className="p-1 bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-white rounded">
                              <Search size={12} />
                            </div>
                            <span className="text-xs font-medium truncate">{line.replace('Searching for:', '')}</span>
                          </div>
                        );
                      }
                      
                      if (isFetch) {
                        return (
                          <div key={i} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-border/50 shadow-sm">
                            <div className="p-1 bg-green-50 text-green-600 rounded">
                              <Globe size={12} />
                            </div>
                            <span className="text-xs font-medium truncate flex-1">{line.replace('Fetching:', '')}</span>
                            <ExternalLink size={10} className="text-muted-foreground" />
                          </div>
                        );
                      }

                      if (isFile) {
                         return (
                          <div key={i} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-border/50 shadow-sm">
                            <div className="p-1 bg-orange-50 text-orange-600 rounded">
                              <FileCode size={12} />
                            </div>
                            <span className="text-xs font-medium truncate">{line.replace('Reading:', '')}</span>
                          </div>
                        );
                      }

                      return (
                        <div key={i} className="p-2 bg-manus-soft/50 rounded text-xs font-mono text-muted-foreground break-all border border-border/30">
                          {line}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
