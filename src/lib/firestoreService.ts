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

const VALID_FIRESTORE_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const MAX_CONVERSATION_RESULT_LEN = 480_000; // Safe margin below 500,000 rule limit
const MAX_CONVERSATION_TITLE_LEN = 256;
const MAX_CONVERSATION_PROMPT_LEN = 10_000;
const completedConversationIds = new Set<string>();
const conversationCreatedAtCache = new Map<string, string>();

function getCanonicalCreatedAt(conversationId: string, candidate?: string): string {
  const existing = conversationCreatedAtCache.get(conversationId);
  if (existing) return existing;
  const resolved = String(candidate || new Date().toISOString()).slice(0, 64);
  conversationCreatedAtCache.set(conversationId, resolved);
  return resolved;
}

function isValidFirestoreDocId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && VALID_FIRESTORE_ID_REGEX.test(id);
}

function sanitizeStepsForFirestore(steps: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(steps) || steps.length === 0) return undefined;
  return steps.slice(0, 50).map((step: any, index) => ({
    id: String(step?.id ?? index + 1).slice(0, 64),
    label: String(step?.label || 'Step').slice(0, 256),
    status: ['pending', 'running', 'completed', 'error'].includes(step?.status)
      ? step.status
      : 'pending',
    trace: Array.isArray(step?.trace)
      ? step.trace.slice(-10).map((t: unknown) => String(t).slice(0, 500))
      : [],
  }));
}

// Conversation / Task Operations
export async function saveConversationToFirestore(conv: StoredConversation): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser || !isValidFirestoreDocId(conv?.id)) return;

  const path = `conversations/${conv.id}`;
  const rawSerializedResult = conv.result
    ? typeof conv.result === 'string'
      ? conv.result
      : JSON.stringify(conv.result)
    : '';
  const serializedResult =
    rawSerializedResult.length > MAX_CONVERSATION_RESULT_LEN
      ? rawSerializedResult.slice(0, MAX_CONVERSATION_RESULT_LEN)
      : rawSerializedResult;
  const sanitizedSteps = sanitizeStepsForFirestore(conv.steps);
  const stepsSig = sanitizedSteps
    ? `${sanitizedSteps.length}:${sanitizedSteps.map((s) => s.status).join(',')}`
    : '0';
  const resultSig = `${serializedResult.length}:${serializedResult.slice(0, 48)}:${serializedResult.slice(-48)}`;
  const signature = `${conv.title || ''}|${conv.status || 'idle'}|${conv.projectId || ''}|${stepsSig}|${resultSig}`;

  if (writeSignatureCache.get(path) === signature) {
    recordFirestoreWriteCoalesced();
    return;
  }

  try {
    const status = ['idle', 'running', 'completed', 'error'].includes(conv.status)
      ? conv.status
      : 'idle';
    const mode = conv.mode === 'work' ? 'work' : 'chat';
    const isReopeningCompleted = completedConversationIds.has(conv.id) && status === 'running';
    const canonicalCreatedAt = getCanonicalCreatedAt(conv.id, conv.createdAt);

    const payload: Record<string, any> = {
      id: conv.id,
      userId: currentUser.uid,
      title: String(conv.title || 'New Conversation').slice(0, MAX_CONVERSATION_TITLE_LEN),
      createdAt: canonicalCreatedAt,
      updatedAt: String(conv.updatedAt || new Date().toISOString()).slice(0, 64),
      mode,
      status,
    };
    if (conv.outputFormat) payload.outputFormat = String(conv.outputFormat).slice(0, 64);
    if (conv.chartType) payload.chartType = String(conv.chartType).slice(0, 64);
    if (conv.projectId && isValidFirestoreDocId(conv.projectId)) {
      payload.projectId = conv.projectId;
    }

    // Respect firestore.rules isValidConversationUpdate():
    // When reopening a completed conversation to 'running', omit result and steps and overwrite cleanly.
    if (!isReopeningCompleted) {
      if (serializedResult) {
        payload.result = serializedResult;
      }
      if (sanitizedSteps) {
        payload.steps = sanitizedSteps;
      }
    }

    if (isReopeningCompleted) {
      await setDoc(doc(db, 'conversations', conv.id), payload);
      completedConversationIds.delete(conv.id);
    } else {
      await setDoc(doc(db, 'conversations', conv.id), payload, { merge: true });
      if (status === 'completed') {
        completedConversationIds.add(conv.id);
      }
    }

    writeSignatureCache.set(path, signature);
    conversationsReadCache.delete(currentUser.uid);
  } catch (error) {
    console.warn(`[Firestore] Skipped conversation save (${path}):`, (error as any)?.message || error);
  }
}

/**
 * Persists an active running task's intermediate progress snapshot to `/conversations/{taskId}`
 * in Firestore so partial output and step progress survive unexpected browser tab closes.
 */
export async function saveActiveTaskProgressToFirestore(params: {
  taskId: string;
  title: string;
  prompt?: string;
  mode?: 'chat' | 'work';
  outputFormat?: string;
  chartType?: string;
  projectId?: string | null;
  status?: 'running' | 'error' | 'completed';
  steps?: any[];
  partialContent?: string;
  createdAt?: string;
}): Promise<boolean> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser || !isValidFirestoreDocId(params.taskId)) return false;

  const path = `conversations/${params.taskId}`;
  const status = params.status || 'running';
  const mode = params.mode === 'work' ? 'work' : 'chat';
  const sanitizedSteps = sanitizeStepsForFirestore(params.steps);
  const partialContent = typeof params.partialContent === 'string' ? params.partialContent : '';
  const serializedPartialResult = partialContent
    ? JSON.stringify({
        type: params.outputFormat || 'chat',
        content: partialContent.slice(0, MAX_CONVERSATION_RESULT_LEN - 256),
        autoSaved: true,
        inProgress: status === 'running',
        savedAt: new Date().toISOString(),
      }).slice(0, MAX_CONVERSATION_RESULT_LEN)
    : '';

  const stepsSig = sanitizedSteps
    ? `${sanitizedSteps.length}:${sanitizedSteps.map((s) => `${s.label}:${s.status}`).join('|')}`
    : '0';
  const signature = `autosave|${params.title || ''}|${status}|${stepsSig}|${partialContent.length}|${partialContent.slice(-64)}`;
  if (writeSignatureCache.get(path) === signature) {
    recordFirestoreWriteCoalesced();
    return true;
  }

  try {
    const now = new Date().toISOString();
    const isReopeningCompleted = completedConversationIds.has(params.taskId) && status === 'running';
    const canonicalCreatedAt = getCanonicalCreatedAt(params.taskId, params.createdAt || now);

    const payload: Record<string, any> = {
      id: params.taskId,
      userId: currentUser.uid,
      title: String(params.title || 'New Conversation').slice(0, MAX_CONVERSATION_TITLE_LEN),
      createdAt: canonicalCreatedAt,
      updatedAt: now,
      mode,
      status,
    };
    if (params.outputFormat) payload.outputFormat = String(params.outputFormat).slice(0, 64);
    if (params.chartType) payload.chartType = String(params.chartType).slice(0, 64);
    if (params.projectId && isValidFirestoreDocId(params.projectId)) {
      payload.projectId = params.projectId;
    }
    if (params.prompt && !isReopeningCompleted) {
      payload.prompt = String(params.prompt).slice(0, MAX_CONVERSATION_PROMPT_LEN);
    }

    if (isReopeningCompleted) {
      // First cleanly reopen the completed conversation without result/steps per firestore.rules
      await setDoc(doc(db, 'conversations', params.taskId), payload);
      completedConversationIds.delete(params.taskId);
    }

    if (sanitizedSteps) {
      payload.steps = sanitizedSteps;
    }
    if (serializedPartialResult) {
      payload.result = serializedPartialResult;
    }

    await setDoc(doc(db, 'conversations', params.taskId), payload, { merge: true });
    if (status === 'completed') {
      completedConversationIds.add(params.taskId);
    }
    writeSignatureCache.set(path, signature);
    conversationsReadCache.delete(currentUser.uid);
    return true;
  } catch (error) {
    console.warn(`[Firestore] Skipped active task auto-save (${path}):`, (error as any)?.message || error);
    return false;
  }
}

export async function getConversationFromFirestore(conversationId: string): Promise<StoredConversation | null> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser || !isValidFirestoreDocId(conversationId)) return null;

  const path = `conversations/${conversationId}`;
  try {
    return await deduplicateInFlightRequest(`read_conv_${conversationId}`, async () => {
      const snap = await getDoc(doc(db, 'conversations', conversationId));
      if (!snap.exists()) return null;
      const data = snap.data() as StoredConversation;
      if (data.createdAt) {
        conversationCreatedAtCache.set(conversationId, data.createdAt);
      }
      if (data.status === 'completed') {
        completedConversationIds.add(conversationId);
      }
      return data;
    });
  } catch (error) {
    console.warn(`[Firestore] Skipped conversation fetch (${path}):`, (error as any)?.message || error);
    return null;
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
      for (const item of list) {
        if (item.id && item.createdAt) {
          conversationCreatedAtCache.set(item.id, item.createdAt);
        }
        if (item.id && item.status === 'completed') {
          completedConversationIds.add(item.id);
        }
      }
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
    completedConversationIds.delete(conversationId);
    conversationCreatedAtCache.delete(conversationId);
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
  const rawContent = msg.content || '';
  const signature = `${msg.status || 'success'}|${rawContent.length}|${rawContent.slice(0, 64)}|${rawContent.slice(-64)}`;
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
      content: rawContent,
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

export async function deleteMessageFromFirestore(
  conversationId: string,
  messageId: string
): Promise<void> {
  const currentUser = getAuthenticatedUser();
  if (!currentUser || !conversationId || !messageId) return;

  const path = `conversations/${conversationId}/messages/${messageId}`;
  try {
    await deleteDoc(doc(db, 'conversations', conversationId, 'messages', messageId));
    writeSignatureCache.delete(path);
    messagesReadCache.delete(conversationId);
  } catch (error) {
    console.warn(`[Firestore] Skipped message delete (${path}):`, (error as any)?.message || error);
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
