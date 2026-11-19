import {
  resolveVerifiedEntityProfile,
  isImageRelevantToEntity,
  isValidPhotoUrl,
  canonicalImageKey,
  VerifiedEntityProfile,
} from '../src/lib/visualAnswerEngine';

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

const serverVisualCache = new Map<string, { timestamp: number; images: ServerVisualImage[] }>();
const SERVER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SERVER_CACHE_SIZE = 120;

async function queryWikipediaAndCommonsForVerifiedEntity(
  query: string,
  entityProfile: VerifiedEntityProfile,
  subjectLabel: string
): Promise<ServerVisualImage[]> {
  const images: ServerVisualImage[] = [];
  const seen = new Set<string>();

  const addVerified = (img: ServerVisualImage) => {
    if (!isValidPhotoUrl(img.url) || !isValidPhotoUrl(img.thumbnailUrl)) return;
    if (img.width && img.height && (img.width < 100 || img.height < 100)) return;
    if (!isImageRelevantToEntity(img, entityProfile)) return;
    const key = canonicalImageKey(img.url);
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

      const verifiedPages: any[] = [];

      for (const page of pages as any[]) {
        const thumbUrl = page?.thumbnail?.source;
        const pageTitle = String(page?.title || '');
        const pageDesc = String(page?.description || '');
        const pageUrl = String(
          page?.fullurl ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`
        );

        const probeImg: ServerVisualImage = {
          id: `srv_wiki_${page.pageid || pageTitle}`,
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

        if (!isImageRelevantToEntity(probeImg, entityProfile)) {
          continue;
        }

        verifiedPages.push(page);
        if (thumbUrl && isValidPhotoUrl(thumbUrl)) {
          addVerified({
            ...probeImg,
            url: thumbUrl,
            thumbnailUrl: thumbUrl,
          });
        }
      }

      // Inspect media-list of top verified entity Wikipedia page
      const topVerifiedPage = verifiedPages[0];
      if (topVerifiedPage?.title && images.length < 4) {
        const encodedTitle = encodeURIComponent(String(topVerifiedPage.title).replace(/\s+/g, '_'));
        const mediaRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodedTitle}`,
          {
            headers: { 'User-Agent': 'ManusAI/2.0 (VisualAnswerEngine)' },
            signal: AbortSignal.timeout(4000),
          }
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
            const captionText = String(
              item?.caption?.text || itemTitle || topVerifiedPage.title
            ).trim();

            addVerified({
              id: `srv_wiki_media_${canonicalImageKey(fullUrl)}`,
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
            if (images.length >= 4) break;
          }
        }
      }
    }
  } catch {}

  if (images.length < 4) {
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(
        `filetype:bitmap "${query}"`
      )}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|dimensions|extmetadata&iiurlwidth=720`;
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

          addVerified({
            id: `srv_commons_${page.pageid || cleanTitle}`,
            url: info?.url && isValidPhotoUrl(info.url) ? info.url : thumbUrl,
            thumbnailUrl: thumbUrl,
            title: cleanTitle || subjectLabel,
            caption: (rawDesc || cleanTitle || subjectLabel).slice(0, 140),
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

export interface SearchVerifiedEntityImagesParams {
  primarySubject?: string;
  subjects?: string[];
  queries?: string[];
  requiredTokens?: string[];
  disallowedTokens?: string[];
  isComparison?: boolean;
  limit?: number;
}

export async function searchVerifiedEntityImages(
  paramsOrQueries: SearchVerifiedEntityImagesParams | string[],
  legacyLimit?: number,
  legacyIsComparison?: boolean
): Promise<ServerVisualImage[]> {
  const params: SearchVerifiedEntityImagesParams = Array.isArray(paramsOrQueries)
    ? {
        queries: paramsOrQueries,
        primarySubject: paramsOrQueries[0] || '',
        subjects: paramsOrQueries,
        limit: legacyLimit,
        isComparison: legacyIsComparison,
      }
    : paramsOrQueries || {};

  const limit = Math.min(6, Math.max(1, params.limit || 4));
  const primarySubject = String(params.primarySubject || params.queries?.[0] || '').trim();
  const subjects =
    Array.isArray(params.subjects) && params.subjects.length > 0
      ? params.subjects
      : primarySubject
        ? [primarySubject]
        : [];

  const entityProfile = resolveVerifiedEntityProfile(primarySubject || subjects[0] || '');
  const queries =
    Array.isArray(params.queries) && params.queries.length > 0
      ? params.queries
      : entityProfile.searchQueries.length > 0
        ? entityProfile.searchQueries
        : subjects;

  if (queries.length === 0) return [];

  const cacheKey = `${entityProfile.canonicalName.toLowerCase()}::${queries.join('|').toLowerCase()}::${Boolean(params.isComparison)}`;
  const cachedEntry = serverVisualCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.timestamp < SERVER_CACHE_TTL_MS) {
    return cachedEntry.images.slice(0, limit);
  }

  const collected: ServerVisualImage[] = [];
  const seen = new Set<string>();
  const pushVerifiedUnique = (img: ServerVisualImage, targetProfile?: VerifiedEntityProfile) => {
    const profileToVerify = targetProfile || entityProfile;
    if (!isImageRelevantToEntity(img, profileToVerify)) return;
    const key = canonicalImageKey(img.url);
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(img);
  };

  if (params.isComparison && subjects.length >= 2) {
    const profiles = subjects.map((sub) => resolveVerifiedEntityProfile(sub));
    const lists = await Promise.all(
      subjects.map((sub, idx) =>
        queryWikipediaAndCommonsForVerifiedEntity(sub, profiles[idx], profiles[idx].canonicalName)
      )
    );
    for (let i = 0; i < 3; i++) {
      for (let sIdx = 0; sIdx < lists.length; sIdx++) {
        const list = lists[sIdx];
        if (list[i]) pushVerifiedUnique(list[i], profiles[sIdx]);
        if (collected.length >= limit) break;
      }
      if (collected.length >= limit) break;
    }
  } else {
    for (const q of queries.slice(0, 4)) {
      const list = await queryWikipediaAndCommonsForVerifiedEntity(
        q,
        entityProfile,
        entityProfile.canonicalName || primarySubject || q
      );
      for (const img of list) {
        pushVerifiedUnique(img, entityProfile);
        if (collected.length >= limit) break;
      }
      if (collected.length >= limit) break;
    }
  }

  const finalImages = collected.slice(0, limit);
  if (finalImages.length > 0) {
    if (serverVisualCache.size >= MAX_SERVER_CACHE_SIZE) {
      const oldestKey = serverVisualCache.keys().next().value;
      if (oldestKey) serverVisualCache.delete(oldestKey);
    }
    serverVisualCache.set(cacheKey, { timestamp: Date.now(), images: finalImages });
  }

  return finalImages;
}
