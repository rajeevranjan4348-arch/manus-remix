import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectVideoQuery,
  enrichQueryWithRealtimeData,
  fetchLiveYouTubeVideos,
  isRealtimeOrLiveFactQuery,
} from '../server/realtimeDataService';
import { generateResilientResponse, needsLiveSearch } from '../server/geminiService';

function makeYouTubeHtml(videos: Array<Record<string, any>>): string {
  const data = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: videos.map((v) => ({ videoRenderer: v })),
                },
              },
            ],
          },
        },
      },
    },
  };
  return '<html><script>var ytInitialData = ' + JSON.stringify(data) + ';</script></html>';
}

const sampleRenderer = {
  videoId: 'dQw4w9WgXcQ',
  title: { runs: [{ text: 'Techno Gamerz new GTA V episode' }] },
  ownerText: {
    runs: [
      {
        text: 'Techno Gamerz',
        navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@TechnoGamerz' } },
      },
    ],
  },
  publishedTimeText: { simpleText: '2 days ago' },
  lengthText: { simpleText: '12:34' },
  descriptionSnippet: { runs: [{ text: 'New GTA V gameplay episode.' }] },
  thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', width: 320 }] },
};

describe('Real-Time Query Understanding & Response Fixes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects current/latest video requests and converts short phrases into search queries', () => {
    expect(detectVideoQuery('Techno gamer current video')).toEqual({
      wantsVideos: true,
      searchQuery: 'Techno gamer latest video',
    });
    expect(detectVideoQuery('Latest MrBeast video').wantsVideos).toBe(true);
    expect(detectVideoQuery('Latest gaming video').searchQuery).toContain('latest video');
    expect(detectVideoQuery('new video from MrBeast').wantsVideos).toBe(true);
    expect(detectVideoQuery('How to write a React hook').wantsVideos).toBe(false);
    expect(detectVideoQuery('best video editing software').wantsVideos).toBe(false);
    expect(detectVideoQuery('Who is Techno Gamerz?').wantsVideos).toBe(false);
  });

  it('classifies all regression queries as live/real-time searches', () => {
    const queries = [
      'Techno gamer current video',
      'Latest gaming video',
      "Today's technology news",
      'Latest AI updates',
      'Current Bitcoin price',
    ];
    for (const q of queries) {
      expect(isRealtimeOrLiveFactQuery(q)).toBe(true);
      expect(needsLiveSearch(q)).toBe(true);
    }
    expect(needsLiveSearch('Nvidia')).toBe(false);
    expect(needsLiveSearch('Who is Techno Gamerz?')).toBe(false);
  });

  it('parses real YouTube results without fabricating anything on failure', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      if (String(url).includes('youtube.com')) {
        return new Response(makeYouTubeHtml([sampleRenderer, { videoId: 'bad' }]), { status: 200 });
      }
      return new Response('error', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const videos = await fetchLiveYouTubeVideos('Techno Gamerz latest video');
    expect(videos).toHaveLength(1);
    const v = videos[0];
    expect(v.title).toBe('Techno Gamerz new GTA V episode');
    expect(v.channel).toBe('Techno Gamerz');
    expect(v.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(v.publishedText).toBe('2 days ago');
    expect(v.publishedAtIso).toBeTruthy();
    expect(v.durationText).toBe('12:34');
    expect(v.description).toContain('GTA V');
    expect(v.thumbnailUrl).toContain('i.ytimg.com');
  });

  it('enriches video queries with verified YouTube results and a direct fallback answer', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      if (String(url).includes('youtube.com')) {
        return new Response(makeYouTubeHtml([sampleRenderer]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await enrichQueryWithRealtimeData('Techno gamer current video');
    expect(result.videos && result.videos.length).toBe(1);
    expect(result.hasLiveDomainData).toBe(true);
    expect(result.systemContextBlock).toContain('[LIVE YOUTUBE VIDEO RESULTS');
    expect(result.systemContextBlock).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.directFallbackMarkdown).toContain('Techno Gamerz new GTA V episode');
    expect(result.directFallbackMarkdown).toContain('**Channel:** Techno Gamerz');
    expect(result.sources.some((s) => s.url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('never returns generic fallback phrases and never shadows live queries with canned answers', () => {
    const banned = ['topic I can', 'Ask a specific follow-up', 'research this in detail'];
    const prompts = [
      "Who's Babur?",
      'Techno gamer current video',
      'Latest gaming video',
      'random unseen question xyz',
    ];
    for (const p of prompts) {
      const reply = generateResilientResponse(p);
      for (const phrase of banned) {
        expect(reply).not.toContain(phrase);
      }
      expect(reply).not.toMatch(/Hello!\s*I am Deku AI/i);
      expect(reply).not.toMatch(/independent(?: AI)? workspace assistant/i);
    }
    // The canned biography must not shadow a live video request.
    expect(generateResilientResponse('Techno gamer current video')).not.toContain('Ujjwal Chaurasia');
    // Preserved behavior: biographical questions without recency still answer directly.
    expect(generateResilientResponse('Nvidia')).toContain('NVIDIA Corporation');
    expect(generateResilientResponse('Who is Techno Gamerz?')).toContain('Techno Gamerz');
    expect(generateResilientResponse('Hello')).toBe('Hello! How can I help you today?');
  });
});
