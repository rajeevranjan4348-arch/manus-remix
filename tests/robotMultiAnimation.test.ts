import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROBOT_ANIMATION_CYCLE,
  AMBIENT_ROBOT_EXPRESSION_SEQUENCE,
  getNextCycledRobotState,
  resolveContextualRobotState,
} from '../src/lib/robotAnimationEngine';

describe('Multi-State Robot Animation Engine (Normal, Thinking, Happy, Searching, Working, etc.)', () => {
  it('cycles through all robot animation states in order', () => {
    expect(ROBOT_ANIMATION_CYCLE).toContain('idle');
    expect(ROBOT_ANIMATION_CYCLE).toContain('thinking');
    expect(ROBOT_ANIMATION_CYCLE).toContain('happy');
    expect(ROBOT_ANIMATION_CYCLE).toContain('searching');
    expect(ROBOT_ANIMATION_CYCLE).toContain('working');
    expect(ROBOT_ANIMATION_CYCLE).toContain('listening');
    expect(ROBOT_ANIMATION_CYCLE).toContain('speaking');
    expect(ROBOT_ANIMATION_CYCLE).toContain('sleeping');

    expect(getNextCycledRobotState('idle')).toBe('thinking');
    expect(getNextCycledRobotState('thinking')).toBe('happy');
    expect(getNextCycledRobotState('happy')).toBe('searching');
  });

  it('resolves contextual robot animation states from typing, voice, intents, and ambient cycle', () => {
    // Normal idle fallback
    expect(
      resolveContextualRobotState({
        baseState: 'idle',
      })
    ).toBe('idle');

    // Ambient cycle state when baseState is idle
    expect(
      resolveContextualRobotState({
        baseState: 'idle',
        ambientState: 'thinking',
      })
    ).toBe('thinking');

    expect(
      resolveContextualRobotState({
        baseState: 'idle',
        ambientState: 'happy',
      })
    ).toBe('happy');

    // Typing general prompt -> thinking 🤔
    expect(
      resolveContextualRobotState({
        baseState: 'idle',
        isTypingPrompt: true,
        promptText: 'Explain quantum computing',
      })
    ).toBe('thinking');

    // Typing greeting/positive prompt -> happy 😊
    expect(
      resolveContextualRobotState({
        baseState: 'idle',
        isTypingPrompt: true,
        promptText: 'Hello there, thanks for the help!',
      })
    ).toBe('happy');

    // Typing search query -> searching
    expect(
      resolveContextualRobotState({
        baseState: 'idle',
        isTypingPrompt: true,
        promptText: 'Search latest news on AI',
      })
    ).toBe('searching');

    // Typing build/code query -> working
    expect(
      resolveContextualRobotState({
        baseState: 'idle',
        isTypingPrompt: true,
        promptText: 'Build a dashboard component',
      })
    ).toBe('working');

    // Voice dictation active -> listening
    expect(
      resolveContextualRobotState({
        baseState: 'idle',
        isListening: true,
      })
    ).toBe('listening');
  });

  it('verifies Home.tsx, Topbar.tsx, and manus-motion.css implement multi-state robot animations', () => {
    expect(AMBIENT_ROBOT_EXPRESSION_SEQUENCE.length).toBeGreaterThanOrEqual(5);

    const homeSource = fs.readFileSync(
      path.resolve(__dirname, '../src/pages/Home.tsx'),
      'utf-8'
    );
    expect(homeSource).toContain('resolveContextualRobotState');
    expect(homeSource).toContain('data-robot-state={effectiveRobotState}');

    const topbarSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/layout/Topbar.tsx'),
      'utf-8'
    );
    expect(topbarSource).toContain('AMBIENT_ROBOT_EXPRESSION_SEQUENCE');
    expect(topbarSource).toContain('data-robot-state={activeTopbarState}');

    const motionCss = fs.readFileSync(
      path.resolve(__dirname, '../src/manus-motion.css'),
      'utf-8'
    );
    expect(motionCss).toContain('manus-robot-state-thinking');
    expect(motionCss).toContain('manus-robot-state-happy');
    expect(motionCss).toContain('manus-robot-state-searching');
    expect(motionCss).toContain('manus-robot-state-working');
    expect(motionCss).toContain('manus-robot-state-sleeping');
  });
});
