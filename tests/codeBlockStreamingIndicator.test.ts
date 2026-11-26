import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { detectStreamingCodeBlockState } from '../src/components/agent/MarkdownRenderer';

describe('Real-time streaming code block indicator', () => {
  it('detects an actively streaming unclosed code fence with language and partial code', () => {
    const partialMarkdown = [
      'Here is your React hook:',
      '',
      '```tsx',
      'export function useCounter() {',
      '  const [count, setCount] = useState(0);',
    ].join('\n');

    const active = detectStreamingCodeBlockState(partialMarkdown, true);
    expect(active.isGeneratingCodeBlock).toBe(true);
    expect(active.language).toBe('tsx');
    expect(active.lineCount).toBe(2);
    expect(active.openFenceIndex).toBe(0);
    expect(active.openFenceCode).toContain('useCounter');

    // Once streaming stops, it must not report as actively generating
    const settled = detectStreamingCodeBlockState(partialMarkdown, false);
    expect(settled.isGeneratingCodeBlock).toBe(false);
    expect(settled.openFenceIndex).toBe(-1);
  });

  it('clears the generating state as soon as the closing code fence arrives', () => {
    const closedMarkdown = [
      '```python',
      'def add(a, b):',
      '    return a + b',
      '```',
      '',
      'All done!',
    ].join('\n');

    const state = detectStreamingCodeBlockState(closedMarkdown, true);
    expect(state.isGeneratingCodeBlock).toBe(false);
    expect(state.openFenceIndex).toBe(-1);
  });

  it('identifies only the trailing open code block when earlier code blocks are already closed', () => {
    const multiBlockMarkdown = [
      'First snippet:',
      '```bash',
      'npm install',
      '```',
      '',
      'Now writing the second file:',
      '```ts:src/index.ts',
      'export const ready = true;',
    ].join('\n');

    const state = detectStreamingCodeBlockState(multiBlockMarkdown, true);
    expect(state.isGeneratingCodeBlock).toBe(true);
    expect(state.language).toBe('ts');
    expect(state.openFenceIndex).toBe(1);
    expect(state.openFenceCode).toBe('export const ready = true;');
  });

  it('supports tilde fences and wires .manus-markdown-typing into CodeBlock and ChatView', () => {
    const tildeState = detectStreamingCodeBlockState('~~~sql\nSELECT * FROM users;', true);
    expect(tildeState.isGeneratingCodeBlock).toBe(true);
    expect(tildeState.language).toBe('sql');

    const codeBlockSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/agent/CodeBlock.tsx'),
      'utf8'
    );
    const chatViewSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/agent/ChatView.tsx'),
      'utf8'
    );

    expect(codeBlockSource).toContain('manus-markdown-typing');
    expect(codeBlockSource).toContain('manus-typing-dots-wave');
    expect(codeBlockSource).toContain('ultra-smooth-caret');
    expect(codeBlockSource).toContain('code-block-streaming-indicator');
    expect(chatViewSource).toContain('isStreaming={isStreamingResponse && isLatestAssistant}');
  });
});
