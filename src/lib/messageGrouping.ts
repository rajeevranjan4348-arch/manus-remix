export interface GroupableChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | string;
  content: any;
  [key: string]: any;
}

export interface ChatMessageGroupMetadata {
  /** True when the immediately preceding visible message has the same sender role */
  isGroupedWithPrev: boolean;
  /** True when the immediately following visible message has the same sender role */
  isGroupedWithNext: boolean;
  /** True when this message is the first message in a consecutive same-sender block */
  isFirstInGroup: boolean;
  /** True when this message is the last message in a consecutive same-sender block */
  isLastInGroup: boolean;
  /** 0-based position of this message inside its consecutive same-sender block */
  groupPosition: number;
  /** Total number of consecutive messages in this same-sender block */
  groupSize: number;
  /** Deterministic identifier shared by all consecutive messages in this block */
  groupId: string;
}

export interface ConsecutiveMessageGroup<T extends GroupableChatMessage = GroupableChatMessage> {
  groupId: string;
  role: string;
  startIndex: number;
  endIndex: number;
  messages: Array<{
    message: T;
    index: number;
    meta: ChatMessageGroupMetadata;
  }>;
}

/**
 * Deduplicates messages that share the exact same ID (or lack IDs and are identical back-to-back streaming snapshots),
 * while preserving distinct consecutive messages sent by the same sender.
 */
export function deduplicateDisplayMessages<T extends GroupableChatMessage>(
  messages: T[],
  cleanContentFn: (raw: any) => string = (v) => String(v || '')
): T[] {
  const list: T[] = [];
  const seenIds = new Set<string>();

  for (const msg of messages) {
    if (!msg) continue;
    const msgId = typeof msg.id === 'string' && msg.id.trim() ? msg.id.trim() : '';
    if (msgId && seenIds.has(msgId)) {
      continue;
    }

    const prev = list[list.length - 1];
    const prevId = prev && typeof prev.id === 'string' && prev.id.trim() ? prev.id.trim() : '';
    const hasDistinctIds = Boolean(msgId && prevId && msgId !== prevId);

    // Only collapse adjacent identical content when they do NOT have distinct message IDs
    // (e.g. duplicate anonymous streaming frames). Distinct messages sent in succession are preserved.
    if (
      prev &&
      !hasDistinctIds &&
      prev.role === msg.role &&
      cleanContentFn(prev.content || '').trim().toLowerCase() ===
        cleanContentFn(msg.content || '').trim().toLowerCase()
    ) {
      continue;
    }

    if (msgId) {
      seenIds.add(msgId);
    }
    list.push(msg);
  }

  return list;
}

/**
 * Computes consecutive same-sender grouping metadata for each message in a list.
 */
export function computeMessageGroupingMetadata<T extends GroupableChatMessage>(
  messages: T[]
): ChatMessageGroupMetadata[] {
  const count = messages.length;
  if (count === 0) return [];

  // First pass: find group boundaries
  const groupStarts: number[] = new Array(count).fill(0);
  const groupEnds: number[] = new Array(count).fill(0);

  let currentStart = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0 && messages[i]?.role !== messages[i - 1]?.role) {
      for (let j = currentStart; j < i; j++) {
        groupStarts[j] = currentStart;
        groupEnds[j] = i - 1;
      }
      currentStart = i;
    }
  }
  for (let j = currentStart; j < count; j++) {
    groupStarts[j] = currentStart;
    groupEnds[j] = count - 1;
  }

  return messages.map((msg, i) => {
    const start = groupStarts[i];
    const end = groupEnds[i];
    const groupSize = end - start + 1;
    const groupPosition = i - start;
    const isFirstInGroup = i === start;
    const isLastInGroup = i === end;
    const firstMsgId = messages[start]?.id || `idx_${start}`;
    const groupId = `group_${msg?.role || 'unknown'}_${firstMsgId}`;

    return {
      isGroupedWithPrev: !isFirstInGroup,
      isGroupedWithNext: !isLastInGroup,
      isFirstInGroup,
      isLastInGroup,
      groupPosition,
      groupSize,
      groupId,
    };
  });
}

/**
 * Groups consecutive messages from the same sender into unified blocks
 * with precomputed per-message metadata and reduced vertical spacing.
 */
export function groupConsecutiveMessages<T extends GroupableChatMessage>(
  messages: T[],
  startOffset = 0
): ConsecutiveMessageGroup<T>[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const metadata = computeMessageGroupingMetadata(messages);
  const groups: ConsecutiveMessageGroup<T>[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const meta = metadata[i];
    const globalIndex = startOffset + i;

    if (meta.isFirstInGroup || groups.length === 0) {
      groups.push({
        groupId: meta.groupId,
        role: msg.role,
        startIndex: globalIndex,
        endIndex: globalIndex,
        messages: [
          {
            message: msg,
            index: globalIndex,
            meta,
          },
        ],
      });
    } else {
      const currentGroup = groups[groups.length - 1];
      currentGroup.endIndex = globalIndex;
      currentGroup.messages.push({
        message: msg,
        index: globalIndex,
        meta,
      });
    }
  }

  return groups;
}
