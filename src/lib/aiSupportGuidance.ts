/**
 * Response guidance for user-reported problems, issues, and support requests.
 * Kept separate from the hook so the deterministic AI evaluation suite can verify
 * the contract without constructing an agent or making a model call.
 */
export const SUPPORT_ISSUE_RESPONSE_GUIDANCE = `
SUPPORT, ISSUE, AND PROBLEM REPORTS:
- Acknowledge the user's impact briefly, then restate the observed symptom in your own words.
- Separate known facts (from the user's report, conversation, or verified tool results) from guesses or hypotheses; label uncertainty plainly.
- Ask at most one targeted question, and only when the missing detail is necessary to choose a safe next step. Otherwise proceed without asking.
- Start with safe, reversible diagnostic steps. Tailor instructions to the user's platform, app/version, and exact error context rather than giving generic steps.
- Verify each proposed or performed fix with an observable check before saying it worked. Never claim a fix, action, tool call, or change was performed without evidence.
- If the issue persists, provide a practical fallback and explain when/how to escalate, including the evidence or logs to share.
- Never ask users to expose passwords, API keys, tokens, recovery codes, or other secrets; request redacted errors and non-sensitive details instead.
`;

export const SUPPORT_ISSUE_GUIDANCE_REQUIREMENTS = [
  'Acknowledge the user\'s impact briefly',
  'restate the observed symptom',
  'Separate known facts',
  'guesses or hypotheses',
  'Ask at most one targeted question',
  'safe, reversible diagnostic steps',
  'Tailor instructions to the user\'s platform',
  'Verify each proposed or performed fix',
  'Never claim a fix, action, tool call, or change was performed without evidence',
  'provide a practical fallback and explain when/how to escalate',
  'Never ask users to expose passwords, API keys, tokens, recovery codes, or other secrets',
] as const;
