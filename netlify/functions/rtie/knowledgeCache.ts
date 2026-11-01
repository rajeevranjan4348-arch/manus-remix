/**
 * Knowledge cache service — persistent storage of verified research facts.
 *
 * Storage strategy:
 * - Primary: Firebase Firestore (project already uses Firebase). Uses the
 *   Firestore REST API with a service-account access token, so no extra
 *   heavyweight SDK is bundled into the Netlify function.
 * - Fallback: in-memory Map when FIREBASE_SERVICE_ACCOUNT_JSON is absent
 *   (e.g. preview environments), so research still works without persistence.
 *
 * Records are keyed by topic hash + freshness category. User research
 * history records additionally carry the userId and are only ever returned
 * for that user. Public verified facts are shared across users but never
 * contain personal data.
 */
import type { KnowledgeRecord, FreshnessCategory, VerifiedSource } from './types';
import { hashContent } from './contentExtraction';
import { isExpired, expiresForCategory, ttlForCategory } from './freshness';

const COLLECTION = 'rtie_knowledge_cache';
const MEMORY_MAX = 200;

const memoryStore = new Map<string, KnowledgeRecord>();

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.client_email && parsed.private_key) return parsed as ServiceAccount;
    return null;
  } catch {
    return null;
  }
}

function projectId(): string | null {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null;
}

async function getAccessToken(): Promise<string | null> {
  const sa = getServiceAccount();
  const pid = projectId();
  if (!sa || !pid) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const b64 = (obj: unknown) => btoaUrl(JSON.stringify(obj));
    const claimSet = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };
    const unsigned = b64(header) + '.' + b64(claimSet);
    // Web Crypto RS256 signature (available in Netlify Functions runtime).
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToBuffer(sa.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const jwt = unsigned + '.' + bufferToB64Url(new Uint8Array(signature));
    const response = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + encodeURIComponent(jwt),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const payload: any = await response.json();
    cachedToken = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  }
}

function btoaUrl(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bufferToB64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoaUrl(binary);
}
function pemToBuffer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const binary = atobUrl(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function atobUrl(b64: string): string {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

export function topicKey(query: string, category: FreshnessCategory): string {
  const normalized = query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return hashContent(category + ':' + normalized);
}

export interface CacheLookup {
  record: KnowledgeRecord | null;
  fresh: boolean;
  source: 'firestore' | 'memory' | 'none';
}

export async function lookupKnowledge(query: string, category: FreshnessCategory): Promise<CacheLookup> {
  const key = topicKey(query, category);
  const record = await readRecord(key);
  if (!record) return { record: null, fresh: false, source: 'none' };
  return { record, fresh: !isExpired(record.expiresAt), source: recordExpiresInStore(record) };
}

function recordExpiresInStore(record: KnowledgeRecord): 'firestore' | 'memory' {
  return memoryStore.has(record.key) ? 'memory' : 'firestore';
}

async function readRecord(key: string): Promise<KnowledgeRecord | null> {
  const token = await getAccessToken();
  const pid = projectId();
  if (token && pid) {
    try {
      const url = 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents/' + COLLECTION + '/' + encodeURIComponent(key);
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        const doc: any = await response.json();
        return firestoreToRecord(doc.fields, key);
      }
      if (response.status !== 404) console.warn('[RTIE] Firestore read failed:', response.status);
    } catch (error) {
      console.warn('[RTIE] Firestore read error:', error);
    }
  }
  return memoryStore.get(key) || null;
}

async function writeRecord(record: KnowledgeRecord): Promise<void> {
  memoryStore.set(record.key, record);
  if (memoryStore.size > MEMORY_MAX) {
    const oldestKey = memoryStore.keys().next().value;
    if (oldestKey) memoryStore.delete(oldestKey);
  }
  const token = await getAccessToken();
  const pid = projectId();
  if (token && pid) {
    try {
      const url = 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents/' + COLLECTION + '?key=' + encodeURIComponent(record.key);
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: recordToFirestore(record) }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) console.warn('[RTIE] Firestore write failed:', response.status);
    } catch (error) {
      console.warn('[RTIE] Firestore write error:', error);
    }
  }
}

function fsValue(value: unknown): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(fsValue) } };
  if (typeof value === 'object') return { mapValue: { fields: objectToFields(value as Record<string, unknown>) } };
  return { stringValue: String(value) };
}

function objectToFields(obj: Record<string, unknown>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = fsValue(v);
  return fields;
}

function recordToFirestore(record: KnowledgeRecord): Record<string, any> {
  return objectToFields({
    userId: record.userId,
    topic: record.topic,
    content: record.content,
    sources: record.sources,
    contentHash: record.contentHash,
    retrievedAt: record.retrievedAt,
    lastVerifiedAt: record.lastVerifiedAt,
    publishedAt: record.publishedAt,
    category: record.category,
    confidence: record.confidence,
    expiresAt: record.expiresAt,
  });
}

function fieldsToValue(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fieldsToValue);
  if ('mapValue' in v && v.mapValue && v.mapValue.fields) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields)) out[k] = fieldsToValue(val);
    return out;
  }
  return null;
}

function firestoreToRecord(fields: Record<string, any>, key: string): KnowledgeRecord | null {
  try {
    const raw: any = {};
    for (const [k, v] of Object.entries(fields)) raw[k] = fieldsToValue(v);
    if (!raw.content || !raw.contentHash) return null;
    return {
      key,
      userId: String(raw.userId || 'shared'),
      topic: String(raw.topic || ''),
      content: String(raw.content),
      sources: Array.isArray(raw.sources) ? raw.sources : [],
      contentHash: String(raw.contentHash),
      retrievedAt: String(raw.retrievedAt || new Date().toISOString()),
      lastVerifiedAt: String(raw.lastVerifiedAt || new Date().toISOString()),
      publishedAt: raw.publishedAt ? String(raw.publishedAt) : null,
      category: (raw.category as FreshnessCategory) || 'default',
      confidence: Number(raw.confidence || 0.5),
      expiresAt: String(raw.expiresAt || new Date(0).toISOString()),
    };
  } catch {
    return null;
  }
}

export interface StoreOptions {
  userId?: string;
  sources?: VerifiedSource[];
  publishedAt?: string | null;
}

export async function storeKnowledge(
  query: string,
  category: FreshnessCategory,
  content: string,
  options: StoreOptions = {}
): Promise<KnowledgeRecord> {
  const now = new Date().toISOString();
  const record: KnowledgeRecord = {
    key: topicKey(query, category),
    userId: options.userId ? String(options.userId).slice(0, 120) : 'shared',
    topic: query.slice(0, 300),
    content: content.slice(0, 8000),
    sources: (options.sources || []).slice(0, 8),
    contentHash: hashContent(content.slice(0, 2000)),
    retrievedAt: now,
    lastVerifiedAt: now,
    publishedAt: options.publishedAt || null,
    category,
    confidence: options.sources && options.sources.length
      ? options.sources.reduce((sum, s) => sum + s.credibility, 0) / options.sources.length
      : 0.5,
    expiresAt: expiresForCategory(category),
  };
  await writeRecord(record);
  return record;
}

/** Refresh a record's verification timestamp after successful re-check. */
export async function markVerified(record: KnowledgeRecord): Promise<KnowledgeRecord> {
  const refreshed: KnowledgeRecord = {
    ...record,
    lastVerifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlForCategory(record.category)).toISOString(),
  };
  await writeRecord(refreshed);
  return refreshed;
}

/** Cache invalidation: drop expired records. */
export async function invalidateExpired(): Promise<number> {
  let removed = 0;
  for (const [key, record] of memoryStore) {
    if (isExpired(record.expiresAt)) {
      memoryStore.delete(key);
      removed++;
    }
  }
  return removed;
}

export function memorySize(): number {
  return memoryStore.size;
}
