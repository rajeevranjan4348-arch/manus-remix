/** Explicit, user-requested memory capture backed by the app's long-term memory store. */
import { longTermMemory } from '@/lib/longTermMemory';

export function isExplicitMemoryRequest(message: string): boolean {
  if (typeof message !== 'string' || !message.trim()) return false;
  return /\b(remember|reminder|remind me|save this|keep this in mind|keep in mind|don't forget|do not forget|my preference is|i prefer|always remember)\b/i.test(message);
}

/** Returns null for ordinary messages and true only after persistence succeeds. */
export async function captureExplicitMemory(userId: string, message: string): Promise<boolean | null> {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!isExplicitMemoryRequest(text)) return null;
  if (!userId) return false;

  const category = /\b(i prefer|my preference is|my favourite|my favorite|i like|i love)\b/i.test(text)
    ? 'preference'
    : 'fact';
  const key = ('explicit_' + text.toLowerCase()).slice(0, 80);

  try {
    await longTermMemory.addMemory({
      userId,
      category,
      key,
      value: text.slice(0, 600),
      source: 'Explicit user memory request',
    });
    return true;
  } catch (error) {
    console.error('[AgentMemory] Explicit memory persistence failed:', error);
    return false;
  }
}

export async function clearAgentMemory(userId: string): Promise<void> {
  if (userId) await longTermMemory.clearAllMemories(userId);
}

export function getAgentMemoryContext(userId: string, limit = 12): Promise<string> {
  return longTermMemory.getRelevantContext(userId, '').then((context) =>
    context.split('\n').slice(-Math.max(1, Math.min(limit, 30))).join('\n')
  );
}
