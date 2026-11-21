import { GoogleGenAI } from '@google/genai';

export const DEFAULT_IMAGE_GENERATION_MODEL = 'gemini-3.1-flash-lite-image';
export const MAX_IMAGE_GENERATION_COUNT = 4;
export const MAX_IMAGE_PROMPT_LENGTH = 4000;
export const MAX_REFERENCE_IMAGE_BYTES = 3_750_000;

export const SUPPORTED_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;

export type ImageAspectRatio = typeof SUPPORTED_IMAGE_ASPECT_RATIOS[number];

export interface ImageGenerationInput {
  prompt: string;
  imageDataUrl?: string;
  count: number;
  aspectRatio: ImageAspectRatio;
}

export interface GeneratedImage {
  imageDataUrl: string;
  mimeType: string;
  alt: string;
}

export interface ImageGenerationResult {
  provider: 'Google Gemini';
  model: string;
  requestedCount: number;
  images: GeneratedImage[];
  warning?: string;
}

export class ImageGenerationError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'ImageGenerationError';
    this.code = code;
    this.status = status;
  }
}

interface ParsedReferenceImage {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: string;
}

function parseReferenceImage(imageDataUrl: string): ParsedReferenceImage {
  const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) {
    throw new ImageGenerationError('Choose a PNG, JPEG, or WebP image to edit.', 'INVALID_REFERENCE_IMAGE');
  }

  const base64Bytes = Math.floor((match[2].length * 3) / 4) - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  if (base64Bytes <= 0 || base64Bytes > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ImageGenerationError('The compressed reference image must be no larger than 3.75 MB.', 'REFERENCE_IMAGE_TOO_LARGE', 413);
  }

  return { mimeType: match[1] as ParsedReferenceImage['mimeType'], data: match[2] };
}

export function normalizeImageGenerationInput(payload: unknown): ImageGenerationInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ImageGenerationError('The request body must be a JSON object.', 'INVALID_PAYLOAD');
  }

  const body = payload as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    throw new ImageGenerationError('Write a prompt describing the image you want.', 'INVALID_PROMPT');
  }
  if (prompt.length > MAX_IMAGE_PROMPT_LENGTH) {
    throw new ImageGenerationError(`Prompts must be ${MAX_IMAGE_PROMPT_LENGTH.toLocaleString()} characters or shorter.`, 'PROMPT_TOO_LONG');
  }

  const count = body.count === undefined ? 1 : body.count;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_IMAGE_GENERATION_COUNT) {
    throw new ImageGenerationError(`Choose between 1 and ${MAX_IMAGE_GENERATION_COUNT} images per batch.`, 'INVALID_IMAGE_COUNT');
  }

  const rawAspectRatio = body.aspectRatio === undefined ? '1:1' : body.aspectRatio;
  if (typeof rawAspectRatio !== 'string' || !SUPPORTED_IMAGE_ASPECT_RATIOS.includes(rawAspectRatio as ImageAspectRatio)) {
    throw new ImageGenerationError('Choose a supported image aspect ratio.', 'INVALID_ASPECT_RATIO');
  }

  let imageDataUrl: string | undefined;
  if (body.imageDataUrl !== undefined && body.imageDataUrl !== null) {
    if (typeof body.imageDataUrl !== 'string') {
      throw new ImageGenerationError('The reference image must be a PNG, JPEG, or WebP image.', 'INVALID_REFERENCE_IMAGE');
    }
    if (body.imageDataUrl.length > 5_100_000) {
      throw new ImageGenerationError('The reference image is too large to process.', 'REFERENCE_IMAGE_TOO_LARGE', 413);
    }
    parseReferenceImage(body.imageDataUrl);
    imageDataUrl = body.imageDataUrl;
  }

  return {
    prompt,
    imageDataUrl,
    count: count as number,
    aspectRatio: rawAspectRatio as ImageAspectRatio,
  };
}

function getImageModel(): string {
  const configuredModel = process.env.IMAGE_GENERATION_MODEL?.trim();
  return configuredModel || DEFAULT_IMAGE_GENERATION_MODEL;
}

function classifyProviderError(error: unknown): ImageGenerationError {
  const providerError = error as { status?: number; code?: number | string; message?: string; response?: { status?: number } };
  const status = Number(providerError?.status || providerError?.response?.status || 0);
  const code = String(providerError?.code || '');

  if (status === 429 || code === 'RESOURCE_EXHAUSTED') {
    return new ImageGenerationError('The image provider is busy right now. Wait a moment and try again.', 'PROVIDER_RATE_LIMITED', 429);
  }
  if (status === 401 || status === 403) {
    return new ImageGenerationError('The server could not authenticate with the image provider. Check its server-side Gemini API configuration.', 'PROVIDER_AUTH_FAILED', 503);
  }
  if (status === 404) {
    return new ImageGenerationError('The configured Gemini image model is unavailable. Check IMAGE_GENERATION_MODEL on the server.', 'IMAGE_MODEL_UNAVAILABLE', 503);
  }

  return new ImageGenerationError('The image provider could not complete this request. Please retry.', 'IMAGE_PROVIDER_ERROR', 502);
}

async function generateSingleImage(
  ai: GoogleGenAI,
  model: string,
  input: ImageGenerationInput,
  referenceImage?: ParsedReferenceImage,
): Promise<GeneratedImage> {
  const interactionInput: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string }> = [
    { type: 'text', text: input.prompt },
  ];
  if (referenceImage) {
    interactionInput.push({ type: 'image', data: referenceImage.data, mime_type: referenceImage.mimeType });
  }

  const response = await ai.interactions.create({
    model,
    input: interactionInput,
    response_format: {
      type: 'image',
      delivery: 'inline',
      aspect_ratio: input.aspectRatio,
      image_size: '1K',
    },
    store: false,
  });

  const outputImage = response.output_image;
  if (!outputImage?.data || !outputImage.mime_type?.startsWith('image/')) {
    throw new ImageGenerationError('The image model returned no image for this prompt. Try changing the prompt and retry.', 'IMAGE_OUTPUT_MISSING', 502);
  }

  return {
    imageDataUrl: `data:${outputImage.mime_type};base64,${outputImage.data}`,
    mimeType: outputImage.mime_type,
    alt: input.prompt.slice(0, 180),
  };
}

export async function generateImages(input: ImageGenerationInput): Promise<ImageGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new ImageGenerationError('Image generation is not configured on the server. Set GEMINI_API_KEY to enable it.', 'IMAGE_PROVIDER_NOT_CONFIGURED', 503);
  }

  const model = getImageModel();
  const referenceImage = input.imageDataUrl ? parseReferenceImage(input.imageDataUrl) : undefined;
  const ai = new GoogleGenAI({ apiKey });
  const outcomes = await Promise.allSettled(
    Array.from({ length: input.count }, () => generateSingleImage(ai, model, input, referenceImage)),
  );
  const images = outcomes
    .filter((outcome): outcome is PromiseFulfilledResult<GeneratedImage> => outcome.status === 'fulfilled')
    .map((outcome) => outcome.value);

  if (images.length === 0) {
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    const providerError = classifyProviderError(rejected?.reason);
    console.warn(`[Image Generation] Provider request failed (${providerError.code}).`);
    throw providerError;
  }

  const failedCount = input.count - images.length;
  return {
    provider: 'Google Gemini',
    model,
    requestedCount: input.count,
    images,
    ...(failedCount > 0 ? { warning: `Generated ${images.length} of ${input.count} requested images. You can retry the missing variations.` } : {}),
  };
}
