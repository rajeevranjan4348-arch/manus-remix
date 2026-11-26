/**
 * Knowledge Base and Semantic Retrieval (RAG) Engine for Deku AI
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
