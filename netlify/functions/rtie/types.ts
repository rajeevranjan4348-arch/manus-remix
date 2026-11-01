/**
 * Real-Time Intelligence Engine (RTIE) â shared types.
 * Backend-only. No UI dependencies.
 */

export type QueryCategory =
  | 'conversation'
  | 'calculation'
  | 'general_knowledge'
  | 'historical'
  | 'current_info'
  | 'news'
  | 'ai_models'
  | 'programming'
  | 'prices_stats'
  | 'complex_research';

export interface RouteDecision {
  category: QueryCategory;
  /** Whether the live research pipeline should run. */
  needsResearch: boolean;
  /** Whether Gemini googleSearch grounding should be enabled as an extra layer. */
  useGrounding: boolean;
  reason: string;
  /** Freshness category used for cache TTL policies. */
  freshnessCategory: FreshnessCategory;
}

export type FreshnessCategory =
  | 'news'
  | 'prices'
  | 'weather'
  | 'releases'
  | 'documentation'
  | 'stable_fact'
  | 'default';

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  publishedAt?: string | null;
  retrievedAt: string;
}

export interface ExtractedContent {
  url: string;
  title: string;
  text: string;
  publishedAt: string | null;
  extractedAt: string;
  contentHash: string;
}

export interface VerifiedSource {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  publishedAt: string | null;
  retrievedAt: string;
  lastVerifiedAt: string;
  credibility: number;
  contentHash: string;
  expiresAt: string;
}

export interface VerificationReport {
  sources: VerifiedSource[];
  conflicts: string[];
  warnings: string[];
}

export type ResearchStageName =
  | 'understanding'
  | 'searching'
  | 'reading'
  | 'verifying'
  | 'complete'
  | 'error';

export interface ResearchStage {
  stage: ResearchStageName;
  message: string;
  /** Present only on 'complete'. */
  context?: string;
  citations?: VerifiedSource[];
}

export interface KnowledgeRecord {
  key: string;
  userId: string;
  topic: string;
  content: string;
  sources: VerifiedSource[];
  contentHash: string;
  retrievedAt: string;
  lastVerifiedAt: string;
  publishedAt: string | null;
  category: FreshnessCategory;
  confidence: number;
  expiresAt: string;
}
