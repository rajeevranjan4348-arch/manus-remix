const WRITING_ARTIFACTS = /\b(?:email|e-mail|letter|report|proposal|essay|social\s+media\s+post|instagram\s+caption|caption|announcement|press\s+release|description|bio|cover\s+letter|memo|document|article|newsletter|message|invitation|thank[- ]you\s+note)\b/i;
const WRITING_VERBS = /\b(?:write|draft|compose|craft|create|prepare|generate|rewrite|turn\s+this\s+into|make\s+this\s+into|word\s+this\s+as)\b/i;
const CODE_INTENT = /\b(?:code|coding|program|programming|function|component|script|typescript|javascript|python|sql|html|css|regex|api|class|debug|implement)\b/i;
const EXPLANATION_INTENT = /\b(?:explain|teach\s+me|show\s+me\s+how|what\s+is|how\s+does|why\s+does)\b/i;
const CONVERSATIONAL_LEAD = /^(?:sure|certainly|of course|here(?:'|’)s|here is|i can|i would|below is|let me explain|you could say|you can say|you might write|try this|for example)\b/i;
const DOCUMENT_SHAPE = /^(?:#{1,3}\s+\S|subject\s*:\s*\S|dear\s+\S|to\s*:\s*\S|executive summary\b|proposal\b|report\b|[A-Z][^\n]{2,80}\n[-=]{3,})/i;

/**
 * True only when the user asked for a writing artifact and the answer resembles
 * a standalone document. Conversational answers, explanations, and code remain
 * regular assistant messages.
 */
export function isStandaloneWritingArtifact(userPrompt: string, assistantContent: string): boolean {
  const prompt = String(userPrompt || '').trim();
  const content = String(assistantContent || '').trim();
  if (!prompt || content.length < 80 || !WRITING_ARTIFACTS.test(prompt)) return false;
  if (CODE_INTENT.test(prompt) || EXPLANATION_INTENT.test(prompt)) return false;
  if (/```|<\/?(?:html|script|style|pre|code)\b/i.test(content)) return false;
  if (CONVERSATIONAL_LEAD.test(content)) return false;

  const explicitWritingRequest = WRITING_VERBS.test(prompt);
  if (!explicitWritingRequest) return false;

  const hasDocumentShape = DOCUMENT_SHAPE.test(content);
  const hasStructuredSections = /^#{1,3}\s+\S/m.test(content) || /\n\s*(?:[-*]|\d+\.)\s+\S/.test(content);
  const hasStandaloneBody = content.split(/\s+/).length >= 30 && !/^\s*(?:the answer|in short|to summarize)\b/i.test(content);
  return hasDocumentShape || (hasStructuredSections && hasStandaloneBody) || hasStandaloneBody;
}
