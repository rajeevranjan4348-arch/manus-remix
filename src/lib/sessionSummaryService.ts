const SESSION_SUMMARIES_STORAGE_KEY = 'manus_session_summaries';

export interface SessionSummaryRequest {
  id: string;
  title?: string;
  prompt?: string;
  content?: string;
  messages?: Array<{ role: string; content: string }>;
}

/**
 * Ensures the summary is a clean, single descriptive sentence ending with punctuation.
 */
export function normalizeOneSentenceSummary(rawText: string, fallbackTopic = 'the conversation'): string {
  const cleaned = String(rawText || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/^(?:summary|one-sentence summary|session summary)\s*:\s*/i, '')
    .replace(/\[(?:Attached|Think Harder|MODE)[^\]]*\]\s*/gi, ' ')
    .replace(/[*_`#>-]+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    const cleanTopic = String(fallbackTopic || 'the conversation')
      .replace(/\[(?:Attached|Think Harder|MODE)[^\]]*\]\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
    return `This session explored ${cleanTopic || 'the user request'} and synthesized actionable insights.`;
  }

  const sentenceMatch = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  let sentence = sentenceMatch ? sentenceMatch[1].trim() : cleaned;
  if (sentence.length > 220) {
    sentence = sentence.slice(0, 217).trimEnd().replace(/[,;:\s]+$/, '') + '.';
  }
  if (!/[.!?]$/.test(sentence)) {
    sentence += '.';
  }
  return sentence;
}

/**
 * Loads persisted session summaries from localStorage.
 */
export function getStoredSessionSummaries(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SESSION_SUMMARIES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Persists a generated one-sentence summary for a session ID.
 */
export function saveSessionSummary(sessionId: string, summary: string): Record<string, string> {
  const current = getStoredSessionSummaries();
  if (!sessionId || !summary) return current;
  const updated = {
    ...current,
    [sessionId]: summary,
  };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SESSION_SUMMARIES_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('manus_session_summaries_updated', { detail: { sessionId, summary } }));
    } catch {}
  }
  return updated;
}

/**
 * Removes a stored summary for a session ID.
 */
export function removeSessionSummary(sessionId: string): Record<string, string> {
  const current = getStoredSessionSummaries();
  if (!sessionId || !(sessionId in current)) return current;
  const updated = { ...current };
  delete updated[sessionId];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SESSION_SUMMARIES_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('manus_session_summaries_updated', { detail: { sessionId, summary: null } }));
    } catch {}
  }
  return updated;
}

/**
 * Calls the server-side Gemini API endpoint (/api/summarize-session) to generate a
 * one-sentence descriptive summary of a conversation session.
 */
export async function generateSessionSummary(request: SessionSummaryRequest): Promise<string> {
  const fallbackTopic = request.title || request.prompt || request.content || 'the conversation';

  try {
    const response = await fetch('/api/summarize-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sessionId: request.id,
        title: request.title,
        prompt: request.prompt,
        content: request.content,
        messages: request.messages,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (typeof data?.summary === 'string' && data.summary.trim()) {
        const normalized = normalizeOneSentenceSummary(data.summary, fallbackTopic);
        saveSessionSummary(request.id, normalized);
        return normalized;
      }
    }
  } catch (err) {
    console.warn('[SessionSummaryService] Fallback summary used:', err);
  }

  const fallbackSummary = normalizeOneSentenceSummary('', fallbackTopic);
  saveSessionSummary(request.id, fallbackSummary);
  return fallbackSummary;
}
