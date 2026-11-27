/**
 * Knowledge Base and Semantic Retrieval (RAG) Engine for Deku AI
 * 
 * Provides document chunking, metadata indexing, BM25-style relevance scoring,
 * user-isolated queries, and citation attribution.
 */

import { observability } from './observability';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

export interface DocumentChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  userId: string;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
}

export interface RetrievalResult {
  chunk: DocumentChunk;
  score: number;
  citation: {
    title: string;
    snippet: string;
    documentId: string;
  };
}

const STORAGE_KEY = 'manus_rag_chunks_v1';

class KnowledgeBaseService {
  private chunks: DocumentChunk[] = [];

  constructor() {
    this.loadChunks();
  }

  /**
   * Split document text into bounded chunks with sentence-boundary respect
   */
  public chunkText(text: string, maxChunkLength = 800, overlap = 100): string[] {
    if (!text || text.length <= maxChunkLength) {
      return [text.trim()];
    }

    const chunks: string[] = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = '';

    for (const para of paragraphs) {
      if ((currentChunk + '\n\n' + para).length > maxChunkLength && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Add overlap
        const lastSentences = currentChunk.slice(-overlap);
        currentChunk = lastSentences + '\n' + para;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Index a document into the knowledge base
   */
  public indexDocument(params: {
    documentId: string;
    documentTitle: string;
    content: string;
    userId: string;
  }): number {
    const { documentId, documentTitle, content, userId } = params;

    // Remove old chunks for this document
    this.chunks = this.chunks.filter(c => c.documentId !== documentId);

    const rawChunks = this.chunkText(content);
    const newChunks: DocumentChunk[] = rawChunks.map((chunk, index) => ({
      id: `${documentId}_chunk_${index}`,
      documentId,
      documentTitle,
      userId,
      chunkIndex: index,
      content: chunk,
      tokenEstimate: Math.round(chunk.length / 4),
    }));

    this.chunks.push(...newChunks);
    this.persistChunks();

    // Non-blocking cloud vector embedding sync when authenticated in browser
    void this.syncDocumentToServerRag({
      documentId,
      title: documentTitle,
      content,
      sourceType: documentId.startsWith('research_') ? 'research' : 'document',
    }).catch(() => {});

    observability.log({
      level: 'info',
      category: 'knowledge_base',
      message: `Indexed "${documentTitle}" into ${newChunks.length} chunks for ${userId}`,
    });

    return newChunks.length;
  }

  /**
   * Explicitly index a document (Markdown, code, PDF text/base64, plain text, or session summary)
   * into both the local index and the server-side semantic vector RAG engine (/api/rag/index).
   */
  public async indexDocumentSemantic(params: {
    documentId?: string;
    documentTitle: string;
    content: string;
    userId: string;
    sourceType?: 'document' | 'file' | 'memory' | 'research' | 'session';
    mimeType?: string;
    fileName?: string;
    pdfBase64?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ localChunks: number; remoteIndexed: boolean; remoteChunks?: number; embeddingModel?: string; documentId: string }> {
    const documentId = params.documentId || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const localChunks = params.content?.trim()
      ? this.indexDocument({
          documentId,
          documentTitle: params.documentTitle,
          content: params.content,
          userId: params.userId,
        })
      : 0;

    const remote = await this.syncDocumentToServerRag({
      documentId,
      title: params.documentTitle,
      content: params.content,
      sourceType: params.sourceType || 'document',
      mimeType: params.mimeType,
      fileName: params.fileName,
      pdfBase64: params.pdfBase64,
      metadata: params.metadata,
    });

    return {
      localChunks,
      remoteIndexed: remote.indexed,
      remoteChunks: remote.chunkCount,
      embeddingModel: remote.embeddingModel,
      documentId,
    };
  }

  private async syncDocumentToServerRag(payload: {
    documentId?: string;
    title: string;
    content: string;
    sourceType?: string;
    mimeType?: string;
    fileName?: string;
    pdfBase64?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ indexed: boolean; chunkCount?: number; embeddingModel?: string }> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return { indexed: false };
    }
    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    if (!authHeader) return { indexed: false };

    try {
      const res = await fetch('/api/rag/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { indexed: false };
      const data = await res.json().catch(() => ({}));
      return {
        indexed: true,
        chunkCount: data?.document?.chunkCount,
        embeddingModel: data?.embeddingModel,
      };
    } catch {
      return { indexed: false };
    }
  }

  /**
   * Hybrid semantic + keyword retrieval combining server-side vector RAG (/api/rag/search)
   * with local BM25 passages, strictly bounded so prompts never stall.
   */
  public async retrieveHybrid(
    query: string,
    userId: string,
    options?: { limit?: number; sourceTypes?: string[]; timeoutMs?: number },
  ): Promise<RetrievalResult[]> {
    const limit = options?.limit ?? 4;
    const localResults = this.retrieve(query, userId, limit);

    if (typeof window === 'undefined' || typeof fetch === 'undefined' || !query.trim()) {
      return localResults;
    }

    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    if (!authHeader) {
      return localResults;
    }

    try {
      const res = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          query,
          limit,
          sourceTypes: options?.sourceTypes,
        }),
        signal: AbortSignal.timeout(options?.timeoutMs ?? 1800),
      });

      if (!res.ok) return localResults;
      const data = await res.json().catch(() => ({}));
      const hits = Array.isArray(data?.hits) ? data.hits : [];
      if (hits.length === 0) return localResults;

      const remoteResults: RetrievalResult[] = hits.map((hit: any, idx: number) => ({
        chunk: {
          id: String(hit.chunkId || `remote_${idx}`),
          documentId: String(hit.documentId || `remote_doc_${idx}`),
          documentTitle: String(hit.documentTitle || 'Workspace Document'),
          userId,
          chunkIndex: Number(hit.chunkIndex || 0),
          content: String(hit.content || ''),
          tokenEstimate: Math.round(String(hit.content || '').length / 4),
        },
        score: Number(hit.hybridScore || hit.semanticScore || 1) * 10,
        citation: {
          title: String(hit.documentTitle || 'Workspace Document'),
          snippet: String(hit.snippet || String(hit.content || '').slice(0, 180)),
          documentId: String(hit.documentId || ''),
        },
      }));

      // Merge remote semantic hits first, then deduplicated local hits
      const merged: RetrievalResult[] = [];
      const seen = new Set<string>();
      for (const item of [...remoteResults, ...localResults]) {
        const key = `${item.chunk.documentId}::${item.chunk.content.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= limit) break;
      }
      return merged;
    } catch {
      return localResults;
    }
  }

  /**
   * Index a verified real-time research summary and its sources into the semantic RAG store
   */
  public indexVerifiedResearch(params: {
    id?: string;
    query: string;
    summary: string;
    sources?: Array<{ title: string; url: string }>;
    userId: string;
  }): number {
    const cleanQuery = String(params.query || '').trim();
    const cleanSummary = String(params.summary || '').trim();
    if (!cleanQuery || !cleanSummary) return 0;

    const normalizedSlug = cleanQuery
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    const documentId = params.id || `research_${params.userId}_${normalizedSlug || 'entry'}`;
    const sourceLines = (params.sources || [])
      .slice(0, 6)
      .map((s) => `- ${s.title}: ${s.url}`)
      .join('\n');
    const content = [
      `Verified Research Query: ${cleanQuery}`,
      cleanSummary,
      sourceLines ? `Verified Sources:\n${sourceLines}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return this.indexDocument({
      documentId,
      documentTitle: `Verified Research: ${cleanQuery.slice(0, 90)}`,
      content,
      userId: params.userId,
    });
  }

  /**
   * List indexed documents for a user (deduplicated by documentId)
   */
  public listDocuments(userId: string): Array<{ documentId: string; documentTitle: string; chunkCount: number }> {
    const map = new Map<string, { documentId: string; documentTitle: string; chunkCount: number }>();
    for (const chunk of this.chunks) {
      if (chunk.userId !== userId && chunk.userId !== 'usr_manus_default') continue;
      const existing = map.get(chunk.documentId);
      if (existing) {
        existing.chunkCount += 1;
      } else {
        map.set(chunk.documentId, {
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          chunkCount: 1,
        });
      }
    }
    return Array.from(map.values());
  }

  public getDocumentCount(userId: string): number {
    return this.listDocuments(userId).length;
  }

  /**
   * Retrieve relevant passages matching query using BM25-style length normalization + bigram boost,
   * strictly bounded by userId
   */
  public retrieve(query: string, userId: string, limit = 4): RetrievalResult[] {
    const traceId = observability.startTrace('rag_retrieve', { query, userId });
    const userChunks = this.chunks.filter(c => c.userId === userId || c.userId === 'usr_manus_default');

    if (!query.trim() || userChunks.length === 0) {
      observability.endTrace(traceId);
      return [];
    }

    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'what', 'when',
      'where', 'which', 'about', 'into', 'your', 'will', 'would', 'could', 'should',
      'there', 'their', 'they', 'them', 'been', 'being', 'more', 'most', 'some',
    ]);

    const rawTerms = query
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopWords.has(t));

    const queryTerms = Array.from(new Set(rawTerms));

    if (queryTerms.length === 0) {
      observability.endTrace(traceId);
      return [];
    }

    const bigrams: string[] = [];
    for (let i = 0; i < rawTerms.length - 1; i++) {
      bigrams.push(`${rawTerms[i]} ${rawTerms[i + 1]}`);
    }

    const avgChunkLen = Math.max(
      120,
      userChunks.reduce((sum, c) => sum + c.content.length, 0) / userChunks.length
    );
    const k1 = 1.5;
    const b = 0.75;

    // Document frequency per term for IDF weighting
    const dfMap = new Map<string, number>();
    for (const term of queryTerms) {
      let df = 0;
      for (const chunk of userChunks) {
        if (chunk.content.toLowerCase().includes(term) || chunk.documentTitle.toLowerCase().includes(term)) {
          df += 1;
        }
      }
      dfMap.set(term, df);
    }

    const totalDocs = userChunks.length;
    const scored: RetrievalResult[] = [];

    for (const chunk of userChunks) {
      const lowerText = chunk.content.toLowerCase();
      const lowerTitle = chunk.documentTitle.toLowerCase();
      const lenNorm = 1 - b + b * (chunk.content.length / avgChunkLen);
      let score = 0;

      for (const term of queryTerms) {
        const df = dfMap.get(term) || 0;
        const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

        // Title match receives 3x weight boost
        if (lowerTitle.includes(term)) {
          score += 3.0 * Math.max(1, idf);
        }

        // BM25-style TF saturation with length damping
        const tf = lowerText.split(term).length - 1;
        if (tf > 0) {
          score += ((tf * (k1 + 1)) / (tf + k1 * lenNorm)) * Math.max(0.75, idf);
        }
      }

      // Phrase / bigram proximity boost
      for (const bigram of bigrams) {
        if (lowerTitle.includes(bigram)) {
          score += 4.0;
        } else if (lowerText.includes(bigram)) {
          score += 2.2;
        }
      }

      if (score > 0) {
        scored.push({
          chunk,
          score,
          citation: {
            title: chunk.documentTitle,
            snippet: chunk.content.slice(0, 180) + '...',
            documentId: chunk.documentId,
          },
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    observability.endTrace(traceId, { matchedCount: results.length });
    return results;
  }

  /**
   * Delete document chunks
   */
  public removeDocument(documentId: string): void {
    this.chunks = this.chunks.filter(c => c.documentId !== documentId);
    this.persistChunks();
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      void getFirebaseAuthorizationHeader()
        .then((authHeader) => {
          if (!authHeader) return;
          return fetch('/api/rag/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            body: JSON.stringify({ documentId }),
          });
        })
        .catch(() => {});
    }
  }

  private persistChunks() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.chunks.slice(-200)));
    } catch {}
  }

  private loadChunks() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.chunks = parsed;
      }
    } catch {}
  }
}

export const knowledgeBase = new KnowledgeBaseService();
