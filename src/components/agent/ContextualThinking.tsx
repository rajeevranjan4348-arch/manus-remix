import React from 'react';
import { WorkModeThinkingAnimation } from './WorkModeThinkingAnimation';

interface ContextualThinkingProps {
  prompt: string;
  activeStep?: string;
  deepMode?: boolean;
  steps?: { label: string; status?: string; trace?: string[] }[];
}

export function ContextualThinking({ prompt, activeStep, steps }: ContextualThinkingProps) {
  return (
    <WorkModeThinkingAnimation
      prompt={prompt}
      activeStep={activeStep}
      isLive={true}
      steps={steps}
    />
  );
}
