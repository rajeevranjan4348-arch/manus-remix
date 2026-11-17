/**
 * Real-Time Intelligence Engine (RTIE) — Multi-Provider Search & Live API Adapters
 *
 * Supports extensible, configurable providers:
 * 1. GitHub Releases & Repository Adapter (api.github.com)
 * 2. Software Package Registry & Official Docs Adapter (npm / PyPI / official docs)
 * 3. AI Models & Official Announcements Adapter (ai.google.dev / official model docs)
 * 4. Firecrawl Web Search Adapter (FIRECRAWL_API_KEY)
 * 5. Agent Reach Bridge Adapter (AGENT_REACH_BRIDGE_URL)
 * 6. Gemini Google Search Grounding Adapter (GEMINI_API_KEY)
 * 7. Public Real-Time Feeds Adapter (Open-Meteo, Frankfurter, CoinGecko, Hacker News, Spaceflight News, USGS, Wikipedia, DuckDuckGo)
 */

import { GoogleGenAI } from '@google/genai';
import {
  fetchLiveCryptoPrices,
  fetchLiveExchangeRates,
  fetchLiveNewsAndFacts,
  fetchLiveWeatherSnapshot,
  LiveCryptoItem,
  LiveCurrencySnapshot,
  LiveWeatherSnapshot,
} from '../realtimeDataService';
import { fetchAndExtractWebPage, validateSafeExternalUrl } from './contentExtractionService';
import { QueryRouteDecision, RawSearchResult } from './types';

export interface DomainLiveSnapshots {
  weather?: LiveWeatherSnapshot | null;
  currency?: LiveCurrencySnapshot | null;
  crypto?: LiveCryptoItem[];
}

/**
 * 1. GitHub Latest Release & Repository Adapter
 */
export async function fetchGitHubReleaseAdapter(
  repo: string,
  signal?: AbortSignal
): Promise<RawSearchResult[]> {
  const cleanRepo = String(repo || '').trim().replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cleanRepo)) {
    return [];
  }

  const baseApi = (process.env.VITE_GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const retrievedAt = new Date().toISOString();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Manus-RTIE-Engine/1.0',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const releaseUrl = `${baseApi}/repos/${cleanRepo}/releases/latest`;
    const timeoutSig = AbortSignal.timeout(4500);
    const res = await fetch(releaseUrl, {
      headers,
      signal: signal && AbortSignal.any ? AbortSignal.any([signal, timeoutSig]) : timeoutSig,
    });

    if (res.ok) {
      const data: any = await res.json();
      const tagName = String(data?.tag_name || data?.name || 'latest');
      const htmlUrl = String(data?.html_url || `https://github.com/${cleanRepo}/releases`);
      const publishedAt = typeof data?.published_at === 'string' ? data.published_at : undefined;
      const bodySnippet = String(data?.body || '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 700);

      return [
        {
          title: `${cleanRepo} Latest GitHub Release: ${tagName}`,
          url: htmlUrl,
          snippet: `Official latest release of ${cleanRepo} is ${tagName}${
            publishedAt ? ` (published on ${publishedAt.slice(0, 10)})` : ''
          }. ${bodySnippet}`,
          provider: 'github-releases',
          publishedAt,
          retrievedAt,
          metadata: { repo: cleanRepo, tagName },
        },
      ];
    }

    // Fallback to tags endpoint if repo doesn't use GitHub Releases
    const tagsRes = await fetch(`${baseApi}/repos/${cleanRepo}/tags?per_page=3`, {
      headers,
      signal: AbortSignal.timeout(3500),
    });
    if (tagsRes.ok) {
      const tags: any = await tagsRes.json();
      if (Array.isArray(tags) && tags.length > 0) {
        const latestTag = String(tags[0]?.name || 'latest');
        return [
          {
            title: `${cleanRepo} Latest GitHub Tag: ${latestTag}`,
            url: `https://github.com/${cleanRepo}/tags`,
            snippet: `Latest tagged version in repository ${cleanRepo} is ${latestTag}.`,
            provider: 'github-releases',
            retrievedAt,
            metadata: { repo: cleanRepo, tagName: latestTag },
          },
        ];
      }
    }
  } catch {}

  return [];
}

/**
 * 2. Software Package Registry Adapter (npm & PyPI)
 */
export async function fetchSoftwarePackageAdapter(
  packageName: string,
  ecosystem: 'npm' | 'pypi' = 'npm',
  signal?: AbortSignal
): Promise<RawSearchResult[]> {
  const retrievedAt = new Date().toISOString();
  const cleanPkg = String(packageName || '').trim();
  if (!cleanPkg) return [];

  try {
    const timeoutSig = AbortSignal.timeout(4500);
    const activeSignal = signal && AbortSignal.any ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;

    if (ecosystem === 'pypi') {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(cleanPkg)}/json`, {
        signal: activeSignal,
      });
      if (res.ok) {
        const data: any = await res.json();
        const version = String(data?.info?.version || '');
        const summary = String(data?.info?.summary || '');
        const releaseList = version && Array.isArray(data?.releases?.[version]) ? data.releases[version] : [];
        const publishedAt = releaseList[0]?.upload_time_iso_8601 || undefined;
        return [
          {
            title: `${cleanPkg} v${version} — PyPI Official Package Registry`,
            url: `https://pypi.org/project/${encodeURIComponent(cleanPkg)}/`,
            snippet: `Latest stable release of Python package ${cleanPkg} is version ${version}${
              publishedAt ? ` (released ${String(publishedAt).slice(0, 10)})` : ''
            }. ${summary}`,
            provider: 'pypi-registry',
            publishedAt,
            retrievedAt,
          },
        ];
      }
      return [];
    }

    // Default: npm registry
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(cleanPkg)}/latest`, {
      signal: activeSignal,
    });
    if (res.ok) {
      const data: any = await res.json();
      const version = String(data?.version || '');
      const description = String(data?.description || '');
      const homepage = typeof data?.homepage === 'string' && /^https?:\/\//i.test(data.homepage) ? data.homepage : '';
      const results: RawSearchResult[] = [
        {
          title: `${cleanPkg} v${version} — Official npm Registry`,
          url: `https://www.npmjs.com/package/${cleanPkg}`,
          snippet: `Latest stable npm version of ${cleanPkg} is v${version}. ${description}`,
          provider: 'npm-registry',
          retrievedAt,
        },
      ];
      if (homepage) {
        results.push({
          title: `${cleanPkg} Official Documentation & Homepage`,
          url: homepage,
          snippet: `Official documentation and project homepage for ${cleanPkg} (latest v${version}). ${description}`,
          provider: 'official-docs',
          retrievedAt,
        });
      }
      return results;
    }
  } catch {}

  return [];
}

/**
 * 3. AI Models Official Documentation & Release Metadata Adapter
 */
export function getOfficialAiModelDocsSnapshot(query: string): RawSearchResult[] {
  const retrievedAt = new Date().toISOString();
  const lower = query.toLowerCase();
  const results: RawSearchResult[] = [];

  if (/\b(gemini|google\s+ai|deepmind|genai)\b/i.test(lower) || /\b(latest\s+ai\s+model|latest\s+llm)\b/i.test(lower)) {
    results.push({
      title: 'Gemini Models Official Documentation — Google AI for Developers',
      url: 'https://ai.google.dev/gemini-api/docs/models',
      snippet:
        'Official Google Gemini model lineup includes the Gemini 3 series (gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-3.1-flash-lite-preview, gemini-3-pro-image-preview) and Gemini 2.5 series (gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite) supporting multimodal reasoning, native tool calling, and Google Search grounding via @google/genai.',
      provider: 'official-ai-docs',
      publishedAt: new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z',
      retrievedAt,
    });
  }

  if (/\b(claude|anthropic)\b/i.test(lower)) {
    results.push({
      title: 'Anthropic Claude Models — Official Documentation',
      url: 'https://docs.anthropic.com/en/docs/about-claude/models',
      snippet:
        'Official Anthropic Claude model documentation covering Claude Sonnet, Claude Opus, and Claude Haiku model families, context windows, and tool use capabilities.',
      provider: 'official-ai-docs',
      retrievedAt,
    });
  }

  if (/\b(openai|gpt|o1|o3)\b/i.test(lower)) {
    results.push({
      title: 'OpenAI Models — Official Platform Documentation',
      url: 'https://platform.openai.com/docs/models',
      snippet:
        'Official OpenAI platform documentation detailing flagship multimodal and reasoning models, API capabilities, and context limits.',
      provider: 'official-ai-docs',
      retrievedAt,
    });
  }

  return results;
}

/**
 * 4. Firecrawl Search Adapter
 */
export async function fetchFirecrawlAdapter(
  query: string,
  limit = 5,
  signal?: AbortSignal
): Promise<RawSearchResult[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return [];

  const retrievedAt = new Date().toISOString();
  try {
    const timeoutSig = AbortSignal.timeout(7500);
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query.slice(0, 1000),
        limit,
        sources: [{ type: 'web' }],
      }),
      signal: signal && AbortSignal.any ? AbortSignal.any([signal, timeoutSig]) : timeoutSig,
    });

    if (!res.ok) return [];
    const payload: any = await res.json();
    const items = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.results)
        ? payload.results
        : [];

    const results: RawSearchResult[] = [];
    for (const item of items.slice(0, limit)) {
      const url = typeof item?.url === 'string' ? item.url : typeof item?.link === 'string' ? item.link : '';
      if (url && /^https?:\/\//i.test(url)) {
        results.push({
          title: String(item?.title || item?.name || url).slice(0, 260),
          url,
          snippet: String(item?.description || item?.snippet || item?.markdown || '').slice(0, 1000),
          content: typeof item?.markdown === 'string' ? item.markdown.slice(0, 2200) : undefined,
          provider: 'firecrawl',
          publishedAt: typeof item?.publishedDate === 'string' ? item.publishedDate : undefined,
          retrievedAt,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 5. Agent Reach Bridge Adapter
 */
export async function fetchAgentReachAdapter(
  query: string,
  limit = 5,
  signal?: AbortSignal
): Promise<RawSearchResult[]> {
  const bridgeUrl = process.env.AGENT_REACH_BRIDGE_URL;
  if (!bridgeUrl) return [];

  const check = validateSafeExternalUrl(bridgeUrl);
  // Allow localhost only if explicitly configured for local bridge
  let parsed: URL;
  try {
    parsed = new URL(bridgeUrl);
  } catch {
    return [];
  }
  if (!check.valid && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return [];
  }

  const retrievedAt = new Date().toISOString();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.AGENT_REACH_BRIDGE_TOKEN) {
      headers.Authorization = `Bearer ${process.env.AGENT_REACH_BRIDGE_TOKEN}`;
    }
    const timeoutSig = AbortSignal.timeout(7000);
    const res = await fetch(parsed.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: query.slice(0, 1000), limit }),
      signal: signal && AbortSignal.any ? AbortSignal.any([signal, timeoutSig]) : timeoutSig,
    });
    if (!res.ok) return [];
    const payload: any = await res.json();
    const items = Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    const results: RawSearchResult[] = [];
    for (const item of items.slice(0, limit)) {
      const url = typeof item?.url === 'string' ? item.url : typeof item?.link === 'string' ? item.link : '';
      if (url && /^https?:\/\//i.test(url)) {
        results.push({
          title: String(item?.title || item?.name || url).slice(0, 260),
          url,
          snippet: String(item?.description || item?.snippet || item?.content || '').slice(0, 1000),
          provider: 'agent-reach',
          retrievedAt,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 6. Standalone Google Search Grounding Adapter (used by /api/web-search and multi-source research)
 */
export async function fetchGoogleSearchGroundingAdapter(
  query: string,
  limit = 5
): Promise<RawSearchResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const retrievedAt = new Date().toISOString();
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Retrieve current, verified facts and sources for: ${query}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const summaryText = response.text?.trim() || '';
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const results: RawSearchResult[] = [];

    for (const chunk of chunks.slice(0, limit)) {
      const web = chunk?.web;
      if (typeof web?.uri === 'string' && /^https?:\/\//i.test(web.uri)) {
        results.push({
          title: String(web.title || web.uri).slice(0, 260),
          url: web.uri,
          snippet: summaryText.slice(0, 700),
          provider: 'google-search-grounding',
          retrievedAt,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 7. Execute all applicable search and live API adapters for a routed query
 */
export async function executeMultiProviderResearch(
  route: QueryRouteDecision,
  rawQuery: string,
  options?: {
    signal?: AbortSignal;
    includeGoogleGroundingFetch?: boolean;
    extractTopWebPages?: boolean;
  }
): Promise<{
  rawResults: RawSearchResult[];
  domainSnapshots: DomainLiveSnapshots;
}> {
  const retrievedAt = new Date().toISOString();
  const rawResults: RawSearchResult[] = [];
  const domainSnapshots: DomainLiveSnapshots = {};

  if (!route.requiresLiveResearch) {
    return { rawResults, domainSnapshots };
  }

  const jobs: Promise<void>[] = [];
  const entities = route.extractedEntities;

  // A. Target URLs extraction if user provided explicit URLs
  if (entities.targetUrls && entities.targetUrls.length > 0) {
    for (const url of entities.targetUrls.slice(0, 2)) {
      jobs.push(
        fetchAndExtractWebPage(url, 5000, options?.signal).then((page) => {
          if (page.ok) {
            rawResults.push({
              title: page.title,
              url: page.url,
              snippet: page.description || page.textContent.slice(0, 600),
              content: page.textContent,
              provider: 'direct-url-extractor',
              publishedAt: page.publishedAt,
              retrievedAt: page.fetchedAt,
            });
          }
        })
      );
    }
  }

  // B. GitHub Release Adapter
  if (entities.githubRepo) {
    jobs.push(
      fetchGitHubReleaseAdapter(entities.githubRepo, options?.signal).then((items) => {
        rawResults.push(...items);
      })
    );
  }

  // C. Software Package Registry Adapter (npm / PyPI)
  if (entities.packageName) {
    jobs.push(
      fetchSoftwarePackageAdapter(
        entities.packageName,
        entities.packageEcosystem || 'npm',
        options?.signal
      ).then((items) => {
        rawResults.push(...items);
      })
    );
  }

  // D. Official AI Model Documentation Adapter
  if (route.category === 'ai_models') {
    rawResults.push(...getOfficialAiModelDocsSnapshot(rawQuery));
  }

  // E. Weather Snapshot Adapter
  if (entities.weatherCity) {
    jobs.push(
      fetchLiveWeatherSnapshot(entities.weatherCity).then((w) => {
        domainSnapshots.weather = w;
        if (w) {
          rawResults.push({
            title: `Open-Meteo Live Weather — ${w.city}${w.country ? `, ${w.country}` : ''}`,
            url: w.sourceUrl,
            snippet: `Current condition in ${w.city}: ${w.condition}, ${w.temperatureC}°C (${w.temperatureF}°F), feels like ${w.feelsLikeC}°C, humidity ${w.humidity}%, wind ${w.windSpeedKmh} km/h${
              w.usAqi !== undefined ? `, US AQI ${w.usAqi}` : ''
            }.`,
            provider: 'open-meteo',
            publishedAt: w.fetchedAtUtc,
            retrievedAt,
          });
        }
      })
    );
  }

  // F. Currency FX Adapter
  if (entities.currencyPair) {
    const { base, target, amount } = entities.currencyPair;
    jobs.push(
      fetchLiveExchangeRates(base, target, amount).then((c) => {
        domainSnapshots.currency = c;
        if (c) {
          rawResults.push({
            title: `Frankfurter Live FX Rate (${c.base}/${c.target})`,
            url: c.sourceUrl,
            snippet: `${c.amount} ${c.base} = ${c.convertedAmount} ${c.target} (1 ${c.base} = ${c.rate} ${c.target} as of ${c.date}).`,
            provider: 'frankfurter-fx',
            publishedAt: `${c.date}T00:00:00.000Z`,
            retrievedAt,
          });
        }
      })
    );
  }

  // G. Cryptocurrency Spot Adapter
  if (entities.wantsCrypto) {
    jobs.push(
      fetchLiveCryptoPrices().then((items) => {
        domainSnapshots.crypto = items;
        if (items.length > 0) {
          const summary = items
            .map(
              (coin) =>
                `${coin.name} (${coin.symbol}): $${coin.priceUsd.toLocaleString('en-US')}${
                  coin.change24hPct !== undefined ? ` (${coin.change24hPct >= 0 ? '+' : ''}${coin.change24hPct}% 24h)` : ''
                }`
            )
            .join(' | ');
          rawResults.push({
            title: 'CoinGecko / Coinbase Live Cryptocurrency Market Feed',
            url: 'https://www.coingecko.com/',
            snippet: summary,
            provider: 'coingecko-crypto',
            publishedAt: retrievedAt,
            retrievedAt,
          });
        }
      })
    );
  }

  // H. Web Search Providers (Firecrawl, Agent Reach, Live News/Facts)
  const primarySearchQuery = route.searchQueries[0] || rawQuery;
  jobs.push(
    fetchFirecrawlAdapter(primarySearchQuery, 5, options?.signal).then((items) => {
      rawResults.push(...items);
    })
  );
  jobs.push(
    fetchAgentReachAdapter(primarySearchQuery, 5, options?.signal).then((items) => {
      rawResults.push(...items);
    })
  );

  if (options?.includeGoogleGroundingFetch) {
    jobs.push(
      fetchGoogleSearchGroundingAdapter(primarySearchQuery, 5).then((items) => {
        rawResults.push(...items);
      })
    );
  }

  if (!entities.weatherCity && !entities.currencyPair) {
    jobs.push(
      fetchLiveNewsAndFacts(primarySearchQuery, 5).then((items) => {
        for (const item of items) {
          rawResults.push({
            title: item.title,
            url: item.url,
            snippet: item.snippet,
            provider: item.source,
            publishedAt: item.publishedAt,
            retrievedAt,
          });
        }
      })
    );
  }

  await Promise.all(jobs);

  // Optional deep content extraction for top 1-2 external results on complex_research
  if (
    options?.extractTopWebPages &&
    route.category === 'complex_research' &&
    rawResults.length > 0
  ) {
    const candidates = rawResults
      .filter((r) => !r.content && /^https?:\/\//i.test(r.url))
      .slice(0, 2);
    await Promise.all(
      candidates.map(async (candidate) => {
        const extracted = await fetchAndExtractWebPage(candidate.url, 3500, options?.signal);
        if (extracted.ok && extracted.textContent) {
          candidate.content = extracted.textContent;
          if (!candidate.publishedAt && extracted.publishedAt) {
            candidate.publishedAt = extracted.publishedAt;
          }
        }
      })
    );
  }

  return { rawResults, domainSnapshots };
}
