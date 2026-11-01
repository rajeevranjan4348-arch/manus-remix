/**
 * RTIE — Real-Time Intelligence Engine public entry point.
 * Backend-only module used by netlify/functions/agent.ts.
 */
export { routeQuery } from './queryRouter';
export type { RouteDecision, QueryCategory } from './types';
export { runResearch } from './orchestrator';
export { buildCitations, credibilityForUrl } from './sourceVerification';
export { isExpired, ttlForCategory } from './freshness';
export { topicKey, lookupKnowledge, storeKnowledge } from './knowledgeCache';
export { hashContent, assertSafeUrl } from './contentExtraction';
export { getConfiguredProviders } from './providers';
export type { ResearchStage, VerifiedSource } from './types';
