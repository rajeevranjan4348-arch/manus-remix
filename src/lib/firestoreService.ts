import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import type { Project } from '@/types/project';
import type { UserSettings } from '@/types/settings';
import type { StoredConversation, StoredMessage } from './chatDatabase';

export interface FirebaseUserProfile {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: string;
}

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
  try {
    await setDoc(doc(db, 'users', profile.id), profile, { merge: true });
  } catch (error) {
    console.warn(`[Firestore] Skipped profile sync (${path}):`, (error as any)?.message || error);
  }
}

export async function getUserProfile(userId: string): Promise<FirebaseUserProfile | null> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser || !userId || userId.startsWith('guest-')) {
    return null;
  }
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.exists() ? (snap.data() as FirebaseUserProfile) : null;
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
    const q = query(collection(db, path), where('userId', '==', currentUser.uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Project);
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
    if (conv.result) {
      payload.result = typeof conv.result === 'string' ? conv.result : JSON.stringify(conv.result);
    }
    await setDoc(doc(db, 'conversations', conv.id), payload, { merge: true });
  } catch (error) {
    console.warn(`[Firestore] Skipped conversation save (${path}):`, (error as any)?.message || error);
  }
}

export async function getConversationsFromFirestore(): Promise<StoredConversation[]> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return [];

  const path = 'conversations';
  try {
    const q = query(
      collection(db, path), 
      where('userId', '==', currentUser.uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as StoredConversation);
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
  } catch (error) {
    console.warn(`[Firestore] Skipped conversation delete (${path}):`, (error as any)?.message || error);
  }
}

// Message Operations
export async function saveMessageToFirestore(msg: StoredMessage): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return;

  const path = `conversations/${msg.conversationId}/messages/${msg.id}`;
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
  } catch (error) {
    console.warn(`[Firestore] Skipped message save (${path}):`, (error as any)?.message || error);
  }
}

export async function getMessagesFromFirestore(conversationId: string): Promise<StoredMessage[]> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser) return [];

  const path = `conversations/${conversationId}/messages`;
  try {
    const snap = await getDocs(collection(db, 'conversations', conversationId, 'messages'));
    const list = snap.docs.map(d => d.data() as StoredMessage);
    list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return list;
  } catch (error) {
    console.warn(`[Firestore] Skipped messages list (${path}):`, (error as any)?.message || error);
    return [];
  }
}
