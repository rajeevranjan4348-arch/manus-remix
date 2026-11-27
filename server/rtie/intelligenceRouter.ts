/**
 * Real-Time Intelligence Engine (RTIE) — Intelligent Query Router
 *
 * Classifies incoming queries into:
 * A. general_knowledge   -> Existing LLM (no unnecessary live search)
 * B. current_information -> Live web search
 * C. programming         -> Current documentation, npm/PyPI registry & GitHub release research
 * D. ai_models           -> Latest official announcements & model documentation
 * E. news                -> Recent and verified news sources
 * F. prices_statistics   -> Current APIs (weather, FX, crypto, market/statistical feeds)
 * G. complex_research    -> Multi-source research pipeline
 */

import {
  detectCryptoQuery,
  detectCurrencyQuery,
  detectVideoQuery,
  detectWeatherCity,
} from '../realtimeDataService';
import { QueryCategory, QueryRouteDecision } from './types';

export const CATEGORY_TTL_MS: Record<QueryCategory, number> = {
  general_knowledge: 24 * 60 * 60 * 1000, // 24 hours
  prices_statistics: 2 * 60 * 1000,      // 2 minutes
  news: 10 * 60 * 1000,                  // 10 minutes
  current_information: 20 * 60 * 1000,   // 20 minutes
  ai_models: 60 * 60 * 1000,             // 1 hour
  programming: 2 * 60 * 60 * 1000,       // 2 hours
  complex_research: 30 * 60 * 1000,      // 30 minutes
};

const KNOWN_GITHUB_REPOS: Record<string, string> = {
  react: 'facebook/react',
  'next.js': 'vercel/next.js',
  nextjs: 'vercel/next.js',
  vite: 'vitejs/vite',
  typescript: 'microsoft/TypeScript',
  tailwind: 'tailwindlabs/tailwindcss',
  tailwindcss: 'tailwindlabs/tailwindcss',
  node: 'nodejs/node',
  nodejs: 'nodejs/node',
  deno: 'denoland/deno',
  bun: 'oven-sh/bun',
  vue: 'vuejs/core',
  svelte: 'sveltejs/svelte',
  angular: 'angular/angular',
  astro: 'withastro/astro',
  prisma: 'prisma/prisma',
  vitest: 'vitest-dev/vitest',
  playwright: 'microsoft/playwright',
  langchain: 'langchain-ai/langchainjs',
  ollama: 'ollama/ollama',
  pytorch: 'pytorch/pytorch',
  tensorflow: 'tensorflow/tensorflow',
};

function extractGitHubRepo(query: string): string | undefined {
  // Explicit owner/repo pattern
  const explicitMatch = query.match(
    /(?:github\.com\/|repo(?:sitory)?\s+|release\s+(?:of|for)\s+)([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].replace(/[.,;!?]+$/, '');
  }

  const slashPair = query.match(/\b([a-zA-Z0-9_.-]{2,35}\/[a-zA-Z0-9_.-]{2,45})\b/);
  if (
    slashPair?.[1] &&
    !/^(http|https|text|application|image|audio|video|and\/or|true\/false|yes\/no|input\/output|ui\/ux|ci\/cd|tcp\/ip|usb\/c)$/i.test(
      slashPair[1]
    ) &&
    /\b(github|release|version|commit|tag|repo|repository|changelog)\b/i.test(query)
  ) {
    return slashPair[1];
  }

  const lower = query.toLowerCase();
  for (const [alias, repo] of Object.entries(KNOWN_GITHUB_REPOS)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
      return repo;
    }
  }
  return undefined;
}

function extractPackageInfo(query: string): {
  packageName?: string;
  packageEcosystem?: 'npm' | 'pypi';
} {
  const npmMatch = query.match(
    /\b(?:npm\s+package|npm\s+version\s+of|latest\s+version\s+of|version\s+of)\s+(@?[a-z0-9-~][a-z0-9-._~]*\/?[a-z0-9-._~]*)\b/i
  );
  if (npmMatch?.[1]) {
    const pkg = npmMatch[1].toLowerCase().replace(/[?.!,]+$/, '');
    if (!['the', 'a', 'an', 'python', 'pip'].includes(pkg)) {
      return { packageName: pkg, packageEcosystem: 'npm' };
    }
  }

  const pypiMatch = query.match(
    /\b(?:pypi|pip\s+package|python\s+package)\s+([a-zA-Z0-9_-]+)\b/i
  );
  if (pypiMatch?.[1]) {
    return { packageName: pypiMatch[1].toLowerCase(), packageEcosystem: 'pypi' };
  }

  const lower = query.toLowerCase();
  for (const pkg of [
    'react',
    'next',
    'vite',
    'typescript',
    'tailwindcss',
    'zod',
    'express',
    'vitest',
    'd3',
    'three',
    '@google/genai',
  ]) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`\\b${escaped}\\b`, 'i').test(lower) &&
      /\b(version|release|latest|docs|documentation|changelog|update|install)\b/i.test(lower)
    ) {
      return { packageName: pkg, packageEcosystem: 'npm' };
    }
  }

  return {};
}

function extractUrls(query: string): string[] {
  const matches = query.match(/https?:\/\/[^\s)<>"']+/gi) || [];
  return matches.map((u) => u.replace(/[.,;!?]+$/, ''));
}

function isSimpleGreetingOrSelfIdentity(clean: string): boolean {
  if (
    /^(hi|hello|hey|hiya|howdy|yo|namaste|greetings|good\s+(morning|afternoon|evening|day|night)|thanks|thank\s+you|ok|okay|bye|goodbye)[!?.\s]*$/i.test(
      clean
    )
  ) {
    return true;
  }
  if (
    /\b(which\s+model\s+are\s+you|what\s+model\s+are\s+you|what\s+llm\s+are\s+you|which\s+llm\s+are\s+you|your\s+underlying\s+model|who\s+built\s+you|who\s+are\s+you|what\s+is\s+(deku|manus))\b/i.test(
      clean
    ) &&
    !/\b(latest\s+gemini|newest\s+gemini|gemini\s+release|latest\s+openai|latest\s+claude|latest\s+ai\s+model)\b/i.test(
      clean
    )
  ) {
    return true;
  }
  return false;
}

function isPureMathOrLogicQuery(clean: string): boolean {
  // e.g. "What is 25 * 48?", "Solve 2x + 5 = 15", "Calculate factorial of 6"
  if (/^[\d\s+*\-/^().%=?]+$/.test(clean)) {
    return true;
  }
  if (
    /\b(calculate|solve|compute|simplify|derivative\s+of|integral\s+of|square\s+root\s+of|factorial\s+of)\b/i.test(
      clean
    ) &&
    !/\b(price|rate|weather|inflation|gdp|stock|population|today|current|202[5-9])\b/i.test(clean)
  ) {
    return true;
  }
  if (/^what\s+is\s+\d+\s*(?:\+|\-|\*|\/|times|plus|minus|divided\s+by)\s*\d+/i.test(clean)) {
    return true;
  }
  return false;
}

function isStaticHistoricalOrConceptualQuery(clean: string): boolean {
  if (
    /\b(latest|current|currently|today|right\s+now|now|recent|recently|new|newest|breaking|live|real[\s-]?time|202[4-9]|203\d|this\s+year|this\s+week|this\s+month|yesterday)\b/i.test(
      clean
    )
  ) {
    return false;
  }
  if (
    /\b(when\s+was\s+.+\s+born|when\s+did\s+world\s+war|who\s+was\s+the\s+first\s+president|history\s+of\s+ancient|what\s+caused\s+the\s+french\s+revolution|who\s+invented\s+the\s+telephone|capital\s+of\s+france|speed\s+of\s+light|pythagorean\s+theorem|photosynthesis)\b/i.test(
      clean
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Classifies a user prompt into one of the 7 RTIE routing categories and prepares search queries.
 */
export function routeQueryIntent(rawQuery: string): QueryRouteDecision {
  const clean = String(rawQuery || '')
    .replace(/\[IMAGE_DATA_URL:[^\]]+\]\s*/gi, '')
    .replace(/\[Attached Image:[^\]]*\]\s*/gi, '')
    .replace(/^\[MODE:[^\]]*\]\s*/i, '')
    .replace(/^\[Think Harder[^\]]*\]\s*/i, '')
    .trim();

  if (!clean) {
    return {
      category: 'general_knowledge',
      requiresLiveResearch: false,
      confidence: 1.0,
      reason: 'Empty query defaults to general LLM conversation.',
      searchQueries: [],
      extractedEntities: {},
      freshnessTtlMs: CATEGORY_TTL_MS.general_knowledge,
    };
  }

  // 1. Check greetings, self-identity, pure math, or timeless historical facts -> A. general_knowledge
  if (isSimpleGreetingOrSelfIdentity(clean)) {
    return {
      category: 'general_knowledge',
      requiresLiveResearch: false,
      confidence: 0.99,
      reason: 'Conversational greeting or agent self-identity query handled directly by LLM.',
      searchQueries: [],
      extractedEntities: {},
      freshnessTtlMs: CATEGORY_TTL_MS.general_knowledge,
    };
  }

  if (isPureMathOrLogicQuery(clean)) {
    return {
      category: 'general_knowledge',
      requiresLiveResearch: false,
      confidence: 0.98,
      reason: 'Mathematical or logical calculation does not require external web research.',
      searchQueries: [],
      extractedEntities: {},
      freshnessTtlMs: CATEGORY_TTL_MS.general_knowledge,
    };
  }

  if (isStaticHistoricalOrConceptualQuery(clean)) {
    return {
      category: 'general_knowledge',
      requiresLiveResearch: false,
      confidence: 0.94,
      reason: 'Timeless historical or scientific concept handled by core knowledge.',
      searchQueries: [],
      extractedEntities: {},
      freshnessTtlMs: CATEGORY_TTL_MS.general_knowledge,
    };
  }

  const targetUrls = extractUrls(clean);
  const weatherInfo = detectWeatherCity(clean);
  const currencyInfo = detectCurrencyQuery(clean);
  const wantsCrypto = detectCryptoQuery(clean);
  const githubRepo = extractGitHubRepo(clean);
  const pkgInfo = extractPackageInfo(clean);

  // 2. Check F. prices_statistics (Weather, Currency FX, Crypto, Stock/Market prices, Live Earthquakes)
  if (
    weatherInfo.wantsWeather ||
    currencyInfo.wantsCurrency ||
    wantsCrypto ||
    /\b(stock\s+price|share\s+price|market\s+cap|exchange\s+rate|forex|gold\s+price|silver\s+price|oil\s+price|nifty|sensex|nasdaq|s&p\s*500|dow\s+jones|live\s+score|cricket\s+score|match\s+score|football\s+score|cpi|inflation\s+rate|gdp\s+growth|unemployment\s+rate|interest\s+rate|earthquake\s+magnitude|aqi|air\s+quality)\b/i.test(
      clean
    )
  ) {
    return {
      category: 'prices_statistics',
      requiresLiveResearch: true,
      confidence: 0.95,
      reason: 'Query requests live prices, market rates, meteorological conditions, or real-time statistics.',
      searchQueries: [clean],
      extractedEntities: {
        weatherCity: weatherInfo.wantsWeather ? weatherInfo.city : undefined,
        currencyPair: currencyInfo.wantsCurrency
          ? { base: currencyInfo.base, target: currencyInfo.target, amount: currencyInfo.amount }
          : undefined,
        wantsCrypto,
        targetUrls,
      },
      freshnessTtlMs: CATEGORY_TTL_MS.prices_statistics,
    };
  }

  // 3. Check D. ai_models (Latest Gemini model, OpenAI, Claude, Llama, AI model announcements/docs)
  if (
    /\b(latest\s+gemini|newest\s+gemini|gemini\s+model|gemini\s+2\.5|gemini\s+3(?:\.1)?|gemini\s+4|gemini-4-(?:hydrogen|neon|carbon|argon)|claude\s+3|claude\s+4|gpt-?4|gpt-?5|o1|o3|llama\s+3|llama\s+4|deepseek\s+r1|deepseek\s+v3|mistral|qwen|latest\s+llm|latest\s+ai\s+model|ai\s+model\s+release|model\s+benchmark|context\s+window\s+of|google\s+ai\s+announcement|anthropic\s+announcement|openai\s+announcement)\b/i.test(
      clean
    )
  ) {
    return {
      category: 'ai_models',
      requiresLiveResearch: true,
      confidence: 0.95,
      reason: 'Query asks about current AI models, official announcements, or model specifications.',
      searchQueries: [
        clean,
        `${clean} official documentation release notes`,
      ],
      extractedEntities: {
        aiModelTopic: clean,
        targetUrls,
      },
      freshnessTtlMs: CATEGORY_TTL_MS.ai_models,
    };
  }

  // 4. Check C. programming (GitHub releases, software versions, official docs, API changes)
  if (
    githubRepo ||
    pkgInfo.packageName ||
    /\b(github\s+release|latest\s+release|latest\s+version|software\s+version|npm\s+version|pypi\s+version|changelog|release\s+notes|official\s+docs|official\s+documentation|migration\s+guide|deprecated\s+in|breaking\s+changes\s+in)\b/i.test(
      clean
    )
  ) {
    const queries = [clean];
    if (githubRepo) {
      queries.push(`${githubRepo} latest release changelog`);
    }
    if (pkgInfo.packageName) {
      queries.push(`${pkgInfo.packageName} latest version documentation`);
    }
    return {
      category: 'programming',
      requiresLiveResearch: true,
      confidence: 0.93,
      reason: 'Query requires current software release metadata, package registry version, or official documentation.',
      searchQueries: queries,
      extractedEntities: {
        githubRepo,
        packageName: pkgInfo.packageName,
        packageEcosystem: pkgInfo.packageEcosystem,
        programmingTopic: clean,
        targetUrls,
      },
      freshnessTtlMs: CATEGORY_TTL_MS.programming,
    };
  }

  // 4.5 Check video requests (e.g. "Techno gamer current video", "Latest MrBeast video")
  const videoIntent = detectVideoQuery(clean);
  if (videoIntent.wantsVideos) {
    return {
      category: 'current_information',
      requiresLiveResearch: true,
      confidence: 0.95,
      reason: 'Query asks for the latest/current videos; live YouTube and web search are required.',
      searchQueries: [
        videoIntent.searchQuery,
        `${videoIntent.searchQuery} site:youtube.com`,
      ],
      extractedEntities: {
        targetUrls,
      },
      freshnessTtlMs: CATEGORY_TTL_MS.current_information,
    };
  }

  // 5. Check E. news (Today's news, AI news, breaking headlines, world/tech/science news)
  if (
    /\b(news|headlines|breaking|top\s+stories|today'?s\s+.*news|ai\s+news|tech\s+news|world\s+news|india\s+news|space\s+news|what\s+happened\s+today|what's\s+happening|whats\s+happening|press\s+release|journalism)\b/i.test(
      clean
    )
  ) {
    return {
      category: 'news',
      requiresLiveResearch: true,
      confidence: 0.95,
      reason: 'Query asks for current news, headlines, or recent press coverage.',
      searchQueries: [
        clean,
        `${clean} latest verified news`,
      ],
      extractedEntities: {
        targetUrls,
      },
      freshnessTtlMs: CATEGORY_TTL_MS.news,
    };
  }

  // 6. Check G. complex_research (Multi-aspect comparisons, deep research, comprehensive investigation with current context)
  if (
    (clean.length > 120 &&
      /\b(compare|comprehensive|in-depth|deep\s+dive|research|investigate|market\s+analysis|state\s+of|pros\s+and\s+cons|benchmark|evaluate)\b/i.test(
        clean
      )) ||
    /\b(multi-source|cross-verify|comprehensive\s+report\s+on\s+current|detailed\s+research\s+on)\b/i.test(clean)
  ) {
    return {
      category: 'complex_research',
      requiresLiveResearch: true,
      confidence: 0.91,
      reason: 'Query requires multi-source research, synthesis, and cross-verification.',
      searchQueries: [
        clean,
        `${clean} official data statistics`,
        `${clean} recent analysis`,
      ],
      extractedEntities: {
        githubRepo,
        packageName: pkgInfo.packageName,
        packageEcosystem: pkgInfo.packageEcosystem,
        targetUrls,
      },
      freshnessTtlMs: CATEGORY_TTL_MS.complex_research,
    };
  }

  // 7. Check B. current_information (Time, date, current officeholders, recent events, explicit URLs, 2025/2026+)
  if (
    targetUrls.length > 0 ||
    /\b(latest|today|current|currently|right\s+now|now|recent|recently|this\s+week|this\s+month|this\s+year|yesterday|who\s+won|who\s+is\s+(the\s+)?(prime\s+minister|president|chief\s+minister|ceo|founder|governor|richest|champion)|what\s+time|what\s+is\s+the\s+date|today'?s\s+date|what\s+day\s+is\s+(it|today)|world\s+clock|score|standings|schedule|box\s+office|election)\b/i.test(
      clean
    ) ||
    /\b(202[5-9]|203\d)\b/.test(clean)
  ) {
    return {
      category: 'current_information',
      requiresLiveResearch: true,
      confidence: 0.92,
      reason: 'Query depends on current facts, live temporal state, or post-cutoff information.',
      searchQueries: [clean],
      extractedEntities: {
        targetUrls,
      },
      freshnessTtlMs: CATEGORY_TTL_MS.current_information,
    };
  }

  // Default: A. general_knowledge
  return {
    category: 'general_knowledge',
    requiresLiveResearch: false,
    confidence: 0.88,
    reason: 'General knowledge, coding task, or conversational prompt suitable for direct LLM execution.',
    searchQueries: [],
    extractedEntities: {},
    freshnessTtlMs: CATEGORY_TTL_MS.general_knowledge,
  };
}
