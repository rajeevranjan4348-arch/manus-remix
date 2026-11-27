/**
 * Semantic Vector Memory & Document RAG Engine
 *
 * Provides:
 * - Format-aware document chunking for Markdown (heading-aware), Source Code (symbol/block-aware),
 *   PDF (extracted/raw text normalization + page-marker preservation), and plain text.
 * - Real server-side vector embeddings via Google GenAI SDK (`gemini-embedding-2`).
 * - Hybrid retrieval combining dense cosine similarity + BM25 lexical relevance via
 *   Reciprocal Rank Fusion (RRF), strictly isolated per userId.
 * - Durable persistence via DurableCollectionStore (`vector_documents` & `vector_chunks`).
 */

import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from '../infrastructure/durableCollectionStore';
import type { DurableRequestContext, PersistenceMode } from '../sandbox/durableStore';
import { defaultLiveSyncHub, type LiveSyncHub } from '../realtime/liveSyncHub';

export type RagDocumentFormat = 'markdown' | 'code' | 'pdf' | 'text' | 'auto';
export type RagSourceType = 'document' | 'memory' | 'session' | 'project_file' | 'research';

export interface VectorDocumentRecord {
  documentId: string;
  userId: string;
  title: string;
  sourceType: RagSourceType;
  format: Exclude<RagDocumentFormat, 'auto'>;
  chunkCount: number;
  totalChars: number;
  embeddingModel: string;
  embeddingMode: 'gemini-embedding-2' | 'lexical-fallback';
  contentHash: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VectorChunkRecord {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  userId: string;
  sourceType: RagSourceType;
  format: Exclude<RagDocumentFormat, 'auto'>;
  chunkIndex: number;
  heading?: string;
  pageNumber?: number;
  content: string;
  tokenEstimate: number;
  embedding?: number[];
  embeddingModel: string;
  createdAt: string;
}

export interface HybridSearchHit {
  chunk: Omit<VectorChunkRecord, 'embedding'>;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  matchMode: 'hybrid' | 'semantic' | 'lexical';
  citation: {
    documentId: string;
    title: string;
    snippet: string;
    sourceType: RagSourceType;
    heading?: string;
    pageNumber?: number;
  };
}

export interface EmbeddingProvider {
  readonly modelName: string;
  isConfigured(): boolean;
  embedTexts(texts: string[]): Promise<{
    vectors: number[][] | null;
    mode: 'gemini-embedding-2' | 'lexical-fallback';
    model: string;
  }>;
}

export class SemanticRagError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'RAG_ERROR', statusCode = 400) {
    super(message);
    this.name = 'SemanticRagError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DOCS_COLLECTION = 'vector_documents';
const CHUNKS_COLLECTION = 'vector_chunks';

const RAG_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'what', 'when',
  'where', 'which', 'about', 'into', 'your', 'will', 'would', 'could', 'should',
  'there', 'their', 'they', 'them', 'been', 'being', 'more', 'most', 'some',
  'are', 'was', 'were', 'has', 'had', 'not', 'but', 'can', 'how', 'who', 'why',
]);

export function l2Normalize(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (!Number.isFinite(norm) || norm <= 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denom) || denom <= 0) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

/**
 * Detect document format from filename/title and content heuristics.
 */
export function detectDocumentFormat(
  content: string,
  title = '',
  explicitFormat: RagDocumentFormat = 'auto',
): Exclude<RagDocumentFormat, 'auto'> {
  if (explicitFormat && explicitFormat !== 'auto') return explicitFormat;
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.endsWith('.pdf') || content.startsWith('%PDF-')) return 'pdf';
  if (lowerTitle.endsWith('.md') || lowerTitle.endsWith('.mdx') || /^#{1,6}\s+.+/m.test(content)) {
    return 'markdown';
  }
  if (
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cpp|c|cs|rb|php|sql|sh|yaml|yml|json)$/i.test(lowerTitle) ||
    /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|def|import|from)\s+/m.test(content)
  ) {
    return 'code';
  }
  return 'text';
}

/**
 * Cleanly extract readable text from raw PDF text streams or normalize pre-extracted PDF text.
 */
export function extractTextFromPdfPayload(rawContent: string): string {
  const input = String(rawContent || '');
  if (!input.startsWith('%PDF-')) {
    return input
      .replace(/\r\n/g, '\n')
      .replace(/-\n([a-z])/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Extract printable text inside PDF BT...ET / (...) Tj / [...] TJ operators when raw PDF source is uploaded
  const extractedParts: string[] = [];
  const tjMatches = input.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g);
  for (const m of tjMatches) {
    const unescaped = m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (unescaped.trim()) extractedParts.push(unescaped);
  }

  const tjArrayMatches = input.matchAll(/\[([^\]]+)\]\s*TJ/g);
  for (const m of tjArrayMatches) {
    const innerStrings = m[1].matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g);
    const line: string[] = [];
    for (const s of innerStrings) {
      line.push(
        s[1]
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\'),
      );
    }
    if (line.length > 0) extractedParts.push(line.join(''));
  }

  const joined = extractedParts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (joined.length >= 20) return joined;

  // Fallback: extract readable ASCII runs excluding PDF binary headers
  const fallback = input
    .replace(/%PDF-[\d.]+/g, ' ')
    .replace(/[^\x20-\x7E\n\t]/g, ' ')
    .replace(/\b(?:obj|endobj|stream|endstream|xref|trailer|startxref)\b/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return fallback;
}

export interface ChunkSegment {
  content: string;
  heading?: string;
  pageNumber?: number;
}

/**
 * Format-aware intelligent document chunker supporting Markdown, Source Code, PDF, and Plain Text.
 */
export function chunkDocumentContent(params: {
  content: string;
  title?: string;
  format?: RagDocumentFormat;
  maxChunkChars?: number;
  overlapChars?: number;
}): { format: Exclude<RagDocumentFormat, 'auto'>; chunks: ChunkSegment[] } {
  const maxChunkChars = Math.min(2400, Math.max(200, params.maxChunkChars ?? 900));
  const overlapChars = Math.min(Math.floor(maxChunkChars / 3), Math.max(0, params.overlapChars ?? 120));
  const format = detectDocumentFormat(params.content, params.title, params.format ?? 'auto');

  const normalized =
    format === 'pdf'
      ? extractTextFromPdfPayload(params.content)
      : String(params.content || '').replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    return { format, chunks: [] };
  }

  const splitOversized = (text: string, heading?: string, pageNumber?: number): ChunkSegment[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.length <= maxChunkChars) {
      return [{ content: trimmed, heading, pageNumber }];
    }
    const out: ChunkSegment[] = [];
    const step = Math.max(100, maxChunkChars - overlapChars);
    let cursor = 0;
    while (cursor < trimmed.length) {
      let end = Math.min(trimmed.length, cursor + maxChunkChars);
      if (end < trimmed.length) {
        // Snap to clean sentence or newline boundary when possible
        const windowSlice = trimmed.slice(cursor, end);
        const lastBreak = Math.max(
          windowSlice.lastIndexOf('\n\n'),
          windowSlice.lastIndexOf('. '),
          windowSlice.lastIndexOf('\n'),
        );
        if (lastBreak > Math.floor(maxChunkChars * 0.45)) {
          end = cursor + lastBreak + 1;
        }
      }
      const slice = trimmed.slice(cursor, end).trim();
      if (slice) {
        out.push({ content: slice, heading, pageNumber });
      }
      if (end >= trimmed.length) break;
      cursor = Math.max(cursor + 1, end - overlapChars);
      if (cursor >= trimmed.length) break;
      if (out.length >= 120) break; // safety cap per document
      if (cursor === end) cursor += step;
    }
    return out;
  };

  // 1. Markdown: split along headings while keeping section hierarchy context
  if (format === 'markdown') {
    const lines = normalized.split('\n');
    const sections: Array<{ heading?: string; body: string }> = [];
    let currentHeading: string | undefined;
    let currentLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (headingMatch) {
        if (currentLines.join('\n').trim()) {
          sections.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
        }
        currentHeading = headingMatch[2].trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }
    if (currentLines.join('\n').trim()) {
      sections.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
    }

    const chunks: ChunkSegment[] = [];
    for (const sec of sections) {
      chunks.push(...splitOversized(sec.body, sec.heading));
    }
    return { format, chunks };
  }

  // 2. Source code: split on top-level function / class / interface / export / def declarations
  if (format === 'code') {
    const lines = normalized.split('\n');
    const blocks: Array<{ symbol?: string; body: string }> = [];
    let currentSymbol: string | undefined;
    let currentLines: string[] = [];
    const declRegex =
      /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|interface|type|enum|def|struct|fn)\s+([a-zA-Z0-9_$]+)/;
    const constFnRegex = /^(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(|function\b)/;

    for (const line of lines) {
      const m = line.match(declRegex) || line.match(constFnRegex);
      if (m && currentLines.join('\n').trim().length >= 80) {
        blocks.push({ symbol: currentSymbol, body: currentLines.join('\n').trim() });
        currentSymbol = m[1];
        currentLines = [line];
      } else {
        if (m && !currentSymbol) currentSymbol = m[1];
        currentLines.push(line);
      }
    }
    if (currentLines.join('\n').trim()) {
      blocks.push({ symbol: currentSymbol, body: currentLines.join('\n').trim() });
    }

    const chunks: ChunkSegment[] = [];
    for (const blk of blocks) {
      chunks.push(...splitOversized(blk.body, blk.symbol));
    }
    return { format, chunks };
  }

  // 3. PDF: respect form-feed or "--- Page N ---" markers
  if (format === 'pdf') {
    const pages = normalized.split(/\f|\n?---\s*Page\s+\d+\s*---\n?/i).filter((p) => p.trim().length > 0);
    const chunks: ChunkSegment[] = [];
    pages.forEach((pageText, idx) => {
      chunks.push(...splitOversized(pageText, `Page ${idx + 1}`, idx + 1));
    });
    return { format, chunks };
  }

  // 4. Plain text: paragraph-grouped sliding window
  const paragraphs = normalized.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: ChunkSegment[] = [];
  let buffer = '';
  for (const para of paragraphs) {
    if (buffer && buffer.length + para.length + 2 > maxChunkChars) {
      chunks.push(...splitOversized(buffer));
      const tail = overlapChars > 0 ? buffer.slice(-overlapChars) : '';
      buffer = tail ? `${tail}\n${para}` : para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer.trim()) {
    chunks.push(...splitOversized(buffer));
  }
  return { format, chunks };
}

/**
 * Default server-side Gemini Embedding provider using `gemini-embedding-2` via `@google/genai`.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly modelName: string;

  constructor(modelName?: string) {
    this.modelName = (modelName || process.env.RAG_EMBEDDING_MODEL || 'gemini-embedding-2').trim();
  }

  public isConfigured(): boolean {
    return Boolean((process.env.GEMINI_API_KEY || '').trim());
  }

  public async embedTexts(texts: string[]): Promise<{
    vectors: number[][] | null;
    mode: 'gemini-embedding-2' | 'lexical-fallback';
    model: string;
  }> {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || texts.length === 0) {
      return { vectors: null, mode: 'lexical-fallback', model: 'bm25-lexical' };
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const vectors: number[][] = [];
      const batchSize = 16;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 8000));
        const res = await ai.models.embedContent({
          model: this.modelName,
          contents: batch,
        });
        const embeddings = res?.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
          return { vectors: null, mode: 'lexical-fallback', model: 'bm25-lexical' };
        }
        for (const emb of embeddings) {
          const values = Array.isArray(emb?.values) ? emb.values.map(Number) : null;
          if (!values || values.length === 0) {
            return { vectors: null, mode: 'lexical-fallback', model: 'bm25-lexical' };
          }
          vectors.push(l2Normalize(values));
        }
      }

      return { vectors, mode: 'gemini-embedding-2', model: this.modelName };
    } catch {
      return { vectors: null, mode: 'lexical-fallback', model: 'bm25-lexical' };
    }
  }
}

export interface SemanticRagEngineOptions {
  store?: DurableCollectionStore;
  embeddingProvider?: EmbeddingProvider;
  syncHub?: LiveSyncHub;
}

export class SemanticRagEngine {
  private readonly store: DurableCollectionStore;
  private readonly embedder: EmbeddingProvider;
  private readonly syncHub: LiveSyncHub;

  constructor(options?: SemanticRagEngineOptions) {
    this.store = options?.store ?? defaultCollectionStore;
    this.embedder = options?.embeddingProvider ?? new GeminiEmbeddingProvider();
    this.syncHub = options?.syncHub ?? defaultLiveSyncHub;
  }

  public getHealth(ctx?: DurableRequestContext): {
    persistenceMode: PersistenceMode;
    embeddingModel: string;
    embeddingConfigured: boolean;
    supportedFormats: Array<Exclude<RagDocumentFormat, 'auto'>>;
  } {
    return {
      persistenceMode: this.store.getMode(ctx),
      embeddingModel: this.embedder.modelName,
      embeddingConfigured: this.embedder.isConfigured(),
      supportedFormats: ['markdown', 'code', 'pdf', 'text'],
    };
  }

  /**
   * Chunk, embed, and durably index a document, memory, project file, or past session for a user.
   */
  public async indexDocument(
    ctx: DurableRequestContext,
    input: {
      documentId?: string;
      title: string;
      content: string;
      sourceType?: RagSourceType;
      format?: RagDocumentFormat;
      maxChunkChars?: number;
      overlapChars?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{
    document: VectorDocumentRecord;
    chunksIndexed: number;
    embeddingMode: 'gemini-embedding-2' | 'lexical-fallback';
  }> {
    const title = String(input.title || '').trim().slice(0, 200);
    const rawContent = String(input.content || '');
    if (!title || !rawContent.trim()) {
      throw new SemanticRagError('title and non-empty content are required.', 'INVALID_RAG_INPUT', 400);
    }

    const sourceType: RagSourceType = input.sourceType || 'document';
    const rawDocId = (input.documentId || `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 100);

    const { format, chunks } = chunkDocumentContent({
      content: rawContent,
      title,
      format: input.format ?? 'auto',
      maxChunkChars: input.maxChunkChars,
      overlapChars: input.overlapChars,
    });

    if (chunks.length === 0) {
      throw new SemanticRagError('Document produced no indexable text content.', 'EMPTY_DOCUMENT', 400);
    }

    // Remove previous chunks for this documentId so re-indexing stays clean
    await this.deleteDocumentChunks(ctx, rawDocId);

    // Generate embeddings via server-side Gemini Embedding 2 (or explicit lexical fallback)
    const textsForEmbedding = chunks.map((c) =>
      c.heading ? `${title}\nSection: ${c.heading}\n${c.content}` : `${title}\n${c.content}`,
    );
    const embRes = await this.embedder.embedTexts(textsForEmbedding);

    const nowIso = new Date().toISOString();
    const contentHash = crypto.createHash('sha256').update(rawContent).digest('hex').slice(0, 32);

    const chunkRecords: VectorChunkRecord[] = chunks.map((seg, idx) => ({
      chunkId: `${rawDocId}_c_${idx}`,
      documentId: rawDocId,
      documentTitle: title,
      userId: ctx.userId,
      sourceType,
      format,
      chunkIndex: idx,
      heading: seg.heading,
      pageNumber: seg.pageNumber,
      content: seg.content,
      tokenEstimate: Math.max(1, Math.ceil(seg.content.length / 4)),
      embedding: embRes.vectors ? embRes.vectors[idx] : undefined,
      embeddingModel: embRes.model,
      createdAt: nowIso,
    }));

    for (const chunk of chunkRecords) {
      await this.store.put(ctx, CHUNKS_COLLECTION, chunk.chunkId, chunk);
    }

    const docRecord: VectorDocumentRecord = {
      documentId: rawDocId,
      userId: ctx.userId,
      title,
      sourceType,
      format,
      chunkCount: chunkRecords.length,
      totalChars: rawContent.length,
      embeddingModel: embRes.model,
      embeddingMode: embRes.mode,
      contentHash,
      metadata: input.metadata,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.put(ctx, DOCS_COLLECTION, rawDocId, docRecord);

    void this.syncHub.publish(ctx, {
      type: 'rag:indexed',
      title: `Indexed "${title}"`,
      message: `Indexed ${chunkRecords.length} ${format} chunk(s) (${embRes.mode}).`,
      resourceId: rawDocId,
      severity: 'info',
      notifyUser: false,
      persist: false,
      data: { documentId: rawDocId, chunkCount: chunkRecords.length, format, sourceType },
    });

    return {
      document: docRecord,
      chunksIndexed: chunkRecords.length,
      embeddingMode: embRes.mode,
    };
  }

  public async listDocuments(
    ctx: DurableRequestContext,
    options?: { sourceType?: RagSourceType; limit?: number },
  ): Promise<VectorDocumentRecord[]> {
    const limit = Math.min(200, Math.max(1, options?.limit ?? 100));
    const docs = await this.store.list<VectorDocumentRecord>(ctx, DOCS_COLLECTION, 200);
    return docs
      .filter((d) => d.userId === ctx.userId && (!options?.sourceType || d.sourceType === options.sourceType))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  private async deleteDocumentChunks(ctx: DurableRequestContext, documentId: string): Promise<number> {
    const existingChunks = await this.store.list<VectorChunkRecord>(ctx, CHUNKS_COLLECTION, 500);
    const matching = existingChunks.filter((c) => c.userId === ctx.userId && c.documentId === documentId);
    for (const chunk of matching) {
      await this.store.delete(ctx, CHUNKS_COLLECTION, chunk.chunkId);
    }
    return matching.length;
  }

  public async deleteDocument(
    ctx: DurableRequestContext,
    documentId: string,
  ): Promise<{ deleted: boolean; chunksRemoved: number }> {
    const existing = await this.store.get<VectorDocumentRecord>(ctx, DOCS_COLLECTION, documentId);
    const chunksRemoved = await this.deleteDocumentChunks(ctx, documentId);
    if (!existing || existing.userId !== ctx.userId) {
      return { deleted: chunksRemoved > 0, chunksRemoved };
    }
    await this.store.delete(ctx, DOCS_COLLECTION, documentId);
    return { deleted: true, chunksRemoved };
  }

  /**
   * Direct server-side embedding endpoint helper for callers needing raw vectors.
   */
  public async embedTexts(texts: string[]): Promise<{
    vectors: number[][] | null;
    mode: 'gemini-embedding-2' | 'lexical-fallback';
    model: string;
  }> {
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 32) {
      throw new SemanticRagError('texts must be a non-empty array of at most 32 strings.', 'INVALID_EMBED_INPUT', 400);
    }
    return this.embedder.embedTexts(texts.map((t) => String(t || '').slice(0, 8000)));
  }

  /**
   * Hybrid Semantic (Cosine Similarity) + Keyword (BM25) Retrieval fused via Reciprocal Rank Fusion (RRF).
   */
  public async hybridSearch(
    ctx: DurableRequestContext,
    input: {
      query: string;
      limit?: number;
      sourceTypes?: RagSourceType[];
      documentId?: string;
      minScore?: number;
    },
  ): Promise<{
    hits: HybridSearchHit[];
    embeddingMode: 'gemini-embedding-2' | 'lexical-fallback';
    totalChunksEvaluated: number;
  }> {
    const query = String(input.query || '').trim();
    const limit = Math.min(20, Math.max(1, input.limit ?? 6));
    if (!query) {
      return { hits: [], embeddingMode: 'lexical-fallback', totalChunksEvaluated: 0 };
    }

    const allUserChunks = await this.store.list<VectorChunkRecord>(ctx, CHUNKS_COLLECTION, 500);
    const candidates = allUserChunks.filter((c) => {
      if (c.userId !== ctx.userId) return false;
      if (input.documentId && c.documentId !== input.documentId) return false;
      if (input.sourceTypes && input.sourceTypes.length > 0 && !input.sourceTypes.includes(c.sourceType)) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      return {
        hits: [],
        embeddingMode: this.embedder.isConfigured() ? 'gemini-embedding-2' : 'lexical-fallback',
        totalChunksEvaluated: 0,
      };
    }

    // 1. Compute dense semantic scores if chunks have embeddings and query can be embedded
    const hasEmbeddedChunks = candidates.some((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
    let queryEmbedding: number[] | null = null;
    let embeddingMode: 'gemini-embedding-2' | 'lexical-fallback' = 'lexical-fallback';

    if (hasEmbeddedChunks) {
      const embRes = await this.embedder.embedTexts([query]);
      if (embRes.vectors && embRes.vectors[0]) {
        queryEmbedding = embRes.vectors[0];
        embeddingMode = embRes.mode;
      }
    }

    const semanticScores = new Map<string, number>();
    if (queryEmbedding) {
      for (const chunk of candidates) {
        if (chunk.embedding && chunk.embedding.length === queryEmbedding.length) {
          const sim = cosineSimilarity(queryEmbedding, chunk.embedding);
          if (sim > 0.15) {
            semanticScores.set(chunk.chunkId, sim);
          }
        }
      }
    }

    // 2. Compute BM25 lexical scores with IDF + title/heading boost + bigram boost
    const rawTerms = query
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !RAG_STOP_WORDS.has(t));
    const uniqueTerms = Array.from(new Set(rawTerms));
    const bigrams: string[] = [];
    for (let i = 0; i < rawTerms.length - 1; i++) {
      bigrams.push(`${rawTerms[i]} ${rawTerms[i + 1]}`);
    }

    const avgLen = Math.max(
      120,
      candidates.reduce((sum, c) => sum + c.content.length, 0) / candidates.length,
    );
    const k1 = 1.5;
    const b = 0.75;
    const dfMap = new Map<string, number>();
    for (const term of uniqueTerms) {
      let df = 0;
      for (const c of candidates) {
        const hay = `${c.documentTitle} ${c.heading || ''} ${c.content}`.toLowerCase();
        if (hay.includes(term)) df += 1;
      }
      dfMap.set(term, df);
    }

    const lexicalScores = new Map<string, number>();
    for (const chunk of candidates) {
      const lowerContent = chunk.content.toLowerCase();
      const lowerTitle = `${chunk.documentTitle} ${chunk.heading || ''}`.toLowerCase();
      const lenNorm = 1 - b + b * (chunk.content.length / avgLen);
      let bm25 = 0;

      for (const term of uniqueTerms) {
        const df = dfMap.get(term) || 0;
        const idf = Math.log(1 + (candidates.length - df + 0.5) / (df + 0.5));
        if (lowerTitle.includes(term)) {
          bm25 += 2.8 * Math.max(0.9, idf);
        }
        const tf = lowerContent.split(term).length - 1;
        if (tf > 0) {
          bm25 += ((tf * (k1 + 1)) / (tf + k1 * lenNorm)) * Math.max(0.7, idf);
        }
      }
      for (const bg of bigrams) {
        if (lowerTitle.includes(bg)) bm25 += 3.2;
        else if (lowerContent.includes(bg)) bm25 += 1.8;
      }
      if (bm25 > 0) {
        lexicalScores.set(chunk.chunkId, bm25);
      }
    }

    // 3. Fuse dense & lexical rankings using Reciprocal Rank Fusion (RRF, k = 60) + weighted blend
    const semanticRanked = Array.from(semanticScores.entries()).sort((a, b) => b[1] - a[1]);
    const lexicalRanked = Array.from(lexicalScores.entries()).sort((a, b) => b[1] - a[1]);

    const semRankMap = new Map<string, number>();
    semanticRanked.forEach(([id], idx) => semRankMap.set(id, idx + 1));

    const lexRankMap = new Map<string, number>();
    lexicalRanked.forEach(([id], idx) => lexRankMap.set(id, idx + 1));

    const rrfK = 60;
    const minScore = input.minScore ?? 0.005;
    const hits: HybridSearchHit[] = [];

    for (const chunk of candidates) {
      const sem = semanticScores.get(chunk.chunkId) ?? 0;
      const lex = lexicalScores.get(chunk.chunkId) ?? 0;
      if (sem <= 0 && lex <= 0) continue;

      const semRank = semRankMap.get(chunk.chunkId);
      const lexRank = lexRankMap.get(chunk.chunkId);

      // Weighted RRF gives dense semantic matches slightly higher authority while preserving exact keyword hits
      const rrfScore =
        (semRank ? 1.35 / (rrfK + semRank) : 0) +
        (lexRank ? 1.0 / (rrfK + lexRank) : 0);

      // Blend raw cosine signal so clearly stronger semantic matches separate cleanly
      const combinedScore = Number((rrfScore + sem * 0.25 + Math.min(0.25, lex * 0.015)).toFixed(6));
      if (combinedScore < minScore) continue;

      const { embedding: _omitEmbedding, ...publicChunk } = chunk;
      hits.push({
        chunk: publicChunk,
        score: combinedScore,
        semanticScore: Number(sem.toFixed(4)),
        lexicalScore: Number(lex.toFixed(4)),
        matchMode: sem > 0 && lex > 0 ? 'hybrid' : sem > 0 ? 'semantic' : 'lexical',
        citation: {
          documentId: chunk.documentId,
          title: chunk.documentTitle,
          snippet: chunk.content.slice(0, 220) + (chunk.content.length > 220 ? '...' : ''),
          sourceType: chunk.sourceType,
          heading: chunk.heading,
          pageNumber: chunk.pageNumber,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);

    return {
      hits: hits.slice(0, limit),
      embeddingMode,
      totalChunksEvaluated: candidates.length,
    };
  }
}

export const defaultSemanticRagEngine = new SemanticRagEngine();
