import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { persistentKnowledgeStore } from '../src/lib/persistentKnowledgeStore';
import { knowledgeBase } from '../src/lib/knowledgeBase';
import { routeQueryIntent } from '../server/rtie/intelligenceRouter';
import { stripInjectedContextBlocks } from '../server/geminiService';

describe('Widget removal & real-time data + knowledge integration', () => {
  beforeEach(async () => {
    await persistentKnowledgeStore.clearUserKnowledgeCache('user_alpha');
    await persistentKnowledgeStore.clearUserKnowledgeCache('user_beta');
    knowledgeBase.removeDocument('doc_alpha_1');
    knowledgeBase.removeDocument('doc_beta_1');
    knowledgeBase.removeDocument('research_user_alpha_verified_gemini_4');
  });

  it('removes the assistant model identity widget from ChatView while preserving header logo and action bar', () => {
    const chatViewSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/agent/ChatView.tsx'),
      'utf8'
    );

    expect(chatViewSource).not.toContain('assistant-model-identity');
    expect(chatViewSource).not.toContain('formatExecutionIdentityLabel');
    expect(chatViewSource).not.toContain('formatExecutionTooltip');
    expect(chatViewSource).toContain('<ManusLogo showBadge={true} />');
    expect(chatViewSource).toContain('<ConversationActionBar');
  });

  it('enables both Google Search and URL Context real-time grounding tools in geminiService', () => {
    const geminiServiceSource = fs.readFileSync(
      path.resolve(process.cwd(), 'server/geminiService.ts'),
      'utf8'
    );

    expect(geminiServiceSource).toContain('googleSearch: {}');
    expect(geminiServiceSource).toContain('urlContext: {}');
    expect(geminiServiceSource).toContain('urlContextMetadata');
  });

  it('strips injected knowledge cache and workspace RAG blocks cleanly before intent routing', () => {
    const promptWithBlocks = [
      'What is the latest NIFTY 50 level?',
      '',
      '[WORKSPACE KNOWLEDGE BASE PASSAGES]:',
      'Document "Notes": Internal note',
      '',
      '[VERIFIED RESEARCH CACHE]:',
      'Topic: NIFTY 50 live update',
    ].join('\n');

    expect(stripInjectedContextBlocks(promptWithBlocks)).toBe('What is the latest NIFTY 50 level?');
  });

  it('routes real-time queries (Gemini 4 models, live market indices, weather, URLs) to live research while skipping greetings', () => {
    const gemini4Route = routeQueryIntent('What are the capabilities of Gemini 4 and gemini-4-hydrogen?');
    expect(gemini4Route.requiresLiveResearch).toBe(true);
    expect(gemini4Route.category).toBe('ai_models');

    const marketRoute = routeQueryIntent('What is the live Nifty 50 and NASDAQ index right now?');
    expect(marketRoute.requiresLiveResearch).toBe(true);
    expect(marketRoute.category).toBe('prices_statistics');

    const weatherRoute = routeQueryIntent('Current weather in Tokyo');
    expect(weatherRoute.requiresLiveResearch).toBe(true);
    expect(weatherRoute.category).toBe('prices_statistics');

    const urlRoute = routeQueryIntent('Summarize https://ai.google.dev/gemini-api/docs/models');
    expect(urlRoute.requiresLiveResearch).toBe(true);
    expect(urlRoute.extractedEntities.targetUrls).toContain('https://ai.google.dev/gemini-api/docs/models');

    const greetingRoute = routeQueryIntent('Hello!');
    expect(greetingRoute.requiresLiveResearch).toBe(false);
  });

  it('retrieves semantically related verified research from persistentKnowledgeStore with freshness & user isolation', async () => {
    const baseTime = 1_750_000_000_000;

    await persistentKnowledgeStore.saveKnowledgeRecord({
      userId: 'user_alpha',
      query: 'Latest Gemini 4 API multimodal capabilities and pricing',
      category: 'ai_models',
      summary: 'Gemini 4 Hydrogen and Neon support native Google Search grounding, URL context, and low-latency multimodal streaming.',
      sources: [
        {
          title: 'Gemini API Models Documentation',
          url: 'https://ai.google.dev/gemini-api/docs/models',
          domain: 'ai.google.dev',
          credibilityScore: 0.98,
          provider: 'official-ai-docs',
        },
      ],
      expirationPolicyMs: 30 * 60 * 1000,
      sourceConfidence: 0.95,
      nowMs: baseTime,
    });

    await persistentKnowledgeStore.saveKnowledgeRecord({
      userId: 'user_beta',
      query: 'Secret Beta Workspace Gemini 4 rollout',
      category: 'ai_models',
      summary: 'Private beta user notes on Gemini 4 deployment.',
      sources: [
        {
          title: 'Internal Beta Doc',
          url: 'https://example.com/beta',
          credibilityScore: 0.8,
          provider: 'internal',
        },
      ],
      expirationPolicyMs: 30 * 60 * 1000,
      nowMs: baseTime,
    });

    // Rephrased query should still match user_alpha's record semantically
    const matches = await persistentKnowledgeStore.searchRelevantRecords(
      'user_alpha',
      'Tell me about Gemini 4 Hydrogen URL context and grounding',
      3,
      baseTime + 60_000
    );
    expect(matches.length).toBe(1);
    expect(matches[0].userId).toBe('user_alpha');
    expect(matches[0].summary).toContain('URL context');

    // Expired records must not be returned
    const expiredMatches = await persistentKnowledgeStore.searchRelevantRecords(
      'user_alpha',
      'Gemini 4 Hydrogen URL context',
      3,
      baseTime + 45 * 60 * 1000
    );
    expect(expiredMatches.length).toBe(0);
  });

  it('indexes workspace documents and verified research into knowledgeBase with BM25+bigram retrieval and user isolation', () => {
    knowledgeBase.indexDocument({
      documentId: 'doc_alpha_1',
      documentTitle: 'Q4 Revenue Architecture Plan',
      content: 'Our Q4 revenue forecast targets enterprise automation with real-time telemetry pipelines and Firestore checkpoints.',
      userId: 'user_alpha',
    });

    knowledgeBase.indexDocument({
      documentId: 'doc_beta_1',
      documentTitle: 'Beta Private Financials',
      content: 'Beta user Q4 revenue forecast is confidential.',
      userId: 'user_beta',
    });

    const researchChunks = knowledgeBase.indexVerifiedResearch({
      id: 'research_user_alpha_verified_gemini_4',
      query: 'Gemini 4 grounding features',
      summary: 'Gemini 4 supports Google Search grounding and URL context inspection.',
      sources: [{ title: 'Google AI Docs', url: 'https://ai.google.dev/gemini-api/docs/models' }],
      userId: 'user_alpha',
    });
    expect(researchChunks).toBeGreaterThan(0);

    const alphaResults = knowledgeBase.retrieve('Q4 revenue forecast telemetry', 'user_alpha', 3);
    expect(alphaResults.length).toBeGreaterThan(0);
    expect(alphaResults[0].chunk.documentId).toBe('doc_alpha_1');
    expect(alphaResults.every((r) => r.chunk.userId !== 'user_beta')).toBe(true);

    const researchResults = knowledgeBase.retrieve('URL context grounding Gemini', 'user_alpha', 3);
    expect(researchResults.some((r) => r.chunk.documentId === 'research_user_alpha_verified_gemini_4')).toBe(true);
    expect(knowledgeBase.getDocumentCount('user_alpha')).toBeGreaterThanOrEqual(2);
  });
});
