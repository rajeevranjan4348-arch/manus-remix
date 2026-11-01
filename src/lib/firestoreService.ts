import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  query, 
  where
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Project } from '@/types/project';
import type { UserSettings } from '@/types/settings';
import type { StoredConversation, StoredMessage } from './chatDatabase';
import {
  BoundedLRUCache,
  deduplicateInFlightRequest,
  recordFirestoreReadSaved,
  recordFirestoreWriteCoalesced,
} from './performanceEngine';

export interface FirebaseUserProfile {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: string;
}

// Bounded caches to minimize Firestore reads and skip redundant writes on 2GB RAM Android devices
const profileReadCache = new BoundedLRUCache<string, FirebaseUserProfile>({
  maxSize: 10,
  ttlMs: 5 * 60 * 1000,
});
const writeSignatureCache = new BoundedLRUCache<string, string>({
  maxSize: 60,
  ttlMs: 2 * 60 * 1000,
});
const conversationsReadCache = new BoundedLRUCache<string, StoredConversation[]>({
  maxSize: 5,
  ttlMs: 25 * 1000,
});
const messagesReadCache = new BoundedLRUCache<string, StoredMessage[]>({
  maxSize: 15,
  ttlMs: 20 * 1000,
});

function getAuthenticatedUser() {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.isAnonymous || String(currentUser.uid || '').startsWith('guest-')) {
    return null;
  }
  return currentUser;
}

// User Profile Operations
export async function syncUserProfile(profile: FirebaseUserProfile): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser || !profile?.id || profile.id.startsWith('guest-') || currentUser.uid !== profile.id) {
    return;
  }
  const path = `users/${profile.id}`;
  const signature = `${profile.id}|${profile.email}|${profile.displayName || ''}|${profile.photoURL || ''}`;
  if (writeSignatureCache.get(path) === signature) {
    recordFirestoreWriteCoalesced();
    return;
  }
  try {
    await deduplicateInFlightRequest(`write_${path}`, () =>
      setDoc(doc(db, 'users', profile.id), profile, { merge: true })
    );
    writeSignatureCache.set(path, signature);
    profileReadCache.set(profile.id, profile);
  } catch (error) {
    console.warn(`[Firestore] Skipped profile sync (${path}):`, (error as any)?.message || error);
  }
}

export async function getUserProfile(userId: string): Promise<FirebaseUserProfile | null> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser || !userId || userId.startsWith('guest-')) {
    return null;
  }
  const cached = profileReadCache.get(userId);
  if (cached) {
    recordFirestoreReadSaved();
    return cached;
  }
  const path = `users/${userId}`;
  try {
    return await deduplicateInFlightRequest(`read_${path}`, async () => {
      const snap = await getDoc(doc(db, 'users', userId));
      if (!snap.exists()) return null;
      const data = snap.data() as FirebaseUserProfile;
      profileReadCache.set(userId, data);
      return data;
    });
  } catch (error) {
    console.warn(`[Firestore] Skipped profile fetch (${path}):`, (error as any)?.message || error);
    return null;
  }
}

// User Settings Operations
export async function saveUserSettingsToFirestore(settings: Partial<UserSettings>): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return;

  const path = `users/${currentUser.uid}/settings/preferences`;
  const signature = `${settings.theme || 'system'}|${settings.defaultMode || 'chat'}|${settings.language || 'en'}|${settings.defaultModel || 'gemini-3.8-flash'}|${settings.voicePersona || 'marcus'}`;
  if (writeSignatureCache.get(path) === signature) {
    recordFirestoreWriteCoalesced();
    return;
  }
  try {
    const payload = {
      userId: currentUser.uid,
      theme: settings.theme || 'system',
      defaultMode: settings.defaultMode || 'chat',
      language: settings.language || 'en',
      defaultModel: settings.defaultModel || 'gemini-3.8-flash',
      voicePersona: settings.voicePersona || 'marcus',
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'preferences'), payload, { merge: true });
    writeSignatureCache.set(path, signature);
  } catch (error) {
    console.warn(`[Firestore] Skipped settings save (${path}):`, (error as any)?.message || error);
  }
}

// Project Operations
export async function saveProjectToFirestore(project: Project): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return;

  const path = `projects/${project.id}`;
  try {
    const payload = {
      id: project.id,
      userId: currentUser.uid,
      name: project.name,
      description: project.description || '',
      icon: project.icon || 'folder',
      color: project.color || 'blue',
      customInstructions: project.customInstructions || '',
      created_at: project.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await setDoc(doc(db, 'projects', project.id), payload, { merge: true });
  } catch (error) {
    console.warn(`[Firestore] Skipped project save (${path}):`, (error as any)?.message || error);
  }
}

export async function getProjectsFromFirestore(): Promise<Project[]> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return [];

  const path = 'projects';
  try {
    return await deduplicateInFlightRequest(`read_projects_${currentUser.uid}`, async () => {
      const q = query(collection(db, path), where('userId', '==', currentUser.uid));
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data() as Project);
    });
  } catch (error) {
    console.warn(`[Firestore] Skipped projects list (${path}):`, (error as any)?.message || error);
    return [];
  }
}

export async function deleteProjectFromFirestore(projectId: string): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return;

  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    console.warn(`[Firestore] Skipped project delete (${path}):`, (error as any)?.message || error);
  }
}

// Conversation / Task Operations
export async function saveConversationToFirestore(conv: StoredConversation): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return;

  const path = `conversations/${conv.id}`;
  const serializedResult = conv.result
    ? typeof conv.result === 'string'
      ? conv.result
      : JSON.stringify(conv.result)
    : '';
  const signature = `${conv.title || ''}|${conv.status || 'idle'}|${conv.projectId || ''}|${serializedResult.length}`;
  if (writeSignatureCache.get(path) === signature) {
    recordFirestoreWriteCoalesced();
    return;
  }

  try {
    const payload: Record<string, any> = {
      id: conv.id,
      userId: currentUser.uid,
      title: conv.title || 'New Conversation',
      createdAt: conv.createdAt || new Date().toISOString(),
      updatedAt: conv.updatedAt || new Date().toISOString(),
      mode: conv.mode || 'chat',
      status: conv.status || 'idle'
    };
    if (conv.outputFormat) payload.outputFormat = conv.outputFormat;
    if (conv.chartType) payload.chartType = conv.chartType;
    if (conv.projectId) payload.projectId = conv.projectId;
    if (serializedResult) {
      payload.result = serializedResult;
    }
    await setDoc(doc(db, 'conversations', conv.id), payload, { merge: true });
    writeSignatureCache.set(path, signature);
    conversationsReadCache.delete(currentUser.uid);
  } catch (error) {
    console.warn(`[Firestore] Skipped conversation save (${path}):`, (error as any)?.message || error);
  }
}

export async function getConversationsFromFirestore(): Promise<StoredConversation[]> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return [];

  const cached = conversationsReadCache.get(currentUser.uid);
  if (cached) {
    recordFirestoreReadSaved();
    return cached;
  }

  const path = 'conversations';
  try {
    return await deduplicateInFlightRequest(`read_convs_${currentUser.uid}`, async () => {
      const q = query(
        collection(db, path), 
        where('userId', '==', currentUser.uid)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => d.data() as StoredConversation);
      conversationsReadCache.set(currentUser.uid, list);
      return list;
    });
  } catch (error) {
    console.warn(`[Firestore] Skipped conversations list (${path}):`, (error as any)?.message || error);
    return [];
  }
}

export async function deleteConversationFromFirestore(conversationId: string): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return;

  const path = `conversations/${conversationId}`;
  try {
    await deleteDoc(doc(db, 'conversations', conversationId));
    writeSignatureCache.delete(path);
    conversationsReadCache.delete(currentUser.uid);
    messagesReadCache.delete(conversationId);
  } catch (error) {
    console.warn(`[Firestore] Skipped conversation delete (${path}):`, (error as any)?.message || error);
  }
}

// Message Operations
export async function saveMessageToFirestore(msg: StoredMessage): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return;

  // Skip persisting intermediate streaming states to Firestore to save quota & battery
  if (msg.status === 'streaming') {
    recordFirestoreWriteCoalesced();
    return;
  }

  const path = `conversations/${msg.conversationId}/messages/${msg.id}`;
  const signature = `${msg.status || 'success'}|${(msg.content || '').length}`;
  if (writeSignatureCache.get(path) === signature) {
    recordFirestoreWriteCoalesced();
    return;
  }

  try {
    const payload = {
      id: msg.id,
      conversationId: msg.conversationId,
      userId: currentUser.uid,
      role: msg.role,
      content: msg.content || '',
      timestamp: msg.timestamp || new Date().toISOString(),
      status: msg.status || 'success'
    };
    await setDoc(doc(db, 'conversations', msg.conversationId, 'messages', msg.id), payload);
    writeSignatureCache.set(path, signature);
    messagesReadCache.delete(msg.conversationId);
  } catch (error) {
    console.warn(`[Firestore] Skipped message save (${path}):`, (error as any)?.message || error);
  }
}

export async function getMessagesFromFirestore(conversationId: string): Promise<StoredMessage[]> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return [];

  const cached = messagesReadCache.get(conversationId);
  if (cached) {
    recordFirestoreReadSaved();
    return cached;
  }

  const path = `conversations/${conversationId}/messages`;
  try {
    return await deduplicateInFlightRequest(`read_msgs_${conversationId}`, async () => {
      const snap = await getDocs(collection(db, 'conversations', conversationId, 'messages'));
      const list = snap.docs.map(d => d.data() as StoredMessage);
      list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      messagesReadCache.set(conversationId, list);
      return list;
    });
  } catch (error) {
    console.warn(`[Firestore] Skipped messages list (${path}):`, (error as any)?.message || error);
    return [];
  }
}
