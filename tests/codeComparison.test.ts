import { describe, it, expect } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';

describe('Magic UI CodeComparison Component', () => {
  it('1. verifies component files exist in registry and ui directories', () => {
    const registryPath = path.resolve(process.cwd(), 'src/registry/magicui/code-comparison.tsx');
    const uiPath = path.resolve(process.cwd(), 'src/components/ui/code-comparison.tsx');
    const demoPath = path.resolve(process.cwd(), 'src/components/demo/CodeComparisonDemo.tsx');

    expect(fs.existsSync(registryPath)).toBe(true);
    expect(fs.existsSync(uiPath)).toBe(true);
    expect(fs.existsSync(demoPath)).toBe(true);
  });

  it('2. verifies CodeComparison and CodeComparisonDemo exports', async () => {
    const registryModule = await import('../src/registry/magicui/code-comparison');
    expect(registryModule.CodeComparison).toBeDefined();
    expect(typeof registryModule.CodeComparison).toBe('function');
    expect(registryModule.CodeComparisonDemo).toBeDefined();
    expect(typeof registryModule.CodeComparisonDemo).toBe('function');
    expect(registryModule.defaultBeforeCode).toContain("req: NextRequest");
    expect(registryModule.defaultAfterCode).toContain("createMiddleware");

    const uiModule = await import('../src/components/ui/code-comparison');
    expect(uiModule.CodeComparison).toBeDefined();
    expect(uiModule.CodeComparisonDemo).toBeDefined();
  }, 15000);

  it('3. verifies shiki and @shikijs/transformers are installed and can highlight code with diff & focus', async () => {
    const { codeToHtml } = await import('shiki');
    const {
      transformerNotationHighlight,
      transformerNotationDiff,
      transformerNotationFocus,
    } = await import('@shikijs/transformers');

    const sample = `const x = 1; // [!code highlight]\nconst y = 2; // [!code ++]\nconst z = 3; // [!code --]`;
    const html = await codeToHtml(sample, {
      lang: 'typescript',
      theme: 'github-dark',
      transformers: [
        transformerNotationHighlight({ matchAlgorithm: 'v3' }),
        transformerNotationDiff({ matchAlgorithm: 'v3' }),
        transformerNotationFocus({ matchAlgorithm: 'v3' }),
      ],
    });

    expect(html).toContain('<pre');
    expect(html).toContain('highlighted');
    expect(html).toContain('diff');
  });
});
