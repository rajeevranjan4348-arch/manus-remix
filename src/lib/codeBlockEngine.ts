import { BoundedLRUCache, getActivePerformanceProfile } from './performanceEngine';

export interface ResolvedCodeLanguage {
  /** Canonical Shiki language identifier */
  shikiLang: string;
  /** Human-friendly label shown at the top-left of the code container (e.g. "TypeScript", "css") */
  displayLabel: string;
  /** Normalized key */
  id: string;
}

export interface CodeBlockMetadata {
  language: ResolvedCodeLanguage;
  filename: string | null;
  cleanCode: string;
  rawCode: string;
}

const shikiHighlightCache = new BoundedLRUCache<string, string>({
  maxSize: 60,
  ttlMs: 30 * 60 * 1000,
});

const LANGUAGE_MAP: Record<string, { shikiLang: string; displayLabel: string }> = {
  ts: { shikiLang: 'typescript', displayLabel: 'TypeScript' },
  typescript: { shikiLang: 'typescript', displayLabel: 'TypeScript' },
  tsx: { shikiLang: 'tsx', displayLabel: 'TypeScript' },
  js: { shikiLang: 'javascript', displayLabel: 'JavaScript' },
  javascript: { shikiLang: 'javascript', displayLabel: 'JavaScript' },
  mjs: { shikiLang: 'javascript', displayLabel: 'JavaScript' },
  cjs: { shikiLang: 'javascript', displayLabel: 'JavaScript' },
  jsx: { shikiLang: 'jsx', displayLabel: 'JSX' },
  html: { shikiLang: 'html', displayLabel: 'HTML' },
  htm: { shikiLang: 'html', displayLabel: 'HTML' },
  xml: { shikiLang: 'xml', displayLabel: 'XML' },
  svg: { shikiLang: 'xml', displayLabel: 'SVG' },
  css: { shikiLang: 'css', displayLabel: 'css' },
  scss: { shikiLang: 'scss', displayLabel: 'SCSS' },
  less: { shikiLang: 'less', displayLabel: 'Less' },
  py: { shikiLang: 'python', displayLabel: 'Python' },
  python: { shikiLang: 'python', displayLabel: 'Python' },
  java: { shikiLang: 'java', displayLabel: 'Java' },
  kt: { shikiLang: 'kotlin', displayLabel: 'Kotlin' },
  kts: { shikiLang: 'kotlin', displayLabel: 'Kotlin' },
  kotlin: { shikiLang: 'kotlin', displayLabel: 'Kotlin' },
  json: { shikiLang: 'json', displayLabel: 'JSON' },
  jsonc: { shikiLang: 'jsonc', displayLabel: 'JSON' },
  sh: { shikiLang: 'bash', displayLabel: 'Bash' },
  bash: { shikiLang: 'bash', displayLabel: 'Bash' },
  shell: { shikiLang: 'bash', displayLabel: 'Bash' },
  zsh: { shikiLang: 'bash', displayLabel: 'Bash' },
  console: { shikiLang: 'bash', displayLabel: 'Bash' },
  terminal: { shikiLang: 'bash', displayLabel: 'Bash' },
  sql: { shikiLang: 'sql', displayLabel: 'SQL' },
  postgres: { shikiLang: 'sql', displayLabel: 'SQL' },
  postgresql: { shikiLang: 'sql', displayLabel: 'SQL' },
  mysql: { shikiLang: 'sql', displayLabel: 'SQL' },
  sqlite: { shikiLang: 'sql', displayLabel: 'SQL' },
  cpp: { shikiLang: 'cpp', displayLabel: 'C++' },
  'c++': { shikiLang: 'cpp', displayLabel: 'C++' },
  cc: { shikiLang: 'cpp', displayLabel: 'C++' },
  cxx: { shikiLang: 'cpp', displayLabel: 'C++' },
  hpp: { shikiLang: 'cpp', displayLabel: 'C++' },
  c: { shikiLang: 'c', displayLabel: 'C' },
  h: { shikiLang: 'c', displayLabel: 'C' },
  cs: { shikiLang: 'csharp', displayLabel: 'C#' },
  csharp: { shikiLang: 'csharp', displayLabel: 'C#' },
  go: { shikiLang: 'go', displayLabel: 'Go' },
  golang: { shikiLang: 'go', displayLabel: 'Go' },
  rs: { shikiLang: 'rust', displayLabel: 'Rust' },
  rust: { shikiLang: 'rust', displayLabel: 'Rust' },
  rb: { shikiLang: 'ruby', displayLabel: 'Ruby' },
  ruby: { shikiLang: 'ruby', displayLabel: 'Ruby' },
  php: { shikiLang: 'php', displayLabel: 'PHP' },
  swift: { shikiLang: 'swift', displayLabel: 'Swift' },
  dart: { shikiLang: 'dart', displayLabel: 'Dart' },
  yaml: { shikiLang: 'yaml', displayLabel: 'YAML' },
  yml: { shikiLang: 'yaml', displayLabel: 'YAML' },
  toml: { shikiLang: 'toml', displayLabel: 'TOML' },
  md: { shikiLang: 'markdown', displayLabel: 'Markdown' },
  markdown: { shikiLang: 'markdown', displayLabel: 'Markdown' },
  dockerfile: { shikiLang: 'dockerfile', displayLabel: 'Dockerfile' },
  docker: { shikiLang: 'dockerfile', displayLabel: 'Dockerfile' },
  graphql: { shikiLang: 'graphql', displayLabel: 'GraphQL' },
  gql: { shikiLang: 'graphql', displayLabel: 'GraphQL' },
};

const EXTENSION_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  c: 'c',
  h: 'c',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  dart: 'dart',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  graphql: 'graphql',
};

const FILENAME_PATTERN =
  /^([a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.[a-zA-Z0-9]{1,10}|Dockerfile|Makefile|CMakeLists\.txt)$/;

/**
 * Automatically detects the programming language from filename extension or code heuristics
 * when the markdown code fence omits an explicit language tag.
 */
export function detectLanguageFromCode(code: string, filename?: string | null): string {
  if (filename) {
    if (/^Dockerfile$/i.test(filename)) return 'dockerfile';
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      if (EXTENSION_TO_LANG[ext]) {
        return EXTENSION_TO_LANG[ext];
      }
    }
  }

  const trimmed = (code || '').trim();
  if (!trimmed) return 'text';

  // JSON
  if (
    ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) &&
    /"[^"]+"\s*:/.test(trimmed)
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      if (/^\{\s*"[^"]+"\s*:/.test(trimmed)) return 'json';
    }
  }

  // HTML
  if (
    /^<!DOCTYPE\s+html>/i.test(trimmed) ||
    (/^<(html|head|body|div|section|main|header|footer|template|svg)\b/i.test(trimmed) &&
      !/\b(import|export|const|function|interface)\b/.test(trimmed))
  ) {
    return 'html';
  }

  // C++ / C
  if (
    /#include\s*[<"][^>"]+[>"]/.test(trimmed) ||
    /\bstd::(cout|cin|vector|string|endl|unique_ptr|shared_ptr)\b/.test(trimmed) ||
    /\bint\s+main\s*\(/.test(trimmed)
  ) {
    return 'cpp';
  }

  // Kotlin
  if (
    /\bfun\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(trimmed) ||
    /\b(data\s+class|sealed\s+class|companion\s+object|lateinit\s+var)\b/.test(trimmed) ||
    (/\b(val|var)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*[:=]/.test(trimmed) && /\bprintln\s*\(/.test(trimmed))
  ) {
    return 'kotlin';
  }

  // Java
  if (
    /\bpublic\s+(class|interface|enum)\s+[A-Z][a-zA-Z0-9_]*/.test(trimmed) ||
    /\bpublic\s+static\s+void\s+main\s*\(/.test(trimmed) ||
    /\bSystem\.out\.print(ln)?\s*\(/.test(trimmed)
  ) {
    return 'java';
  }

  // SQL
  if (
    /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(
      trimmed
    ) &&
    /\b(FROM|WHERE|VALUES|SET|PRIMARY\s+KEY|JOIN|GROUP\s+BY|ORDER\s+BY)\b/i.test(trimmed)
  ) {
    return 'sql';
  }

  // Python
  if (
    /\bdef\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*(->\s*[^:]+)?\s*:/.test(trimmed) ||
    /\b(elif|except|None|True|False)\b/.test(trimmed) && /:\s*(\n|$)/.test(trimmed) ||
    /^from\s+[a-zA-Z0-9_.]+\s+import\s+/m.test(trimmed) ||
    /if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(trimmed)
  ) {
    return 'python';
  }

  // Bash / Shell
  if (
    /^#!\s*\/bin\/(ba|z)?sh/m.test(trimmed) ||
    (/^\s*(\$\s+)?(npm|npx|pnpm|yarn|git|curl|docker|apt-get|brew|chmod|mkdir|echo)\s+/m.test(
      trimmed
    ) &&
      !/\b(import|export\s+(?:default|function|const|let|class|interface|type)|interface)\b/.test(
        trimmed
      )) ||
    /^\s*export\s+[A-Z_][A-Z0-9_]*=/m.test(trimmed)
  ) {
    return 'bash';
  }

  // CSS
  if (
    /^([.#@][a-zA-Z0-9_-]+|body|html|:root|\*)\s*[,{]/m.test(trimmed) &&
    /\b(display|width|height|margin|padding|color|background|border|font-size|flex|grid|position|line-height|white-space|overflow-wrap)\s*:/i.test(
      trimmed
    ) &&
    !/\b(import|export|const|let|function|return)\b/.test(trimmed)
  ) {
    return 'css';
  }

  // TypeScript / TSX
  if (
    /\b(interface|type)\s+[A-Z][a-zA-Z0-9_]*/.test(trimmed) ||
    /:\s*(string|number|boolean|any|void|unknown|never|React\.[A-Za-z]+)\b/.test(trimmed) ||
    /\buseState<[^>]+>\(/.test(trimmed)
  ) {
    if (/<[A-Za-z][A-Za-z0-9.]*(\s+[^>]*)?>/.test(trimmed) || /\bclassName=/.test(trimmed)) {
      return 'tsx';
    }
    return 'typescript';
  }

  // JSX / JavaScript
  if (
    /\b(import|export|const|let|function|return|async|await)\b/.test(trimmed) ||
    /=>/.test(trimmed) ||
    /\bconsole\.(log|warn|error)\s*\(/.test(trimmed)
  ) {
    if (/<[A-Za-z][A-Za-z0-9.]*(\s+[^>]*)?>/.test(trimmed) || /\bclassName=/.test(trimmed)) {
      return 'jsx';
    }
    return 'javascript';
  }

  return 'text';
}

export function resolveCodeLanguage(
  rawLang?: string | null,
  code = '',
  filename?: string | null
): ResolvedCodeLanguage {
  const cleaned = (rawLang || '')
    .trim()
    .replace(/^language-/i, '')
    .toLowerCase();

  if (cleaned && LANGUAGE_MAP[cleaned]) {
    const entry = LANGUAGE_MAP[cleaned];
    return {
      id: cleaned,
      shikiLang: entry.shikiLang,
      displayLabel: entry.displayLabel,
    };
  }

  // Check if rawLang itself looks like a filename (e.g. ```LongMessage.tsx)
  if (cleaned && FILENAME_PATTERN.test(rawLang!.trim().replace(/^language-/i, ''))) {
    const detectedFromFile = detectLanguageFromCode(code, rawLang!.trim().replace(/^language-/i, ''));
    const entry = LANGUAGE_MAP[detectedFromFile];
    if (entry) {
      return {
        id: detectedFromFile,
        shikiLang: entry.shikiLang,
        displayLabel: entry.displayLabel,
      };
    }
  }

  const autoDetected = detectLanguageFromCode(code, filename);
  if (LANGUAGE_MAP[autoDetected]) {
    const entry = LANGUAGE_MAP[autoDetected];
    return {
      id: autoDetected,
      shikiLang: entry.shikiLang,
      displayLabel: entry.displayLabel,
    };
  }

  if (cleaned && cleaned !== 'text' && cleaned !== 'plaintext' && cleaned !== 'txt') {
    return {
      id: cleaned,
      shikiLang: 'text',
      displayLabel: cleaned,
    };
  }

  return {
    id: 'text',
    shikiLang: 'text',
    displayLabel: 'Code',
  };
}

/**
 * Extracts language, optional filename (from fence info string, title/filename attribute,
 * or leading file comment), and cleaned code.
 */
export function extractCodeBlockMetadata(params: {
  className?: string;
  meta?: string;
  code: string;
}): CodeBlockMetadata {
  const rawCode = (params.code || '').replace(/\n$/, '');
  const rawClass = (params.className || '').replace(/^language-/i, '').trim();
  const rawMeta = (params.meta || '').trim();

  let rawLangToken = rawClass;
  let filename: string | null = null;
  let cleanCode = rawCode;

  // 1. Check `lang:filename.ext` syntax (e.g. ```tsx:LongMessage.tsx)
  if (rawLangToken.includes(':')) {
    const [langPart, filePart] = rawLangToken.split(':', 2);
    rawLangToken = langPart.trim();
    if (filePart && FILENAME_PATTERN.test(filePart.trim())) {
      filename = filePart.trim();
    }
  } else if (FILENAME_PATTERN.test(rawLangToken)) {
    // Fence wrote ```LongMessage.tsx directly
    filename = rawLangToken;
    rawLangToken = '';
  }

  // 2. Check fence meta string for `title="..."`, `filename="..."`, `file="..."` or bare filename
  if (!filename && rawMeta) {
    const attrMatch = rawMeta.match(/(?:title|filename|file|name)\s*=\s*["']([^"']+)["']/i);
    if (attrMatch && attrMatch[1].trim()) {
      filename = attrMatch[1].trim();
    } else {
      const tokens = rawMeta.split(/\s+/);
      for (const tok of tokens) {
        const cleanTok = tok.replace(/^["'`]|["'`]$/g, '');
        if (FILENAME_PATTERN.test(cleanTok)) {
          filename = cleanTok;
          break;
        }
      }
    }
  }

  // 3. Check first line of code for an explicit filename comment (e.g. `// LongMessage.tsx` or `/* LongMessage.css */` or `# app.py`)
  if (!filename && rawCode) {
    const lines = rawCode.split('\n');
    const firstLine = lines[0]?.trim() || '';
    const commentPatterns = [
      /^\/\/\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.[a-zA-Z0-9]{1,10})\s*$/i,
      /^\/\*\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.[a-zA-Z0-9]{1,10})\s*\*\/$/i,
      /^#\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.[a-zA-Z0-9]{1,10})\s*$/i,
      /^--\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.[a-zA-Z0-9]{1,10})\s*$/i,
      /^<!--\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.[a-zA-Z0-9]{1,10})\s*-->$/i,
    ];

    for (const pattern of commentPatterns) {
      const match = firstLine.match(pattern);
      if (match && match[1]) {
        filename = match[1].trim();
        cleanCode = lines.slice(1).join('\n').replace(/^\n+/, '');
        break;
      }
    }
  }

  const language = resolveCodeLanguage(rawLangToken, cleanCode, filename);

  return {
    language,
    filename,
    cleanCode,
    rawCode: cleanCode,
  };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const KEYWORD_SET = new Set([
  'import',
  'from',
  'export',
  'default',
  'function',
  'return',
  'const',
  'let',
  'var',
  'if',
  'else',
  'elif',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'class',
  'interface',
  'type',
  'extends',
  'implements',
  'async',
  'await',
  'yield',
  'typeof',
  'instanceof',
  'in',
  'of',
  'void',
  'delete',
  'def',
  'lambda',
  'pass',
  'with',
  'as',
  'global',
  'nonlocal',
  'assert',
  'del',
  'raise',
  'except',
  'fun',
  'val',
  'when',
  'object',
  'companion',
  'data',
  'sealed',
  'override',
  'open',
  'private',
  'protected',
  'public',
  'internal',
  'static',
  'final',
  'abstract',
  'synchronized',
  'volatile',
  'package',
  'namespace',
  'using',
  'struct',
  'enum',
  'template',
  'typename',
  'virtual',
  'inline',
  'constexpr',
  'nullptr',
  'SELECT',
  'FROM',
  'WHERE',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'ALTER',
  'DROP',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'ON',
  'GROUP',
  'BY',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'AS',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'PRIMARY',
  'KEY',
]);

const TYPE_SET = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'never',
  'Record',
  'Array',
  'Promise',
  'Partial',
  'Required',
  'Readonly',
  'int',
  'float',
  'double',
  'char',
  'long',
  'short',
  'byte',
  'bool',
  'String',
  'Int',
  'Long',
  'Double',
  'Float',
  'Boolean',
  'Unit',
  'List',
  'Map',
  'Set',
  'dict',
  'list',
  'tuple',
  'set',
  'str',
]);

const LITERAL_SET = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'True',
  'False',
  'None',
  'NaN',
  'Infinity',
]);

/**
 * Fast, zero-dependency synchronous tokenizer that highlights code immediately
 * (during streaming, before Shiki settles, or in ultra-lite low-memory mode).
 * Produces semantic `.cb-tok-*` spans styled via theme-reactive CSS variables.
 */
export function highlightCodeInstantHtml(code: string, langId = 'text'): string {
  if (!code) return '';

  // Special clean CSS highlighter matching Screenshot 1 (.long-message { width: 100%; })
  if (langId === 'css' || langId === 'scss' || langId === 'less') {
    const tokenRegex =
      /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([.#][a-zA-Z_-][a-zA-Z0-9_-]*|@[a-zA-Z-]+)|([a-zA-Z-]+)(?=\s*:)|(-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|dvh|%|s|ms|deg)?\b)/g;

    let lastIdx = 0;
    let out = '';
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(code)) !== null) {
      if (match.index > lastIdx) {
        out += escapeHtml(code.slice(lastIdx, match.index));
      }
      const [full, comment, str, selector, prop, num] = match;
      if (comment) {
        out += `<span class="cb-tok-comment">${escapeHtml(full)}</span>`;
      } else if (str) {
        out += `<span class="cb-tok-string">${escapeHtml(full)}</span>`;
      } else if (selector) {
        out += `<span class="cb-tok-selector">${escapeHtml(full)}</span>`;
      } else if (prop) {
        out += `<span class="cb-tok-property">${escapeHtml(full)}</span>`;
      } else if (num) {
        out += `<span class="cb-tok-number">${escapeHtml(full)}</span>`;
      } else {
        out += escapeHtml(full);
      }
      lastIdx = match.index + full.length;
    }

    if (lastIdx < code.length) {
      out += escapeHtml(code.slice(lastIdx));
    }
    return out;
  }

  // General multi-language single-pass tokenizer
  const tokenRegex =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

  let lastIndex = 0;
  let result = '';
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      result += escapeHtml(code.slice(lastIndex, match.index));
    }

    const [full, comment, str, num, word] = match;
    if (comment) {
      result += `<span class="cb-tok-comment">${escapeHtml(full)}</span>`;
    } else if (str) {
      result += `<span class="cb-tok-string">${escapeHtml(full)}</span>`;
    } else if (num) {
      result += `<span class="cb-tok-number">${escapeHtml(full)}</span>`;
    } else if (word) {
      if (KEYWORD_SET.has(word)) {
        result += `<span class="cb-tok-keyword">${escapeHtml(full)}</span>`;
      } else if (LITERAL_SET.has(word)) {
        result += `<span class="cb-tok-number">${escapeHtml(full)}</span>`;
      } else if (TYPE_SET.has(word)) {
        result += `<span class="cb-tok-type">${escapeHtml(full)}</span>`;
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) {
        result += `<span class="cb-tok-entity">${escapeHtml(full)}</span>`;
      } else {
        // Check if followed by `(` for function invocation
        const nextChar = code[match.index + full.length];
        if (nextChar === '(') {
          result += `<span class="cb-tok-function">${escapeHtml(full)}</span>`;
        } else {
          result += escapeHtml(full);
        }
      }
    } else {
      result += escapeHtml(full);
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < code.length) {
    result += escapeHtml(code.slice(lastIndex));
  }

  return result;
}

/**
 * Lazy-loads Shiki and highlights code with dual-theme CSS variables (`--shiki-light` & `--shiki-dark`)
 * so switching between Light and Dark themes is instantaneous via pure CSS.
 * Automatically skips heavy async Shiki tokenization on ultra-large files (>16KB) or ultra-lite profile.
 */
export async function highlightCodeWithShiki(
  code: string,
  shikiLang: string
): Promise<string | null> {
  if (!code || shikiLang === 'text') return null;

  // Guard low-end Android devices and very large code blocks
  const MAX_SHIKI_CHARS = 16000;
  if (code.length > MAX_SHIKI_CHARS) {
    return null;
  }

  const profile = getActivePerformanceProfile();
  if (profile === 'ultra-lite' && code.length > 4000) {
    return null;
  }

  const cacheKey = `${shikiLang}::${code}`;
  const cached = shikiHighlightCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const { codeToHtml } = await import('shiki');
    const html = await codeToHtml(code, {
      lang: shikiLang,
      themes: {
        light: 'github-light',
        dark: 'dark-plus',
      },
      defaultColor: false,
    });
    shikiHighlightCache.set(cacheKey, html);
    return html;
  } catch {
    return null;
  }
}
