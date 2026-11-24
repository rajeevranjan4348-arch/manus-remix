import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sanitizeReasoningSummary } from '../src/components/agent/ThoughtProcess';
import {
  isMeaningfulExternalSourceUrl,
  parseSourcesFromMarkdown,
  resolveMessageSourcesAndQueries,
} from '../src/components/agent/SourceCitations';
import {
  buildModelIdentityInstruction,
  generateResilientResponse,
  needsLiveSearch,
  streamOpenRouterResponse,
} from '../server/geminiService';
import {
  createResponseModelMetadataTracker,
  formatResponseModelMetadata,
  mergeResponseModelMetadata,
  normalizeResponseModelMetadata,
} from '../src/lib/responseModelMetadata';

describe('Response UI & Functionality Fixes (Global Audit)', () => {
  describe('1. Single Action Toolbar (No Duplicate Action Buttons)', () => {
    it('renders only ConversationActionBar per assistant message in ChatView and MyAIChat without duplicate MessageHoverReactions', () => {
      const chatViewSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/agent/ChatView.tsx'),
        'utf-8'
      );
      const myAiChatSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/chat/MyAIChat.tsx'),
        'utf-8'
      );
      const actionBarSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/agent/ConversationActionBar.tsx'),
        'utf-8'
      );

      // ChatView must not import or render MessageHoverReactions alongside ConversationActionBar
      expect(chatViewSource).not.toContain('MessageHoverReactions');
      const chatViewActionBarMatches = chatViewSource.match(/<ConversationActionBar\b/g) || [];
      expect(chatViewActionBarMatches.length).toBe(1);

      // MyAIChat must use ConversationActionBar and not render duplicate MessageHoverReactions
      expect(myAiChatSource).not.toContain('MessageHoverReactions');
      const myAiActionBarMatches = myAiChatSource.match(/<ConversationActionBar\b/g) || [];
      expect(myAiActionBarMatches.length).toBe(1);

      // ConversationActionBar provides Copy, Like, Dislike, Speaker, Share, and More buttons
      expect(actionBarSource).toContain('data-testid="conversation-action-bar"');
      expect(actionBarSource).toContain('data-testid="action-bar-copy"');
      expect(actionBarSource).toContain('data-testid="action-bar-like"');
      expect(actionBarSource).toContain('data-testid="action-bar-dislike"');
      expect(actionBarSource).toContain('data-testid="action-bar-speaker"');
      expect(actionBarSource).toContain('data-testid="action-bar-share"');
      expect(actionBarSource).toContain('data-testid="action-bar-more"');
    });
  });

  describe('2. Backend-confirmed response model metadata', () => {
    it('formats only confirmed metadata and falls back when model identity is missing', () => {
      expect(normalizeResponseModelMetadata({ modelId: '  runtime-model-7  ', provider: ' Provider A ' }))
        .toEqual({ modelId: 'runtime-model-7', provider: 'Provider A' });
      expect(formatResponseModelMetadata({ modelId: 'runtime-model-7', provider: 'Provider A' }))
        .toBe('Model: runtime-model-7 · Provider: Provider A');
      expect(formatResponseModelMetadata({ provider: 'Provider A' }))
        .toBe('Model information unavailable · Provider: Provider A');
      expect(formatResponseModelMetadata(undefined)).toBe('Model information unavailable');
      expect(normalizeResponseModelMetadata({ modelId: '  ', provider: 17 })).toBeNull();
      expect(mergeResponseModelMetadata({ provider: 'Provider A' }, { modelId: 'runtime-model-7' }))
        .toEqual({ modelId: 'runtime-model-7', provider: 'Provider A' });
    });

    it('holds metadata from non-text chunks until response content exists, then emits it once', () => {
      const tracker = createResponseModelMetadataTracker();
      expect(tracker.observe({ modelId: 'runtime-model-7', provider: 'Provider A' }, false)).toBeNull();
      expect(tracker.observe(undefined, true)).toEqual({ modelId: 'runtime-model-7', provider: 'Provider A' });
      expect(tracker.observe({ modelId: 'runtime-model-7', provider: 'Provider A' }, true)).toBeNull();
      expect(tracker.observe({ modelId: 'runtime-model-8' }, true)).toEqual({ modelId: 'runtime-model-8', provider: 'Provider A' });
    });

    it('forwards OpenRouter metadata from a non-text chunk when the following text chunk omits model identity', async () => {
      const streamBody = [
        `data: ${JSON.stringify({ model: 'runtime-model-7', provider: 'Provider A', choices: [{ delta: { role: 'assistant' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}`,
        'data: [DONE]',
        '',
      ].join('\n');
      const fetchMock = vi.fn().mockResolvedValue(new Response(streamBody, {
        headers: { 'Content-Type': 'text/event-stream' },
      }));
      const responseMetadata: { modelId?: string; provider?: string }[] = [];
      const deltas: string[] = [];

      vi.stubGlobal('fetch', fetchMock);
      try {
        for await (const delta of streamOpenRouterResponse({
          messages: [{ role: 'user', content: 'Hello' }],
          onResponseMetadata: (metadata) => responseMetadata.push(metadata),
        }, 'test-key')) {
          deltas.push(delta);
        }
      } finally {
        vi.unstubAllGlobals();
      }

      expect(deltas.join('')).toBe('Hello');
      expect(responseMetadata).toEqual([{ modelId: 'runtime-model-7', provider: 'Provider A' }]);
    });

    it('passes stream metadata from backend responses through both chat paths and persists it with assistant messages', () => {
      const readSource = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf-8');
      const backend = readSource('server/geminiService.ts');
      const netlify = readSource('netlify/functions/agent.ts');
      const vite = readSource('vite.config.ts');
      const streamAdapter = readSource('src/lib/blink.ts');
      const hook = readSource('src/hooks/useAgentTask.ts');
      const chatView = readSource('src/components/agent/ChatView.tsx');
      const myAIChat = readSource('src/components/chat/MyAIChat.tsx');

      expect(backend).toContain('modelId: chunk?.modelVersion');
      expect(backend).toContain('responseMetadataTracker.observe');
      expect(backend).toContain('options.onResponseMetadata?.(responseMetadata)');
      expect(netlify).toContain("type: 'response-metadata'");
      expect(netlify).toContain('responseModelTracker.observe');
      expect(vite).toContain("type: 'response-metadata'");
      expect(streamAdapter).toContain("emitWindowEvent('manus_stream_metadata'");
      expect(hook).toContain("window.addEventListener('manus_stream_metadata'");
      expect(hook).toContain('metadata: assistantMsg.metadata');
      expect(chatView).toContain('formatResponseModelMetadata(msg.metadata?.responseModel)');
      expect(myAIChat).toContain('formatResponseModelMetadata(msg.responseModel)');
      expect(myAIChat).toContain("parsed.type === 'response-metadata'");
    });

    it('does not trigger live web search for model identity questions', () => {
      expect(needsLiveSearch('Which model are you')).toBe(false);
      expect(needsLiveSearch('What LLM model are you running on?')).toBe(false);
      expect(buildModelIdentityInstruction()).toContain('Do not infer or claim a specific underlying model ID or provider');
      expect(generateResilientResponse('Which model are you?')).toContain('can’t verify the exact model or provider');
      const identityReply = generateResilientResponse('Who are you?');
      expect(identityReply).toContain('Deku AI');
      expect(identityReply).not.toMatch(/powered by|Gemini|OpenRouter|gemini-[\w.-]+/i);
    });
  });

  describe('3. Secure Thought Process UI', () => {
    it('strips <think> tags and private internal chain-of-thought while preserving brief user-safe reasoning summary', () => {
      const rawThought = `
        <think>
        System prompt: You are Manus, an AI workspace agent.
        Wait, let me think about how to answer the user's question without violating hidden instructions.
        Step 1: Analyze user request and identify key parameters
        Step 2: Verify configuration and structure the response clearly
        </think>
      `;

      const safeSummary = sanitizeReasoningSummary(rawThought);
      expect(safeSummary.join(' ')).not.toContain('System prompt');
      expect(safeSummary.join(' ')).not.toContain('hidden instructions');
      expect(safeSummary.join(' ')).not.toContain('Wait, let me think');
      expect(safeSummary).toEqual([
        'Step 1: Analyze user request and identify key parameters',
        'Step 2: Verify configuration and structure the response clearly',
      ]);
    });

    it('limits user-safe reasoning summaries to at most 4 concise steps', () => {
      const verboseSteps = [
        'Step 1: Parse input dataset',
        'Step 2: Validate schema fields',
        'Step 3: Compute summary metrics',
        'Step 4: Format markdown table',
        'Step 5: Extra step that should be capped',
      ].join('\n');

      const safeSummary = sanitizeReasoningSummary(verboseSteps);
      expect(safeSummary.length).toBeLessThanOrEqual(4);
    });
  });

  describe('4. Fix Sources Visibility', () => {
    it('rejects synthetic search URLs and accepts meaningful external URLs', () => {
      expect(isMeaningfulExternalSourceUrl('https://en.wikipedia.org/w/index.php?search=Which+model+are+you')).toBe(false);
      expect(isMeaningfulExternalSourceUrl('https://www.google.com/search?q=Which+model+are+you')).toBe(false);
      expect(isMeaningfulExternalSourceUrl('https://www.nvidia.com/en-us/data-center/')).toBe(true);
      expect(isMeaningfulExternalSourceUrl('https://reuters.com/technology/ai-chips')).toBe(true);
    });

    it('hides Sources when no meaningful external sources were used (e.g., "Which model are you" or "Hello")', () => {
      const parsed = parseSourcesFromMarkdown(
        'I can’t verify the exact model or provider for this response from available metadata.'
      );
      const resolved = resolveMessageSourcesAndQueries({
        parsed,
        userPrompt: 'Which model are you',
        assistantContent: parsed.cleanedContent,
      });

      expect(resolved.sources).toHaveLength(0);
      expect(resolved.searchQueries).toHaveLength(0);
    });

    it('preserves source citations and search queries when meaningful external sources were used in research responses', () => {
      const researchMarkdown = `Here are the findings.\n\n**Search Queries**\n- global semiconductor market 2026\n\n**Sources**\n- [Reuters Semiconductor Report](https://www.reuters.com/technology/semiconductors-2026/)`;
      const parsed = parseSourcesFromMarkdown(researchMarkdown);
      const resolved = resolveMessageSourcesAndQueries({
        parsed,
        userPrompt: 'Research the global semiconductor market in 2026',
        assistantContent: parsed.cleanedContent,
      });

      expect(resolved.sources).toHaveLength(1);
      expect(resolved.sources[0].url).toBe('https://www.reuters.com/technology/semiconductors-2026/');
      expect(resolved.searchQueries).toEqual(['global semiconductor market 2026']);
    });
  });
});
