import React, { useEffect, useMemo, useState } from 'react';
import './ContextualThinking.css';

interface ContextualThinkingProps {
  prompt: string;
  activeStep?: string;
  deepMode?: boolean;
}

function getStages(prompt: string): string[] {
  const q = prompt.toLowerCase();
  if (/quantum|physics|chemistry|biology|science|universe|atom|energy/.test(q)) {
    return ['Understanding the question', 'Breaking down the core concept', 'Connecting the key ideas', 'Preparing a clear explanation'];
  }
  if (/\b(code|debug|bug|function|api|typescript|javascript|python|program|repository|github|build)\b/.test(q)) {
    return ['Analyzing the request', 'Tracing the implementation', 'Checking edge cases', 'Preparing the solution'];
  }
  if (/\b(image|picture|illustration|draw|design|logo|wallpaper|visual)\b/.test(q)) {
    return ['Interpreting the visual brief', 'Planning the composition', 'Refining the visual direction', 'Preparing the result'];
  }
  if (/\b(chart|graph|data|statistics|calculate|compare|analysis|table)\b/.test(q)) {
    return ['Identifying the key data', 'Organizing the information', 'Checking the relationships', 'Building the result'];
  }
  if (/\b(latest|today|news|weather|current|recent|price|search|research|source)\b/.test(q)) {
    return ['Understanding what to find', 'Gathering relevant information', 'Cross-checking key details', 'Summarizing the findings'];
  }
  if (/\b(write|story|essay|email|rewrite|summarize|explain|meaning|translate)\b/.test(q)) {
    return ['Understanding your intent', 'Structuring the response', 'Checking clarity and context', 'Preparing the answer'];
  }
  return ['Understanding your request', 'Exploring the relevant context', 'Connecting the important details', 'Preparing a useful answer'];
}

export function ContextualThinking({ prompt, activeStep, deepMode = false }: ContextualThinkingProps) {
  const stages = useMemo(() => getStages(prompt), [prompt]);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    setStageIndex(0);
    const timer = window.setInterval(() => setStageIndex(index => (index + 1) % stages.length), 2600);
    return () => window.clearInterval(timer);
  }, [stages]);

  const label = activeStep?.trim() || (deepMode ? 'Thinking more deeply' : stages[stageIndex]);

  return (
    <div className="contextual-thinking" role="status" aria-live="polite" aria-label={label}>
      <span className="contextual-thinking__dots" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span key={label} className="contextual-thinking__label">{label}</span>
      <span className="contextual-thinking__pulse" aria-hidden="true" />
    </div>
  );
}
