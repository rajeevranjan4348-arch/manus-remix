export interface ServerVisualImage {
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

const UNWANTED_PATTERNS = [
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
  /speaker_icon/i,
  /loudspeaker/i,
  /1x1\.png/i,
  /replace_this_image/i,
  /no_free_image/i,
  /default_avatar/i,
  /placeholder/i,
  /signature\.png/i,
  /_sign\.png/i,
  /autograph/i,
];

function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  return !UNWANTED_PATTERNS.some((p) => p.test(url));
}

function getCanonicalKey(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(parts[parts.length - 1] || '')
      .replace(/^\d+px-/i, '')
      .toLowerCase();
    return last || parsed.pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

async function queryWikipediaAndCommonsForSubject(
  query: string,
  subjectLabel: string
): Promise<ServerVisualImage[]> {
  const images: ServerVisualImage[] = [];
  const seen = new Set<string>();

  const add = (img: ServerVisualImage) => {
    if (!isValidImageUrl(img.url) || !isValidImageUrl(img.thumbnailUrl)) return;
    if (img.width && img.height && (img.width < 100 || img.height < 100)) return;
    const key = getCanonicalKey(img.url);
    if (seen.has(key)) return;
    seen.add(key);
    images.push(img);
  };

  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrlimit=5&prop=pageimages|info|description&inprop=url&pithumbsize=720`;
    const res = await fetch(wikiUrl, {
      headers: { 'User-Agent': 'ManusAI/2.0 (VisualAnswerEngine)' },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data: any = await res.json();
      const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
      pages.sort((a: any, b: any) => (a?.index ?? 99) - (b?.index ?? 99));

      for (const page of pages as any[]) {
        const thumbUrl = page?.thumbnail?.source;
        const pageTitle = String(page?.title || query);
        const pageUrl = String(
          page?.fullurl ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`
        );
        if (thumbUrl && isValidImageUrl(thumbUrl)) {
          add({
            id: `srv_wiki_${page.pageid || pageTitle}`,
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
    }
  } catch {}

  if (images.length < 4) {
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(
        `filetype:bitmap ${query}`
      )}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|dimensions&iiurlwidth=720`;
      const commonsRes = await fetch(commonsUrl, {
        headers: { 'User-Agent': 'ManusAI/2.0 (VisualAnswerEngine)' },
        signal: AbortSignal.timeout(4500),
      });
      if (commonsRes.ok) {
        const commonsData: any = await commonsRes.json();
        const pages = commonsData?.query?.pages ? Object.values(commonsData.query.pages) : [];
        pages.sort((a: any, b: any) => (a?.index ?? 99) - (b?.index ?? 99));

        for (const page of pages as any[]) {
          const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
          const thumbUrl = info?.thumburl || info?.url;
          if (!thumbUrl || !isValidImageUrl(thumbUrl)) continue;
          const cleanTitle = String(page?.title || '')
            .replace(/^File:/i, '')
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[_-]+/g, ' ')
            .trim();
          add({
            id: `srv_commons_${page.pageid || cleanTitle}`,
            url: info?.url && isValidImageUrl(info.url) ? info.url : thumbUrl,
            thumbnailUrl: thumbUrl,
            title: cleanTitle || subjectLabel,
            caption: cleanTitle || subjectLabel,
            sourceUrl: String(info?.descriptionurl || 'https://commons.wikimedia.org'),
            sourceName: 'Wikimedia Commons',
            subject: subjectLabel,
            width: info?.thumbwidth || info?.width,
            height: info?.thumbheight || info?.height,
          });
          if (images.length >= 4) break;
        }
      }
    } catch {}
  }

  return images;
}

export async function searchVerifiedEntityImages(params: {
  primarySubject?: string;
  subjects?: string[];
  queries?: string[];
  isComparison?: boolean;
  limit?: number;
}): Promise<ServerVisualImage[]> {
  const limit = Math.min(6, Math.max(1, params.limit || 4));
  const primarySubject = String(params.primarySubject || params.queries?.[0] || '').trim();
  const subjects = Array.isArray(params.subjects) && params.subjects.length > 0
    ? params.subjects
    : primarySubject
      ? [primarySubject]
      : [];
  const queries = Array.isArray(params.queries) && params.queries.length > 0
    ? params.queries
    : subjects;

  if (queries.length === 0) return [];

  const collected: ServerVisualImage[] = [];
  const seen = new Set<string>();
  const pushUnique = (img: ServerVisualImage) => {
    const key = getCanonicalKey(img.url);
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(img);
  };

  if (params.isComparison && subjects.length >= 2) {
    const lists = await Promise.all(
      subjects.map((sub) => queryWikipediaAndCommonsForSubject(sub, sub))
    );
    for (let i = 0; i < 3; i++) {
      for (const list of lists) {
        if (list[i]) pushUnique(list[i]);
        if (collected.length >= limit) break;
      }
      if (collected.length >= limit) break;
    }
  } else {
    for (const q of queries.slice(0, 4)) {
      const list = await queryWikipediaAndCommonsForSubject(q, primarySubject || q);
      for (const img of list) {
        pushUnique(img);
        if (collected.length >= limit) break;
      }
      if (collected.length >= limit) break;
    }
  }

  return collected.slice(0, limit);
}
