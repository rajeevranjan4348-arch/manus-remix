export type VisualSubjectCategory =
  | 'person'
  | 'character'
  | 'media'
  | 'brand_product'
  | 'animal_nature'
  | 'landmark_location'
  | 'historical_object'
  | 'comparison'
  | 'none';

export interface VisualSubjectDetection {
  shouldDisplayImages: boolean;
  category: VisualSubjectCategory;
  primarySubject: string;
  subjects: string[];
  searchQueries: string[];
  isComparison: boolean;
  reason: string;
}

export interface VisualAnswerImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  title: string;
  caption?: string;
  sourceUrl: string;
  sourceName: string;
  subject: string;
  width?: number;
  height?: number;
}

export interface VisualAnswerResult {
  detection: VisualSubjectDetection;
  images: VisualAnswerImage[];
}

// In-memory LRU cache to keep repeated renders instant and avoid redundant network calls
const visualResultCache = new Map<string, VisualAnswerImage[]>();
const MAX_VISUAL_CACHE_ENTRIES = 80;

// Known character / celebrity / entity expansions that enrich search recall with real actor/show photos
const ENTITY_SEARCH_EXPANSIONS: Record<string, string[]> = {
  jethalal: ['Dilip Joshi', 'Jethalal Champaklal Gada', 'Taarak Mehta Ka Ooltah Chashmah'],
  'jethalal gada': ['Dilip Joshi', 'Jethalal Champaklal Gada', 'Taarak Mehta Ka Ooltah Chashmah'],
  'jethalal champaklal gada': ['Dilip Joshi', 'Taarak Mehta Ka Ooltah Chashmah'],
  daya: ['Disha Vakani', 'Taarak Mehta Ka Ooltah Chashmah'],
  'daya gada': ['Disha Vakani', 'Taarak Mehta Ka Ooltah Chashmah'],
  dayaben: ['Disha Vakani', 'Taarak Mehta Ka Ooltah Chashmah'],
  bhide: ['Mandar Chandwadkar', 'Taarak Mehta Ka Ooltah Chashmah'],
  'atmaram bhide': ['Mandar Chandwadkar', 'Taarak Mehta Ka Ooltah Chashmah'],
  'taarak mehta': ['Shailesh Lodha', 'Taarak Mehta Ka Ooltah Chashmah'],
  champaklal: ['Amit Bhatt', 'Taarak Mehta Ka Ooltah Chashmah'],
  babita: ['Munmun Dutta', 'Taarak Mehta Ka Ooltah Chashmah'],
  'babita ji': ['Munmun Dutta', 'Taarak Mehta Ka Ooltah Chashmah'],
  popatlal: ['Shyam Pathak', 'Taarak Mehta Ka Ooltah Chashmah'],
  'techno gamerz': ['Ujjwal Chaurasia', 'Techno Gamerz'],
  'iron man': ['Iron Man', 'Robert Downey Jr. Tony Stark'],
  'spider-man': ['Spider-Man', 'Peter Parker Marvel'],
  spiderman: ['Spider-Man', 'Peter Parker Marvel'],
  batman: ['Batman', 'Bruce Wayne DC'],
  superman: ['Superman', 'Clark Kent DC'],
  naruto: ['Naruto Uzumaki', 'Naruto anime'],
  goku: ['Son Goku', 'Dragon Ball Goku'],
  luffy: ['Monkey D. Luffy', 'One Piece Luffy'],
  gojo: ['Satoru Gojo', 'Jujutsu Kaisen'],
  pikachu: ['Pikachu', 'Pokemon Pikachu'],
  'prime minister india': ['Narendra Modi', 'Prime Minister of India'],
  'prime minister of india': ['Narendra Modi', 'Prime Minister of India'],
  'pm india': ['Narendra Modi', 'Prime Minister of India'],
  'pm of india': ['Narendra Modi', 'Prime Minister of India'],
};

const NON_VISUAL_PATTERNS = [
  /^(hi|hello|hey|hiya|howdy|yo|namaste|greetings|good\s+(morning|afternoon|evening|night)|how are you|how's it going|what's up|whats up|thanks|thank you|ok|okay|bye|goodbye|yes|no|sure|cool|great|nice)[!?.\s]*$/i,
  /\b(which model|what model|what llm|which llm|underlying model|who built you|your architecture|what are you|who are you|what can you do)\b/i,
  /\b(what time is it|current time|time right now|today'?s date|what is the date|what day is today|weather in|temperature in|forecast for)\b/i,
  /\b(write a|write code|implement a|debug|fix this|refactor|create a function|typescript|javascript|python script|sql query|css layout|html page|react component|regex for|compile error|syntax error|stack trace)\b/i,
  /\b(solve|calculate|compute|integrate|differentiate|derivative of|equation|2\s*\+\s*2|\d+\s*[\+\-\*\/]\s*\d+)\b/i,
  /\b(translate|summarize this text|proofread|rewrite this|paraphrase|draft an email|write an essay|write a letter|write a poem)\b/i,
  /^@(gmail|calendar|drive|docs|sheets|slides|tasks|forms|keep|chat|meet|github)\b/i,
];

const UNWANTED_IMAGE_FILENAME_PATTERNS = [
  /\.svg$/i,
  /\.gif$/i,
  /\.ogg$/i,
  /\.oga$/i,
  /\.ogv$/i,
  /\.webm$/i,
  /\.mp3$/i,
  /\.wav$/i,
  /commons-logo/i,
  /wiki_letter/i,
  /question_book/i,
  /edit-clear/i,
  /disambig/i,
  /ambox/i,
  /crystal_clear/i,
  /nuvola/i,
  /symbol_/i,
  /folder_hexagonal/i,
  /oojs_ui/i,
  /red_pog/i,
  /blue_pog/i,
  /padlock/i,
  /lock-green/i,
  / lock-/i,
  /increase2/i,
  /decrease2/i,
  /steady2/i,
  /speaker_icon/i,
  /loudspeaker/i,
  / Blank /i,
  /1x1\.png/i,
  /replace_this_image/i,
  /no_free_image/i,
  /default_avatar/i,
  /placeholder/i,
  /icon[-_]?logo/i,
  /flag_of_/i,
  /signature\.png/i,
  /_sign\.png/i,
  /autograph/i,
];

export function normalizeSubjectKey(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\b(the|a|an|of|in|on|at|for|to|about|photo|photos|image|images|picture|pictures)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanExtractedSubject(raw: string): string {
  return String(raw || '')
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/^(who|what|where|when|which)\s+(is|are|was|were)\s+/i, '')
    .replace(/^(who'?s|what'?s|where'?s)\s+/i, '')
    .replace(/^(tell me about|show me|give me information on|give me info about|explain|describe|biography of|history of|profile of|overview of|details about|facts about|everything about|do you know about|do you know who|do you know)\s+/i, '')
    .replace(/\s+(is|are|was|were)\??$/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/\b(in hindi|in english|in detail|briefly|short note|wikipedia|wiki|biography|bio|net worth|age|height|photos|images|pictures)\b/gi, '')
    .replace(/[?!.,"'“”‘’]+$/g, '')
    .replace(/^["'“”‘’]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractAssistantProperNouns(assistantText?: string): string[] {
  if (!assistantText) return [];
  const cleaned = assistantText
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ');

  const boldMatches: string[] = [];
  const boldRegex = /\*\*([A-Z][A-Za-z0-9 .'-]{2,45})\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = boldRegex.exec(cleaned)) !== null) {
    const candidate = match[1].trim();
    if (
      candidate.length >= 3 &&
      !/^(Summary|Quick Information|Overview|Key Facts|Search Queries|Sources|Note|Important|Character|Actor|Show|Nationality|Founded|Creator|Known For|Impact|Core Technologies|Live Real-Time)$/i.test(
        candidate
      )
    ) {
      boldMatches.push(candidate);
    }
    if (boldMatches.length >= 4) break;
  }

  // Also check "played by actor X" or "portrayed by X"
  const actorMatch = cleaned.match(/\b(?:played|portrayed|created|founded|directed)\s+by\s+(?:actor\s+|actress\s+)?\*?\*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\*?\*?/);
  if (actorMatch?.[1] && !boldMatches.includes(actorMatch[1].trim())) {
    boldMatches.push(actorMatch[1].trim());
  }

  return boldMatches;
}

export function detectVisualSubjectQuery(
  prompt: string,
  assistantContent?: string,
  previousTurnSubjects: string[] = []
): VisualSubjectDetection {
  const rawPrompt = String(prompt || '')
    .replace(/\[IMAGE_DATA_URL:[^\]]+\]\s*/gi, '')
    .replace(/\[Attached[^\]]*\]\s*/gi, '')
    .replace(/^\[MODE:[^\]]*\]\s*/i, '')
    .replace(/^\[Think Harder[^\]]*\]\s*/i, '')
    .trim();

  if (!rawPrompt || rawPrompt.length < 2 || rawPrompt.length > 260) {
    return {
      shouldDisplayImages: false,
      category: 'none',
      primarySubject: '',
      subjects: [],
      searchQueries: [],
      isComparison: false,
      reason: 'Empty or long complex prompt',
    };
  }

  for (const pattern of NON_VISUAL_PATTERNS) {
    if (pattern.test(rawPrompt)) {
      return {
        shouldDisplayImages: false,
        category: 'none',
        primarySubject: '',
        subjects: [],
        searchQueries: [],
        isComparison: false,
        reason: 'Conversational, technical, or utility prompt',
      };
    }
  }

  const explicitPhotoRequest = /\b(photo|photos|image|images|picture|pictures|pic|pics|look like|looks like)\b/i.test(rawPrompt);

  // 1. Check for Comparison Queries ("X vs Y", "Compare X and Y", "Difference between X and Y")
  const vsMatch =
    rawPrompt.match(/^(?:compare\s+|difference\s+between\s+)?(.+?)\s+(?:vs\.?|versus|or|and)\s+(.+?)[?!.]*$/i);
  if (
    vsMatch &&
    (/\b(vs\.?|versus|compare|difference between)\b/i.test(rawPrompt))
  ) {
    const left = cleanExtractedSubject(vsMatch[1]);
    const right = cleanExtractedSubject(vsMatch[2]);
    if (left.length >= 2 && right.length >= 2 && left.split(/\s+/).length <= 5 && right.split(/\s+/).length <= 5) {
      const subjects = [left, right];
      return {
        shouldDisplayImages: true,
        category: 'comparison',
        primarySubject: `${left} vs ${right}`,
        subjects,
        searchQueries: subjects,
        isComparison: true,
        reason: 'Comparison between visual subjects',
      };
    }
  }

  // 2. Check for "Who is / Who's / What is / Tell me about / Where is" entity patterns
  const whoMatch = rawPrompt.match(/^(?:who\s+(?:is|was|are|were)|who'?s|tell\s+me\s+about|do\s+you\s+know\s+(?:who|about)?|biography\s+of|profile\s+of|information\s+about|info\s+on)\s+(.+?)[?!.]*$/i);
  const whatWhereMatch = rawPrompt.match(/^(?:what\s+(?:is|was|are|were)|what'?s|where\s+(?:is|are)|show\s+me|describe)\s+(.+?)[?!.]*$/i);

  let candidateSubject = '';
  let category: VisualSubjectCategory = 'none';

  if (whoMatch?.[1]) {
    candidateSubject = cleanExtractedSubject(whoMatch[1]);
    category = 'person';
  } else if (whatWhereMatch?.[1]) {
    const candidate = cleanExtractedSubject(whatWhereMatch[1]);
    // Avoid abstract conceptual "what is" questions like "what is love", "what is recursion", "what is inflation"
    const isAbstractConcept = /\b(meaning|definition|difference|concept|recursion|polymorphism|closure|promises|async|await|inflation|democracy|philosophy|gravity|photosynthesis|mitosis|entropy|algorithm|database|latency|throughput|api|rest|graphql|oauth|jwt|cors|docker|kubernetes)\b/i.test(
      candidate
    );
    if (!isAbstractConcept && candidate.split(/\s+/).length <= 6) {
      candidateSubject = candidate;
      category = /where\s+/i.test(rawPrompt) ? 'landmark_location' : 'historical_object';
    }
  } else {
    // Short direct entity name query (e.g. "Jethalal", "Virat Kohli", "Taj Mahal", "Naruto Uzumaki", "iPhone 16 Pro")
    const cleanedDirect = cleanExtractedSubject(rawPrompt);
    const wordCount = cleanedDirect.split(/\s+/).filter(Boolean).length;
    const looksLikeQuestionWithoutEntity = /^(why|how|when|can|could|should|would|will|did|does|do|is|are)\b/i.test(rawPrompt);
    if (!looksLikeQuestionWithoutEntity && wordCount >= 1 && wordCount <= 5 && cleanedDirect.length >= 3) {
      const normalized = normalizeSubjectKey(cleanedDirect);
      const isKnownExpansion = Boolean(ENTITY_SEARCH_EXPANSIONS[normalized]);
      const hasCapitalizedWords = /^[A-Z]/.test(cleanedDirect.trim());
      if (isKnownExpansion || hasCapitalizedWords || explicitPhotoRequest) {
        candidateSubject = cleanedDirect;
        category = 'person';
      }
    }
  }

  if (!candidateSubject) {
    return {
      shouldDisplayImages: false,
      category: 'none',
      primarySubject: '',
      subjects: [],
      searchQueries: [],
      isComparison: false,
      reason: 'No visual entity detected in prompt',
    };
  }

  // Refine category based on subject keywords
  const lowerSub = candidateSubject.toLowerCase();
  if (ENTITY_SEARCH_EXPANSIONS[normalizeSubjectKey(candidateSubject)] || /\b(naruto|goku|luffy|gojo|pikachu|iron man|spider-?man|batman|superman|jethalal|dayaben|bhide|shinchan|doraemon|avengers)\b/i.test(lowerSub)) {
    category = 'character';
  } else if (/\b(movie|film|series|show|sitcom|anime|cartoon|season|episode|tmkoc|taarak mehta|breaking bad|inception|interstellar|one piece)\b/i.test(lowerSub)) {
    category = 'media';
  } else if (/\b(iphone|samsung|galaxy|pixel|macbook|ipad|playstation|xbox|tesla|cybertruck|ferrari|lamborghini|porsche|nvidia|apple|microsoft|google|sony|rolex)\b/i.test(lowerSub)) {
    category = 'brand_product';
  } else if (/\b(tiger|lion|elephant|leopard|cheetah|peacock|eagle|falcon|whale|dolphin|shark|panda|koala|penguin|dinosaur|t-rex|dog|cat|bird|animal)\b/i.test(lowerSub)) {
    category = 'animal_nature';
  } else if (/\b(taj mahal|eiffel tower|statue of liberty|colosseum|burj khalifa|mount everest|grand canyon|machu picchu|great wall|pyramids|temple|fort|palace|city|island|waterfall)\b/i.test(lowerSub)) {
    category = 'landmark_location';
  }

  // Follow-up suppression: if this subject (or a follow-up attribute question about a previously shown subject)
  // was already displayed earlier in the conversation and the user didn't explicitly ask for photos/images,
  // skip repeating the gallery.
  const normalizedPrimary = normalizeSubjectKey(candidateSubject);
  const normalizedFullPrompt = normalizeSubjectKey(rawPrompt);
  const previousNormalized = Array.from(
    new Set(previousTurnSubjects.map(normalizeSubjectKey).filter(Boolean))
  );
  const matchesPreviousSubject = previousNormalized.some(
    (prev) =>
      prev === normalizedPrimary ||
      (prev.length >= 3 &&
        (normalizedPrimary.includes(prev) || normalizedFullPrompt.includes(prev)))
  );
  if (!explicitPhotoRequest && normalizedPrimary && matchesPreviousSubject) {
    return {
      shouldDisplayImages: false,
      category,
      primarySubject: candidateSubject,
      subjects: [candidateSubject],
      searchQueries: [],
      isComparison: false,
      reason: 'Follow-up on already displayed subject',
    };
  }

  // Build search query list combining primary subject, known entity expansions, and assistant-extracted proper nouns
  const searchQueries: string[] = [candidateSubject];
  const expansions = ENTITY_SEARCH_EXPANSIONS[normalizedPrimary];
  if (expansions) {
    for (const exp of expansions) {
      if (!searchQueries.includes(exp)) {
        searchQueries.push(exp);
      }
    }
  }

  const assistantEntities = extractAssistantProperNouns(assistantContent);
  for (const entity of assistantEntities) {
    if (
      normalizeSubjectKey(entity) !== normalizedPrimary &&
      !searchQueries.some((q) => normalizeSubjectKey(q) === normalizeSubjectKey(entity))
    ) {
      searchQueries.push(entity);
    }
    if (searchQueries.length >= 4) break;
  }

  return {
    shouldDisplayImages: true,
    category,
    primarySubject: candidateSubject,
    subjects: [candidateSubject],
    searchQueries: searchQueries.slice(0, 4),
    isComparison: false,
    reason: `Detected visual entity (${category}): ${candidateSubject}`,
  };
}

export function isValidPhotoUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  for (const pattern of UNWANTED_IMAGE_FILENAME_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

export const isValidVisualImageUrl = isValidPhotoUrl;

export function canonicalImageKey(url: string): string {
  try {
    const parsed = new URL(url);
    // Normalize Wikimedia thumb URLs so /thumb/a/ab/File.jpg/800px-File.jpg and /a/ab/File.jpg map to the same file
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const lastPart = decodeURIComponent(pathParts[pathParts.length - 1] || '')
      .replace(/^\d+px-/i, '')
      .toLowerCase();
    return lastPart || parsed.pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function deduplicateVisualImages(
  images: VisualAnswerImage[],
  maxImages = 4
): VisualAnswerImage[] {
  const unique: VisualAnswerImage[] = [];
  const seenKeys = new Set<string>();
  for (const img of images) {
    if (!img || !isValidPhotoUrl(img.url) || !isValidPhotoUrl(img.thumbnailUrl || img.url)) {
      continue;
    }
    const key = canonicalImageKey(img.url);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    unique.push(img);
    if (unique.length >= maxImages) break;
  }
  return unique;
}

async function fetchWikipediaSummaryAndMediaImages(
  query: string,
  subjectLabel: string,
  signal?: AbortSignal
): Promise<VisualAnswerImage[]> {
  const results: VisualAnswerImage[] = [];
  const seenKeys = new Set<string>();

  const addCandidate = (img: VisualAnswerImage) => {
    if (!isValidPhotoUrl(img.url) || !isValidPhotoUrl(img.thumbnailUrl)) return;
    if (img.width && img.height && (img.width < 100 || img.height < 100)) return;
    const key = canonicalImageKey(img.url);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push(img);
  };

  try {
    // 1. Search Wikipedia pages with PageImages (returns up to 5 closely matching articles + thumbnails)
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrlimit=5&prop=pageimages|info|description&inprop=url&pithumbsize=720`;

    const res = await fetch(searchUrl, {
      signal: signal || AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data: any = await res.json();
      const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
      // Sort by search index
      pages.sort((a: any, b: any) => (a?.index ?? 99) - (b?.index ?? 99));

      for (const page of pages as any[]) {
        const thumbUrl = page?.thumbnail?.source;
        const pageTitle = String(page?.title || query);
        const pageUrl = String(page?.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`);
        if (thumbUrl && isValidPhotoUrl(thumbUrl)) {
          addCandidate({
            id: `wiki_pi_${page.pageid || pageTitle}`,
            url: thumbUrl,
            thumbnailUrl: thumbUrl,
            title: pageTitle,
            caption: page?.description || pageTitle,
            sourceUrl: pageUrl,
            sourceName: 'Wikipedia',
            subject: subjectLabel,
            width: page?.thumbnail?.width,
            height: page?.thumbnail?.height,
          });
        }
      }

      // 2. If top Wikipedia page exists, also inspect its media-list for additional photographs
      const topPage: any = pages[0];
      if (topPage?.title && results.length < 4) {
        const encodedTitle = encodeURIComponent(String(topPage.title).replace(/\s+/g, '_'));
        const mediaRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodedTitle}`,
          { signal: signal || AbortSignal.timeout(4000) }
        );
        if (mediaRes.ok) {
          const mediaData: any = await mediaRes.json();
          const items = Array.isArray(mediaData?.items) ? mediaData.items : [];
          for (const item of items) {
            if (item?.type !== 'image') continue;
            const srcset = Array.isArray(item?.srcset) ? item.srcset : [];
            const bestSrc = srcset[srcset.length - 1]?.src || srcset[0]?.src;
            if (!bestSrc) continue;
            const fullUrl = bestSrc.startsWith('//') ? `https:${bestSrc}` : bestSrc;
            if (!isValidPhotoUrl(fullUrl)) continue;
            const captionText = String(item?.caption?.text || topPage.title || subjectLabel).trim();
            addCandidate({
              id: `wiki_media_${canonicalImageKey(fullUrl)}`,
              url: fullUrl,
              thumbnailUrl: fullUrl,
              title: String(topPage.title || subjectLabel),
              caption: captionText.slice(0, 140),
              sourceUrl: String(topPage.fullurl || `https://en.wikipedia.org/wiki/${encodedTitle}`),
              sourceName: 'Wikipedia',
              subject: subjectLabel,
            });
            if (results.length >= 4) break;
          }
        }
      }
    }
  } catch {
    // Ignore individual source timeout/errors
  }

  // 3. Query Wikimedia Commons directly for photographs if we still need more images
  if (results.length < 4) {
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(
        `filetype:bitmap ${query}`
      )}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|dimensions|extmetadata&iiurlwidth=720`;

      const commonsRes = await fetch(commonsUrl, {
        signal: signal || AbortSignal.timeout(4500),
      });
      if (commonsRes.ok) {
        const commonsData: any = await commonsRes.json();
        const pages = commonsData?.query?.pages ? Object.values(commonsData.query.pages) : [];
        pages.sort((a: any, b: any) => (a?.index ?? 99) - (b?.index ?? 99));

        for (const page of pages as any[]) {
          const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
          const thumbUrl = info?.thumburl || info?.url;
          const descUrl = info?.descriptionurl || 'https://commons.wikimedia.org';
          if (!thumbUrl || !isValidPhotoUrl(thumbUrl)) continue;

          const cleanTitle = String(page?.title || '')
            .replace(/^File:/i, '')
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[_-]+/g, ' ')
            .trim();

          addCandidate({
            id: `commons_${page.pageid || cleanTitle}`,
            url: info?.url && isValidPhotoUrl(info.url) ? info.url : thumbUrl,
            thumbnailUrl: thumbUrl,
            title: cleanTitle || subjectLabel,
            caption: cleanTitle || subjectLabel,
            sourceUrl: descUrl,
            sourceName: 'Wikimedia Commons',
            subject: subjectLabel,
            width: info?.thumbwidth || info?.width,
            height: info?.thumbheight || info?.height,
          });
          if (results.length >= 4) break;
        }
      }
    } catch {
      // Ignore Commons fetch errors
    }
  }

  return results;
}

async function fetchCharacterOrShowImagesFallback(
  query: string,
  subjectLabel: string,
  signal?: AbortSignal
): Promise<VisualAnswerImage[]> {
  const results: VisualAnswerImage[] = [];
  try {
    // TVMaze person & character search (CORS-enabled, great for TV actors & sitcom characters)
    const tvRes = await fetch(
      `https://api.tvmaze.com/search/people?q=${encodeURIComponent(query)}`,
      { signal: signal || AbortSignal.timeout(3500) }
    );
    if (tvRes.ok) {
      const items: any[] = await tvRes.json();
      for (const item of items.slice(0, 3)) {
        const imgUrl = item?.person?.image?.original || item?.person?.image?.medium;
        const thumbUrl = item?.person?.image?.medium || imgUrl;
        if (imgUrl && /^https?:\/\//i.test(imgUrl)) {
          results.push({
            id: `tvmaze_person_${item.person.id}`,
            url: imgUrl.replace(/^http:\/\//i, 'https://'),
            thumbnailUrl: (thumbUrl || imgUrl).replace(/^http:\/\//i, 'https://'),
            title: String(item.person.name || subjectLabel),
            caption: String(item.person.name || subjectLabel),
            sourceUrl: String(item.person.url || 'https://www.tvmaze.com'),
            sourceName: 'TVMaze',
            subject: subjectLabel,
          });
        }
      }
    }
  } catch {
    // Ignore fallback error
  }
  return results;
}

export async function fetchVisualAnswerImages(
  detection: VisualSubjectDetection,
  options?: { signal?: AbortSignal; maxImages?: number }
): Promise<VisualAnswerImage[]> {
  if (!detection.shouldDisplayImages || detection.searchQueries.length === 0) {
    return [];
  }

  const maxImages = options?.maxImages ?? 4;
  const cacheKey = `${detection.primarySubject.toLowerCase()}::${detection.searchQueries.join('|').toLowerCase()}`;
  const cached = visualResultCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached.slice(0, maxImages);
  }

  const collected: VisualAnswerImage[] = [];
  const seenKeys = new Set<string>();

  const pushUnique = (img: VisualAnswerImage) => {
    if (!isValidPhotoUrl(img.url) || !isValidPhotoUrl(img.thumbnailUrl)) return;
    const key = canonicalImageKey(img.url);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    collected.push(img);
  };

  // 1. Try server-side /api/visual-search endpoint first (fast & cached on server)
  try {
    const serverRes = await fetch('/api/visual-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primarySubject: detection.primarySubject,
        subjects: detection.subjects,
        queries: detection.searchQueries,
        isComparison: detection.isComparison,
        limit: maxImages,
      }),
      signal: options?.signal || AbortSignal.timeout(4500),
    });

    if (serverRes.ok) {
      const contentType = serverRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await serverRes.json();
        if (Array.isArray(payload?.images)) {
          for (const img of payload.images) {
            pushUnique(img);
            if (collected.length >= maxImages) break;
          }
        }
      }
    }
  } catch {
    // Seamlessly continue to client-side CORS-safe Wikipedia/Commons retrieval
  }

  // 2. Client-side CORS-safe retrieval (Wikipedia + Wikimedia Commons + TVMaze)
  if (collected.length < 2) {
    if (detection.isComparison && detection.subjects.length >= 2) {
      const perSubjectLists = await Promise.all(
        detection.subjects.map((sub) =>
          fetchWikipediaSummaryAndMediaImages(sub, sub, options?.signal)
        )
      );
      // Interleave images so each compared subject gets matched photos
      for (let i = 0; i < 3; i++) {
        for (const list of perSubjectLists) {
          if (list[i]) {
            pushUnique(list[i]);
          }
          if (collected.length >= maxImages) break;
        }
        if (collected.length >= maxImages) break;
      }
    } else {
      for (const query of detection.searchQueries) {
        const imgs = await fetchWikipediaSummaryAndMediaImages(
          query,
          detection.primarySubject,
          options?.signal
        );
        for (const img of imgs) {
          pushUnique(img);
          if (collected.length >= maxImages) break;
        }
        if (collected.length >= maxImages) break;
      }

      if (collected.length < 2) {
        for (const query of detection.searchQueries) {
          const fallbackImgs = await fetchCharacterOrShowImagesFallback(
            query,
            detection.primarySubject,
            options?.signal
          );
          for (const img of fallbackImgs) {
            pushUnique(img);
            if (collected.length >= maxImages) break;
          }
          if (collected.length >= maxImages) break;
        }
      }
    }
  }

  const finalImages = collected.slice(0, maxImages);
  if (finalImages.length > 0) {
    if (visualResultCache.size >= MAX_VISUAL_CACHE_ENTRIES) {
      const oldestKey = visualResultCache.keys().next().value;
      if (oldestKey) visualResultCache.delete(oldestKey);
    }
    visualResultCache.set(cacheKey, finalImages);
  }

  return finalImages;
}
