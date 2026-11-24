import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  isComplexMultiStepReasoningTask,
  shouldShowChatThinkingIndicator,
} from '../src/components/agent/ChatView';

const ROOT = path.resolve(__dirname, '..');

describe('ChatView Thinking Indicator — Complex Multi-Step Reasoning Pulse', () => {
  it('stays inactive for simple short greetings without multi-step plans or deep reasoning', () => {
    expect(
      isComplexMultiStepReasoningTask({
        steps: [],
        activities: [],
        phase: 'text-generation',
        isThinkHarder: false,
        promptText: 'Hello there!',
      })
    ).toBe(false);
  });

  it('activates when multi-step plan has 2 or more steps', () => {
    expect(
      isComplexMultiStepReasoningTask({
        steps: [
          { id: 's1', label: 'Gather sources', status: 'completed' },
          { id: 's2', label: 'Synthesize architecture', status: 'running' },
        ],
        promptText: 'Hi',
      })
    ).toBe(true);
  });

  it('activates when deep reasoning (Think Harder) is toggled or tagged in prompt', () => {
    expect(
      isComplexMultiStepReasoningTask({
        isThinkHarder: true,
        promptText: 'Quick question',
      })
    ).toBe(true);

    expect(
      isComplexMultiStepReasoningTask({
        promptText: '[Think Harder] Explain quantum entanglement',
      })
    ).toBe(true);
  });

  it('activates during planning, research, verification, or multi-activity execution', () => {
    expect(
      isComplexMultiStepReasoningTask({
        phase: 'planning',
        promptText: 'Help me',
      })
    ).toBe(true);

    expect(
      isComplexMultiStepReasoningTask({
        activities: [{ category: 'analysis', status: 'running' }],
        promptText: 'Help me',
      })
    ).toBe(true);
  });

  it('activates for complex reasoning prompts (architecture, compare, step-by-step, long prompts)', () => {
    expect(
      isComplexMultiStepReasoningTask({
        promptText: 'Compare microservices vs modular monolith architecture step-by-step.',
      })
    ).toBe(true);

    expect(
      isComplexMultiStepReasoningTask({
        promptText: 'A'.repeat(150),
      })
    ).toBe(true);
  });

  it('preserves existing thinking indicator visibility contract and reduced-motion CSS guards', () => {
    expect(
      shouldShowChatThinkingIndicator({
        isAssistantWorking: true,
        hasCurrentUserMessage: true,
        hasVisibleAssistantMessage: false,
      })
    ).toBe(true);

    const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
    expect(css).toContain('.chat-thinking-bubble--reasoning');
    expect(css).toContain('@keyframes chat-thinking-reasoning-pulse');
    expect(css).toContain('@keyframes chat-thinking-reasoning-pulse-dark');
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.chat-thinking-bubble--reasoning/);
    expect(css).toContain('[data-perf-mode="ultra-lite"] .chat-thinking-bubble--reasoning');
  });
});
