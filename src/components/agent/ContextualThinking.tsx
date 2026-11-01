import React from 'react';
import { WorkModeThinkingAnimation } from './WorkModeThinkingAnimation';

interface ContextualThinkingProps {
  prompt: string;
  activeStep?: string;
  deepMode?: boolean;
  isLive?: boolean;
  steps?: { id?: string; label: string; status?: string; trace?: string[] }[];
}

export function ContextualThinking({ prompt, activeStep, deepMode, isLive = true, steps }: ContextualThinkingProps) {
  return (
    <WorkModeThinkingAnimation
      prompt={prompt}
      activeStep={activeStep}
      deepMode={deepMode}
      isLive={isLive}
      steps={steps}
    />
  );
}
