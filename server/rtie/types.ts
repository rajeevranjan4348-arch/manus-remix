/**
 * Real-Time Intelligence Engine (RTIE) — Core Types & Contracts
 */

export type QueryCategory =
  | 'general_knowledge'
  | 'current_information'
  | 'programming'
  | 'ai_models'
  | 'news'
  | 'prices_statistics'
  | 'complex_research';

export type ResearchStageId =
  | 'understanding_question'
  | 'searching_sources'
  | 'reading_information'
  | 'verifying_facts'
  | 'preparing_answer';

export interface ResearchProgressEvent {
  stage: ResearchStageId;
  label: string;
  detail?: string;
  timestamp: string;
}

export interface QueryRouteDecision {
  category: QueryCategory;
  requiresLiveResearch: boolean;
  confidence: number;
  reason: string;
  searchQueries: string[];
  extractedEntities: {
    githubRepo?: string;
    packageName?: string;
    packageEcosystem?: 'npm' | 'pypi';
    weatherCity?: string;
    currencyPair?: { base: string; target: string; amount: number };
    wantsCrypto?: boolean;
    targetUrls?: string[];
    programmingTopic?: string;
    aiModelTopic?: string;
  };
  freshnessTtlMs: number;
}

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  provider: string;
  publishedAt?: string;
  retrievedAt: string;
  metadata?: Record<string, unknown>;
}

export interface VerifiedSourceRecord {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  extractedContent?: string;
  provider: string;
  credibilityScore: number; // 0.0 - 1.0
  credibilityTier: 'official' | 'trusted' | 'standard' | 'low';
  publishedAt?: string;
   publicationDateVerified: boolean;
  retrievedAt: string;
  lastVerifiedAt: string;
  contentHash: string;
  expirationTimestampMs: number;
  isFresh: boolean;
}

export interface ConflictingClaim {
  topic: string;
  claimA: { value: string; sourceUrl: string; sourceTitle: string };
  claimB: { value: string; sourceUrl: string; sourceTitle: string };
  description: string;
}

export interface SourceVerificationReport {
  verifiedSources: VerifiedSourceRecord[];
  duplicatesRemoved: number;
  conflicts: ConflictingClaim[];
  unsupportedClaimsFlagged: string[];
  overallConfidence: number;
  verificationSummary: string;
}

export interface KnowledgeFreshnessRecord {
  key: string;
  query: string;
  category: QueryCategory;
  sourceUrl: string;
  retrievedAt: string;
  publishedAt?: string;
  lastVerifiedAt: string;
  contentHash: string;
  expirationPolicyMs: number;
  expiresAtMs: number;
  sourceConfidence: number;
  payload: ResearchOrchestrationResult;
}

export interface ResearchOrchestrationResult {
  query: string;
  route: QueryRouteDecision;
  fromCache: boolean;
  freshness: {
    retrievedAt: string;
    lastVerifiedAt: string;
    expiresAt: string;
    isFresh: boolean;
    contentHash: string;
  };
  verification: SourceVerificationReport;
  systemContextBlock: string;
  citationsMarkdown: string;
  sources: Array<{
    title: string;
    url: string;
    credibilityScore: number;
    publishedAt?: string;
    provider: string;
  }>;
  directFallbackMarkdown?: string;
  stagesCompleted: ResearchStageId[];
}
