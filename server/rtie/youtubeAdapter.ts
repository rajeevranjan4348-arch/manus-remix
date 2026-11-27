/**
 * YouTube search adapter for RTIE video requests.
 *
 * Primary: YouTube Data API v3 (search.list, order=date) when YOUTUBE_API_KEY is set.
 * Fallback: keyless public YouTube results parsing (realtimeDataService), so video
 * lookups still work with no API key configured.
 *
 * Never fabricates results: every field comes from a real API/page response, and any
 * failure is reported through the `status` field so callers can say so honestly.
 */

import { fetchLiveYouTubeVideos, LiveVideoResult } from '../realtimeDataService';
import type { RawSearchResult } from './types';

export interface YouTubeVideoResult {
  videoId: string;
  title: string;
  channel: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  url: string;
  description: string;
}

export interface YouTubeSearchOutcome {
  status: 'ok' | 'no_results' | 'not_configured' | 'error';
  query: string;
  results: YouTubeVideoResult[];
  source?: 'youtube-data-api' | 'youtube-live-search';
  error?: string;
}

const YT_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const REQUEST_TIMEOUT_MS = 6000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export async function searchYouTubeLatest(
  query: string,
  options?: { maxResults?: number; signal?: AbortSignal }
): Promise<YouTubeSearchOutcome> {
  const apiKey = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) {
    return { status: 'not_configured', query, results: [] };
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'date',
    maxResults: String(Math.min(Math.max(options?.maxResults ?? 5, 1), 10)),
    q: query,
    safeSearch: 'moderate',
    key: apiKey,
  });

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  try {
    const res = await fetch(`${YT_SEARCH_ENDPOINT}?${params.toString()}`, { signal });
    if (!res.ok) {
      return { status: 'error', query, results: [], error: `YouTube API HTTP ${res.status}` };
    }
    const data: any = await res.json();
    const items: any[] = Array.isArray(data?.items) ? data.items : [];

    const results: YouTubeVideoResult[] = [];
    for (const item of items) {
      const videoId = item?.id?.videoId;
      const sn = item?.snippet;
      if (typeof videoId !== 'string' || !sn?.title) continue; // never invent a video
      results.push({
        videoId,
        title: decodeEntities(String(sn.title)),
        channel: decodeEntities(String(sn.channelTitle || 'Unknown channel')),
        publishedAt: typeof sn.publishedAt === 'string' ? sn.publishedAt : undefined,
        thumbnailUrl:
          sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || undefined,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        description: decodeEntities(String(sn.description || '')).slice(0, 280),
      });
    }

    if (results.length === 0) return { status: 'no_results', query, results: [] };
    return { status: 'ok', query, results };
  } catch (err) {
    return {
      status: 'error',
      query,
      results: [],
      error: err instanceof Error ? err.message : 'YouTube search failed',
    };
  }
}

/** Converts Data API results into the shared LiveVideoResult shape. */
export function apiResultsToLiveVideos(outcome: YouTubeSearchOutcome): LiveVideoResult[] {
  return outcome.results.map((v) => ({
    title: v.title,
    videoId: v.videoId,
    url: v.url,
    channel: v.channel,
    publishedText: v.publishedAt ? v.publishedAt.slice(0, 10) : undefined,
    publishedAtIso: v.publishedAt,
    description: v.description || undefined,
    thumbnailUrl: v.thumbnailUrl,
  }));
}

/**
 * YouTube video search with graceful degradation:
 * 1. YouTube Data API v3 (order=date) when YOUTUBE_API_KEY is configured.
 * 2. Keyless public YouTube results parsing otherwise (or when the API fails or returns nothing).
 * Never fabricates results: returns [] when both paths fail.
 */
export async function searchYouTubeVideosWithFallback(
  query: string,
  options?: { maxResults?: number; signal?: AbortSignal }
): Promise<{ videos: LiveVideoResult[]; outcome: YouTubeSearchOutcome }> {
  const apiOutcome = await searchYouTubeLatest(query, options);
  if (apiOutcome.status === 'ok' && apiOutcome.results.length > 0) {
    return { videos: apiResultsToLiveVideos(apiOutcome), outcome: { ...apiOutcome, source: 'youtube-data-api' } };
  }

  const scraped = await fetchLiveYouTubeVideos(query, Math.min(Math.max(options?.maxResults ?? 5, 1), 10));
  const outcome: YouTubeSearchOutcome = {
    status: scraped.length > 0 ? 'ok' : apiOutcome.status,
    query,
    results: apiOutcome.results,
    source: 'youtube-live-search',
    error: apiOutcome.error,
  };
  return { videos: scraped, outcome };
}

/** Converts YouTube results into RawSearchResult records for the existing pipeline. */
export function youtubeResultsToRaw(outcome: YouTubeSearchOutcome): RawSearchResult[] {
  const retrievedAt = new Date().toISOString();
  return outcome.results.map((v) => ({
    title: v.title,
    url: v.url,
    snippet: `${v.channel}${v.publishedAt ? `, uploaded ${v.publishedAt.slice(0, 10)}` : ''}. ${v.description}`.trim(),
    provider: outcome.source === 'youtube-live-search' ? 'youtube-live-search' : 'youtube-data-api',
    publishedAt: v.publishedAt,
    retrievedAt,
    metadata: { channel: v.channel, thumbnailUrl: v.thumbnailUrl, videoId: v.videoId },
  }));
}
