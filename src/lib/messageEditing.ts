export interface EditableChatMessage {
  id?: string;
  role?: string;
  content?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface EditedUserTurn {
  messages: EditableChatMessage[];
  editedMessage: EditableChatMessage;
  removedMessages: EditableChatMessage[];
}

/**
 * Creates the active transcript for an edited prompt. Earlier context remains
 * untouched, the edited user message keeps its ID and timestamp, and the old
 * assistant/user tail is returned for removal from this branch before regen.
 */
export function replaceEditedUserTurn(
  messages: EditableChatMessage[],
  messageId: string,
  editedContent: string,
  editedAt = new Date().toISOString(),
  allowUnchanged = false,
): EditedUserTurn | null {
  const content = String(editedContent || '').trim();
  if (!messageId || !content || !Array.isArray(messages)) return null;

  const index = messages.findIndex((message) => message?.id === messageId && message.role === 'user');
  if (index < 0) return null;

  const original = messages[index];
  const contentChanged = String(original.content || '').trim() !== content;
  if (!contentChanged && !allowUnchanged) return null;

  const editedMessage: EditableChatMessage = {
    ...original,
    ...(contentChanged ? { content } : {}),
    ...(contentChanged ? { status: 'success' } : {}),
    ...(contentChanged ? {
      metadata: {
        ...(original.metadata || {}),
        editedAt,
        editCount: Number(original.metadata?.editCount || 0) + 1,
      },
    } : {}),
  };

  return {
    messages: [...messages.slice(0, index), editedMessage],
    editedMessage,
    removedMessages: messages.slice(index + 1),
  };
}
