export type ChatExportFormat = 'pdf' | 'markdown' | 'json';

export interface ChatExportMessage {
  id?: string;
  role: string;
  content: any;
  timestamp?: string | number;
  status?: string;
}

export interface ChatExportStep {
  id?: string;
  label: string;
  status: string;
  trace?: string[];
}

export interface ChatExportSessionData {
  taskId?: string | null;
  title?: string;
  prompt?: string;
  format?: string;
  status?: string;
  messages?: ChatExportMessage[];
  steps?: ChatExportStep[];
  result?: any;
  exportedAt?: string;
}

export interface ChatExportResult {
  format: ChatExportFormat;
  filename: string;
  mimeType: string;
  content: string | Uint8Array;
}

/**
 * Extracts `<think>...</think>` or `[THOUGHTS]...[/THOUGHTS]` blocks and returns cleaned message text.
 */
export function extractExportThoughtAndContent(raw: any): { thought: string; content: string } {
  if (raw === null || raw === undefined) {
    return { thought: '', content: '' };
  }

  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (typeof raw === 'object') {
    try {
      text = raw.content || raw.text || raw.message || JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  } else {
    text = String(raw);
  }

  let thought = '';
  let content = text;

  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    thought = thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  } else {
    const unclosedMatch = content.match(/<think>([\s\S]*)$/i);
    if (unclosedMatch) {
      thought = unclosedMatch[1].trim();
      content = content.replace(/<think>[\s\S]*$/i, '').trim();
    }
  }

  if (!thought) {
    const thoughtsMatch = content.match(/\[THOUGHTS?\]([\s\S]*?)\[\/THOUGHTS?\]/i);
    if (thoughtsMatch) {
      thought = thoughtsMatch[1].trim();
      content = content.replace(/\[THOUGHTS?\][\s\S]*?\[\/THOUGHTS?\]/gi, '').trim();
    }
  }

  content = cleanExportMessageText(content);
  return { thought, content };
}

/**
 * Cleans internal tags and prompt metadata from exported message content.
 */
export function cleanExportMessageText(raw: any): string {
  if (raw === null || raw === undefined) return '';
  let text = typeof raw === 'string' ? raw : String(raw);

  text = text.replace(/\[IMAGE_DATA_URL:[^\]]*\]\s*/gi, '[Attached Image] ');
  text = text.replace(/\[Attached Image Data URL:[^\]]*\]\s*/gi, '');
  text = text.replace(/^\[Think Harder[^\]]*\]\s*/gim, '');
  text = text.replace(/\[Think Harder[^\]]*\]\s*/gi, '');
  text = text.replace(/^\[MODE:\s*THINK HARDER[^\]]*\]\s*/gim, '');
  text = text.replace(/\[(?:USER INSTRUCTIONS & PREFERENCES|MODE|USER PROFILE|TONE REQUIREMENT|PROJECT CONTEXT|INSTRUCTION)[^\]]*\]\n*/gi, '');

  const userMatch = text.match(/(?:User Prompt|User):\s*([\s\S]+)$/i);
  if (userMatch) {
    text = userMatch[1].trim();
  }

  return text.trim();
}

/**
 * Derives a clean, human-readable title and safe filename slug for the session.
 */
export function deriveSessionTitle(data: ChatExportSessionData): string {
  if (data.title && data.title.trim()) {
    return cleanExportMessageText(data.title).slice(0, 80);
  }
  if (data.prompt && data.prompt.trim()) {
    const cleaned = cleanExportMessageText(data.prompt);
    if (cleaned) return cleaned.slice(0, 80);
  }
  const firstUserMsg = (data.messages || []).find((m) => m?.role === 'user');
  if (firstUserMsg?.content) {
    const cleaned = cleanExportMessageText(firstUserMsg.content);
    if (cleaned) return cleaned.slice(0, 80);
  }
  return 'Manus Chat Session';
}

export function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'manus-chat-session';
}

/**
 * Normalizes messages from session data, falling back to prompt + result if messages array is empty.
 */
export function normalizeExportMessages(data: ChatExportSessionData): Array<{
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  thought?: string;
  timestamp?: string;
}> {
  const normalized: Array<{
    id: string;
    role: 'user' | 'assistant' | string;
    content: string;
    thought?: string;
    timestamp?: string;
  }> = [];

  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  rawMessages.forEach((msg, idx) => {
    if (!msg) return;
    const { thought, content } = extractExportThoughtAndContent(msg.content);
    if (!content && !thought) return;

    const ts =
      typeof msg.timestamp === 'number'
        ? new Date(msg.timestamp).toISOString()
        : typeof msg.timestamp === 'string' && msg.timestamp.trim()
          ? msg.timestamp
          : undefined;

    normalized.push({
      id: msg.id || `msg-${idx + 1}`,
      role: msg.role || 'assistant',
      content,
      ...(thought ? { thought } : {}),
      ...(ts ? { timestamp: ts } : {}),
    });
  });

  if (normalized.length === 0) {
    if (data.prompt && cleanExportMessageText(data.prompt)) {
      normalized.push({
        id: 'msg-prompt',
        role: 'user',
        content: cleanExportMessageText(data.prompt),
      });
    }
    const resultText =
      typeof data.result === 'string'
        ? data.result
        : data.result?.content || data.result?.summary || data.result?.text || '';
    if (resultText && cleanExportMessageText(resultText)) {
      const { thought, content } = extractExportThoughtAndContent(resultText);
      normalized.push({
        id: 'msg-result',
        role: 'assistant',
        content,
        ...(thought ? { thought } : {}),
      });
    }
  }

  return normalized;
}

/**
 * Formats the chat session into a clean Markdown (.md) document.
 */
export function formatChatAsMarkdown(data: ChatExportSessionData): string {
  const title = deriveSessionTitle(data);
  const exportedAt = data.exportedAt || new Date().toISOString();
  const messages = normalizeExportMessages(data);
  const steps = Array.isArray(data.steps) ? data.steps : [];

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- **Exported:** ${exportedAt}`);
  if (data.taskId) {
    lines.push(`- **Session ID:** \`${data.taskId}\``);
  }
  if (data.status) {
    lines.push(`- **Status:** ${data.status}`);
  }
  if (data.format) {
    lines.push(`- **Format:** ${data.format}`);
  }
  lines.push('');

  if (steps.length > 0) {
    lines.push('## Execution Steps');
    lines.push('');
    steps.forEach((step) => {
      const checked = step.status === 'completed' ? 'x' : ' ';
      lines.push(`- [${checked}] **${step.label}** _(${step.status})_`);
      if (Array.isArray(step.trace) && step.trace.length > 0) {
        step.trace.forEach((traceLine) => {
          lines.push(`  - ${traceLine}`);
        });
      }
    });
    lines.push('');
  }

  lines.push('## Conversation');
  lines.push('');

  if (messages.length === 0) {
    lines.push('_No messages recorded in this session._');
    lines.push('');
  } else {
    messages.forEach((msg, index) => {
      const speaker = msg.role === 'user' ? 'User' : 'Manus AI';
      const timeSuffix = msg.timestamp ? ` (${msg.timestamp})` : '';
      lines.push(`### ${index + 1}. ${speaker}${timeSuffix}`);
      lines.push('');
      if (msg.thought) {
        lines.push('> **Thought Process:**');
        msg.thought.split('\n').forEach((tLine) => {
          lines.push(`> ${tLine}`);
        });
        lines.push('');
      }
      if (msg.content) {
        lines.push(msg.content);
        lines.push('');
      }
    });
  }

  lines.push('---');
  lines.push('_Exported from Manus AI Workspace_');

  return lines.join('\n');
}

/**
 * Formats the chat session into a structured JSON (.json) string.
 */
export function formatChatAsJSON(data: ChatExportSessionData): string {
  const title = deriveSessionTitle(data);
  const exportedAt = data.exportedAt || new Date().toISOString();
  const messages = normalizeExportMessages(data);
  const steps = Array.isArray(data.steps) ? data.steps : [];

  const payload = {
    schemaVersion: '1.0',
    exportedAt,
    session: {
      id: data.taskId || null,
      title,
      prompt: data.prompt ? cleanExportMessageText(data.prompt) : title,
      status: data.status || 'completed',
      format: data.format || 'chat',
    },
    steps: steps.map((s, idx) => ({
      id: s.id || `step-${idx + 1}`,
      label: s.label,
      status: s.status,
      trace: Array.isArray(s.trace) ? s.trace : [],
    })),
    messages,
    result: data.result ?? null,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Escapes characters for PDF literal strings (...) and strips non-printable ASCII characters
 * so standard Type1 Helvetica fonts render cleanly in any PDF viewer.
 */
function escapePdfText(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Wraps text into lines of at most `maxChars` characters.
 */
function wrapTextLines(text: string, maxChars = 84): string[] {
  const wrapped: string[] = [];
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');

  for (const para of paragraphs) {
    const trimmed = para.trimEnd();
    if (!trimmed) {
      wrapped.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        if (word.length > maxChars) {
          for (let i = 0; i < word.length; i += maxChars) {
            wrapped.push(word.slice(i, i + maxChars));
          }
        } else {
          currentLine = word;
        }
      } else if (currentLine.length + 1 + word.length <= maxChars) {
        currentLine += ` ${word}`;
      } else {
        wrapped.push(currentLine);
        if (word.length > maxChars) {
          for (let i = 0; i < word.length; i += maxChars) {
            const chunk = word.slice(i, i + maxChars);
            if (chunk.length === maxChars) {
              wrapped.push(chunk);
            } else {
              currentLine = chunk;
            }
          }
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      wrapped.push(currentLine);
    }
  }

  return wrapped;
}

interface PdfLineItem {
  text: string;
  bold?: boolean;
  fontSize?: number;
  leading?: number;
}

/**
 * Generates a valid, multi-page standards-compliant PDF 1.4 binary document (`%PDF-1.4`)
 * containing the chat session header, metadata, steps, and conversation messages.
 */
export function generateChatPdfBytes(data: ChatExportSessionData): Uint8Array {
  const title = deriveSessionTitle(data);
  const exportedAt = data.exportedAt || new Date().toISOString();
  const messages = normalizeExportMessages(data);
  const steps = Array.isArray(data.steps) ? data.steps : [];

  const pdfLines: PdfLineItem[] = [];

  // Header
  pdfLines.push({ text: 'MANUS AI - CHAT SESSION EXPORT', bold: true, fontSize: 15, leading: 22 });
  pdfLines.push({ text: `Title: ${title}`, bold: true, fontSize: 11, leading: 16 });
  pdfLines.push({ text: `Exported: ${exportedAt}`, fontSize: 9, leading: 14 });
  if (data.taskId) {
    pdfLines.push({ text: `Session ID: ${data.taskId}`, fontSize: 9, leading: 14 });
  }
  pdfLines.push({ text: '------------------------------------------------------------------------------------', fontSize: 9, leading: 16 });

  if (steps.length > 0) {
    pdfLines.push({ text: 'EXECUTION STEPS', bold: true, fontSize: 11, leading: 18 });
    steps.forEach((step) => {
      const statusTag = step.status === 'completed' ? '[DONE]' : `[${String(step.status).toUpperCase()}]`;
      wrapTextLines(`${statusTag} ${step.label}`, 82).forEach((l) => {
        pdfLines.push({ text: l, fontSize: 10, leading: 14 });
      });
    });
    pdfLines.push({ text: '', fontSize: 10, leading: 12 });
  }

  pdfLines.push({ text: 'CONVERSATION', bold: true, fontSize: 11, leading: 18 });

  if (messages.length === 0) {
    pdfLines.push({ text: 'No messages recorded in this session.', fontSize: 10, leading: 14 });
  } else {
    messages.forEach((msg, index) => {
      const speaker = msg.role === 'user' ? 'User' : 'Manus AI';
      const header = `${index + 1}. ${speaker}${msg.timestamp ? ` (${msg.timestamp})` : ''}`;
      pdfLines.push({ text: header, bold: true, fontSize: 11, leading: 17 });

      if (msg.thought) {
        wrapTextLines(`[Thought Process]: ${msg.thought}`, 82).forEach((line) => {
          pdfLines.push({ text: `  ${line}`, fontSize: 9, leading: 13 });
        });
      }

      if (msg.content) {
        wrapTextLines(msg.content, 84).forEach((line) => {
          pdfLines.push({ text: line, fontSize: 10, leading: 14 });
        });
      }

      pdfLines.push({ text: '', fontSize: 10, leading: 10 });
    });
  }

  // Paginate lines (US Letter 612 x 792 pt, top margin 740, bottom margin 56)
  const pages: PdfLineItem[][] = [];
  let currentPage: PdfLineItem[] = [];
  let currentY = 740;
  const minY = 56;

  for (const item of pdfLines) {
    const leading = item.leading ?? 14;
    if (currentY - leading < minY && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      currentY = 740;
    }
    currentPage.push(item);
    currentY -= leading;
  }
  if (currentPage.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  // Build PDF objects:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Helvetica)
  // 4: Font F2 (Helvetica-Bold)
  // For each page i (0..N-1):
  //   pageObjId = 5 + i * 2
  //   contentObjId = 6 + i * 2
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  pages.forEach((pageItems, pageIndex) => {
    const pageObjId = 5 + pageIndex * 2;
    const contentObjId = 6 + pageIndex * 2;
    pageObjIds.push(pageObjId);

    const streamOps: string[] = [];
    streamOps.push('BT');
    let y = 740;

    pageItems.forEach((item) => {
      const font = item.bold ? '/F2' : '/F1';
      const size = item.fontSize ?? 10;
      const leading = item.leading ?? 14;
      const escaped = escapePdfText(item.text);
      streamOps.push(`${font} ${size} Tf`);
      streamOps.push(`1 0 0 1 50 ${y} Tm`);
      streamOps.push(`(${escaped}) Tj`);
      y -= leading;
    });

    // Footer with page number
    streamOps.push('/F1 8 Tf');
    streamOps.push(`1 0 0 1 50 32 Tm`);
    streamOps.push(`(Page ${pageIndex + 1} of ${pages.length} - Manus AI Workspace) Tj`);
    streamOps.push('ET');

    const streamBody = streamOps.join('\n');
    objects[pageObjId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`;
    objects[contentObjId] = `<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream`;
  });

  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;

  let pdfString = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdfString.length;
    pdfString += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdfString.length;
  pdfString += `xref\n0 ${objects.length}\n`;
  pdfString += '0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id++) {
    const padded = String(offsets[id]).padStart(10, '0');
    pdfString += `${padded} 00000 n \n`;
  }

  pdfString += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const encoder = new TextEncoder();
  return encoder.encode(pdfString);
}

/**
 * Triggers a browser download for a Blob without using window.open or window.alert.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }, 250);
}

/**
 * Generates the requested export format (PDF, Markdown, or JSON) and triggers a file download.
 */
export function exportChatSession(
  data: ChatExportSessionData,
  format: ChatExportFormat = 'pdf',
  options?: { triggerDownload?: boolean }
): ChatExportResult {
  const shouldDownload = options?.triggerDownload ?? true;
  const title = deriveSessionTitle(data);
  const baseSlug = slugifyFilename(title);

  if (format === 'markdown') {
    const content = formatChatAsMarkdown(data);
    const filename = `${baseSlug}.md`;
    const mimeType = 'text/markdown;charset=utf-8';
    if (shouldDownload && typeof Blob !== 'undefined') {
      triggerBrowserDownload(new Blob([content], { type: mimeType }), filename);
    }
    return { format, filename, mimeType, content };
  }

  if (format === 'json') {
    const content = formatChatAsJSON(data);
    const filename = `${baseSlug}.json`;
    const mimeType = 'application/json;charset=utf-8';
    if (shouldDownload && typeof Blob !== 'undefined') {
      triggerBrowserDownload(new Blob([content], { type: mimeType }), filename);
    }
    return { format, filename, mimeType, content };
  }

  // Default: PDF
  const pdfBytes = generateChatPdfBytes(data);
  const filename = `${baseSlug}.pdf`;
  const mimeType = 'application/pdf';
  if (shouldDownload && typeof Blob !== 'undefined') {
    triggerBrowserDownload(new Blob([pdfBytes as unknown as BlobPart], { type: mimeType }), filename);
  }
  return { format: 'pdf', filename, mimeType, content: pdfBytes };
}
