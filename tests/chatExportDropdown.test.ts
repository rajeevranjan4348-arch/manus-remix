import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatChatAsMarkdown,
  formatChatAsJSON,
  generateChatPdfBytes,
  exportChatSession,
  deriveSessionTitle,
  slugifyFilename,
  ChatExportSessionData,
} from '../src/lib/chatExport';
import { EXPORT_FORMAT_OPTIONS } from '../src/components/agent/ExportChatDropdown';

const sampleSession: ChatExportSessionData = {
  taskId: 'task_export_123',
  prompt: '[Think Harder / Deep Reasoning Mode]\nCompare renewable energy growth in 2025 vs 2026',
  status: 'completed',
  format: 'chat',
  exportedAt: '2026-10-28T16:40:00.000Z',
  steps: [
    {
      id: 'step-1',
      label: 'Search global solar & wind capacity reports',
      status: 'completed',
      trace: ['Searching for: IEA renewable energy 2026 forecast'],
    },
    {
      id: 'step-2',
      label: 'Synthesize year-over-year comparison table',
      status: 'completed',
    },
  ],
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      content: '[Think Harder / Deep Reasoning Mode]\nCompare renewable energy growth in 2025 vs 2026',
      timestamp: '2026-10-28T16:38:00.000Z',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content:
        '<think>Analyzing IEA 2025 and 2026 solar and wind additions.</think>\nGlobal renewable capacity additions increased by 18% in 2026 led by utility-scale solar.',
      timestamp: '2026-10-28T16:39:00.000Z',
    },
  ],
};

describe('Topbar Chat Session Export (PDF, Markdown, JSON)', () => {
  it('cleans internal mode prefixes when deriving session title and filename slug', () => {
    const title = deriveSessionTitle(sampleSession);
    expect(title).toBe('Compare renewable energy growth in 2025 vs 2026');
    expect(slugifyFilename(title)).toBe('compare-renewable-energy-growth-in-2025-vs-2026');
  });

  it('formats chat sessions into clean Markdown (.md) with steps, thoughts, and messages', () => {
    const md = formatChatAsMarkdown(sampleSession);
    expect(md).toContain('# Compare renewable energy growth in 2025 vs 2026');
    expect(md).toContain('- **Session ID:** `task_export_123`');
    expect(md).toContain('## Execution Steps');
    expect(md).toContain('- [x] **Search global solar & wind capacity reports** _(completed)_');
    expect(md).toContain('### 1. User');
    expect(md).toContain('### 2. Manus AI');
    expect(md).toContain('> **Thought Process:**');
    expect(md).toContain('> Analyzing IEA 2025 and 2026 solar and wind additions.');
    expect(md).toContain('Global renewable capacity additions increased by 18% in 2026');
  });

  it('formats chat sessions into structured JSON (.json) with metadata, steps, and messages', () => {
    const rawJson = formatChatAsJSON(sampleSession);
    const parsed = JSON.parse(rawJson);

    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.exportedAt).toBe('2026-10-28T16:40:00.000Z');
    expect(parsed.session.id).toBe('task_export_123');
    expect(parsed.session.title).toBe('Compare renewable energy growth in 2025 vs 2026');
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[1].thought).toContain('Analyzing IEA 2025 and 2026');
    expect(parsed.messages[1].content).toContain('Global renewable capacity additions increased by 18%');
  });

  it('generates a valid PDF 1.4 binary document (.pdf) containing the session conversation', () => {
    const pdfBytes = generateChatPdfBytes(sampleSession);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.byteLength).toBeGreaterThan(200);

    const pdfText = new TextDecoder().decode(pdfBytes);
    expect(pdfText.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdfText).toContain('MANUS AI - CHAT SESSION EXPORT');
    expect(pdfText).toContain('Compare renewable energy growth in 2025 vs 2026');
    expect(pdfText).toContain('Global renewable capacity additions increased by 18%');
    expect(pdfText).toContain('xref');
    expect(pdfText.trim().endsWith('%%EOF')).toBe(true);
  });

  it('exportChatSession returns matching filename, mimeType, and payload for pdf, markdown, and json', () => {
    const pdfExport = exportChatSession(sampleSession, 'pdf', { triggerDownload: false });
    expect(pdfExport.format).toBe('pdf');
    expect(pdfExport.filename).toBe('compare-renewable-energy-growth-in-2025-vs-2026.pdf');
    expect(pdfExport.mimeType).toBe('application/pdf');

    const mdExport = exportChatSession(sampleSession, 'markdown', { triggerDownload: false });
    expect(mdExport.format).toBe('markdown');
    expect(mdExport.filename).toBe('compare-renewable-energy-growth-in-2025-vs-2026.md');
    expect(mdExport.mimeType).toContain('text/markdown');

    const jsonExport = exportChatSession(sampleSession, 'json', { triggerDownload: false });
    expect(jsonExport.format).toBe('json');
    expect(jsonExport.filename).toBe('compare-renewable-energy-growth-in-2025-vs-2026.json');
    expect(jsonExport.mimeType).toContain('application/json');
  });

  it('exposes PDF, Markdown, and JSON options in ExportChatDropdown and removes topbar Export button', () => {
    expect(EXPORT_FORMAT_OPTIONS.map((o) => o.format)).toEqual(['pdf', 'markdown', 'json']);
    expect(EXPORT_FORMAT_OPTIONS.map((o) => o.testId)).toEqual([
      'export-option-pdf',
      'export-option-markdown',
      'export-option-json',
    ]);

    const topbarSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/layout/Topbar.tsx'),
      'utf-8'
    );
    expect(topbarSource).not.toContain('ExportChatDropdown');
    expect(topbarSource).toContain("onExport('pdf')");
    expect(topbarSource).toContain("onExport('markdown')");
    expect(topbarSource).toContain("onExport('json')");

    const agentViewSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/agent/AgentView.tsx'),
      'utf-8'
    );
    expect(agentViewSource).toContain('ExportChatDropdown');
  });
});
