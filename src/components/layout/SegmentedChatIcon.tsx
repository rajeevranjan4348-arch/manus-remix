import React from 'react';

interface SegmentedChatIconProps {
  className?: string;
  size?: number;
}

export function SegmentedChatIcon({ className = "w-5 h-5", size = 20 }: SegmentedChatIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2.3" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Top segmented arc */}
      <path d="M 8.2 6.2 A 6.2 6.2 0 0 1 15.8 6.2" />
      {/* Right segmented arc */}
      <path d="M 17.8 8.8 A 6.2 6.2 0 0 1 16.0 15.4" />
      {/* Bottom segmented arc */}
      <path d="M 13.8 17.1 A 6.2 6.2 0 0 1 10.6 17.3" />
      {/* Left segmented arc with speech bubble tail */}
      <path d="M 6.2 8.8 C 5.8 10.6 5.7 12.4 5.8 14.0 L 5.5 16.6 L 8.6 15.8" />
    </svg>
  );
}
