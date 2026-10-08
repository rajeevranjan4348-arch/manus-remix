import React from 'react';
import { cn } from '@/lib/utils';

interface HorizontalLoaderProps {
  label?: string;
  className?: string;
}

export function HorizontalLoader({
  label = "Generating",
  className
}: HorizontalLoaderProps) {
  const letters = label.split('');

  return (
    /* <!-- From Uiverse.io by dexter-st --> */
    <div className={cn("loader-wrapper", className)}>
      {letters.map((char, index) => (
        <span
          key={index}
          className="loader-letter"
          style={{ ['--index' as any]: index }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
      <div className="loader" />
    </div>
  );
}
