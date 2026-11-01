import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BoundedLRUCache,
  getActivePerformanceProfile,
  PerformanceProfile,
} from '@/lib/performanceEngine';

export interface UseUltraLiteImageOptions {
  /** Maximum width/height in pixels when downscaling in ultra-lite mode (default: 240) */
  maxDimension?: number;
  /** Compression quality (0.1 - 1.0) for downscaled thumbnails (default: 0.55) */
  quality?: number;
  /** Maximum inline data URL byte length before replacing/downscaling in ultra-lite mode (default: 49152 = 48KB) */
  maxInlineBytes?: number;
  /** Optional known file size in bytes (if available from attachment metadata) */
  fileSizeBytes?: number;
  /** Optional label/alt text displayed in the low-memory monochrome placeholder thumbnail */
  label?: string;
  /** Force replacement with low-memory SVG placeholder instead of canvas downscaling for very large assets */
  preferPlaceholderAboveBytes?: number;
}

export interface UseUltraLiteImageResult {
  /** The optimized image source URL (downscaled thumbnail, CDN-rewritten URL, SVG placeholder, or original src) */
  src: string;
  /** True when the image was downscaled or replaced with a low-memory placeholder thumbnail */
  isOptimized: boolean;
  /** True when replaced with a lightweight SVG placeholder thumbnail */
  isPlaceholder: boolean;
  /** Current active performance profile */
  profile: PerformanceProfile;
  /** Estimated memory saved in KB by using the ultra-lite thumbnail/placeholder */
  estimatedMemorySavedKB: number;
  /** Allows user to explicitly load the original full-resolution image on demand */
  loadFullResolution: () => void;
  /** HTML img attributes tuned for 2GB RAM Android WebViews */
  imgProps: {
    loading: 'lazy' | 'eager';
    decoding: 'async' | 'auto';
  };
}

// Bounded LRU cache for downscaled thumbnails & generated placeholders (max 30 entries)
const thumbnailCache = new BoundedLRUCache<string, { src: string; isPlaceholder: boolean; savedKB: number }>({
  maxSize: 30,
  ttlMs: 10 * 60 * 1000,
});

/**
 * Generates an ultra-lightweight (~400 bytes) monochrome SVG placeholder thumbnail
 * adhering to the Pure Black & White Monochrome Design System (#FAFAFA, #E0E0E0, #777777, #111111).
 */
export function createLowMemoryPlaceholderDataUrl(label = 'High-Res Image (Ultra-Lite)'): string {
  const safeLabel = String(label || 'Image')
    .replace(/[<>&"']/g, '')
    .slice(0, 32);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150" fill="none">
  <rect width="240" height="150" rx="12" fill="#FAFAFA" stroke="#E0E0E0" stroke-width="1.5"/>
  <rect x="96" y="34" width="48" height="38" rx="6" stroke="#333333" stroke-width="1.75" fill="#F2F2F2"/>
  <circle cx="110" cy="47" r="4" fill="#333333"/>
  <path d="M99 67L112 54L122 63L130 56L141 67" stroke="#111111" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="120" y="96" text-anchor="middle" fill="#111111" font-family="sans-serif" font-size="11" font-weight="600">${safeLabel}</text>
  <text x="120" y="114" text-anchor="middle" fill="#777777" font-family="monospace" font-size="9.5">2GB RAM ULTRA-LITE THUMBNAIL</text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Rewrites known high-resolution CDN image URLs to request a downscaled low-memory thumbnail
 * before decoding on constrained 2GB RAM Android devices.
 */
export function downscaleRemoteImageUrl(
  rawUrl: string,
  maxDimension = 240,
  quality = 55
): { url: string; modified: boolean } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { url: '', modified: false };
  }
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, modified: false };
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    // Unsplash / Imgur / Cloudinary / Wix / Wordpress / generic width-parameterized CDNs
    if (
      host.includes('unsplash.com') ||
      host.includes('images.pexels.com') ||
      host.includes('ctfassets.net') ||
      host.includes('shopify.com') ||
      parsed.searchParams.has('w') ||
      parsed.searchParams.has('width') ||
      parsed.searchParams.has('q')
    ) {
      const currentW = Number(parsed.searchParams.get('w') || parsed.searchParams.get('width') || 0);
      if (!currentW || currentW > maxDimension) {
        parsed.searchParams.set('w', String(maxDimension));
        parsed.searchParams.set('q', String(quality));
        if (host.includes('unsplash.com')) {
          parsed.searchParams.set('auto', 'format');
          parsed.searchParams.set('fit', 'crop');
        }
        return { url: parsed.toString(), modified: true };
      }
    }

    // Picsum photos pattern: https://picsum.photos/1920/1080 -> https://picsum.photos/240/160
    const picsumMatch = trimmed.match(/^(https?:\/\/picsum\.photos(?:\/seed\/[^/]+)?)\/(\d+)\/(\d+)(\?.*)?$/i);
    if (picsumMatch) {
      const [, prefix, wStr, hStr, query = ''] = picsumMatch;
      const w = Number(wStr);
      const h = Number(hStr);
      if (w > maxDimension || h > maxDimension) {
        const scale = maxDimension / Math.max(w, h);
        const targetW = Math.max(64, Math.round(w * scale));
        const targetH = Math.max(64, Math.round(h * scale));
        return { url: `${prefix}/${targetW}/${targetH}${query}`, modified: true };
      }
    }

    // Detect explicit high-res filenames (e.g., 4k, 1080p, 2000x, ultra-hd)
    if (/(?:4k|8k|1920x|2560x|3840x|original|fullres|highres)/i.test(parsed.pathname)) {
      parsed.searchParams.set('w', String(maxDimension));
      parsed.searchParams.set('q', String(quality));
      return { url: parsed.toString(), modified: true };
    }
  } catch {
    // Fall through if URL parsing fails
  }

  return { url: trimmed, modified: false };
}

/**
 * Downscales an inline data:image/* or HTMLImageElement using an offscreen 2D canvas
 * to drastically reduce decoded RGBA bitmap memory on 2GB RAM Android devices.
 */
export function downscaleDataUrlImage(
  sourceDataUrl: string,
  maxDimension = 240,
  quality = 0.55,
  fallbackLabel = 'Thumbnail'
): Promise<{ src: string; isPlaceholder: boolean; savedKB: number }> {
  const cacheKey = `${sourceDataUrl.slice(0, 96)}_${sourceDataUrl.length}_${maxDimension}`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const originalKB = Math.max(1, Math.round((sourceDataUrl.length * 0.75) / 1024));

  // In headless/SSR or when Image/Canvas is unavailable, return lightweight SVG placeholder
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    const placeholder = createLowMemoryPlaceholderDataUrl(fallbackLabel);
    const entry = { src: placeholder, isPlaceholder: true, savedKB: Math.max(1, originalKB - 1) };
    thumbnailCache.set(cacheKey, entry);
    return Promise.resolve(entry);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      cleanup();
      try {
        const naturalW = img.naturalWidth || img.width || maxDimension;
        const naturalH = img.naturalHeight || img.height || maxDimension;
        const scale = Math.min(1, maxDimension / Math.max(naturalW, naturalH));
        const targetW = Math.max(32, Math.round(naturalW * scale));
        const targetH = Math.max(32, Math.round(naturalH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const placeholder = createLowMemoryPlaceholderDataUrl(fallbackLabel);
          const entry = { src: placeholder, isPlaceholder: true, savedKB: Math.max(1, originalKB - 1) };
          thumbnailCache.set(cacheKey, entry);
          resolve(entry);
          return;
        }

        ctx.drawImage(img, 0, 0, targetW, targetH);
        const thumbDataUrl = canvas.toDataURL('image/jpeg', quality);
        // Release canvas backing store immediately
        canvas.width = 0;
        canvas.height = 0;

        const thumbKB = Math.max(1, Math.round((thumbDataUrl.length * 0.75) / 1024));
        const savedKB = Math.max(1, originalKB - thumbKB);
        const entry = { src: thumbDataUrl, isPlaceholder: false, savedKB };
        thumbnailCache.set(cacheKey, entry);
        resolve(entry);
      } catch {
        const placeholder = createLowMemoryPlaceholderDataUrl(fallbackLabel);
        const entry = { src: placeholder, isPlaceholder: true, savedKB: Math.max(1, originalKB - 1) };
        thumbnailCache.set(cacheKey, entry);
        resolve(entry);
      }
    };

    img.onerror = () => {
      cleanup();
      const placeholder = createLowMemoryPlaceholderDataUrl(fallbackLabel);
      const entry = { src: placeholder, isPlaceholder: true, savedKB: Math.max(1, originalKB - 1) };
      thumbnailCache.set(cacheKey, entry);
      resolve(entry);
    };

    img.src = sourceDataUrl;
  });
}

/**
 * Synchronous evaluation of how an image source should be transformed under the active performance profile.
 */
export function resolveUltraLiteImageSync(
  originalSrc: string | undefined | null,
  profile: PerformanceProfile = getActivePerformanceProfile(),
  options: UseUltraLiteImageOptions = {}
): {
  src: string;
  isOptimized: boolean;
  isPlaceholder: boolean;
  estimatedMemorySavedKB: number;
  needsAsyncCanvasDownscale: boolean;
} {
  if (!originalSrc) {
    return {
      src: '',
      isOptimized: false,
      isPlaceholder: false,
      estimatedMemorySavedKB: 0,
      needsAsyncCanvasDownscale: false,
    };
  }

  if (profile !== 'ultra-lite') {
    return {
      src: originalSrc,
      isOptimized: false,
      isPlaceholder: false,
      estimatedMemorySavedKB: 0,
      needsAsyncCanvasDownscale: false,
    };
  }

  const maxDimension = options.maxDimension ?? 240;
  const quality = Math.round((options.quality ?? 0.55) * 100);
  const maxInlineBytes = options.maxInlineBytes ?? 48 * 1024; // 48KB
  const preferPlaceholderAboveBytes = options.preferPlaceholderAboveBytes ?? 350 * 1024; // 350KB
  const label = options.label || 'High-Res Image';

  // 1. Check if caller provided explicit large fileSizeBytes exceeding placeholder threshold
  if (options.fileSizeBytes && options.fileSizeBytes >= preferPlaceholderAboveBytes) {
    const savedKB = Math.max(16, Math.round(options.fileSizeBytes / 1024) - 1);
    return {
      src: createLowMemoryPlaceholderDataUrl(label),
      isOptimized: true,
      isPlaceholder: true,
      estimatedMemorySavedKB: savedKB,
      needsAsyncCanvasDownscale: false,
    };
  }

  // 2. Handle inline base64 data:image/* URLs
  if (originalSrc.startsWith('data:image/')) {
    if (originalSrc.startsWith('data:image/svg+xml')) {
      return {
        src: originalSrc,
        isOptimized: false,
        isPlaceholder: false,
        estimatedMemorySavedKB: 0,
        needsAsyncCanvasDownscale: false,
      };
    }

    const approxBytes = Math.round(originalSrc.length * 0.75);
    if (approxBytes >= preferPlaceholderAboveBytes) {
      const savedKB = Math.max(32, Math.round(approxBytes / 1024) - 1);
      return {
        src: createLowMemoryPlaceholderDataUrl(label),
        isOptimized: true,
        isPlaceholder: true,
        estimatedMemorySavedKB: savedKB,
        needsAsyncCanvasDownscale: false,
      };
    }

    if (approxBytes > maxInlineBytes) {
      const cacheKey = `${originalSrc.slice(0, 96)}_${originalSrc.length}_${maxDimension}`;
      const cached = thumbnailCache.get(cacheKey);
      if (cached) {
        return {
          src: cached.src,
          isOptimized: true,
          isPlaceholder: cached.isPlaceholder,
          estimatedMemorySavedKB: cached.savedKB,
          needsAsyncCanvasDownscale: false,
        };
      }
      // Return lightweight placeholder immediately while async canvas downscale runs (or in non-DOM environments)
      const savedKB = Math.max(12, Math.round(approxBytes / 1024) - 8);
      return {
        src: createLowMemoryPlaceholderDataUrl(label),
        isOptimized: true,
        isPlaceholder: true,
        estimatedMemorySavedKB: savedKB,
        needsAsyncCanvasDownscale: true,
      };
    }
  }

  // 3. Handle remote HTTP/HTTPS URLs
  const remoteResult = downscaleRemoteImageUrl(originalSrc, maxDimension, quality);
  if (remoteResult.modified) {
    return {
      src: remoteResult.url,
      isOptimized: true,
      isPlaceholder: false,
      estimatedMemorySavedKB: 420,
      needsAsyncCanvasDownscale: false,
    };
  }

  // 4. If fileSizeBytes exceeds maxInlineBytes on a blob/remote URL, use low-memory placeholder
  if (options.fileSizeBytes && options.fileSizeBytes > maxInlineBytes) {
    const savedKB = Math.max(16, Math.round(options.fileSizeBytes / 1024) - 4);
    return {
      src: createLowMemoryPlaceholderDataUrl(label),
      isOptimized: true,
      isPlaceholder: true,
      estimatedMemorySavedKB: savedKB,
      needsAsyncCanvasDownscale: false,
    };
  }

  return {
    src: originalSrc,
    isOptimized: false,
    isPlaceholder: false,
    estimatedMemorySavedKB: 0,
    needsAsyncCanvasDownscale: false,
  };
}

/**
 * React hook to conditionally downscale or replace heavy high-resolution images
 * with low-memory placeholder thumbnails when the 'ultra-lite' performance profile is active.
 */
export function useUltraLiteImage(
  originalSrc: string | undefined | null,
  options: UseUltraLiteImageOptions = {}
): UseUltraLiteImageResult {
  const [profile, setProfile] = useState<PerformanceProfile>(() => getActivePerformanceProfile());
  const [forceFullRes, setForceFullRes] = useState(false);
  const [asyncThumb, setAsyncThumb] = useState<{
    forSrc: string;
    src: string;
    isPlaceholder: boolean;
    savedKB: number;
  } | null>(null);

  useEffect(() => {
    setForceFullRes(false);
  }, [originalSrc]);

  useEffect(() => {
    const handleProfileChange = (e: Event) => {
      const custom = e as CustomEvent<{ profile?: PerformanceProfile }>;
      setProfile(custom.detail?.profile || getActivePerformanceProfile());
    };
    window.addEventListener('manus_performance_profile_changed', handleProfileChange);
    return () => {
      window.removeEventListener('manus_performance_profile_changed', handleProfileChange);
    };
  }, []);

  const syncEvaluation = useMemo(() => {
    if (forceFullRes && originalSrc) {
      return {
        src: originalSrc,
        isOptimized: false,
        isPlaceholder: false,
        estimatedMemorySavedKB: 0,
        needsAsyncCanvasDownscale: false,
      };
    }
    return resolveUltraLiteImageSync(originalSrc, profile, options);
  }, [
    originalSrc,
    profile,
    forceFullRes,
    options.maxDimension,
    options.quality,
    options.maxInlineBytes,
    options.fileSizeBytes,
    options.label,
    options.preferPlaceholderAboveBytes,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (
      syncEvaluation.needsAsyncCanvasDownscale &&
      originalSrc &&
      profile === 'ultra-lite' &&
      !forceFullRes
    ) {
      downscaleDataUrlImage(
        originalSrc,
        options.maxDimension ?? 240,
        options.quality ?? 0.55,
        options.label || 'High-Res Image'
      ).then((res) => {
        if (!cancelled) {
          setAsyncThumb({
            forSrc: originalSrc,
            src: res.src,
            isPlaceholder: res.isPlaceholder,
            savedKB: res.savedKB,
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [
    syncEvaluation.needsAsyncCanvasDownscale,
    originalSrc,
    profile,
    forceFullRes,
    options.maxDimension,
    options.quality,
    options.label,
  ]);

  const loadFullResolution = useCallback(() => {
    setForceFullRes(true);
  }, []);

  const effectiveResult =
    !forceFullRes &&
    profile === 'ultra-lite' &&
    asyncThumb &&
    asyncThumb.forSrc === originalSrc
      ? {
          src: asyncThumb.src,
          isOptimized: true,
          isPlaceholder: asyncThumb.isPlaceholder,
          estimatedMemorySavedKB: asyncThumb.savedKB,
        }
      : syncEvaluation;

  return {
    src: effectiveResult.src,
    isOptimized: effectiveResult.isOptimized,
    isPlaceholder: effectiveResult.isPlaceholder,
    profile,
    estimatedMemorySavedKB: effectiveResult.estimatedMemorySavedKB,
    loadFullResolution,
    imgProps: {
      loading: 'lazy',
      decoding: 'async',
    },
  };
}
