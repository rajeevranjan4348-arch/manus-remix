/**
 * Knowledge Base and Semantic Retrieval (RAG) Engine for Manus AI
 * 
 * Provides document chunking, metadata indexing, BM25-style relevance scoring,
 * user-isolated queries, and citation attribution.
 */

import { observability } from './observability';

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

    observability.log({
      level: 'info',
      category: 'knowledge_base',
      message: `Indexed "${documentTitle}" into ${newChunks.length} chunks for ${userId}`,
    });

    return newChunks.length;
  }

  /**
   * Retrieve relevant passages matching query, strictly bounded by userId
   */
  public retrieve(query: string, userId: string, limit = 4): RetrievalResult[] {
    const traceId = observability.startTrace('rag_retrieve', { query, userId });
    const userChunks = this.chunks.filter(c => c.userId === userId || c.userId === 'usr_manus_default');

    if (!query.trim() || userChunks.length === 0) {
      observability.endTrace(traceId);
      return [];
    }

    const queryTerms = query
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2);

    if (queryTerms.length === 0) {
      observability.endTrace(traceId);
      return [];
    }

    const scored: RetrievalResult[] = [];

    for (const chunk of userChunks) {
      const lowerText = chunk.content.toLowerCase();
      const lowerTitle = chunk.documentTitle.toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        // Title match receives 3x weight boost
        if (lowerTitle.includes(term)) {
          score += 3.0;
        }

        // Term frequency match
        const occurrences = lowerText.split(term).length - 1;
        if (occurrences > 0) {
          score += 1.0 + Math.log(occurrences);
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
