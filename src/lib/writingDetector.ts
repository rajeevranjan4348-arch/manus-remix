/**
 * Intelligent Writing Mode Classifier & Splitter
 *
 * Detects when an AI response contains a standalone writing artifact
 * (email draft, letter, report, proposal, essay, social post, formal document,
 * cover letter, press release, product description, or structured AI prompt)
 * and cleanly separates any brief conversational intro/outro from the writing body.
 *
 * Normal conversational answers, Q&A explanations, greetings, and code-centric
 * responses are intentionally kept as regular chat messages.
 */

export type WritingArtifactType =
  | 'email'
  | 'letter'
  | 'report'
  | 'proposal'
  | 'essay'
  | 'social_post'
  | 'prompt'
  | 'document'
  | 'announcement'
  | 'copywriting';

export interface WritingBlockDetectionResult {
  isWritingBlock: boolean;
  introText: string;
  writingContent: string;
  outroText: string;
  title?: string;
  artifactType?: WritingArtifactType;
}

const NON_WRITING_PROMPT_PATTERNS = [
  /^\s*(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening)|how\s+are\s+you|thanks|thank\s+you|ok|okay|cool|nice)\b[!.?\s]*$/i,
  /\b(who\s+is|what\s+is|what\s+are|how\s+does|why\s+does|explain\s+(how|what|why)|define\s+|tell\s+me\s+about|weather\s+in|temperature\s+in|directions\s+to|route\s+from|show\s+me\s+.*\s+on\s+(?:a\s+)?map|what\s+do\s+you\s+remember)\b/i,
];

const CODE_REQUEST_PROMPT_PATTERNS = [
  /\b(write\s+(?:me\s+)?(?:a\s+)?(?:python|javascript|typescript|java|c\+\+|rust|go|sql|html|css|bash|shell|react|node)\s+(?:code|script|function|component|query|program)|debug\s+this|fix\s+this\s+(?:code|bug|error|typescript)|implement\s+(?:a\s+)?(?:function|class|api|endpoint|algorithm)|refactor\s+this)\b/i,
];

const EXPLICIT_WRITING_PROMPT_RULES: Array<{
  type: WritingArtifactType;
  pattern: RegExp;
}> = [
  {
    type: 'email',
    pattern:
      /\b(write|draft|compose|create|generate|prepare|rewrite|polish)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:professional\s+|formal\s+|polite\s+|follow[\s-]?up\s+|cold\s+|outreach\s+|apology\s+|thank[\s-]?you\s+|welcome\s+|resignation\s+|sales\s+|marketing\s+)?(?:email|e-mail|mail\s+draft|reply\s+email)\b/i,
  },
  {
    type: 'letter',
    pattern:
      /\b(write|draft|compose|create|generate|prepare)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:cover\s+letter|formal\s+letter|recommendation\s+letter|reference\s+letter|resignation\s+letter|application\s+letter|complaint\s+letter|invitation\s+letter|letter\s+to|leave\s+application)\b/i,
  },
  {
    type: 'prompt',
    pattern:
      /\b(write|draft|create|generate|give\s+me|make)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:fix\s+prompt|coding\s+agent\s+prompt|ai\s+prompt|system\s+prompt|prompt\s+for\s+(?:my\s+|your\s+)?(?:ai|coding\s+agent|agent|cursor|windsurf|claude|chatgpt|gemini|copilot|lovable|bolt))\b/i,
  },
  {
    type: 'proposal',
    pattern:
      /\b(write|draft|compose|create|generate|prepare)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:project\s+|business\s+|client\s+|grant\s+|partnership\s+|sponsorship\s+|budget\s+)?proposal\b/i,
  },
  {
    type: 'report',
    pattern:
      /\b(write|draft|compose|create|generate|prepare)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:formal\s+|executive\s+|weekly\s+|monthly\s+|quarterly\s+|annual\s+|incident\s+|status\s+|progress\s+|research\s+|audit\s+|project\s+)?(?:report|executive\s+summary|case\s+study|white\s*paper)\b/i,
  },
  {
    type: 'essay',
    pattern:
      /\b(write|draft|compose|create|generate)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:short\s+|persuasive\s+|argumentative\s+|analytical\s+|narrative\s+|college\s+|academic\s+)?(?:essay|article|blog\s+post|op-ed|speech|eulogy|toast)\b/i,
  },
  {
    type: 'social_post',
    pattern:
      /\b(write|draft|compose|create|generate)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:linkedin|twitter|x\s+|instagram|facebook|threads|social\s+media)\s+(?:post|caption|thread|announcement|update)\b/i,
  },
  {
    type: 'announcement',
    pattern:
      /\b(write|draft|compose|create|generate|prepare)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:press\s+release|announcement|memo|memorandum|newsletter|release\s+notes|changelog\s+announcement|notice)\b/i,
  },
  {
    type: 'copywriting',
    pattern:
      /\b(write|draft|compose|create|generate)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:product\s+description|landing\s+page\s+copy|ad\s+copy|sales\s+pitch|elevator\s+pitch|bio|biography|about\s+us|job\s+description|sop|statement\s+of\s+purpose)\b/i,
  },
  {
    type: 'document',
    pattern:
      /\b(write|draft|compose|create|generate|prepare)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:formal\s+document|policy\s+document|prd|product\s+requirements\s+document|spec\s+document|specification\s+document|contract\s+draft|agreement\s+draft|meeting\s+minutes|brief)\b/i,
  },
];

const INTRO_LINE_PATTERNS = [
  /^(?:here(?:'s|\s+is)\s+(?:a|an|the|your)\b.*|sure[,!.]?\s+here.*|certainly[,!.]?\s+here.*|below\s+is\s+(?:a|an|the|your)\b.*|i(?:'ve|\s+have)\s+(?:drafted|written|prepared|created)\b.*)/i,
  /^(?:#{1,3}\s+)?(?:fix\s+prompt|prompt\s+for\s+your\s+ai|email\s+draft|draft\s+email|cover\s+letter|project\s+proposal|press\s+release|linkedin\s+post|social\s+media\s+post|formal\s+letter|executive\s+report)\b.*$/i,
];

const OUTRO_PARAGRAPH_PATTERNS = [
  /^(?:let\s+me\s+know\s+if\s+you(?:'d|\s+would|\s+want|\s+need)\b|feel\s+free\s+to\s+(?:adjust|customize|tweak|modify|edit|let\s+me\s+know)\b|would\s+you\s+like\s+me\s+to\s+(?:adjust|make|shorten|expand|refine|change|tweak)\b|if\s+you(?:'d|\s+would)\s+like\s+(?:a\s+different\s+tone|me\s+to|any\s+changes)\b|hope\s+this\s+helps\b)/i,
];

const EMAIL_SALUTATION_REGEX = /^(?:dear|hi|hello|greetings|to\s+whom\s+it\s+may\s+concern)\s+[^\n]{1,60}[,:]?\s*$/im;
const EMAIL_SIGNOFF_REGEX = /^(?:best\s+regards|warm\s+regards|kind\s+regards|sincerely|regards|cheers|respectfully|yours\s+(?:truly|sincerely|faithfully)|thank\s+you|thanks|best)[,.!]?\s*$/im;
const SUBJECT_LINE_REGEX = /^(?:\*{0,2})Subject(?:\*{0,2})\s*:\s*.+$/im;

function detectPromptWritingType(userPrompt?: string): WritingArtifactType | null {
  const prompt = (userPrompt || '').trim();
  if (!prompt) return null;

  for (const rule of EXPLICIT_WRITING_PROMPT_RULES) {
    if (rule.pattern.test(prompt)) {
      return rule.type;
    }
  }
  return null;
}

function getFencedCodeRatio(markdown: string): { ratio: number; blockCount: number } {
  const matches: string[] = markdown.match(/```[\s\S]*?```/g) ?? [];
  if (matches.length === 0) return { ratio: 0, blockCount: 0 };
  const codeChars = matches.reduce((sum: number, block: string) => sum + block.length, 0);
  return {
    ratio: markdown.length > 0 ? codeChars / markdown.length : 0,
    blockCount: matches.length,
  };
}

function extractExplicitWritingFence(markdown: string): WritingBlockDetectionResult | null {
  const fenceRegex = /```(?:writing|document|draft|email|letter|prompt)\s*\n([\s\S]*?)\n```/i;
  const match = markdown.match(fenceRegex);
  if (!match || typeof match.index !== 'number') return null;

  const writingContent = match[1].trim();
  if (writingContent.length < 40) return null;

  const introText = markdown.slice(0, match.index).trim();
  const outroText = markdown.slice(match.index + match[0].length).trim();

  return {
    isWritingBlock: true,
    introText,
    writingContent,
    outroText,
    artifactType: 'document',
    title: extractWritingTitle(writingContent, introText),
  };
}

function extractWritingTitle(writingContent: string, introText?: string): string | undefined {
  const subjectMatch = writingContent.match(/^(?:\*{0,2})Subject(?:\*{0,2})\s*:\s*(.+)$/im);
  if (subjectMatch?.[1]) {
    return subjectMatch[1].replace(/\*+/g, '').trim().slice(0, 120);
  }

  const firstLine = writingContent
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstLine) {
    const cleaned = firstLine.replace(/^#{1,6}\s+/, '').replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
    if (cleaned.length >= 4 && cleaned.length <= 120) {
      return cleaned;
    }
  }

  if (introText) {
    const introFirst = introText
      .split('\n')
      .map((l) => l.trim().replace(/^#{1,6}\s+/, ''))
      .find(Boolean);
    if (introFirst && introFirst.length <= 100) return introFirst;
  }

  return undefined;
}

function isConversationalLeadIn(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  if (!trimmed || trimmed.length > 220) return false;
  if (trimmed.includes('\n\n')) return false;
  if (SUBJECT_LINE_REGEX.test(trimmed)) return false;

  // Short lead-in ending with a colon (e.g., "Here's a draft you can send:")
  if (trimmed.length <= 160 && /:\s*$/.test(trimmed)) {
    return true;
  }

  for (const pattern of INTRO_LINE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function isConversationalOutro(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  if (!trimmed || trimmed.length > 260) return false;
  for (const pattern of OUTRO_PARAGRAPH_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function splitIntroBodyOutro(raw: string): {
  introText: string;
  writingContent: string;
  outroText: string;
} {
  const normalized = raw.replace(/\r\n/g, '\n').trim();

  // Check for horizontal rule separator after an intro line (e.g., "Here is your draft:\n\n---\n\n...")
  const hrSplit = normalized.match(/^([^\n]{4,220})\n+\s*(?:---|\*\*\*|___)\s*\n+([\s\S]+)$/);
  if (hrSplit) {
    const candidateIntro = hrSplit[1].trim();
    let candidateBody = hrSplit[2].trim();
    let candidateOutro = '';

    // Check trailing horizontal rule before outro
    const trailingHr = candidateBody.match(/^([\s\S]+?)\n+\s*(?:---|\*\*\*|___)\s*\n+([^\n][\s\S]{0,260})$/);
    if (trailingHr && isConversationalOutro(trailingHr[2])) {
      candidateBody = trailingHr[1].trim();
      candidateOutro = trailingHr[2].trim();
    }

    if (isConversationalLeadIn(candidateIntro) && candidateBody.length >= 60) {
      return {
        introText: candidateIntro,
        writingContent: candidateBody,
        outroText: candidateOutro,
      };
    }
  }

  const paragraphs = normalized.split(/\n{2,}/);
  if (paragraphs.length === 1) {
    return { introText: '', writingContent: normalized, outroText: '' };
  }

  let startIdx = 0;
  let endIdx = paragraphs.length;

  // Peel off leading conversational lead-in (up to 1 paragraph)
  if (paragraphs.length >= 2 && isConversationalLeadIn(paragraphs[0])) {
    startIdx = 1;
  }

  // Peel off trailing conversational outro (up to 1 paragraph)
  if (endIdx - startIdx >= 2 && isConversationalOutro(paragraphs[endIdx - 1])) {
    endIdx -= 1;
  }

  const introText = paragraphs.slice(0, startIdx).join('\n\n').trim();
  const writingContent = paragraphs
    .slice(startIdx, endIdx)
    .join('\n\n')
    .replace(/^(?:---|\*\*\*|___)\s*\n+/, '')
    .replace(/\n+\s*(?:---|\*\*\*|___)$/, '')
    .trim();
  const outroText = paragraphs.slice(endIdx).join('\n\n').trim();

  if (!writingContent) {
    return { introText: '', writingContent: normalized, outroText: '' };
  }

  return { introText, writingContent, outroText };
}

function detectContentDrivenWritingType(markdown: string): WritingArtifactType | null {
  const trimmed = markdown.trim();
  if (trimmed.length < 110) return null;

  // 1. Classic email artifact: Subject line + salutation OR Subject line + sign-off
  const hasSubject = SUBJECT_LINE_REGEX.test(trimmed);
  const hasSalutation = EMAIL_SALUTATION_REGEX.test(trimmed);
  const hasSignoff = EMAIL_SIGNOFF_REGEX.test(trimmed);

  if (hasSubject && (hasSalutation || hasSignoff)) {
    return 'email';
  }

  // 2. Formal letter artifact: Salutation + Sign-off + multi-paragraph body
  if (hasSalutation && hasSignoff && trimmed.split(/\n{2,}/).length >= 3) {
    return 'letter';
  }

  // 3. Structured AI prompt / coding-agent prompt (e.g. "Fix prompt for your AI coding agent" + structured spec)
  if (
    /^(?:#{1,3}\s+)?(?:fix\s+prompt|prompt\s+for\s+(?:your|my)\s+ai|agent\s+prompt|system\s+prompt)\b/im.test(trimmed) &&
    trimmed.length >= 160
  ) {
    return 'prompt';
  }

  // 4. Press release
  if (/^\s*(?:\*{0,2})FOR\s+IMMEDIATE\s+RELEASE(?:\*{0,2})/im.test(trimmed)) {
    return 'announcement';
  }

  return null;
}

/**
 * Determines whether an assistant message should render a ChatGPT-style Writing Block card.
 */
export function detectWritingBlock(
  markdown: string,
  userPrompt?: string
): WritingBlockDetectionResult {
  const emptyResult: WritingBlockDetectionResult = {
    isWritingBlock: false,
    introText: '',
    writingContent: markdown || '',
    outroText: '',
  };

  if (!markdown || typeof markdown !== 'string') return emptyResult;
  const trimmed = markdown.trim();
  if (trimmed.length < 75) return emptyResult;

  // Explicit fenced writing/document block always wins
  const explicitFence = extractExplicitWritingFence(trimmed);
  if (explicitFence) return explicitFence;

  const promptWritingType = detectPromptWritingType(userPrompt);
  const contentWritingType = detectContentDrivenWritingType(trimmed);

  // Never wrap simple greetings or factual Q&A unless content itself is clearly a formal email/letter/prompt
  if (!promptWritingType && !contentWritingType) {
    return emptyResult;
  }

  const normalizedPrompt = (userPrompt || '').trim();
  if (
    !promptWritingType &&
    normalizedPrompt &&
    NON_WRITING_PROMPT_PATTERNS.some((p) => p.test(normalizedPrompt))
  ) {
    return emptyResult;
  }

  // Keep code-centric responses out of Writing Block unless user explicitly requested a prompt/document
  const { ratio: codeRatio, blockCount: codeBlockCount } = getFencedCodeRatio(trimmed);
  const isPromptOrDocRequest = promptWritingType === 'prompt' || promptWritingType === 'document';
  if (!isPromptOrDocRequest) {
    if (codeRatio >= 0.25 || codeBlockCount >= 2) {
      return emptyResult;
    }
    if (normalizedPrompt && CODE_REQUEST_PROMPT_PATTERNS.some((p) => p.test(normalizedPrompt))) {
      return emptyResult;
    }
  }

  // Avoid wrapping short conversational refusals/clarifications even when the prompt asked to write
  const isClarifyingQuestionOnly =
    trimmed.length < 180 &&
    /\?\s*$/.test(trimmed) &&
    !SUBJECT_LINE_REGEX.test(trimmed) &&
    !EMAIL_SALUTATION_REGEX.test(trimmed);
  if (isClarifyingQuestionOnly) {
    return emptyResult;
  }

  const artifactType = promptWritingType || contentWritingType || 'document';
  const { introText, writingContent, outroText } = splitIntroBodyOutro(trimmed);

  // Ensure the extracted writing body is genuinely substantive
  if (writingContent.length < 70) {
    return emptyResult;
  }

  return {
    isWritingBlock: true,
    introText,
    writingContent,
    outroText,
    artifactType,
    title: extractWritingTitle(writingContent, introText),
  };
}
