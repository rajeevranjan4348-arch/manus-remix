import { auth } from './firebase';
import type { StoredConversation, StoredMessage } from './chatDatabase';
import type { Project } from '@/types/project';

/**
 * Retrieves the current Firebase user's ID token in memory (never stored in localStorage).
 */
async function getAuthHeaders(): Promise<Record<string, string> | null> {
  if (typeof window === 'undefined' || !auth.currentUser || auth.currentUser.isAnonymous) {
    return null;
  }
  try {
    const token = await auth.currentUser.getIdToken();
    if (!token) return null;
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  } catch {
    return null;
  }
}

export async function syncUserToCloudSql(profile: {
  email?: string | null;
  displayName?: string | null;
}): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;
  try {
    await fetch('/api/sql/users/sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: profile.email || undefined,
        displayName: profile.displayName || undefined,
      }),
    });
  } catch {
    // Fail silently on client to preserve UI isolation
  }
}

export async function saveConversationToCloudSql(conv: StoredConversation): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;
  try {
    await fetch('/api/sql/conversations', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: conv.id,
        title: conv.title,
        mode: conv.mode,
        status: conv.status,
        projectId: conv.projectId ?? null,
      }),
    });
  } catch {}
}

export async function deleteConversationFromCloudSql(conversationId: string): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;
  try {
    await fetch(`/api/sql/conversations?id=${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
      headers,
    });
  } catch {}
}

export async function fetchConversationsFromCloudSql(limit = 50): Promise<any[]> {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  try {
    const res = await fetch(`/api/sql/conversations?limit=${limit}`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.conversations) ? data.conversations : [];
  } catch {
    return [];
  }
}

export async function saveMessageToCloudSql(msg: StoredMessage): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;
  try {
    await fetch('/api/sql/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role,
        content: msg.content,
        status: msg.status,
      }),
    });
  } catch {}
}

export async function fetchMessagesFromCloudSql(conversationId: string): Promise<any[]> {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  try {
    const res = await fetch(`/api/sql/messages?conversationId=${encodeURIComponent(conversationId)}`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

export async function saveProjectToCloudSql(project: Project): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;
  try {
    await fetch('/api/sql/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: project.id,
        name: project.name,
        description: project.description || null,
        icon: project.icon || null,
        color: project.color || null,
      }),
    });
  } catch {}
}

export async function deleteProjectFromCloudSql(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;
  try {
    await fetch(`/api/sql/projects?id=${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers,
    });
  } catch {}
}

export async function fetchProjectsFromCloudSql(): Promise<any[]> {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  try {
    const res = await fetch('/api/sql/projects', {
      method: 'GET',
      headers,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    return [];
  }
}
