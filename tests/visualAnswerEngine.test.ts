import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  detectVisualSubjectQuery,
  deduplicateVisualImages,
  isValidVisualImageUrl,
  resolveVerifiedEntityProfile,
  isImageRelevantToEntity,
  VisualAnswerImage,
} from '../src/lib/visualAnswerEngine';
import { generateResilientResponse } from '../server/geminiService';

describe('Visual Answer Engine — Auto Image Display & Google AI Overview Style', () => {
  describe('1. Automatic Subject Detection Across All Required Categories', () => {
    it('detects famous characters and actors such as "Who\'s jethalal", resolves canonical entity, distinguishes character from actor, and excludes broad show queries', () => {
      const result = detectVisualSubjectQuery("Who's jethalal");
      expect(result.shouldDisplayImages).toBe(true);
      expect(result.canonicalEntity).toBe('Jethalal Champaklal Gada');
      expect(result.portrayedBy).toBe('Dilip Joshi');
      expect(result.isFictionalCharacter).toBe(true);
      expect(result.subjects.length).toBeGreaterThan(0);
      expect(result.searchQueries).toEqual(
        expect.arrayContaining(['Dilip Joshi', 'Jethalal Champaklal Gada'])
      );
      // Must NOT include broad show name that pulls unrelated cast/celebrity photos
      expect(result.searchQueries).not.toContain('Taarak Mehta Ka Ooltah Chashmah');
    });

    it('strictly validates entity relevance and rejects unrelated celebrity or co-star images', () => {
      const jethalalProfile = resolveVerifiedEntityProfile('jethalal');
      expect(jethalalProfile.canonicalName).toBe('Jethalal Champaklal Gada');
      expect(jethalalProfile.portrayedBy).toBe('Dilip Joshi');

      // Relevant Jethalal / Dilip Joshi photo -> accepted
      expect(
        isImageRelevantToEntity(
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/5/5c/Dilip_Joshi_at_event.jpg',
            thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/5c/Dilip_Joshi_at_event.jpg',
            title: 'Dilip Joshi',
            caption: 'Dilip Joshi portraying Jethalal Champaklal Gada',
            subject: 'Jethalal Champaklal Gada',
          },
          jethalalProfile
        )
      ).toBe(true);

      // Unrelated celebrity (Salman Khan) -> rejected
      expect(
        isImageRelevantToEntity(
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Salman_Khan_at_event.jpg',
            thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Salman_Khan_at_event.jpg',
            title: 'Salman Khan',
            caption: 'Salman Khan promoting film on television show',
            subject: 'Jethalal Champaklal Gada',
          },
          jethalalProfile
        )
      ).toBe(false);

      // Unrelated co-star (Disha Vakani / Munmun Dutta) -> rejected when user asked for Jethalal
      expect(
        isImageRelevantToEntity(
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/2/2b/Munmun_Dutta_2022.jpg',
            thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/2b/Munmun_Dutta_2022.jpg',
            title: 'Munmun Dutta',
            caption: 'Munmun Dutta at Taarak Mehta Ka Ooltah Chashmah event',
            subject: 'Jethalal Champaklal Gada',
          },
          jethalalProfile
        )
      ).toBe(false);
    });

    it('detects celebrities, actors, politicians, and athletes', () => {
      const shahRukh = detectVisualSubjectQuery('Who is Shah Rukh Khan?');
      expect(shahRukh.shouldDisplayImages).toBe(true);
      expect(shahRukh.subjects[0]).toMatch(/Shah Rukh Khan/i);

      const athlete = detectVisualSubjectQuery('Tell me about Virat Kohli');
      expect(athlete.shouldDisplayImages).toBe(true);
      expect(athlete.subjects[0]).toMatch(/Virat Kohli/i);

      const politician = detectVisualSubjectQuery('Who is the Prime Minister of India?');
      expect(politician.shouldDisplayImages).toBe(true);
      expect(politician.searchQueries).toEqual(expect.arrayContaining(['Narendra Modi']));
    });

    it('detects anime characters, fictional characters, and superheroes', () => {
      const anime = detectVisualSubjectQuery('Who is Naruto Uzumaki?');
      expect(anime.shouldDisplayImages).toBe(true);
      expect(anime.subjects[0]).toMatch(/Naruto Uzumaki/i);

      const hero = detectVisualSubjectQuery('Who is Spider-Man?');
      expect(hero.shouldDisplayImages).toBe(true);
    });

    it('detects movies, TV shows, web series, and cartoons', () => {
      const show = detectVisualSubjectQuery('What is Taarak Mehta Ka Ooltah Chashmah?');
      expect(show.shouldDisplayImages).toBe(true);

      const movie = detectVisualSubjectQuery('Tell me about Oppenheimer movie');
      expect(movie.shouldDisplayImages).toBe(true);
    });

    it('detects companies, brands, products, and gadgets', () => {
      const company = detectVisualSubjectQuery('What is NVIDIA Corporation?');
      expect(company.shouldDisplayImages).toBe(true);

      const gadget = detectVisualSubjectQuery('What is iPhone 16 Pro?');
      expect(gadget.shouldDisplayImages).toBe(true);
      expect(gadget.category).toBe('brand_product');
    });

    it('detects animals, birds, landmarks, and locations', () => {
      const animal = detectVisualSubjectQuery('Tell me about the Bengal Tiger');
      expect(animal.shouldDisplayImages).toBe(true);

      const landmark = detectVisualSubjectQuery('Where is the Taj Mahal?');
      expect(landmark.shouldDisplayImages).toBe(true);
      expect(landmark.category).toBe('landmark_location');
    });

    it('detects historical events, inventions, and famous things', () => {
      const history = detectVisualSubjectQuery('What was the Apollo 11 Moon Landing?');
      expect(history.shouldDisplayImages).toBe(true);
    });
  });

  describe('2. Intelligent Filtering & Follow-Up Suppression', () => {
    it('does not trigger images for greetings, coding, math, or meta questions', () => {
      expect(detectVisualSubjectQuery('Hello!').shouldDisplayImages).toBe(false);
      expect(detectVisualSubjectQuery('How are you doing today?').shouldDisplayImages).toBe(false);
      expect(detectVisualSubjectQuery('Write a TypeScript function to sort an array').shouldDisplayImages).toBe(false);
      expect(detectVisualSubjectQuery('Fix this React CSS bug in my component').shouldDisplayImages).toBe(false);
      expect(detectVisualSubjectQuery('What model are you running on?').shouldDisplayImages).toBe(false);
      expect(detectVisualSubjectQuery('What time is it right now?').shouldDisplayImages).toBe(false);
    });

    it('avoids repeating the image gallery on follow-up questions about the same subject', () => {
      const firstTurn = detectVisualSubjectQuery("Who's jethalal");
      expect(firstTurn.shouldDisplayImages).toBe(true);

      const followUp = detectVisualSubjectQuery(
        "What is jethalal's shop name?",
        undefined,
        firstTurn.subjects
      );
      expect(followUp.shouldDisplayImages).toBe(false);
    });

    it('detects comparison queries and extracts both subjects for matched images', () => {
      const comparison = detectVisualSubjectQuery('Compare Virat Kohli vs Rohit Sharma');
      expect(comparison.shouldDisplayImages).toBe(true);
      expect(comparison.isComparison).toBe(true);
      expect(comparison.subjects).toHaveLength(2);
      expect(comparison.subjects[0]).toMatch(/Virat Kohli/i);
      expect(comparison.subjects[1]).toMatch(/Rohit Sharma/i);
    });
  });

  describe('3. Image Quality, Deduplication & Broken/SVG Link Filtering', () => {
    it('rejects broken links, SVGs, icons, flags, and placeholder images', () => {
      expect(isValidVisualImageUrl('')).toBe(false);
      expect(isValidVisualImageUrl('not-a-url')).toBe(false);
      expect(isValidVisualImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Flag_of_India.svg')).toBe(false);
      expect(isValidVisualImageUrl('https://example.com/assets/icon-logo.png')).toBe(false);
      expect(isValidVisualImageUrl('https://example.com/default_avatar_placeholder.jpg')).toBe(false);
      expect(
        isValidVisualImageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Dilip_Joshi_at_event.jpg/640px-Dilip_Joshi_at_event.jpg')
      ).toBe(true);
    });

    it('deduplicates images that point to different thumbnail sizes of the same Wikimedia photograph', () => {
      const candidates: VisualAnswerImage[] = [
        {
          id: '1',
          url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Dilip_Joshi_2022.jpg/400px-Dilip_Joshi_2022.jpg',
          thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Dilip_Joshi_2022.jpg/400px-Dilip_Joshi_2022.jpg',
          title: 'Dilip Joshi',
          subject: 'Dilip Joshi',
          sourceName: 'Wikipedia',
          sourceUrl: 'https://en.wikipedia.org/wiki/Dilip_Joshi',
        },
        {
          id: '2',
          url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Dilip_Joshi_2022.jpg/800px-Dilip_Joshi_2022.jpg',
          thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Dilip_Joshi_2022.jpg/800px-Dilip_Joshi_2022.jpg',
          title: 'Dilip Joshi duplicate thumb',
          subject: 'Dilip Joshi',
          sourceName: 'Wikimedia Commons',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Dilip_Joshi_2022.jpg',
        },
        {
          id: '3',
          url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Dilip_Joshi_Portrait.jpg/640px-Dilip_Joshi_Portrait.jpg',
          thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Dilip_Joshi_Portrait.jpg/640px-Dilip_Joshi_Portrait.jpg',
          title: 'Dilip Joshi Portrait',
          subject: 'Dilip Joshi',
          sourceName: 'Wikimedia Commons',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Dilip_Joshi_Portrait.jpg',
        },
      ];

      const deduped = deduplicateVisualImages(candidates, 4);
      expect(deduped).toHaveLength(2);
      expect(deduped[0].id).toBe('1');
      expect(deduped[1].id).toBe('3');
    });
  });

  describe('4. Information Below Images & UI Integration', () => {
    it('formats "Who\'s Jethalal?" with the lead character summary and Quick Information bullets', () => {
      const response = generateResilientResponse("Who's Jethalal?");
      expect(response).toContain('**Jethalal Champaklal Gada**');
      expect(response).toContain('*Taarak Mehta Ka Ooltah Chashmah*');
      expect(response).toContain('**Dilip Joshi**');
      expect(response).toContain('### Quick Information');
      expect(response).toContain('- **Character:** Jethalal Champaklal Gada');
      expect(response).toContain('- **Actor:** Dilip Joshi');
      expect(response).toContain('- **Nationality:** Indian');
    });

    it('renders VisualAnswerGallery at the top of the AI response before MarkdownRenderer in ChatView.tsx', () => {
      const chatViewPath = path.resolve(__dirname, '../src/components/agent/ChatView.tsx');
      const chatViewCode = fs.readFileSync(chatViewPath, 'utf-8');

      const galleryIndex = chatViewCode.indexOf('<VisualAnswerGallery');
      const markdownIndex = chatViewCode.indexOf('<MarkdownRenderer');
      expect(galleryIndex).toBeGreaterThan(-1);
      expect(markdownIndex).toBeGreaterThan(-1);
      expect(galleryIndex).toBeLessThan(markdownIndex);
    });
  });
});
