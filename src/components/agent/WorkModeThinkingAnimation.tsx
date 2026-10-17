import React from 'react';
import { Sparkles, Brain, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import LatticeLoader from '../ui/LatticeLoader';

interface WorkModeThinkingAnimationProps {
  prompt?: string;
  activeStep?: string;
  isLive?: boolean;
  steps?: { label: string; status?: string; trace?: string[] }[];
  className?: string;
}

export function WorkModeThinkingAnimation({
  prompt,
  activeStep,
  isLive = true,
  steps = [],
  className,
}: WorkModeThinkingAnimationProps) {
  const currentStatusText = activeStep || 'Thinking';

  return (
    <div className={cn("p-4 rounded-2xl border border-primary/20 bg-primary/5 dark:bg-primary/10 backdrop-blur-xs space-y-3 my-2 animate-in fade-in duration-200", className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary shrink-0">
            <Brain size={16} className="animate-pulse" />
            <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping opacity-75" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              Manus AI is working
              <Sparkles size={13} className="text-amber-500 animate-spin" style={{ animationDuration: '3s' }} />
            </p>
          </div>
        </div>

        {/* Integrated Lattice Loader Thinking Animation */}
        <LatticeLoader
          label={currentStatusText}
          doneLabel="Completed in"
          errorLabel="Failed after"
          status={isLive ? "working" : "done"}
          pattern="orbit"
          grid={3}
          shape="round"
          cellSize={5}
          gap={2}
          fontSize={12}
          glow={true}
          showTimer={true}
          className="shrink-0"
        />
      </div>

      {steps && steps.length > 0 && (
        <div className="pt-2 border-t border-border/40 space-y-1.5 text-xs">
          {steps.slice(-3).map((step, idx) => (
            <div key={idx} className="flex items-center gap-2 text-muted-foreground font-mono text-[11px]">
              <Cpu size={12} className="text-primary/70 shrink-0" />
              <span className="truncate">{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
