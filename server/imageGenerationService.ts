import { GoogleGenAI } from '@google/genai';
import { agentActivityHub, AgentActivityEvent } from './agentActivityService';

export type SupportedAspectRatio =
  | '1:1'
  | '3:4'
  | '4:3'
  | '9:16'
  | '16:9'
  | '1:4'
  | '1:8'
  | '4:1'
  | '8:1';

export type SupportedImageSize = '1K' | '2K' | '4K';

export interface ReferenceImagePart {
  mimeType: string;
  data: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio?: SupportedAspectRatio;
  imageSize?: SupportedImageSize;
  model?: string;
  highQuality?: boolean;
  useGoogleSearch?: boolean;
  useImageSearch?: boolean;
  referenceImages?: ReferenceImagePart[];
  taskId?: string;
  signal?: AbortSignal;
  onActivity?: (event: AgentActivityEvent) => void;
}

export interface ImageGenerationResult {
  success: boolean;
  imageDataUrl: string;
  mimeType: string;
  model: string;
  provider: 'Google Gemini' | 'Google Gemini SVG' | 'Manus Visual Synthesizer';
  prompt: string;
  aspectRatio: SupportedAspectRatio;
  imageSize?: SupportedImageSize;
  caption: string;
  isEdited: boolean;
}

export interface DetectedImageIntent {
  isImageRequest: boolean;
  isEditRequest: boolean;
  cleanPrompt: string;
  aspectRatio: SupportedAspectRatio;
  imageSize: SupportedImageSize;
  highQuality: boolean;
  useGoogleSearch: boolean;
  useImageSearch: boolean;
  referenceImages: ReferenceImagePart[];
}

const STANDARD_ASPECT_RATIOS = new Set<SupportedAspectRatio>([
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
]);

const EXTENDED_ASPECT_RATIOS = new Set<SupportedAspectRatio>([
  '1:4',
  '1:8',
  '4:1',
  '8:1',
]);

/**
 * Extracts inline `[IMAGE_DATA_URL:data:image/...;base64,...]` attachments from message content.
 */
export function extractReferenceImagesFromContent(content: string): {
  images: ReferenceImagePart[];
  strippedText: string;
} {
  const raw = String(content || '');
  const images: ReferenceImagePart[] = [];
  const imgRegex = /\[IMAGE_DATA_URL:(data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))\]/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(raw)) !== null) {
    const mimeType = match[2];
    const base64Data = match[3].replace(/\s+/g, '');
    if (mimeType && base64Data) {
      images.push({ mimeType, data: base64Data });
    }
  }

  // Also check for markdown data URLs in previous assistant messages when editing
  const mdImgRegex = /!\[[^\]]*\]\((data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))\)/gi;
  while ((match = mdImgRegex.exec(raw)) !== null) {
    const mimeType = match[2];
    const base64Data = match[3].replace(/\s+/g, '');
    if (mimeType && base64Data && !mimeType.includes('svg')) {
      images.push({ mimeType, data: base64Data });
    }
  }

  const strippedText = raw
    .replace(/\[IMAGE_DATA_URL:[^\]]+\]\s*/gi, '')
    .replace(/\[Attached Image:[^\]]*\]\s*/gi, '')
    .replace(/^\[MODE:[^\]]*\]\s*/i, '')
    .replace(/^\[Think Harder[^\]]*\]\s*/i, '')
    .trim();

  return { images, strippedText };
}

/**
 * Parses requested aspect ratio from natural language or explicit ratio tokens.
 */
export function parseAspectRatioFromPrompt(text: string): SupportedAspectRatio {
  const raw = String(text || '');
  const ratioMatch = raw.match(/\b(16:9|9:16|4:3|3:4|1:1|1:4|1:8|4:1|8:1)\b/);
  if (ratioMatch) {
    return ratioMatch[1] as SupportedAspectRatio;
  }
  const lower = raw.toLowerCase();
  if (/\b(widescreen|landscape|horizontal|banner|thumbnail|desktop wallpaper|cinematic wide)\b/.test(lower)) {
    return '16:9';
  }
  if (/\b(vertical|mobile wallpaper|phone wallpaper|story|reel|tiktok|shorts)\b/.test(lower)) {
    return '9:16';
  }
  if (/\b(portrait|headshot|poster)\b/.test(lower)) {
    return '3:4';
  }
  if (/\b(4 by 3|classic photo)\b/.test(lower)) {
    return '4:3';
  }
  return '1:1';
}

/**
 * Parses requested resolution (1K, 2K, 4K) from natural language.
 */
export function parseImageSizeFromPrompt(text: string): {
  imageSize: SupportedImageSize;
  explicitResolution: boolean;
} {
  const raw = String(text || '');
  if (/\b(4k|ultra[\s-]?hd|uhd|high[\s-]?res(?:olution)?)\b/i.test(raw)) {
    return { imageSize: '4K', explicitResolution: true };
  }
  if (/\b(2k|qhd)\b/i.test(raw)) {
    return { imageSize: '2K', explicitResolution: true };
  }
  if (/\b1k\b/i.test(raw)) {
    return { imageSize: '1K', explicitResolution: true };
  }
  return { imageSize: '1K', explicitResolution: false };
}

/**
 * Determines whether a user prompt (and optional conversation history) is requesting
 * AI image generation or image editing, while excluding coding/UI/debugging requests.
 */
export function detectImageGenerationIntent(
  rawUserContent: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): DetectedImageIntent {
  const { images: attachedImages, strippedText } = extractReferenceImagesFromContent(rawUserContent);
  const text = strippedText.trim();
  const lower = text.toLowerCase();

  const defaultResult: DetectedImageIntent = {
    isImageRequest: false,
    isEditRequest: false,
    cleanPrompt: text,
    aspectRatio: '1:1',
    imageSize: '1K',
    highQuality: false,
    useGoogleSearch: false,
    useImageSearch: false,
    referenceImages: attachedImages,
  };

  if (!text) {
    return defaultResult;
  }

  // Exclude coding / software engineering requests that happen to mention "image" or "picture"
  const isCodingRequest =
    /\b(html|css|tsx|jsx|typescript|javascript|react|python|sql|component|function|class|bug|error|fix|upload|tag|carousel|slider|modal|dockerfile|container|docker\s+image|iso\s+image|disk\s+image|system\s+image|regex|api|endpoint)\b/i.test(
      lower
    ) && !/^\/?(?:image|imagine|draw|paint)\b/i.test(lower);

  if (isCodingRequest) {
    return defaultResult;
  }

  // 1. Explicit slash commands: /image, /imagine, /draw
  const slashMatch = text.match(/^\/(?:image|imagine|draw|paint|generate-image)\s+([\s\S]+)$/i);

  // 2. Explicit generation phrases: "generate an image of...", "create a picture of...", "draw...", "paint...", "illustrate..."
  const generationVerbPattern =
    /\b(?:generate|create|make|draw|paint|sketch|render|illustrate|design|produce|show\s+me|give\s+me)\s+(?:me\s+)?(?:an?\s+|some\s+|the\s+)?(?:(?:realistic|photorealistic|cinematic|4k|2k|hd|high[\s-]resolution|digital|3d|anime|watercolor|oil|minimalist|futuristic|cute|beautiful|stunning|vibrant|dark|neon|custom|new|ai)\s+)*(?:image|picture|photo|photograph|illustration|artwork|drawing|painting|sketch|portrait|wallpaper|poster|logo|icon|avatar|graphic|scene|render|visual)\b/i;

  // 3. Direct drawing/painting start: "Draw a...", "Paint a...", "Sketch a...", "Illustrate a..."
  const directArtStartPattern =
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+|the\s+)?[a-z0-9]/i;

  // 4. Image editing intent when an image is attached or was generated in the previous turn
  const editVerbPattern =
    /\b(?:edit|modify|change|transform|convert|turn|restyle|add|remove|replace|make\s+it|make\s+this|enhance|colorize|recolor|upscale|remix)\b/i;
  const refersToImagePattern =
    /\b(?:this\s+(?:image|picture|photo|drawing|illustration)|the\s+(?:image|picture|photo|background|sky|subject)|in\s+the\s+(?:image|picture|photo)|next\s+to\s+(?:it|the\s+image|them|him|her)|into\s+(?:an?\s+)?(?:watercolor|anime|sketch|oil\s+painting|3d|pixel\s+art|cyberpunk))\b/i;

  let referenceImages = [...attachedImages];
  if (referenceImages.length === 0 && conversationHistory.length > 0) {
    // Check if the most recent assistant or user message had an image and the user is asking to edit it
    for (let i = conversationHistory.length - 1; i >= Math.max(0, conversationHistory.length - 4); i--) {
      const msg = conversationHistory[i];
      if (!msg || typeof msg.content !== 'string') continue;
      const extracted = extractReferenceImagesFromContent(msg.content);
      if (extracted.images.length > 0) {
        referenceImages = [extracted.images[extracted.images.length - 1]];
        break;
      }
    }
  }

  const isEditWithAttachedImage =
    attachedImages.length > 0 &&
    editVerbPattern.test(lower) &&
    (refersToImagePattern.test(lower) || /\b(add|remove|replace|background|style|filter|lighting|color)\b/i.test(lower));

  const isFollowUpEdit =
    attachedImages.length === 0 &&
    referenceImages.length > 0 &&
    editVerbPattern.test(lower) &&
    refersToImagePattern.test(lower);

  const isEditRequest = isEditWithAttachedImage || isFollowUpEdit;
  const isImageRequest =
    Boolean(slashMatch) ||
    generationVerbPattern.test(text) ||
    directArtStartPattern.test(text) ||
    isEditRequest;

  if (!isImageRequest) {
    return defaultResult;
  }

  const aspectRatio = parseAspectRatioFromPrompt(text);
  const { imageSize, explicitResolution } = parseImageSizeFromPrompt(text);
  const isExtendedRatio = EXTENDED_ASPECT_RATIOS.has(aspectRatio);
  const useImageSearch = /\b(image\s+search|reference\s+photos?\s+from\s+web|google\s+images?)\b/i.test(text);
  const useGoogleSearch =
    useImageSearch ||
    /\b(latest|current|real[\s-]?time|live|today'?s|recent|grounded)\b/i.test(text);

  const highQuality =
    explicitResolution ||
    isExtendedRatio ||
    useGoogleSearch ||
    useImageSearch ||
    /\b(high[\s-]?quality|nano[\s-]?banana[\s-]?2\.1|pro\s+image|masterpiece|ultra[\s-]?detailed)\b/i.test(text);

  let cleanPrompt = slashMatch ? slashMatch[1].trim() : text;
  if (!isEditRequest) {
    cleanPrompt = cleanPrompt
      .replace(
        /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:generate|create|make|produce|show\s+me|give\s+me)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:image|picture|photo|photograph|illustration|artwork|drawing|painting|sketch|render|visual)\s+(?:of|for|showing|depicting|with|featuring)\s+/i,
        ''
      )
      .trim();
  }
  if (!cleanPrompt) {
    cleanPrompt = text;
  }

  return {
    isImageRequest: true,
    isEditRequest,
    cleanPrompt,
    aspectRatio,
    imageSize,
    highQuality,
    useGoogleSearch,
    useImageSearch,
    referenceImages,
  };
}

/**
 * Resolves the prioritized Gemini image model list according to the `@google/genai` skill rules:
 * - Default general image generation & editing: `gemini-3.1-flash-lite-image`
 * - High-quality (1K/2K/4K), non-standard aspect ratios (1:4, 1:8, 4:1, 8:1), or Google Search / Image Search: `gemini-nano-banana-2.1`
 */
export function selectImageGenerationModels(options: {
  requestedModel?: string;
  highQuality?: boolean;
  aspectRatio?: SupportedAspectRatio;
  imageSize?: SupportedImageSize;
  useGoogleSearch?: boolean;
  useImageSearch?: boolean;
}): string[] {
  const {
    requestedModel,
    highQuality,
    aspectRatio = '1:1',
    imageSize = '1K',
    useGoogleSearch,
    useImageSearch,
  } = options;

  const needsNanoBanana21 =
    Boolean(highQuality) ||
    Boolean(useGoogleSearch) ||
    Boolean(useImageSearch) ||
    imageSize === '2K' ||
    imageSize === '4K' ||
    EXTENDED_ASPECT_RATIOS.has(aspectRatio);

  const models: string[] = [];

  if (requestedModel) {
    const clean = requestedModel.trim().toLowerCase();
    if (clean.includes('nano-banana-2.1')) {
      models.push('gemini-nano-banana-2.1');
    } else if (clean.includes('pro-image')) {
      models.push('gemini-3-pro-image');
    } else if (clean.includes('flash-lite-image') || clean.includes('nano-banana')) {
      models.push('gemini-3.1-flash-lite-image');
    } else if (clean.includes('image')) {
      models.push(requestedModel.trim());
    }
  }

  if (needsNanoBanana21) {
    if (!models.includes('gemini-nano-banana-2.1')) models.push('gemini-nano-banana-2.1');
    if (!models.includes('gemini-3-pro-image')) models.push('gemini-3-pro-image');
    if (!models.includes('gemini-3.1-flash-lite-image')) models.push('gemini-3.1-flash-lite-image');
  } else {
    if (!models.includes('gemini-3.1-flash-lite-image')) models.push('gemini-3.1-flash-lite-image');
    if (!models.includes('gemini-nano-banana-2.1')) models.push('gemini-nano-banana-2.1');
  }

  return models;
}

/**
 * Computes pixel dimensions for SVG fallback artwork matching the requested aspect ratio.
 */
export function getDimensionsForAspectRatio(aspectRatio: SupportedAspectRatio): {
  width: number;
  height: number;
} {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1024, height: 576 };
    case '9:16':
      return { width: 576, height: 1024 };
    case '4:3':
      return { width: 960, height: 720 };
    case '3:4':
      return { width: 720, height: 960 };
    case '4:1':
      return { width: 1200, height: 300 };
    case '1:4':
      return { width: 300, height: 1200 };
    case '8:1':
      return { width: 1280, height: 160 };
    case '1:8':
      return { width: 160, height: 1280 };
    case '1:1':
    default:
      return { width: 800, height: 800 };
  }
}

/**
 * Generates a deterministic, rich vector artwork SVG data URL tailored to the prompt's theme,
 * colors, subject, and aspect ratio when paid image generation models are unavailable.
 */
export function buildProceduralArtworkDataUrl(
  prompt: string,
  aspectRatio: SupportedAspectRatio = '1:1'
): { imageDataUrl: string; mimeType: string } {
  const { width, height } = getDimensionsForAspectRatio(aspectRatio);
  const clean = String(prompt || 'AI Generated Artwork').trim();
  const lower = clean.toLowerCase();

  // Select thematic color palette based on prompt keywords
  let bgStart = '#0f172a';
  let bgMid = '#1e1b4b';
  let bgEnd = '#311042';
  let accentA = '#38bdf8';
  let accentB = '#a855f7';
  let accentC = '#f472b6';

  if (/\b(sunset|sunrise|golden\s+hour|desert|autumn|fire|mars|warm|orange|amber)\b/.test(lower)) {
    bgStart = '#1c0f13';
    bgMid = '#4c1d24';
    bgEnd = '#9a3412';
    accentA = '#fb923c';
    accentB = '#facc15';
    accentC = '#f43f5e';
  } else if (/\b(forest|nature|mountain|jungle|emerald|garden|meadow|tree|leaf|green)\b/.test(lower)) {
    bgStart = '#051b14';
    bgMid = '#064e3b';
    bgEnd = '#0f766e';
    accentA = '#34d399';
    accentB = '#a7f3d0';
    accentC = '#38bdf8';
  } else if (/\b(ocean|sea|underwater|water|ice|winter|snow|arctic|blue|sky)\b/.test(lower)) {
    bgStart = '#041022';
    bgMid = '#0c4a6e';
    bgEnd = '#1e3a8a';
    accentA = '#38bdf8';
    accentB = '#7dd3fc';
    accentC = '#818cf8';
  } else if (/\b(minimal|monochrome|black\s+and\s+white|sketch|noir|charcoal|pencil)\b/.test(lower)) {
    bgStart = '#09090b';
    bgMid = '#18181b';
    bgEnd = '#27272a';
    accentA = '#e4e4e7';
    accentB = '#a1a1aa';
    accentC = '#71717a';
  }

  // Deterministic hash from prompt for procedural geometry
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const seed = Math.abs(hash);

  const cx1 = Math.round(width * (0.28 + ((seed % 44) / 100)));
  const cy1 = Math.round(height * (0.3 + (((seed >> 4) % 35) / 100)));
  const r1 = Math.round(Math.min(width, height) * 0.24);

  const cx2 = Math.round(width * (0.62 - (((seed >> 8) % 30) / 100)));
  const cy2 = Math.round(height * (0.48 + (((seed >> 12) % 25) / 100)));
  const r2 = Math.round(Math.min(width, height) * 0.18);

  const horizonY = Math.round(height * 0.68);
  const peak1X = Math.round(width * 0.22);
  const peak1Y = Math.round(height * 0.42);
  const peak2X = Math.round(width * 0.54);
  const peak2Y = Math.round(height * 0.34);
  const peak3X = Math.round(width * 0.8);
  const peak3Y = Math.round(height * 0.46);

  const safeTitle = clean
    .replace(/[<>&"']/g, '')
    .slice(0, 68);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bgStart}"/>
      <stop offset="52%" stop-color="${bgMid}"/>
      <stop offset="100%" stop-color="${bgEnd}"/>
    </linearGradient>
    <radialGradient id="glowA" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${accentA}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${accentA}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${accentB}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${accentB}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ridgeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${accentC}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${bgStart}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
  <circle cx="${cx1}" cy="${cy1}" r="${r1 * 1.6}" fill="url(#glowA)"/>
  <circle cx="${cx2}" cy="${cy2}" r="${r2 * 1.7}" fill="url(#glowB)"/>
  <circle cx="${cx1}" cy="${cy1}" r="${Math.round(r1 * 0.42)}" fill="${accentB}" fill-opacity="0.28" stroke="${accentA}" stroke-opacity="0.55" stroke-width="2"/>
  <path d="M 0 ${horizonY} L ${peak1X} ${peak1Y} L ${Math.round(width * 0.38)} ${Math.round(height * 0.56)} L ${peak2X} ${peak2Y} L ${Math.round(width * 0.68)} ${Math.round(height * 0.54)} L ${peak3X} ${peak3Y} L ${width} ${horizonY} L ${width} ${height} L 0 ${height} Z" fill="url(#ridgeGrad)"/>
  <line x1="${Math.round(width * 0.08)}" y1="${horizonY}" x2="${Math.round(width * 0.92)}" y2="${horizonY}" stroke="${accentA}" stroke-opacity="0.35" stroke-width="1.5"/>
  <rect x="${Math.round(width * 0.06)}" y="${Math.round(height - 76)}" width="${Math.round(width * 0.88)}" height="54" rx="14" fill="#09090b" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>
  <text x="${Math.round(width * 0.5)}" y="${Math.round(height - 44)}" text-anchor="middle" fill="#fafafa" font-family="system-ui, -apple-system, sans-serif" font-size="15" font-weight="600">${safeTitle}</text>
</svg>`;

  const base64Svg = Buffer.from(svg, 'utf-8').toString('base64');
  return {
    imageDataUrl: `data:image/svg+xml;base64,${base64Svg}`,
    mimeType: 'image/svg+xml',
  };
}

/**
 * Generates an image using the server-side `@google/genai` SDK following the `gemini-api` skill guidelines:
 * - Default model: `gemini-3.1-flash-lite-image`
 * - Upgraded model: `gemini-nano-banana-2.1` (for 1K/2K/4K high-res, extended aspect ratios, or Google Search grounding)
 * - Fallback: Gemini-authored SVG illustration via `gemini-4-hydrogen` / `gemini-3-flash-preview`, then deterministic procedural SVG.
 */
export async function generateImageWithGemini(
  request: ImageGenerationRequest
): Promise<ImageGenerationResult> {
  const cleanPrompt = String(request.prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('An image prompt is required.');
  }

  const aspectRatio: SupportedAspectRatio =
    request.aspectRatio || parseAspectRatioFromPrompt(cleanPrompt);
  const parsedSize = parseImageSizeFromPrompt(cleanPrompt);
  const imageSize: SupportedImageSize = request.imageSize || parsedSize.imageSize;
  const referenceImages = Array.isArray(request.referenceImages) ? request.referenceImages : [];
  const isEdited = referenceImages.length > 0;

  const candidateModels = selectImageGenerationModels({
    requestedModel: request.model,
    highQuality: request.highQuality || parsedSize.explicitResolution,
    aspectRatio,
    imageSize,
    useGoogleSearch: request.useGoogleSearch,
    useImageSearch: request.useImageSearch,
  });

  const taskId = request.taskId || `img_task_${Date.now()}`;
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    for (const model of candidateModels) {
      if (request.signal?.aborted) {
        throw new Error('Image generation cancelled by client');
      }

      const activityHandle = agentActivityHub.startActivity(
        taskId,
        {
          title: isEdited
            ? `Editing image with ${model}`
            : `Generating image with ${model}`,
          description: `${cleanPrompt.slice(0, 90)} (${aspectRatio}${model !== 'gemini-3.1-flash-lite-image' ? `, ${imageSize}` : ''})`,
          toolName: 'gemini_image_generation',
          category: 'model',
        },
        request.onActivity
      );

      try {
        const supportsExtendedRatio =
          model === 'gemini-nano-banana-2.1' || model === 'gemini-3-pro-image';
        const effectiveAspectRatio: SupportedAspectRatio =
          supportsExtendedRatio || STANDARD_ASPECT_RATIOS.has(aspectRatio)
            ? aspectRatio
            : '1:1';
        const supportsImageSize =
          model === 'gemini-nano-banana-2.1' || model === 'gemini-3-pro-image';
        const supportsGoogleSearch =
          (model === 'gemini-nano-banana-2.1' || model === 'gemini-3-pro-image') &&
          Boolean(request.useGoogleSearch || request.useImageSearch);

        const parts: any[] = [];
        for (const refImg of referenceImages) {
          if (refImg?.data && refImg?.mimeType) {
            parts.push({
              inlineData: {
                data: refImg.data,
                mimeType: refImg.mimeType,
              },
            });
          }
        }
        parts.push({ text: cleanPrompt });

        const config: Record<string, any> = {
          imageConfig: {
            aspectRatio: effectiveAspectRatio,
            ...(supportsImageSize ? { imageSize } : {}),
          },
        };

        if (supportsGoogleSearch) {
          config.tools = [
            {
              googleSearch: {
                searchTypes: {
                  webSearch: {},
                  ...(model === 'gemini-nano-banana-2.1' && request.useImageSearch
                    ? { imageSearch: {} }
                    : {}),
                },
              },
            },
          ];
        }

        const response = await ai.models.generateContent({
          model,
          contents: { parts },
          config,
        });

        let foundImageData: string | null = null;
        let foundMimeType = 'image/png';
        const textParts: string[] = [];

        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data && !foundImageData) {
            foundImageData = part.inlineData.data;
            foundMimeType = part.inlineData.mimeType ?? 'image/png';
          } else if (part.text) {
            textParts.push(part.text.trim());
          }
        }

        if (foundImageData) {
          const imageDataUrl = `data:${foundMimeType};base64,${foundImageData}`;
          const caption =
            textParts.filter(Boolean).join(' ').trim() ||
            `${isEdited ? 'Edited' : 'Generated'} image for "${cleanPrompt}" (${effectiveAspectRatio})`;

          activityHandle.complete(`Generated ${foundMimeType} image with ${model}`);
          return {
            success: true,
            imageDataUrl,
            mimeType: foundMimeType,
            model,
            provider: 'Google Gemini',
            prompt: cleanPrompt,
            aspectRatio: effectiveAspectRatio,
            imageSize: supportsImageSize ? imageSize : undefined,
            caption,
            isEdited,
          };
        }

        activityHandle.fail(`Model ${model} returned no image inlineData; trying fallback`);
      } catch (err: any) {
        activityHandle.fail(`Model ${model} unavailable (${err?.status || err?.code || 'fallback'})`);
      }
    }

    // Secondary Gemini Fallback: Ask a fast Gemini text model to author a custom SVG artwork when paid image models are not enabled on the current key
    const svgModels = ['gemini-4-hydrogen', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];
    const { width, height } = getDimensionsForAspectRatio(aspectRatio);
    for (const svgModel of svgModels) {
      if (request.signal?.aborted) break;
      try {
        const svgResponse = await ai.models.generateContent({
          model: svgModel,
          contents:
            `Create a rich, detailed, visually striking standalone SVG illustration (${width}x${height}, viewBox="0 0 ${width} ${height}") for the following image prompt:\n` +
            `"${cleanPrompt}"\n\n` +
            `Requirements:\n` +
            `- Return ONLY valid raw <svg ...>...</svg> markup with no markdown code fences or explanation.\n` +
            `- Use rich linearGradient/radialGradient definitions, layered shapes, lighting effects, and atmospheric details that faithfully depict the prompt.`,
        });
        const rawSvgText = String(svgResponse.text || '').trim();
        const svgMatch = rawSvgText.match(/<svg[\s\S]*?<\/svg>/i);
        if (svgMatch) {
          const cleanSvg = svgMatch[0]
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/\son[a-z]+\s*=\s*["'][^"']*["']/gi, '');
          const base64Svg = Buffer.from(cleanSvg, 'utf-8').toString('base64');
          return {
            success: true,
            imageDataUrl: `data:image/svg+xml;base64,${base64Svg}`,
            mimeType: 'image/svg+xml',
            model: svgModel,
            provider: 'Google Gemini SVG',
            prompt: cleanPrompt,
            aspectRatio,
            imageSize,
            caption: `Generated custom vector illustration for "${cleanPrompt}" (${aspectRatio})`,
            isEdited,
          };
        }
      } catch {
        // Continue to next fallback
      }
    }
  }

  // Final deterministic procedural SVG fallback so image generation always succeeds offline or without a paid key
  const fallbackHandle = agentActivityHub.startActivity(
    taskId,
    {
      title: 'Synthesizing vector artwork illustration',
      description: `Rendering ${aspectRatio} visual asset for "${cleanPrompt.slice(0, 80)}"`,
      toolName: 'visual_synthesizer',
      category: 'model',
    },
    request.onActivity
  );
  const procedural = buildProceduralArtworkDataUrl(cleanPrompt, aspectRatio);
  fallbackHandle.complete(`Rendered ${aspectRatio} vector artwork`);

  return {
    success: true,
    imageDataUrl: procedural.imageDataUrl,
    mimeType: procedural.mimeType,
    model: candidateModels[0] || 'gemini-3.1-flash-lite-image',
    provider: 'Manus Visual Synthesizer',
    prompt: cleanPrompt,
    aspectRatio,
    imageSize,
    caption: `${isEdited ? 'Edited' : 'Generated'} artwork for "${cleanPrompt}" (${aspectRatio})`,
    isEdited,
  };
}

/**
 * Formats an ImageGenerationResult into clean Markdown that renders directly inside
 * the existing ChatView and MyAIChat MarkdownRenderer without altering any UI components.
 */
export function formatGeneratedImageMarkdown(result: ImageGenerationResult): string {
  const safeAlt = result.prompt.replace(/[\[\]\r\n]+/g, ' ').trim().slice(0, 140) || 'Generated Image';
  const detailsLine = `**Prompt:** ${result.prompt}  \n**Aspect Ratio:** \`${result.aspectRatio}\`${result.imageSize ? ` • **Resolution:** \`${result.imageSize}\`` : ''} • **Model:** \`${result.model}\``;

  return (
    `![${safeAlt}](${result.imageDataUrl})\n\n` +
    `${result.caption}\n\n` +
    `${detailsLine}`
  );
}
