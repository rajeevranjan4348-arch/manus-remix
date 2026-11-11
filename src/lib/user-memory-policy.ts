/**
 * Privacy policy helpers for Manus long-term user memory.
 *
 * Conversation history is separate and may preserve the actual conversation
 * according to the app's history/retention settings. This module only governs
 * what may be copied into a durable personalization memory.
 *
 * These client-side checks are defense-in-depth, not a security boundary.
 * Repeat validation on the trusted server before persisting memory.
 */

export type MemoryCandidate = {
  text: string;
  sourceMessageId?: string;
  category?: "preference" | "project" | "goal" | "other";
};

export type MemoryDecision =
  | { allowed: true; normalizedText: string }
  | { allowed: false; reason: string };

const SECRET_PATTERNS: RegExp[] = [
  /\bpassword\s*[:=]\s*\S+/i,
  /\b(passcode|pin|recovery code)\s*[:=]\s*\S+/i,
  /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret[_ -]?key)\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b\d{13,19}\b/,
];

const SENSITIVE_CATEGORIES: RegExp[] = [
  /\bdiagnos(?:is|ed)|medical record|prescription|health condition\b/i,
  /\bsexual orientation|sex life|religious belief|political affiliation\b/i,
  /\bimmigration status|precise location|government id\b/i,
];

const EXPLICIT_MEMORY_INTENT =
  /\b(remember this|please remember|save this (?:to|as) memory|keep in mind for future chats)\b/i;

const CLEAR_MEMORY_INTENT =
  /\b(forget this|don't remember|do not remember|delete this memory|remove from memory)\b/i;

export function normalizeMemoryText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * A candidate can be stored only if memory is enabled and the user has
 * explicitly requested remembering it, or the UI has separately obtained
 * confirmation. Never use this helper to store every chat message as memory.
 */
export function evaluateMemoryCandidate(
  candidate: MemoryCandidate,
  options: { memoryEnabled: boolean; userConfirmed: boolean },
): MemoryDecision {
  const text = normalizeMemoryText(candidate.text);

  if (!options.memoryEnabled) {
    return { allowed: false, reason: "Long-term memory is disabled." };
  }
  if (!text) {
    return { allowed: false, reason: "Memory text is empty." };
  }
  if (text.length > 500) {
    return { allowed: false, reason: "Memory text exceeds the 500-character limit." };
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    return { allowed: false, reason: "Potential secret or financial identifier detected." };
  }
  if (SENSITIVE_CATEGORIES.some((pattern) => pattern.test(text))) {
    return { allowed: false, reason: "Potentially sensitive personal data is not eligible for long-term memory." };
  }
  if (!options.userConfirmed) {
    return { allowed: false, reason: "User confirmation is required before saving this memory." };
  }

  return { allowed: true, normalizedText: text };
}

/** UI can use this to offer memory controls; it does not perform deletion itself. */
export function getMemoryIntent(message: string): "remember" | "forget" | "none" {
  const text = normalizeMemoryText(message);
  if (CLEAR_MEMORY_INTENT.test(text)) return "forget";
  if (EXPLICIT_MEMORY_INTENT.test(text)) return "remember";
  return "none";
}
