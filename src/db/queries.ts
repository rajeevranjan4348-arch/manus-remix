import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import { conversations, messages, projects, users } from './schema.ts';
import { getOrCreateUser } from './users.ts';

export async function listUserConversationsFromSql(uid: string, limitCount = 50) {
  try {
    return await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, uid))
      .orderBy(desc(conversations.updatedAt))
      .limit(Math.min(Math.max(limitCount, 1), 200));
  } catch (error) {
    console.error('Database query failed in listUserConversationsFromSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function upsertConversationInSql(params: {
  uid: string;
  email: string;
  displayName?: string | null;
  id: string;
  title: string;
  mode?: string;
  status?: string;
  projectId?: string | null;
  summary?: string | null;
}) {
  try {
    await getOrCreateUser(params.uid, params.email, params.displayName);
    if (params.projectId) {
      const [ownedProject] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, params.projectId), eq(projects.userId, params.uid)))
        .limit(1);
      if (!ownedProject) return undefined;
    }
    const now = new Date();
    const result = await db
      .insert(conversations)
      .values({
        id: params.id,
        userId: params.uid,
        projectId: params.projectId ?? null,
        title: params.title || 'New Conversation',
        mode: params.mode || 'chat',
        status: params.status || 'idle',
        summary: params.summary ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          title: params.title || 'New Conversation',
          mode: params.mode || 'chat',
          status: params.status || 'idle',
          projectId: params.projectId ?? null,
          ...(params.summary !== undefined ? { summary: params.summary } : {}),
          updatedAt: now,
        },
        setWhere: eq(conversations.userId, params.uid),
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in upsertConversationInSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function deleteConversationInSql(uid: string, conversationId: string) {
  try {
    await db
      .delete(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.userId, uid)));
    const deleted = await db
      .delete(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, uid)))
      .returning();
    return deleted.length > 0;
  } catch (error) {
    console.error('Database query failed in deleteConversationInSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function listConversationMessagesFromSql(uid: string, conversationId: string) {
  try {
    // Verify ownership via inner join with conversations
    const rows = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        userId: messages.userId,
        role: messages.role,
        content: messages.content,
        thought: messages.thought,
        status: messages.status,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, uid),
        eq(messages.userId, uid),
      ));

    return rows;
  } catch (error) {
    console.error('Database query failed in listConversationMessagesFromSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function deleteMessagesInSql(uid: string, conversationId: string, messageIds: string[]) {
  const ids = [...new Set(messageIds.filter((id) => typeof id === 'string' && id.length > 0))].slice(0, 500);
  if (!uid || !conversationId || ids.length === 0) return 0;
  try {
    const [ownedConversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, uid)))
      .limit(1);
    if (!ownedConversation) return 0;

    const deleted = await db
      .delete(messages)
      .where(and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, uid),
        inArray(messages.id, ids),
      ))
      .returning({ id: messages.id });
    return deleted.length;
  } catch (error) {
    console.error('Database query failed in deleteMessagesInSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function upsertMessageInSql(params: {
  uid: string;
  email: string;
  id: string;
  conversationId: string;
  role: string;
  content: string;
  thought?: string | null;
  status?: string;
}) {
  try {
    await getOrCreateUser(params.uid, params.email);
    const [ownedConversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, params.conversationId), eq(conversations.userId, params.uid)))
      .limit(1);
    if (!ownedConversation) return undefined;
    const result = await db
      .insert(messages)
      .values({
        id: params.id,
        conversationId: params.conversationId,
        userId: params.uid,
        role: params.role,
        content: params.content,
        thought: params.thought ?? null,
        status: params.status || 'success',
      })
      .onConflictDoUpdate({
        target: messages.id,
        set: {
          content: params.content,
          thought: params.thought ?? null,
          status: params.status || 'success',
        },
        setWhere: and(
          eq(messages.userId, params.uid),
          eq(messages.conversationId, params.conversationId),
        ),
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in upsertMessageInSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function listUserProjectsFromSql(uid: string) {
  try {
    return await db
      .select()
      .from(projects)
      .where(eq(projects.userId, uid))
      .orderBy(desc(projects.updatedAt));
  } catch (error) {
    console.error('Database query failed in listUserProjectsFromSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function upsertProjectInSql(params: {
  uid: string;
  email: string;
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
}) {
  try {
    await getOrCreateUser(params.uid, params.email);
    const now = new Date();
    const result = await db
      .insert(projects)
      .values({
        id: params.id,
        userId: params.uid,
        name: params.name,
        description: params.description ?? null,
        icon: params.icon ?? null,
        color: params.color ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: params.name,
          description: params.description ?? null,
          icon: params.icon ?? null,
          color: params.color ?? null,
          updatedAt: now,
        },
        setWhere: eq(projects.userId, params.uid),
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in upsertProjectInSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function deleteProjectInSql(uid: string, projectId: string) {
  try {
    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, uid)))
      .returning();
    return deleted.length > 0;
  } catch (error) {
    console.error('Database query failed in deleteProjectInSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getUserProfileWithCountsFromSql(uid: string) {
  try {
    const userRows = await db.select().from(users).where(eq(users.uid, uid));
    const userConversations = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, uid));
    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, uid));

    return {
      user: userRows[0] || null,
      conversationCount: userConversations.length,
      projectCount: userProjects.length,
    };
  } catch (error) {
    console.error('Database query failed in getUserProfileWithCountsFromSql:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}
