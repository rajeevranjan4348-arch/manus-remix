/**
 * Pure Conversation Branching Utilities for Real Message Editing
 *
 * Updates a user message in-place (preserving its id, timestamp, and any embedded
 * attachment metadata prefixes), truncates all subsequent messages after that turn
 * cleanly, and returns the exact list of removed message IDs for storage cleanup.
 */

export interface EditableChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
  timestamp?: string;
  status?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface MessageEditBranchResult<T extends EditableChatMessage> {
  updatedMessages: T[];
  editedMessage: T | null;
  removedMessageIds: string[];
  editedIndex: number;
  isFirstUserMessage: boolean;
}

/**
 * Preserves any leading attachment markers (e.g. `[Attached Image: ...]`, `[IMAGE_DATA_URL:...]`,
 * `[Attached File: ...]`) from the original message while replacing only the user's editable text.
 */
export function preserveUserMessageAttachments(
  originalRawContent: string,
  newUserText: string
): string {
  const trimmedNew = (newUserText || '').trim();
  if (!originalRawContent || typeof originalRawContent !== 'string') {
    return trimmedNew;
  }

  const prefixes: string[] = [];
  const attachedImgMatch = originalRawContent.match(/\[Attached Image:[^\]]+\]/i);
  if (attachedImgMatch) prefixes.push(attachedImgMatch[0]);

  const dataUrlMatch = originalRawContent.match(/\[IMAGE_DATA_URL:[^\]]+\]/i);
  if (dataUrlMatch) prefixes.push(dataUrlMatch[0]);

  const attachedFileMatch = originalRawContent.match(/\[Attached File:[^\]]+\]/i);
  if (attachedFileMatch) prefixes.push(attachedFileMatch[0]);

  if (prefixes.length === 0) {
    return trimmedNew;
  }

  return `${prefixes.join('\n')}\n${trimmedNew}`.trim();
}

/**
 * Applies an in-place edit to a user message and branches the conversation
 * by removing every subsequent message after the edited turn.
 */
export function applyUserMessageEditBranch<T extends EditableChatMessage>(
  messages: T[],
  messageId: string,
  newContent: string,
  editedAtIso: string = new Date().toISOString()
): MessageEditBranchResult<T> {
  const trimmed = (newContent || '').trim();
  if (!messageId || !trimmed || !Array.isArray(messages) || messages.length === 0) {
    return {
      updatedMessages: messages || [],
      editedMessage: null,
      removedMessageIds: [],
      editedIndex: -1,
      isFirstUserMessage: false,
    };
  }

  const targetIndex = messages.findIndex(
    (m) => m && m.role === 'user' && m.id === messageId
  );

  if (targetIndex === -1) {
    return {
      updatedMessages: messages,
      editedMessage: null,
      removedMessageIds: [],
      editedIndex: -1,
      isFirstUserMessage: false,
    };
  }

  const original = messages[targetIndex];
  const mergedContent = preserveUserMessageAttachments(original.content, trimmed);
  const editedMessage: T = {
    ...original,
    content: mergedContent,
    status: 'success',
    metadata: {
      ...(original.metadata || {}),
      edited: true,
      editedAt: editedAtIso,
      previousContent: original.content,
    },
  };

  const keptBefore = messages.slice(0, targetIndex);
  const removed = messages.slice(targetIndex + 1);
  const removedMessageIds = removed
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

  const isFirstUserMessage = !keptBefore.some((m) => m?.role === 'user');

  return {
    updatedMessages: [...keptBefore, editedMessage],
    editedMessage,
    removedMessageIds,
    editedIndex: targetIndex,
    isFirstUserMessage,
  };
}
