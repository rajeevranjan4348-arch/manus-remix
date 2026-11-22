import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

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

export interface VerifiedEntityProfile {
  canonicalName: string;
  displayName: string;
  category: VisualSubjectCategory;
  isFictionalCharacter: boolean;
  portrayedBy?: string;
  aliases: string[];
  searchQueries: string[];
  requiredTokens: string[];
  disallowedTokens: string[];
}

export interface VisualSubjectDetection {
  shouldDisplayImages: boolean;
  category: VisualSubjectCategory;
  primarySubject: string;
  canonicalEntity?: string;
  portrayedBy?: string;
  isFictionalCharacter?: boolean;
  subjects: string[];
  searchQueries: string[];
  isComparison: boolean;
  reason: string;
  entityProfile?: VerifiedEntityProfile;
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

// In-memory LRU caches to keep repeated renders instant and avoid redundant network calls
const visualResultCache = new Map<string, VisualAnswerImage[]>();
const verifiedEntityCache = new Map<string, VerifiedEntityProfile>();
const MAX_VISUAL_CACHE_ENTRIES = 100;

interface StaticEntityDefinition {
  canonicalName: string;
  displayName: string;
  category: VisualSubjectCategory;
  isFictionalCharacter: boolean;
  portrayedBy?: string;
  aliases: string[];
  searchQueries: string[];
  requiredTokens: string[];
  disallowedTokens?: string[];
}

const TMKOC_OTHER_CAST_TOKENS = [
  'disha vakani',
  'munmun dutta',
  'shailesh lodha',
  'amit bhatt',
  'mandar chandwadkar',
  'shyam pathak',
  'asit kumarr modi',
  'asit modi',
  'tanuj mahashabde',
  'ambika ranjankar',
  'kavi kumar azad',
  'bhavya gandhi',
  'raj anadkat',
  'nitish bhaluni',
  'sunayana fozdar',
  'sachin shroff',
  'palak sindhwani',
  'sonalika joshi',
  'jennifer mistry',
  'neha mehta',
  'gurucharan singh',
  'sharad sankla',
  'ghanashyam nayak',
  'salman khan',
  'shah rukh khan',
  'amitabh bachchan',
  'akshay kumar',
  'ajay devgn',
  'ranveer singh',
  'deepika padukone',
  'varun dhawan',
  'alia bhatt',
];

const VERIFIED_ENTITY_DEFINITIONS: StaticEntityDefinition[] = [
  {
    canonicalName: 'Jethalal Champaklal Gada',
    displayName: 'Jethalal Champaklal Gada',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Dilip Joshi',
    aliases: ['jethalal', 'jetha', 'jethiya', 'jethalal gada', 'jethalal champaklal gada'],
    searchQueries: ['Jethalal Champaklal Gada', 'Jethalal', 'Dilip Joshi'],
    requiredTokens: ['jethalal', 'dilip joshi'],
    disallowedTokens: TMKOC_OTHER_CAST_TOKENS,
  },
  {
    canonicalName: 'Daya Jethalal Gada',
    displayName: 'Daya Jethalal Gada (Dayaben)',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Disha Vakani',
    aliases: ['daya', 'dayaben', 'daya gada', 'daya jethalal gada', 'daya bhabhi'],
    searchQueries: ['Daya Jethalal Gada', 'Dayaben', 'Disha Vakani'],
    requiredTokens: ['dayaben', 'daya gada', 'disha vakani'],
    disallowedTokens: TMKOC_OTHER_CAST_TOKENS.filter((t) => t !== 'disha vakani'),
  },
  {
    canonicalName: 'Atmaram Tukaram Bhide',
    displayName: 'Atmaram Tukaram Bhide',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Mandar Chandwadkar',
    aliases: ['bhide', 'atmaram bhide', 'atmaram tukaram bhide', 'master bhide'],
    searchQueries: ['Atmaram Tukaram Bhide', 'Mandar Chandwadkar'],
    requiredTokens: ['bhide', 'atmaram', 'mandar chandwadkar'],
    disallowedTokens: TMKOC_OTHER_CAST_TOKENS.filter((t) => t !== 'mandar chandwadkar'),
  },
  {
    canonicalName: 'Taarak Mehta',
    displayName: 'Taarak Mehta',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Shailesh Lodha',
    aliases: ['taarak mehta', 'tarak mehta', 'mehta sahab'],
    searchQueries: ['Taarak Mehta', 'Shailesh Lodha'],
    requiredTokens: ['taarak mehta', 'shailesh lodha'],
    disallowedTokens: TMKOC_OTHER_CAST_TOKENS.filter((t) => t !== 'shailesh lodha'),
  },
  {
    canonicalName: 'Champaklal Jayantilal Gada',
    displayName: 'Champaklal Jayantilal Gada',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Amit Bhatt',
    aliases: ['champaklal', 'champaklal gada', 'champaklal jayantilal gada', 'bapuji'],
    searchQueries: ['Champaklal Jayantilal Gada', 'Amit Bhatt'],
    requiredTokens: ['champaklal', 'amit bhatt'],
    disallowedTokens: TMKOC_OTHER_CAST_TOKENS.filter((t) => t !== 'amit bhatt'),
  },
  {
    canonicalName: 'Babita Krishnan Iyer',
    displayName: 'Babita Krishnan Iyer',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Munmun Dutta',
    aliases: ['babita', 'babita ji', 'babita iyer', 'babita krishnan iyer'],
    searchQueries: ['Babita Iyer', 'Munmun Dutta'],
    requiredTokens: ['babita', 'munmun dutta'],
    disallowedTokens: TMKOC_OTHER_CAST_TOKENS.filter((t) => t !== 'munmun dutta'),
  },
  {
    canonicalName: 'Patrakar Popatlal',
    displayName: 'Patrakar Popatlal',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Shyam Pathak',
    aliases: ['popatlal', 'patrakar popatlal', 'popatlal pandey'],
    searchQueries: ['Patrakar Popatlal', 'Shyam Pathak'],
    requiredTokens: ['popatlal', 'shyam pathak'],
    disallowedTokens: TMKOC_OTHER_CAST_TOKENS.filter((t) => t !== 'shyam pathak'),
  },
  {
    canonicalName: 'Techno Gamerz',
    displayName: 'Techno Gamerz (Ujjwal Chaurasia)',
    category: 'person',
    isFictionalCharacter: false,
    portrayedBy: 'Ujjwal Chaurasia',
    aliases: ['techno gamerz', 'ujjwal chaurasia', 'ujjwal gamer'],
    searchQueries: ['Ujjwal Chaurasia', 'Techno Gamerz'],
    requiredTokens: ['ujjwal chaurasia', 'techno gamerz'],
  },
  {
    canonicalName: 'Iron Man',
    displayName: 'Iron Man (Tony Stark)',
    category: 'character',
    isFictionalCharacter: true,
    portrayedBy: 'Robert Downey Jr.',
    aliases: ['iron man', 'ironman', 'tony stark'],
    searchQueries: ['Iron Man', 'Tony Stark', 'Robert Downey Jr.'],
    requiredTokens: ['iron man', 'tony stark', 'robert downey'],
  },
  {
    canonicalName: 'Spider-Man',
    displayName: 'Spider-Man (Peter Parker)',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['spider-man', 'spiderman', 'spider man', 'peter parker'],
    searchQueries: ['Spider-Man', 'Peter Parker Marvel'],
    requiredTokens: ['spider-man', 'spider man', 'spiderman', 'peter parker'],
  },
  {
    canonicalName: 'Batman',
    displayName: 'Batman (Bruce Wayne)',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['batman', 'bruce wayne'],
    searchQueries: ['Batman', 'Bruce Wayne DC'],
    requiredTokens: ['batman', 'bruce wayne'],
  },
  {
    canonicalName: 'Superman',
    displayName: 'Superman (Clark Kent)',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['superman', 'clark kent', 'kal-el'],
    searchQueries: ['Superman', 'Clark Kent DC'],
    requiredTokens: ['superman', 'clark kent'],
  },
  {
    canonicalName: 'Naruto Uzumaki',
    displayName: 'Naruto Uzumaki',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['naruto', 'naruto uzumaki'],
    searchQueries: ['Naruto Uzumaki', 'Naruto anime'],
    requiredTokens: ['naruto'],
  },
  {
    canonicalName: 'Son Goku',
    displayName: 'Son Goku',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['goku', 'son goku', 'kakarot'],
    searchQueries: ['Son Goku', 'Dragon Ball Goku'],
    requiredTokens: ['goku', 'kakarot'],
  },
  {
    canonicalName: 'Monkey D. Luffy',
    displayName: 'Monkey D. Luffy',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['luffy', 'monkey d luffy', 'monkey d. luffy', 'straw hat luffy'],
    searchQueries: ['Monkey D. Luffy', 'One Piece Luffy'],
    requiredTokens: ['luffy'],
  },
  {
    canonicalName: 'Satoru Gojo',
    displayName: 'Satoru Gojo',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['gojo', 'satoru gojo', 'gojo satoru'],
    searchQueries: ['Satoru Gojo', 'Jujutsu Kaisen Gojo'],
    requiredTokens: ['gojo'],
  },
  {
    canonicalName: 'Pikachu',
    displayName: 'Pikachu',
    category: 'character',
    isFictionalCharacter: true,
    aliases: ['pikachu', 'pokemon pikachu'],
    searchQueries: ['Pikachu', 'Pokemon Pikachu'],
    requiredTokens: ['pikachu'],
  },
  {
    canonicalName: 'Narendra Modi',
    displayName: 'Narendra Modi',
    category: 'person',
    isFictionalCharacter: false,
    aliases: [
      'narendra modi',
      'narendra damodardas modi',
      'prime minister india',
      'prime minister of india',
      'pm india',
      'pm of india',
      'indian prime minister',
    ],
    searchQueries: ['Narendra Modi', 'Prime Minister of India'],
    requiredTokens: ['narendra modi', 'pm modi', 'modi'],
  },
];

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
  /\.pdf$/i,
  /\.djvu$/i,
  /\.tif$/i,
  /\.tiff$/i,
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
  /map_of_/i,
  /locator_map/i,
  /location_map/i,
  /signature\.png/i,
  /_sign\.png/i,
  /autograph/i,
  /wordmark/i,
  /text_logo/i,
  /coat_of_arms/i,
  /emblem_of/i,
  /seal_of/i,
];

const GENERIC_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'who',
  'what',
  'where',
  'when',
  'why',
  'how',
  'actor',
  'actress',
  'character',
  'fictional',
  'series',
  'show',
  'movie',
  'film',
  'sitcom',
  'television',
  'indian',
  'american',
  'british',
  'japanese',
  'photo',
  'photograph',
  'image',
  'picture',
  'portrait',
  'file',
  'jpg',
  'jpeg',
  'png',
  'webp',
]);

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
    .replace(
      /^(tell me about|show me|give me information on|give me info about|explain|describe|biography of|history of|profile of|overview of|details about|facts about|everything about|do you know about|do you know who|do you know)\s+/i,
      ''
    )
    .replace(/\s+(is|are|was|were)\??$/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/\b(in hindi|in english|in detail|briefly|short note|wikipedia|wiki|biography|bio|net worth|age|height|photos|images|pictures)\b/gi, '')
    .replace(/[?!.,"'“”‘’]+$/g, '')
    .replace(/^["'“”‘’]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts ONLY the verified portraying actor when the assistant response
 * explicitly states that the queried fictional character is played/portrayed by that actor.
 * Never extracts unrelated proper nouns or co-stars mentioned elsewhere in the text.
 */
export function extractPortrayingActorForSubject(
  subject: string,
  assistantText?: string
): string | undefined {
  if (!assistantText || !subject) return undefined;
  const cleaned = assistantText
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ');

  // Match explicit "- **Actor:** Name" or "portrayed by actor Name" / "played by Name"
  const bulletActorMatch = cleaned.match(
    /-\s*\*\*Actor:\*\*\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/
  );
  if (bulletActorMatch?.[1]) {
    return bulletActorMatch[1].trim();
  }

  const inlineActorMatch = cleaned.match(
    /\b(?:played|portrayed)\s+by\s+(?:veteran\s+)?(?:indian\s+|american\s+|british\s+)?(?:actor\s+|actress\s+)?\*?\*?([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2})\*?\*?/i
  );
  if (inlineActorMatch?.[1]) {
    return inlineActorMatch[1].trim();
  }

  return undefined;
}

/**
 * Resolves a raw subject string into a canonical VerifiedEntityProfile.
 * Distinguishes fictional characters from portraying actors, resolves aliases,
 * and builds strict relevance validation tokens.
 */
export function resolveVerifiedEntityProfile(
  rawSubject: string,
  inferredCategory: VisualSubjectCategory = 'person',
  assistantContent?: string
): VerifiedEntityProfile {
  const cleanedSubject = cleanExtractedSubject(rawSubject);
  const normalized = normalizeSubjectKey(cleanedSubject);
  const cacheKey = `${normalized}::${Boolean(assistantContent)}`;

  const cached = verifiedEntityCache.get(cacheKey);
  if (cached) return cached;

  // 1. Check static verified entity directory by exact alias or normalized canonical name
  for (const def of VERIFIED_ENTITY_DEFINITIONS) {
    const defNormalized = normalizeSubjectKey(def.canonicalName);
    const aliasMatched = def.aliases.some((alias) => normalizeSubjectKey(alias) === normalized);
    if (aliasMatched || defNormalized === normalized) {
      const profile: VerifiedEntityProfile = {
        canonicalName: def.canonicalName,
        displayName: def.displayName,
        category: def.category,
        isFictionalCharacter: def.isFictionalCharacter,
        portrayedBy: def.portrayedBy,
        aliases: [...def.aliases],
        searchQueries: [...def.searchQueries],
        requiredTokens: def.requiredTokens.map((t) => normalizeSubjectKey(t)).filter(Boolean),
        disallowedTokens: (def.disallowedTokens || []).map((t) => normalizeSubjectKey(t)).filter(Boolean),
      };
      verifiedEntityCache.set(cacheKey, profile);
      return profile;
    }
  }

  // 2. Dynamic entity resolution
  let category = inferredCategory;
  const lowerSub = cleanedSubject.toLowerCase();
  if (/\b(naruto|goku|luffy|gojo|pikachu|iron man|spider-?man|batman|superman|jethalal|dayaben|bhide|shinchan|doraemon|harry potter|walter white|sherlock holmes|mr\.?\s*bean)\b/i.test(lowerSub)) {
    category = 'character';
  } else if (/\b(movie|film|series|show|sitcom|anime|cartoon|season|episode|tmkoc|taarak mehta ka ooltah chashmah|breaking bad|inception|interstellar|one piece|oppenheimer)\b/i.test(lowerSub)) {
    category = 'media';
  } else if (/\b(iphone|samsung|galaxy|pixel|macbook|ipad|playstation|xbox|tesla|cybertruck|ferrari|lamborghini|porsche|nvidia|apple|microsoft|google|sony|rolex)\b/i.test(lowerSub)) {
    category = 'brand_product';
  } else if (/\b(tiger|lion|elephant|leopard|cheetah|peacock|eagle|falcon|whale|dolphin|shark|panda|koala|penguin|dinosaur|t-rex|dog|cat|bird|animal)\b/i.test(lowerSub)) {
    category = 'animal_nature';
  } else if (/\b(taj mahal|eiffel tower|statue of liberty|colosseum|burj khalifa|mount everest|grand canyon|machu picchu|great wall|pyramids|temple|fort|palace|city|island|waterfall)\b/i.test(lowerSub)) {
    category = 'landmark_location';
  }

  const portrayedBy = extractPortrayingActorForSubject(cleanedSubject, assistantContent);
  const isFictionalCharacter = category === 'character' || Boolean(portrayedBy);
  if (isFictionalCharacter && category === 'person') {
    category = 'character';
  }

  const searchQueries: string[] = [cleanedSubject];
  if (portrayedBy && normalizeSubjectKey(portrayedBy) !== normalized) {
    searchQueries.push(portrayedBy);
  }

  const requiredTokens: string[] = [normalized];
  if (portrayedBy) {
    const actorNorm = normalizeSubjectKey(portrayedBy);
    if (actorNorm && !requiredTokens.includes(actorNorm)) {
      requiredTokens.push(actorNorm);
    }
  }

  const profile: VerifiedEntityProfile = {
    canonicalName: cleanedSubject,
    displayName: cleanedSubject,
    category,
    isFictionalCharacter,
    portrayedBy,
    aliases: [cleanedSubject],
    searchQueries,
    requiredTokens: requiredTokens.filter(Boolean),
    disallowedTokens: [],
  };

  if (verifiedEntityCache.size >= MAX_VISUAL_CACHE_ENTRIES) {
    const oldest = verifiedEntityCache.keys().next().value;
    if (oldest) verifiedEntityCache.delete(oldest);
  }
  verifiedEntityCache.set(cacheKey, profile);
  return profile;
}

/**
 * Validates whether a candidate image (from Wikipedia, Wikimedia Commons, or TVMaze)
 * actually depicts the requested entity.
 * Rejects unrelated celebrity photos, co-star portraits, and non-matching articles.
 */
export function isImageRelevantToEntity(
  image: Pick<VisualAnswerImage, 'url' | 'thumbnailUrl' | 'title' | 'caption' | 'subject'>,
  entity: VerifiedEntityProfile | string
): boolean {
  if (!image || !isValidPhotoUrl(image.url) || !isValidPhotoUrl(image.thumbnailUrl || image.url)) {
    return false;
  }

  const profile: VerifiedEntityProfile =
    typeof entity === 'string' ? resolveVerifiedEntityProfile(entity) : entity;

  const decodedFileKey = canonicalImageKey(image.url)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ');

  const normalizedTitle = normalizeSubjectKey(image.title || '');
  const normalizedCaption = normalizeSubjectKey(image.caption || '');
  const normalizedFilename = normalizeSubjectKey(decodedFileKey);

  const combinedMetadata = `${normalizedTitle} | ${normalizedCaption} | ${normalizedFilename}`;

  // Reject Wikipedia disambiguation, list, template, or category pages
  if (
    /\b(disambiguation|list of|filmography|awards and nominations|category|template|portal)\b/i.test(
      image.title || ''
    )
  ) {
    return false;
  }

  // 1. Check disallowed tokens (e.g., co-stars or unrelated celebrities from the same show/event)
  // If a disallowed celebrity/character name is present AND the primary entity's own canonical tokens are absent, reject!
  if (profile.disallowedTokens && profile.disallowedTokens.length > 0) {
    const hasDisallowed = profile.disallowedTokens.some(
      (badToken) => badToken.length >= 4 && combinedMetadata.includes(badToken)
    );
    if (hasDisallowed) {
      return false;
    }
  }

  // 2. Check exact required phrase match (canonical name, alias, or verified portraying actor)
  for (const reqPhrase of profile.requiredTokens) {
    if (!reqPhrase) continue;
    if (combinedMetadata.includes(reqPhrase)) {
      return true;
    }
  }

  // 3. Token-level validation for multi-word entity names (e.g. "Virat Kohli", "Shah Rukh Khan", "Bengal Tiger", "Apollo 11 Moon Landing")
  for (const reqPhrase of profile.requiredTokens) {
    const words = reqPhrase
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !GENERIC_STOPWORDS.has(w));

    if (words.length === 0) continue;

    if (words.length === 1) {
      const token = words[0];
      const wordBoundaryRegex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (wordBoundaryRegex.test(combinedMetadata)) {
        return true;
      }
    } else {
      // For multi-word entities:
      // All significant tokens must appear in the combined metadata, OR for 3+ word names at least 2 significant tokens including the primary/last identifier
      const matchedWords = words.filter((w) => {
        const regex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(combinedMetadata);
      });

      if (matchedWords.length === words.length) {
        return true;
      }
      if (words.length >= 3 && matchedWords.length >= 2) {
        return true;
      }
    }
  }

  return false;
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
  const vsMatch = rawPrompt.match(
    /^(?:compare\s+|difference\s+between\s+)?(.+?)\s+(?:vs\.?|versus|or|and)\s+(.+?)[?!.]*$/i
  );
  if (vsMatch && /\b(vs\.?|versus|compare|difference between)\b/i.test(rawPrompt)) {
    const left = cleanExtractedSubject(vsMatch[1]);
    const right = cleanExtractedSubject(vsMatch[2]);
    if (left.length >= 2 && right.length >= 2 && left.split(/\s+/).length <= 5 && right.split(/\s+/).length <= 5) {
      const leftProfile = resolveVerifiedEntityProfile(left);
      const rightProfile = resolveVerifiedEntityProfile(right);
      const subjects = [leftProfile.canonicalName, rightProfile.canonicalName];
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
  const whoMatch = rawPrompt.match(
    /^(?:who\s+(?:is|was|are|were)|who'?s|tell\s+me\s+about|do\s+you\s+know\s+(?:who|about)?|biography\s+of|profile\s+of|information\s+about|info\s+on)\s+(.+?)[?!.]*$/i
  );
  const whatWhereMatch = rawPrompt.match(
    /^(?:what\s+(?:is|was|are|were)|what'?s|where\s+(?:is|are)|show\s+me|describe)\s+(.+?)[?!.]*$/i
  );

  let candidateSubject = '';
  let inferredCategory: VisualSubjectCategory = 'none';

  if (whoMatch?.[1]) {
    candidateSubject = cleanExtractedSubject(whoMatch[1]);
    inferredCategory = 'person';
  } else if (whatWhereMatch?.[1]) {
    const candidate = cleanExtractedSubject(whatWhereMatch[1]);
    const isAbstractConcept =
      /\b(meaning|definition|difference|concept|recursion|polymorphism|closure|promises|async|await|inflation|democracy|philosophy|gravity|photosynthesis|mitosis|entropy|algorithm|database|latency|throughput|api|rest|graphql|oauth|jwt|cors|docker|kubernetes)\b/i.test(
        candidate
      );
    if (!isAbstractConcept && candidate.split(/\s+/).length <= 6) {
      candidateSubject = candidate;
      inferredCategory = /where\s+/i.test(rawPrompt) ? 'landmark_location' : 'historical_object';
    }
  } else {
    // Short direct entity name query (e.g. "Jethalal", "Virat Kohli", "Taj Mahal", "Naruto Uzumaki", "iPhone 16 Pro")
    const cleanedDirect = cleanExtractedSubject(rawPrompt);
    const wordCount = cleanedDirect.split(/\s+/).filter(Boolean).length;
    const looksLikeQuestionWithoutEntity =
      /^(why|how|when|can|could|should|would|will|did|does|do|is|are)\b/i.test(rawPrompt);
    if (!looksLikeQuestionWithoutEntity && wordCount >= 1 && wordCount <= 5 && cleanedDirect.length >= 3) {
      const normalized = normalizeSubjectKey(cleanedDirect);
      const isKnownEntity = VERIFIED_ENTITY_DEFINITIONS.some(
        (d) =>
          normalizeSubjectKey(d.canonicalName) === normalized ||
          d.aliases.some((a) => normalizeSubjectKey(a) === normalized)
      );
      const hasCapitalizedWords = /^[A-Z]/.test(cleanedDirect.trim());
      if (isKnownEntity || hasCapitalizedWords || explicitPhotoRequest) {
        candidateSubject = cleanedDirect;
        inferredCategory = 'person';
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

  const entityProfile = resolveVerifiedEntityProfile(
    candidateSubject,
    inferredCategory,
    assistantContent
  );

  // Follow-up suppression: if this subject (or a follow-up attribute question about a previously shown subject)
  // was already displayed earlier in the conversation and the user didn't explicitly ask for photos/images,
  // skip repeating the gallery.
  const normalizedPrimary = normalizeSubjectKey(candidateSubject);
  const normalizedCanonical = normalizeSubjectKey(entityProfile.canonicalName);
  const normalizedFullPrompt = normalizeSubjectKey(rawPrompt);
  const previousNormalized = Array.from(
    new Set(previousTurnSubjects.map(normalizeSubjectKey).filter(Boolean))
  );
  const matchesPreviousSubject = previousNormalized.some(
    (prev) =>
      prev === normalizedPrimary ||
      prev === normalizedCanonical ||
      (prev.length >= 3 &&
        (normalizedPrimary.includes(prev) ||
          normalizedCanonical.includes(prev) ||
          normalizedFullPrompt.includes(prev)))
  );

  if (!explicitPhotoRequest && normalizedPrimary && matchesPreviousSubject) {
    return {
      shouldDisplayImages: false,
      category: entityProfile.category,
      primarySubject: candidateSubject,
      canonicalEntity: entityProfile.canonicalName,
      portrayedBy: entityProfile.portrayedBy,
      isFictionalCharacter: entityProfile.isFictionalCharacter,
      subjects: [candidateSubject],
      searchQueries: [],
      isComparison: false,
      reason: 'Follow-up on already displayed subject',
      entityProfile,
    };
  }

  return {
    shouldDisplayImages: true,
    category: entityProfile.category,
    primarySubject: candidateSubject,
    canonicalEntity: entityProfile.canonicalName,
    portrayedBy: entityProfile.portrayedBy,
    isFictionalCharacter: entityProfile.isFictionalCharacter,
    subjects: [candidateSubject],
    searchQueries: entityProfile.searchQueries.slice(0, 4),
    isComparison: false,
    reason: `Detected visual entity (${entityProfile.category}): ${entityProfile.canonicalName}`,
    entityProfile,
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
  maxImages = 4,
  entityContext?: VerifiedEntityProfile | string
): VisualAnswerImage[] {
  const unique: VisualAnswerImage[] = [];
  const seenKeys = new Set<string>();
  for (const img of images) {
    if (!img || !isValidPhotoUrl(img.url) || !isValidPhotoUrl(img.thumbnailUrl || img.url)) {
      continue;
    }
    if (entityContext && !isImageRelevantToEntity(img, entityContext)) {
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

async function fetchVerifiedWikipediaAndCommonsImages(
  query: string,
  entityProfile: VerifiedEntityProfile,
  subjectLabel: string,
  signal?: AbortSignal
): Promise<VisualAnswerImage[]> {
  const results: VisualAnswerImage[] = [];
  const seenKeys = new Set<string>();

  const addVerifiedCandidate = (img: VisualAnswerImage) => {
    if (!isValidPhotoUrl(img.url) || !isValidPhotoUrl(img.thumbnailUrl)) return;
    if (img.width && img.height && (img.width < 100 || img.height < 100)) return;
    if (!isImageRelevantToEntity(img, entityProfile)) return;
    const key = canonicalImageKey(img.url);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push(img);
  };

  try {
    // 1. Search Wikipedia pages with PageImages
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrlimit=5&prop=pageimages|info|description&inprop=url&pithumbsize=720`;

    const res = await fetch(searchUrl, {
      signal: signal || AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data: any = await res.json();
      const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
      pages.sort((a: any, b: any) => (a?.index ?? 99) - (b?.index ?? 99));

      const verifiedPages: any[] = [];

      for (const page of pages as any[]) {
        const thumbUrl = page?.thumbnail?.source;
        const pageTitle = String(page?.title || '');
        const pageDesc = String(page?.description || '');
        const pageUrl = String(
          page?.fullurl ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`
        );

        // Verify the Wikipedia article itself matches the requested entity (not a random article mentioning the word)
        const candidatePageImg: VisualAnswerImage = {
          id: `wiki_pi_${page.pageid || pageTitle}`,
          url: thumbUrl || 'https://upload.wikimedia.org/valid.jpg',
          thumbnailUrl: thumbUrl || 'https://upload.wikimedia.org/valid.jpg',
          title: pageTitle,
          caption: pageDesc ? `${pageTitle} — ${pageDesc}` : pageTitle,
          sourceUrl: pageUrl,
          sourceName: 'Wikipedia',
          subject: subjectLabel,
          width: page?.thumbnail?.width,
          height: page?.thumbnail?.height,
        };

        const isArticleAboutEntity = isImageRelevantToEntity(candidatePageImg, entityProfile);
        if (!isArticleAboutEntity) {
          continue;
        }

        verifiedPages.push(page);
        if (thumbUrl && isValidPhotoUrl(thumbUrl)) {
          addVerifiedCandidate({
            ...candidatePageImg,
            url: thumbUrl,
            thumbnailUrl: thumbUrl,
          });
        }
      }

      // 2. Only inspect media-list of a verified Wikipedia article about the entity itself
      const topVerifiedPage: any = verifiedPages[0];
      if (topVerifiedPage?.title && results.length < 4) {
        const encodedTitle = encodeURIComponent(String(topVerifiedPage.title).replace(/\s+/g, '_'));
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
            const itemTitle = String(item?.title || '')
              .replace(/^File:/i, '')
              .replace(/\.[a-z0-9]+$/i, '')
              .replace(/[_-]+/g, ' ')
              .trim();
            const captionText = String(item?.caption?.text || itemTitle || topVerifiedPage.title).trim();

            addVerifiedCandidate({
              id: `wiki_media_${canonicalImageKey(fullUrl)}`,
              url: fullUrl,
              thumbnailUrl: fullUrl,
              title: itemTitle || String(topVerifiedPage.title || subjectLabel),
              caption: captionText.slice(0, 140),
              sourceUrl: String(
                topVerifiedPage.fullurl || `https://en.wikipedia.org/wiki/${encodedTitle}`
              ),
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

  // 3. Query Wikimedia Commons directly for verified photographs of the entity
  if (results.length < 4) {
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(
        `filetype:bitmap "${query}"`
      )}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|dimensions|extmetadata&iiurlwidth=720`;

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

          const rawDesc = String(
            info?.extmetadata?.ImageDescription?.value ||
              info?.extmetadata?.ObjectName?.value ||
              ''
          )
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          addVerifiedCandidate({
            id: `commons_${page.pageid || cleanTitle}`,
            url: info?.url && isValidPhotoUrl(info.url) ? info.url : thumbUrl,
            thumbnailUrl: thumbUrl,
            title: cleanTitle || subjectLabel,
            caption: (rawDesc || cleanTitle || subjectLabel).slice(0, 140),
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

async function fetchVerifiedCharacterOrActorFallback(
  query: string,
  entityProfile: VerifiedEntityProfile,
  subjectLabel: string,
  signal?: AbortSignal
): Promise<VisualAnswerImage[]> {
  const results: VisualAnswerImage[] = [];
  try {
    // 1. TVMaze character search first for fictional characters
    if (entityProfile.isFictionalCharacter) {
      const charRes = await fetch(
        `https://api.tvmaze.com/search/characters?q=${encodeURIComponent(query)}`,
        { signal: signal || AbortSignal.timeout(3500) }
      ).catch(() => null);
      if (charRes && charRes.ok) {
        const charItems: any[] = await charRes.json();
        for (const item of charItems.slice(0, 3)) {
          const charObj = item?.character;
          const imgUrl = charObj?.image?.original || charObj?.image?.medium;
          const thumbUrl = charObj?.image?.medium || imgUrl;
          if (imgUrl && /^https?:\/\//i.test(imgUrl)) {
            const candidate: VisualAnswerImage = {
              id: `tvmaze_char_${charObj.id}`,
              url: imgUrl.replace(/^http:\/\//i, 'https://'),
              thumbnailUrl: (thumbUrl || imgUrl).replace(/^http:\/\//i, 'https://'),
              title: String(charObj.name || subjectLabel),
              caption: `${charObj.name || subjectLabel}`,
              sourceUrl: String(charObj.url || 'https://www.tvmaze.com'),
              sourceName: 'TVMaze',
              subject: subjectLabel,
            };
            if (isImageRelevantToEntity(candidate, entityProfile)) {
              results.push(candidate);
            }
          }
        }
      }
    }

    // 2. TVMaze person search with strict name verification
    const tvRes = await fetch(
      `https://api.tvmaze.com/search/people?q=${encodeURIComponent(query)}`,
      { signal: signal || AbortSignal.timeout(3500) }
    );
    if (tvRes.ok) {
      const items: any[] = await tvRes.json();
      for (const item of items.slice(0, 3)) {
        const personName = String(item?.person?.name || '').trim();
        const imgUrl = item?.person?.image?.original || item?.person?.image?.medium;
        const thumbUrl = item?.person?.image?.medium || imgUrl;
        if (personName && imgUrl && /^https?:\/\//i.test(imgUrl)) {
          const candidate: VisualAnswerImage = {
            id: `tvmaze_person_${item.person.id}`,
            url: imgUrl.replace(/^http:\/\//i, 'https://'),
            thumbnailUrl: (thumbUrl || imgUrl).replace(/^http:\/\//i, 'https://'),
            title: entityProfile.isFictionalCharacter && entityProfile.portrayedBy
              ? `${entityProfile.canonicalName} (${personName})`
              : personName,
            caption: entityProfile.isFictionalCharacter
              ? `${personName} (${entityProfile.canonicalName})`
              : personName,
            sourceUrl: String(item.person.url || 'https://www.tvmaze.com'),
            sourceName: 'TVMaze',
            subject: subjectLabel,
          };
          // Strictly verify that the TVMaze person name matches the entity or its portraying actor
          const normPerson = normalizeSubjectKey(personName);
          const matchesEntityOrActor = entityProfile.requiredTokens.some(
            (token) => token === normPerson
          );
          if (matchesEntityOrActor && isImageRelevantToEntity(candidate, entityProfile)) {
            results.push(candidate);
          }
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
  const entityProfile =
    detection.entityProfile ||
    resolveVerifiedEntityProfile(detection.primarySubject, detection.category);

  const cacheKey = `${entityProfile.canonicalName.toLowerCase()}::${detection.searchQueries.join('|').toLowerCase()}`;
  const cached = visualResultCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached.slice(0, maxImages);
  }

  const collected: VisualAnswerImage[] = [];
  const seenKeys = new Set<string>();

  const pushVerifiedUnique = (img: VisualAnswerImage, targetEntity?: VerifiedEntityProfile) => {
    if (!isValidPhotoUrl(img.url) || !isValidPhotoUrl(img.thumbnailUrl)) return;
    const profileToCheck = targetEntity || entityProfile;
    if (!detection.isComparison && !isImageRelevantToEntity(img, profileToCheck)) {
      return;
    }
    if (detection.isComparison && img.subject) {
      const subProfile = resolveVerifiedEntityProfile(img.subject);
      if (!isImageRelevantToEntity(img, subProfile)) {
        return;
      }
    }
    const key = canonicalImageKey(img.url);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    collected.push(img);
  };

  // 1. Try server-side /api/visual-search endpoint first (fast & cached on server)
  try {
    const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);
    const serverRes = await fetch('/api/visual-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        primarySubject: entityProfile.canonicalName,
        subjects: detection.subjects,
        queries: detection.searchQueries,
        requiredTokens: entityProfile.requiredTokens,
        disallowedTokens: entityProfile.disallowedTokens,
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
            pushVerifiedUnique(img);
            if (collected.length >= maxImages) break;
          }
        }
      }
    }
  } catch {
    // Seamlessly continue to client-side CORS-safe Wikipedia/Commons retrieval
  }

  // 2. Client-side CORS-safe retrieval with strict entity relevance validation
  if (collected.length < 2) {
    if (detection.isComparison && detection.subjects.length >= 2) {
      const perSubjectLists = await Promise.all(
        detection.subjects.map((sub) => {
          const subProfile = resolveVerifiedEntityProfile(sub);
          return fetchVerifiedWikipediaAndCommonsImages(sub, subProfile, sub, options?.signal);
        })
      );
      for (let i = 0; i < 3; i++) {
        for (let sIdx = 0; sIdx < perSubjectLists.length; sIdx++) {
          const list = perSubjectLists[sIdx];
          const subProfile = resolveVerifiedEntityProfile(detection.subjects[sIdx]);
          if (list[i]) {
            pushVerifiedUnique(list[i], subProfile);
          }
          if (collected.length >= maxImages) break;
        }
        if (collected.length >= maxImages) break;
      }
    } else {
      for (const query of detection.searchQueries) {
        const imgs = await fetchVerifiedWikipediaAndCommonsImages(
          query,
          entityProfile,
          entityProfile.canonicalName,
          options?.signal
        );
        for (const img of imgs) {
          pushVerifiedUnique(img);
          if (collected.length >= maxImages) break;
        }
        if (collected.length >= maxImages) break;
      }

      if (collected.length === 0) {
        for (const query of detection.searchQueries) {
          const fallbackImgs = await fetchVerifiedCharacterOrActorFallback(
            query,
            entityProfile,
            entityProfile.canonicalName,
            options?.signal
          );
          for (const img of fallbackImgs) {
            pushVerifiedUnique(img);
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
