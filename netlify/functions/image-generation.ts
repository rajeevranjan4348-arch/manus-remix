import {
  generateImageWithGemini,
  formatGeneratedImageMarkdown,
  extractReferenceImagesFromContent,
  parseAspectRatioFromPrompt,
  parseImageSizeFromPrompt,
  SupportedAspectRatio,
  SupportedImageSize,
} from '../../server/imageGenerationService';
import { parseJsonBodyLimited } from '../../server/limitedJsonBody';

const jsonResponse = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const parsedBody = await parseJsonBodyLimited(req, 4 * 1024 * 1024);
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.error, code: parsedBody.code }, parsedBody.status);
  }

  const body: any = parsedBody.value || {};
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!rawPrompt) {
    return jsonResponse({ error: 'An image prompt is required.', code: 'INVALID_PROMPT' }, 400);
  }

  try {
    const { images: inlineRefImages, strippedText } = extractReferenceImagesFromContent(rawPrompt);
    const explicitRefImages = Array.isArray(body.referenceImages)
      ? body.referenceImages.filter(
          (img: any) =>
            img &&
            typeof img.data === 'string' &&
            img.data.trim() &&
            typeof img.mimeType === 'string' &&
            img.mimeType.startsWith('image/')
        )
      : [];
    const referenceImages = [...explicitRefImages, ...inlineRefImages];

    const aspectRatio: SupportedAspectRatio =
      typeof body.aspectRatio === 'string' && body.aspectRatio.trim()
        ? (body.aspectRatio.trim() as SupportedAspectRatio)
        : parseAspectRatioFromPrompt(strippedText || rawPrompt);

    const parsedSize = parseImageSizeFromPrompt(strippedText || rawPrompt);
    const imageSize: SupportedImageSize =
      typeof body.imageSize === 'string' && ['1K', '2K', '4K'].includes(body.imageSize.trim().toUpperCase())
        ? (body.imageSize.trim().toUpperCase() as SupportedImageSize)
        : parsedSize.imageSize;

    const result = await generateImageWithGemini({
      prompt: strippedText || rawPrompt,
      aspectRatio,
      imageSize,
      model: typeof body.model === 'string' ? body.model : undefined,
      highQuality: Boolean(body.highQuality || parsedSize.explicitResolution),
      useGoogleSearch: Boolean(body.useGoogleSearch),
      useImageSearch: Boolean(body.useImageSearch),
      referenceImages,
      taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
    });

    return jsonResponse({
      success: true,
      provider: result.provider,
      model: result.model,
      mimeType: result.mimeType,
      imageDataUrl: result.imageDataUrl,
      aspectRatio: result.aspectRatio,
      imageSize: result.imageSize,
      caption: result.caption,
      alt: result.prompt.slice(0, 180),
      isEdited: result.isEdited,
      markdown: formatGeneratedImageMarkdown(result),
    });
  } catch (err: any) {
    return jsonResponse(
      {
        success: false,
        error: err?.message || 'Failed to generate image',
      },
      500
    );
  }
};
