import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sanitizeReasoningSummary } from '../src/components/agent/ThoughtProcess';
import {
  isMeaningfulExternalSourceUrl,
  parseSourcesFromMarkdown,
  resolveMessageSourcesAndQueries,
} from '../src/components/agent/SourceCitations';
import {
  resolveVerifiedModelConfig,
  buildModelIdentityInstruction,
  generateResilientResponse,
  needsLiveSearch,
} from '../server/geminiService';

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

  describe('2. Verified Model Identification', () => {
    it('resolves verified backend model configuration and distinguishes Manus application from underlying LLM', () => {
      const defaultConfig = resolveVerifiedModelConfig('gemini-3.8-flash');
      expect(defaultConfig.applicationName).toBe('Manus');
      expect(defaultConfig.modelId).toBe('gemini-3-flash-preview');
      expect(defaultConfig.provider).toBe('Google Gemini');

      const liteConfig = resolveVerifiedModelConfig('manus-1.6-lite');
      expect(liteConfig.applicationName).toBe('Manus');
      expect(liteConfig.modelId).toBe('gemini-3.1-flash-lite-preview');
      expect(liteConfig.provider).toBe('Google Gemini');

      const instruction = buildModelIdentityInstruction('gemini-3-flash-preview', 'Google Gemini');
      expect(instruction).toContain('Application / Workspace Agent Name: Manus');
      expect(instruction).toContain('Active Underlying LLM Model ID: gemini-3-flash-preview');
      expect(instruction).toContain('Model Provider: Google Gemini');
      expect(instruction).toContain('Never invent model names');
    });

    it('identifies the actual underlying model and distinguishes Manus vs LLM when asked "Which model are you"', () => {
      const reply = generateResilientResponse('Which model are you', [], 'gemini-3-flash-preview');
      expect(reply).toContain('Manus');
      expect(reply).toContain('gemini-3-flash-preview');
      expect(reply).toContain('Google Gemini');
      expect(reply).toContain('Application / Agent:');
      expect(reply).toContain('Underlying LLM Model:');
    });

    it('does not trigger live web search for model identity questions', () => {
      expect(needsLiveSearch('Which model are you')).toBe(false);
      expect(needsLiveSearch('What LLM model are you running on?')).toBe(false);
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
        'I am operating inside Manus, powered by the gemini-3-flash-preview large language model from Google Gemini.'
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
