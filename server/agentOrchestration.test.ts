import { describe, expect, it } from 'vitest';
import {
  buildAgentOrchestrationInstruction,
  buildAgentOrchestrationProfile,
  classifyAgentIntent,
} from './agentOrchestration';

describe('agent orchestration profile', () => {
  it('keeps ordinary greetings on the fast conversational path', () => {
    expect(classifyAgentIntent('Hello!')).toBe('conversation');
    expect(buildAgentOrchestrationProfile('Hi').requiresPlan).toBe(false);
  });

  it('recognizes targeted UI changes and preserves unrelated UI by default', () => {
    const profile = buildAgentOrchestrationProfile('Change the UI button and fix its click behavior');
    expect(profile.intent).toBe('ui-change');
    expect(profile.preserveExistingUi).toBe(true);
    expect(buildAgentOrchestrationInstruction('Change the UI button')).toContain('Preserve existing layout');
  });

  it('allows broader visual changes only when explicitly requested', () => {
    const profile = buildAgentOrchestrationProfile('Redesign the entire UI with a new layout');
    expect(profile.intent).toBe('ui-change');
    expect(profile.preserveExistingUi).toBe(false);
  });

  it('recognizes emotional cues in English and Hindi', () => {
    expect(classifyAgentIntent('I feel worried and overwhelmed')).toBe('emotional-support');
    expect(classifyAgentIntent('मैं बहुत परेशान और उदास हूँ')).toBe('emotional-support');
    expect(buildAgentOrchestrationInstruction('I feel frustrated')).toContain('respond with warmth');
  });

  it('enables planning and verification for multi-step coding work', () => {
    const prompt = 'Fix all errors in the repository, implement the missing feature, and then test and deploy everything';
    const profile = buildAgentOrchestrationProfile(prompt);
    expect(profile.intent).toBe('coding');
    expect(profile.complexity).toBe('high');
    expect(profile.requiresPlan).toBe(true);
    const instruction = buildAgentOrchestrationInstruction(prompt, true);
    expect(instruction).toContain('plan → act → inspect → verify');
    expect(instruction).toContain('Never claim a tool ran');
  });
});
