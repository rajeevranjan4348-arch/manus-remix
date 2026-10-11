/**
 * Small, privacy-conscious preference memory for Manus.
 *
 * Stores only messages that explicitly ask Manus to remember something.
 * Data stays in this browser's localStorage and is scoped by the signed-in user ID.
 * It is not uploaded to a third-party service and can be cleared by asking Manus
 * to "forget my saved memories".
 */
export interface AgentMemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

const STORAGE_PREFIX = 'manus:agent-memory:v1:';
const MAX_ENTRIES = 30;
const MAX_ENTRY_LENGTH = 600;

function storageKey(userId: string): string {
  return STORAGE_PREFIX + encodeURIComponent(userId || 'usr_manus_default');
}

function readEntries(userId: string): AgentMemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AgentMemoryEntry =>
      item && typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      typeof item.createdAt === 'string'
    ).slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeEntries(userId: string, entries: AgentMemoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Storage may be unavailable or full; memory is an optional enhancement.
  }
}

/** Save only explicit remember/preference requests; do not silently profile every message. */
export function captureExplicitMemory(userId: string, message: string): void {
  if (typeof message !== 'string' || !message.trim()) return;
  const text = message.trim();

  if (/\bforget\b.*\b(my )?(saved )?(memories|memory|preferences)\b/i.test(text)) {
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem(storageKey(userId)); } catch { /* optional storage */ }
    }
    return;
  }

  const explicitRequest = /\b(remember|save this|keep this in mind|keep in mind|don't forget|do not forget|my preference is|i prefer|always remember)\b/i.test(text);
  if (!explicitRequest) return;

  const normalized = text.replace(/\s+/g, ' ').slice(0, MAX_ENTRY_LENGTH);
  const entries = readEntries(userId);
  if (entries.some(entry => entry.text.toLowerCase() === normalized.toLowerCase())) return;

  entries.push({
    id: `memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: normalized,
    createdAt: new Date().toISOString(),
  });
  writeEntries(userId, entries);
}

export function getAgentMemoryContext(userId: string, limit = 12): string {
  const entries = readEntries(userId).slice(-Math.max(1, Math.min(limit, MAX_ENTRIES)));
  if (!entries.length) return '';
  return entries.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n');
}

export function clearAgentMemory(userId: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(storageKey(userId)); } catch { /* optional storage */ }
}
