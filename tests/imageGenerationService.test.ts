import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction } = vi.hoisted(() => ({ createInteraction: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAITestDouble {
    interactions = { create: createInteraction };
    constructor(_config: unknown) {}
  },
}));

import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  generateImages,
  normalizeImageGenerationInput,
} from '../server/imageGenerationService';

let previousGeminiKey: string | undefined;
let previousGoogleKey: string | undefined;
let previousImageModel: string | undefined;

beforeEach(() => {
  previousGeminiKey = process.env.GEMINI_API_KEY;
  previousGoogleKey = process.env.GOOGLE_API_KEY;
  previousImageModel = process.env.IMAGE_GENERATION_MODEL;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  delete process.env.GOOGLE_API_KEY;
  delete process.env.IMAGE_GENERATION_MODEL;
  createInteraction.mockReset().mockResolvedValue({
    output_image: { data: 'aW1hZ2U=', mime_type: 'image/png' },
  });
});

afterEach(() => {
  if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousGeminiKey;
  if (previousGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = previousGoogleKey;
  if (previousImageModel === undefined) delete process.env.IMAGE_GENERATION_MODEL;
  else process.env.IMAGE_GENERATION_MODEL = previousImageModel;
});

describe('image generation input validation', () => {
  it('trims a prompt and supplies bounded generation defaults', () => {
    expect(normalizeImageGenerationInput({ prompt: '  A small fox  ' })).toEqual({
      prompt: 'A small fox',
      imageDataUrl: undefined,
      count: 1,
      aspectRatio: '1:1',
    });
  });

  it('rejects a missing prompt, oversized prompt, invalid count, and unsupported ratio', () => {
    expect(() => normalizeImageGenerationInput({ prompt: '  ' })).toThrowError(/prompt/i);
    expect(() => normalizeImageGenerationInput({ prompt: 'x'.repeat(4001) })).toThrowError(/4,000/);
    expect(() => normalizeImageGenerationInput({ prompt: 'fox', count: 5 })).toThrowError(/between 1 and 4/);
    expect(() => normalizeImageGenerationInput({ prompt: 'fox', aspectRatio: '7:1' })).toThrowError(/aspect ratio/i);
  });

  it('accepts a bounded PNG reference and rejects malformed reference data', () => {
    const input = normalizeImageGenerationInput({
      prompt: 'Make this a watercolor',
      imageDataUrl: 'data:image/png;base64,aGVsbG8=',
    });
    expect(input.imageDataUrl).toBe('data:image/png;base64,aGVsbG8=');
    expect(() => normalizeImageGenerationInput({
      prompt: 'Make this a watercolor',
      imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
    })).toThrowError(/PNG, JPEG, or WebP/i);
  });
});

describe('Gemini image generation', () => {
  it('requests parallel batch variants using the fast default model and image response format', async () => {
    const input = normalizeImageGenerationInput({ prompt: 'A tiny robot in a garden', count: 2, aspectRatio: '4:3' });
    const result = await generateImages(input);

    expect(result).toMatchObject({
      provider: 'Google Gemini',
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      requestedCount: 2,
    });
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({
      imageDataUrl: 'data:image/png;base64,aW1hZ2U=',
      mimeType: 'image/png',
    });
    expect(createInteraction).toHaveBeenCalledTimes(2);
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      store: false,
      response_format: expect.objectContaining({ type: 'image', delivery: 'inline', aspect_ratio: '4:3', image_size: '1K' }),
    }));
  });

  it('passes a reference image to the model for prompt-guided editing', async () => {
    const input = normalizeImageGenerationInput({
      prompt: 'Make the sky purple',
      imageDataUrl: 'data:image/png;base64,aGVsbG8=',
    });
    await generateImages(input);

    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        { type: 'text', text: 'Make the sky purple' },
        { type: 'image', data: 'aGVsbG8=', mime_type: 'image/png' },
      ],
    }));
  });

  it('returns a clear setup error when no server-side Gemini key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    await expect(generateImages(normalizeImageGenerationInput({ prompt: 'A blue mountain' })))
      .rejects.toMatchObject({ code: 'IMAGE_PROVIDER_NOT_CONFIGURED', status: 503 });
    expect(createInteraction).not.toHaveBeenCalled();
  });
});
