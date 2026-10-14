import { describe, it, expect } from 'vitest';

function cleanSnippetText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[(?:Attached File|Think Harder|MODE)[^\]]*\]\s*/gi, '')
    .replace(/```[\s\S]*?```/g, '[Code Block]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

describe('Quick Preview Tooltip Suite', () => {
  it('should clean user prompts and markdown correctly', () => {
    const rawPrompt = '[Attached File: doc.pdf] # How to implement Quick Preview in React?\nUse **HoverCard** with ```code block```';
    const cleaned = cleanSnippetText(rawPrompt);
    expect(cleaned).not.toContain('[Attached File: doc.pdf]');
    expect(cleaned).not.toContain('#');
    expect(cleaned).toContain('How to implement Quick Preview in React?');
    expect(cleaned).toContain('Use HoverCard with [Code Block]');
  });

  it('should handle empty or null inputs gracefully', () => {
    expect(cleanSnippetText('')).toBe('');
    expect(cleanSnippetText('   ')).toBe('');
  });

  it('should preserve regular conversational text', () => {
    const text = 'What is the speed of light?';
    expect(cleanSnippetText(text)).toBe('What is the speed of light?');
  });
});
