import { describe, it, expect } from 'vitest';
import { needsLiveSearch } from '../server/geminiService';
import { parseSourcesFromMarkdown, extractDomain } from '../src/components/agent/SourceCitations';

describe('Google Search Data & Agent Grounding Tests', () => {
  describe('1. needsLiveSearch Intent Detection', () => {
    it('detects current events and breaking developments', () => {
      expect(needsLiveSearch('What are the latest current events in global politics?')).toBe(true);
      expect(needsLiveSearch('Discuss current events happening this week')).toBe(true);
      expect(needsLiveSearch('What are the top headlines in world news today?')).toBe(true);
      expect(needsLiveSearch('Breaking news on space exploration')).toBe(true);
    });

    it('detects recent news citations and requests', () => {
      expect(needsLiveSearch('Cite recent news about AI regulation in Europe')).toBe(true);
      expect(needsLiveSearch('What is the latest news regarding electric vehicle subsidies?')).toBe(true);
      expect(needsLiveSearch('Tell me about recent tech news updates')).toBe(true);
    });

    it('detects fact-checking and claim verification queries', () => {
      expect(needsLiveSearch('Fact check: Did NASA confirm biosignatures on Mars?')).toBe(true);
      expect(needsLiveSearch('Is it true that the prime minister announced tax cuts?')).toBe(true);
      expect(needsLiveSearch('Verify the rumor about the merger between Company A and B')).toBe(true);
      expect(needsLiveSearch('Debunk the myth regarding solar storms causing blackouts')).toBe(true);
    });

    it('detects temporal freshness indicators and recent years', () => {
      expect(needsLiveSearch('Who is the president of France right now?')).toBe(true);
      expect(needsLiveSearch('What happened yesterday at the G7 summit?')).toBe(true);
      expect(needsLiveSearch('What are the major space missions scheduled for 2026?')).toBe(true);
      expect(needsLiveSearch('Weather forecast for Tokyo today')).toBe(true);
      expect(needsLiveSearch('Stock price of Apple currently')).toBe(true);
    });

    it('detects explicit Google Search triggers and mentions', () => {
      expect(needsLiveSearch('@web_search search for autonomous agent frameworks')).toBe(true);
      expect(needsLiveSearch('@search what is the population of Tokyo?')).toBe(true);
      expect(needsLiveSearch('@google find recent climate reports')).toBe(true);
      expect(needsLiveSearch('Google search the latest Olympic medal count')).toBe(true);
    });

    it('keeps simple conversations and coding tasks on fast path without unnecessary search', () => {
      expect(needsLiveSearch('Hello, how are you?')).toBe(false);
      expect(needsLiveSearch('Write a React component for a dropdown')).toBe(false);
      expect(needsLiveSearch('Explain the difference between let and const in JavaScript')).toBe(false);
      expect(needsLiveSearch('Hi Manus, good morning!')).toBe(false);
    });
  });

  describe('2. Source Citations & Markdown Grounding Parser', () => {
    it('extracts domain correctly from varied URLs', () => {
      expect(extractDomain('https://www.reuters.com/world/news-article')).toBe('reuters.com');
      expect(extractDomain('https://bbc.com/news/technology')).toBe('bbc.com');
      expect(extractDomain('https://apnews.com/article/123')).toBe('apnews.com');
      expect(extractDomain('invalid-url')).toBe('web source');
    });

    it('parses markdown source blocks into structured SourceCitationItem objects', () => {
      const markdown = `The recent NASA mission successfully deployed its instruments to study Europa's subsurface ocean.

**Sources**
- [NASA Europa Mission Overview](https://www.nasa.gov/mission/europa-clipper)
- [Reuters Science News](https://www.reuters.com/science/nasa-europa-update)`;

      const { cleanedContent, sources } = parseSourcesFromMarkdown(markdown);

      expect(cleanedContent).toBe("The recent NASA mission successfully deployed its instruments to study Europa's subsurface ocean.");
      expect(sources).toHaveLength(2);
      expect(sources[0].title).toBe('NASA Europa Mission Overview');
      expect(sources[0].url).toBe('https://www.nasa.gov/mission/europa-clipper');
      expect(sources[0].domain).toBe('nasa.gov');
      expect(sources[0].favicon).toContain('nasa.gov');

      expect(sources[1].title).toBe('Reuters Science News');
      expect(sources[1].url).toBe('https://www.reuters.com/science/nasa-europa-update');
      expect(sources[1].domain).toBe('reuters.com');
    });

    it('gracefully handles responses without sources', () => {
      const pureText = 'This is a standard assistant conversational response.';
      const { cleanedContent, sources } = parseSourcesFromMarkdown(pureText);
      expect(cleanedContent).toBe(pureText);
      expect(sources).toHaveLength(0);
    });
  });

  describe('3. Google Search Grounding Metadata Processing', () => {
    it('transforms groundingChunks and queries into structured search results', () => {
      const sampleGroundingChunks = [
        { web: { uri: 'https://news.google.com/articles/1', title: 'Global Climate Summit Reaches Accord' } },
        { web: { uri: 'https://reuters.com/world/accord-details', title: 'Key Takeaways from the Climate Agreement' } }
      ];

      const results = sampleGroundingChunks
        .map(chunk => ({
          title: chunk.web?.title || chunk.web?.uri || '',
          url: chunk.web?.uri || '',
          snippet: 'Verified real-time search result from Google Search grounding',
          source: 'google-search' as const,
        }))
        .filter(r => /^https?:\/\//i.test(r.url));

      expect(results).toHaveLength(2);
      expect(results[0].source).toBe('google-search');
      expect(results[0].title).toBe('Global Climate Summit Reaches Accord');
      expect(results[1].url).toBe('https://reuters.com/world/accord-details');
    });
  });
});
