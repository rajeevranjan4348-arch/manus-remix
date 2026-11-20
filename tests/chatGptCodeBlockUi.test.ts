import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectLanguageFromCode,
  resolveCodeLanguage,
  extractCodeBlockMetadata,
  highlightCodeInstantHtml,
  highlightCodeWithShiki,
} from '../src/lib/codeBlockEngine';
import { normalizeFenceFilenames } from '../src/components/agent/MarkdownRenderer';

const ROOT = process.cwd();
const read = (relPath: string) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

describe('ChatGPT-Style Full-Page Code Block Engine', () => {
  it('supports and normalizes all required programming languages', () => {
    const cases: Array<{ tag: string; expectedShiki: string; expectedLabel: string }> = [
      { tag: 'typescript', expectedShiki: 'typescript', expectedLabel: 'TypeScript' },
      { tag: 'ts', expectedShiki: 'typescript', expectedLabel: 'TypeScript' },
      { tag: 'tsx', expectedShiki: 'tsx', expectedLabel: 'TypeScript' },
      { tag: 'javascript', expectedShiki: 'javascript', expectedLabel: 'JavaScript' },
      { tag: 'js', expectedShiki: 'javascript', expectedLabel: 'JavaScript' },
      { tag: 'jsx', expectedShiki: 'jsx', expectedLabel: 'JSX' },
      { tag: 'html', expectedShiki: 'html', expectedLabel: 'HTML' },
      { tag: 'css', expectedShiki: 'css', expectedLabel: 'css' },
      { tag: 'python', expectedShiki: 'python', expectedLabel: 'Python' },
      { tag: 'py', expectedShiki: 'python', expectedLabel: 'Python' },
      { tag: 'java', expectedShiki: 'java', expectedLabel: 'Java' },
      { tag: 'kotlin', expectedShiki: 'kotlin', expectedLabel: 'Kotlin' },
      { tag: 'kt', expectedShiki: 'kotlin', expectedLabel: 'Kotlin' },
      { tag: 'json', expectedShiki: 'json', expectedLabel: 'JSON' },
      { tag: 'bash', expectedShiki: 'bash', expectedLabel: 'Bash' },
      { tag: 'sh', expectedShiki: 'bash', expectedLabel: 'Bash' },
      { tag: 'sql', expectedShiki: 'sql', expectedLabel: 'SQL' },
      { tag: 'cpp', expectedShiki: 'cpp', expectedLabel: 'C++' },
      { tag: 'c++', expectedShiki: 'cpp', expectedLabel: 'C++' },
    ];

    for (const c of cases) {
      const resolved = resolveCodeLanguage(c.tag);
      expect(resolved.shikiLang).toBe(c.expectedShiki);
      expect(resolved.displayLabel).toBe(c.expectedLabel);
    }
  });

  it('automatically detects programming language when fence language tag is omitted', () => {
    expect(
      detectLanguageFromCode(
        'import React, { useState } from "react";\ninterface LongMessageProps { content: string; }\nexport default function LongMessage({ content }: LongMessageProps) { return <div className="box">{content}</div>; }'
      )
    ).toBe('tsx');

    expect(
      detectLanguageFromCode(
        '.long-message {\n  width: 100%;\n  min-width: 0;\n  line-height: 1.6;\n}'
      )
    ).toBe('css');

    expect(
      detectLanguageFromCode('def calculate_metrics(items):\n    if not items:\n        return None')
    ).toBe('python');

    expect(
      detectLanguageFromCode('SELECT id, email FROM users WHERE active = 1 ORDER BY created_at DESC;')
    ).toBe('sql');

    expect(
      detectLanguageFromCode('#include <iostream>\nint main() {\n  std::cout << "Hello";\n  return 0;\n}')
    ).toBe('cpp');

    expect(
      detectLanguageFromCode('fun main() {\n  val greeting: String = "Hello"\n  println(greeting)\n}')
    ).toBe('kotlin');

    expect(
      detectLanguageFromCode('public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hi");\n  }\n}')
    ).toBe('java');

    expect(detectLanguageFromCode('{\n  "name": "app",\n  "version": "1.0.0"\n}')).toBe('json');
    expect(detectLanguageFromCode('#!/bin/bash\nnpm run build')).toBe('bash');
    expect(detectLanguageFromCode('<!DOCTYPE html>\n<html><body><h1>Hello</h1></body></html>')).toBe(
      'html'
    );
  });

  it('extracts standalone filenames from fence info, meta attributes, and leading comments', () => {
    const fromColon = extractCodeBlockMetadata({
      className: 'language-tsx:LongMessage.tsx',
      code: 'export default function LongMessage() {}',
    });
    expect(fromColon.filename).toBe('LongMessage.tsx');
    expect(fromColon.language.displayLabel).toBe('TypeScript');

    const fromMeta = extractCodeBlockMetadata({
      className: 'language-css',
      meta: 'title="LongMessage.css"',
      code: '.long-message { width: 100%; }',
    });
    expect(fromMeta.filename).toBe('LongMessage.css');
    expect(fromMeta.language.displayLabel).toBe('css');

    const fromComment = extractCodeBlockMetadata({
      className: 'language-tsx',
      code: '// LongMessage.tsx\nimport React from "react";\nexport const App = () => null;',
    });
    expect(fromComment.filename).toBe('LongMessage.tsx');
    expect(fromComment.rawCode).toBe('import React from "react";\nexport const App = () => null;');
  });

  it('normalizes fence filenames in markdown while avoiding duplicates when preceded by a filename heading', () => {
    const withInlineHeading = '1. `LongMessage.tsx`\n\n```tsx LongMessage.tsx\nconst x = 1;\n```';
    const normalized1 = normalizeFenceFilenames(withInlineHeading);
    // Should strip duplicate filename from fence since `LongMessage.tsx` is already on the line above
    expect(normalized1).toContain('```tsx\n');
    expect(normalized1).not.toContain('```tsx:LongMessage.tsx');

    const withoutHeading = 'Here is the implementation:\n\n```tsx LongMessage.tsx\nconst x = 1;\n```';
    const normalized2 = normalizeFenceFilenames(withoutHeading);
    expect(normalized2).toContain('```tsx:LongMessage.tsx');
  });

  it('highlights TypeScript and CSS synchronously via highlightCodeInstantHtml and asynchronously via dual-theme Shiki', async () => {
    const tsCode = 'import React, { useState } from "react";\nconst count = 500;';
    const instantTs = highlightCodeInstantHtml(tsCode, 'tsx');
    expect(instantTs).toContain('cb-tok-keyword');
    expect(instantTs).toContain('cb-tok-string');
    expect(instantTs).toContain('cb-tok-number');

    const cssCode = '.long-message {\n  width: 100%;\n}';
    const instantCss = highlightCodeInstantHtml(cssCode, 'css');
    expect(instantCss).toContain('cb-tok-selector');
    expect(instantCss).toContain('cb-tok-property');
    expect(instantCss).toContain('cb-tok-number');

    const shikiHtml = await highlightCodeWithShiki(tsCode, 'tsx');
    expect(shikiHtml).toBeTruthy();
    expect(shikiHtml).toContain('--shiki-light');
    expect(shikiHtml).toContain('--shiki-dark');
  });
});

describe('ChatGPT-Style Code Block Component & Automatic Theme Integration', () => {
  it('uses existing ThemeContext, safe copyTextToClipboard with complete original code, and responsive scroll containers', () => {
    const codeBlock = read('src/components/agent/CodeBlock.tsx');
    const markdown = read('src/components/agent/MarkdownRenderer.tsx');
    const css = read('src/index.css');

    // Uses existing ThemeContext and does not create a separate theme system
    expect(codeBlock).toContain("from '@/context/ThemeContext'");
    expect(codeBlock).toContain('const { resolvedTheme } = useTheme()');
    expect(codeBlock).toContain('data-theme={resolvedTheme}');

    // Copies the complete original code (fullCode), never the truncated preview
    expect(codeBlock).toContain("from '@/lib/clipboard'");
    expect(codeBlock).toContain('await copyTextToClipboard(fullCode)');
    expect(codeBlock).toContain('onMouseDown={(e) => e.preventDefault()}');
    expect(codeBlock).toContain('Copied');

    // Displays standalone filename pill above container, language top-left, copy top-right
    expect(codeBlock).toContain('data-testid="code-block-filename"');
    expect(codeBlock).toContain('data-testid="code-block-language"');
    expect(codeBlock).toContain('data-testid="code-block-copy-button"');
    expect(codeBlock).toContain('overflow-x-auto overflow-y-auto');

    // MarkdownRenderer integrates CodeBlock via pre/code components while preserving existing features
    expect(markdown).toContain("import { CodeBlock } from './CodeBlock'");
    expect(markdown).toContain('pre: MarkdownPreBlock');
    expect(markdown).toContain('code: MarkdownCodeElement');
    expect(markdown).toContain('manus-inline-code-pill');

    // CSS defines both light theme and dark theme rules for code containers and syntax tokens
    expect(css).toContain('.manus-codeblock-card');
    expect(css).toContain('.dark .manus-codeblock-card');
    expect(css).toContain('var(--shiki-light');
    expect(css).toContain('var(--shiki-dark');
  });
});
