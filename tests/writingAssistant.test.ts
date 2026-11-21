import { describe, expect, it } from 'vitest';
import { buildWritingAssistantPrompt, WRITING_ASSISTANT_GUIDANCE } from '../src/lib/writingAssistant';

describe('writing assistant prompt', () => {
  it('asks for a copy-ready draft without inventing facts or sending it', () => {
    expect(WRITING_ASSISTANT_GUIDANCE).toContain('ready-to-copy draft');
    expect(WRITING_ASSISTANT_GUIDANCE).toContain('Do not invent facts');
    expect(WRITING_ASSISTANT_GUIDANCE).toContain('[placeholder]');
    expect(WRITING_ASSISTANT_GUIDANCE).toContain('never send, publish');
  });

  it('preserves the user request while trimming surrounding whitespace', () => {
    expect(buildWritingAssistantPrompt('  Ask for Friday off.  ')).toContain('Writing request:\nAsk for Friday off.');
  });
});
