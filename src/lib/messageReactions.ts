export type MessageReactionType = 'up' | 'down';

const MESSAGE_REACTIONS_STORAGE_KEY = 'manus_message_reactions';

export function getStoredMessageReactions(): Record<string, MessageReactionType> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MESSAGE_REACTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getMessageReaction(messageId: string): MessageReactionType | null {
  if (!messageId) return null;
  const all = getStoredMessageReactions();
  return all[messageId] ?? null;
}

export function setMessageReaction(
  messageId: string,
  reaction: MessageReactionType | null
): Record<string, MessageReactionType> {
  const current = getStoredMessageReactions();
  if (!messageId) return current;

  const updated = { ...current };
  if (reaction === null) {
    delete updated[messageId];
  } else {
    updated[messageId] = reaction;
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MESSAGE_REACTIONS_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(
        new CustomEvent('manus_message_reactions_updated', {
          detail: { messageId, reaction },
        })
      );
    } catch {}
  }

  return updated;
}

export function toggleMessageReaction(
  messageId: string,
  reaction: MessageReactionType
): { nextReaction: MessageReactionType | null; reactions: Record<string, MessageReactionType> } {
  const currentReaction = getMessageReaction(messageId);
  const nextReaction: MessageReactionType | null = currentReaction === reaction ? null : reaction;
  const reactions = setMessageReaction(messageId, nextReaction);
  return { nextReaction, reactions };
}
