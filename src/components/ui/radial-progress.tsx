import React from 'react';
import { cn } from '@/lib/utils';

export interface RadialProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
  size?: number; // Outer diameter in pixels
  strokeWidth?: number; // Thickness of the ring
  className?: string;
  trackClassName?: string;
  indicatorClassName?: string;
  showValue?: boolean;
  valueClassName?: string;
  isIndeterminate?: boolean;
  status?: 'idle' | 'running' | 'completed' | 'error' | string;
  children?: React.ReactNode;
}

export function RadialProgress({
  value = 0,
  size = 24,
  strokeWidth = 2.5,
  className,
  trackClassName,
  indicatorClassName,
  showValue = false,
  valueClassName,
  isIndeterminate = false,
  status = 'idle',
  children,
  ...props
}: RadialProgressProps) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const radius = Math.max(1, (size - strokeWidth) / 2);
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedValue / 100) * circumference;

  const isCompleted = status === 'completed' || clampedValue >= 100;
  const isRunning = status === 'running';
  const isError = status === 'error';

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clampedValue)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 select-none",
        className
      )}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn(
          "overflow-visible -rotate-90 transition-transform",
          isIndeterminate && "animate-spin duration-1500"
        )}
      >
        {/* Background Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          stroke="currentColor"
          className={cn(
            "text-muted/20 dark:text-muted/30 transition-colors",
            trackClassName
          )}
        />

        {/* Foreground Animated Progress Arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={isIndeterminate ? circumference * 0.75 : strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          stroke="currentColor"
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-500 ease-out",
            isError
              ? "text-destructive"
              : isCompleted
              ? "text-emerald-500 dark:text-emerald-400"
              : "text-primary",
            isRunning && "filter drop-shadow-[0_0_2px_rgba(var(--primary),0.3)]",
            indicatorClassName
          )}
        />
      </svg>

      {/* Center Label or Icon */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {children ? (
          children
        ) : showValue ? (
          <span
            className={cn(
              "text-[8px] font-bold tabular-nums leading-none tracking-tighter",
              isCompleted ? "text-emerald-500 dark:text-emerald-400" : "text-foreground",
              valueClassName
            )}
          >
            {Math.round(clampedValue)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}
