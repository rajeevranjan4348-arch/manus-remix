/**
 * Intelligent Query Router â classifies incoming questions and decides
 * whether live research is required. Avoids unnecessary searches for
 * greetings, small talk, math and stable historical knowledge.
 */
import type { RouteDecision, QueryCategory, FreshnessCategory } from './types';

const CONVERSATION_RE =
  /^(hi|hello|hey|hiya|howdy|thanks|thank you|ok|okay|bye|good\s+(morning|afternoon|evening|day)|how are you|who are you|what is manus|which model|what model|what llm|which llm|model are you|who built you|your architecture|what can you do)\b/i;

const MATH_RE =
  /^[\s\d+\-*/^%().,eÃÃ·]+$/;

const MATH_WORD_RE =
  /\b(calculate|compute|what is|solve|sum of|product of|square root|percentage of)\b.*\d/i;

const HISTORICAL_RE =
  /\b(history|historical|in the (19|20)th century|medieval|ancient|who was|when was .* (born|died)|world war|independence)\b/i;

const STABLE_FACT_RE =
  /\b(capital of|definition of|what is a|what does .* mean|synonym|antonym|who wrote|who discovered|invented)\b/i;

const CURRENT_RE =
  /\b(latest|today|current|currently|right now|breaking|live|real[\s-]?time|recent|this week|this month|yesterday|update[sd]?|newest)\b/i;

const NEWS_RE =
  /\b(news|headlines|what happened|what's happening|whats happening|election|press conference|announcee today)\b/i;

const AI_MODELS_RE =
  /\b(gemini|gpt|claude|llama|anthropic|openai|deepseek|qwen|midjourney|sora|copilot|model release|ai model|foundation model)\b/i;

const PROGRAMMING_RE =
  /\b(npm|yarn|pnpm|pip|package|library|framework|api|sdk|version|release|changelog|docs|documentation|react|next\.?js|vite|typescript|python|rust|golang|deprecated)\b/i;

const PRICES_STATS_RE =
  /\b(price|prices|cost|stock|share price|exchange rate|usd to|inr to|weather|temperature|forecast|statistics|population of .* (now|currently)|score|standings|gdp|inflation)\b/i;

const COMPLEX_RESEARCH_RE =
  /\b(compare|analysis|research|deep dive|pros and cons|market (?:size|trend|landscape)|state of|survey|report on)\b/i;

function freshnessFor(category: QueryCategory, text: string): FreshnessCategory {
  if (/\bweather|temperature|forecast|humidity\b/i.test(text)) return 'weather';
  switch (category) {
    case 'news':
    case 'current_info':
    case 'ai_models':
      return 'news';
    case 'prices_stats':
      return 'prices';
    case 'programming':
      return 'releases';
    case 'complex_research':
      return 'default';
    default:
      return 'stable_fact';
  }
}

export function routeQuery(text: string): RouteDecision {
  const q = (text || '').trim();
  const lower = q.toLowerCase();

  if (!q || q.split(/\s+/).length <= 4 && CONVERSATION_RE.test(lower)) {
    return { category: 'conversation', needsResearch: false, useGrounding: false, reason: 'Greeting / identity / small talk', freshnessCategory: 'stable_fact' };
  }
  if (CONVERSATION_RE.test(lower) && !CURRENT_RE.test(lower) && q.split(/\s+/).length <= 8) {
    return { category: 'conversation', needsResearch: false, useGrounding: false, reason: 'Conversational or identity question', freshnessCategory: 'stable_fact' };
  }
  if (MATH_RE.test(q)) {
    return { category: 'calculation', needsResearch: false, useGrounding: false, reason: 'Pure arithmetic expression', freshnessCategory: 'stable_fact' };
  }
  if (MATH_WORD_RE.test(lower) && !CURRENT_RE.test(lower) && !NEWS_RE.test(lower)) {
    return { category: 'calculation', needsResearch: false, useGrounding: false, reason: 'Mathematical computation from known values', freshnessCategory: 'stable_fact' };
  }
  if (AI_MODELS_RE.test(lower) && (CURRENT_RE.test(lower) || /\b(latest|newest|just released|version)\b/i.test(lower))) {
    return { category: 'ai_models', needsResearch: true, useGrounding: true, reason: 'AI model landscape changes frequently', freshnessCategory: freshnessFor(category, q) };
  }
  if (NEWS_RE.test(lower)) {
    return { category: 'news', needsResearch: true, useGrounding: true, reason: 'News requires fresh verified sources', freshnessCategory: freshnessFor(category, q) };
  }
  if (PRICES_STATS_RE.test(lower) && (CURRENT_RE.test(lower) || /\b(now|today|current)\b/i.test(lower))) {
    return { category: 'prices_stats', needsResearch: true, useGrounding: true, reason: 'Live prices / statistics / weather', freshnessCategory: freshnessFor(category, q) };
  }
  if (PRICES_STATS_RE.test(lower) && /\bweather|temperature|forecast\b/i.test(lower)) {
    return { category: 'prices_stats', needsResearch: true, useGrounding: true, reason: 'Weather data is time-sensitive', freshnessCategory: 'weather' };
  }
  if (PROGRAMMING_RE.test(lower) && (CURRENT_RE.test(lower) || /\b(latest|newest|version|release|breaking change|deprecated)\b/i.test(lower))) {
    return { category: 'programming', needsResearch: true, useGrounding: true, reason: 'Ecosystem versions and docs change often', freshnessCategory: freshnessFor(category, q) };
  }
  if (CURRENT_RE.test(lower) || /\b202[5-9]\b|203\d/.test(lower)) {
    return { category: 'current_info', needsResearch: true, useGrounding: true, reason: 'Question references current events or recent dates', freshnessCategory: freshnessFor(category, q) };
  }
  if (COMPLEX_RESEARCH_RE.test(lower) && q.split(/\s+/).length >= 4) {
    return { category: 'complex_research', needsResearch: true, useGrounding: true, reason: 'Complex multi-source research request', freshnessCategory: freshnessFor(category, q) };
  }
  if (HISTORICAL_RE.test(lower)) {
    return { category: 'historical', needsResearch: false, useGrounding: false, reason: 'Stable historical knowledge', freshnessCategory: 'stable_fact' };
  }
  if (STABLE_FACT_RE.test(lower)) {
    return { category: 'general_knowledge', needsResearch: false, useGrounding: false, reason: 'Stable general knowledge', freshnessCategory: 'stable_fact' };
  }
  return { category: 'general_knowledge', needsResearch: false, useGrounding: false, reason: 'Answerable from existing model knowledge', freshnessCategory: 'stable_fact' };
}
