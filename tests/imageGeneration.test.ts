import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  detectImageGenerationIntent,
  selectImageGenerationModels,
  parseAspectRatioFromPrompt,
  parseImageSizeFromPrompt,
  generateImageWithGemini,
  formatGeneratedImageMarkdown,
} from '../server/imageGenerationService';
import { streamGeminiResponse } from '../server/geminiService';
import {
  MarkdownRenderer,
  safeMarkdownUrlTransform,
  snapVisibleLengthPastDataImages,
} from '../src/components/agent/MarkdownRenderer';
import { toolRegistry } from '../src/lib/toolFramework';

describe('AI Image Generation & Editing Feature Suite', () => {
  it('1. Intent Detection: detects image generation and editing requests while excluding coding queries', () => {
    const gen1 = detectImageGenerationIntent('Generate an image of a robot holding a red skateboard');
    expect(gen1.isImageRequest).toBe(true);
    expect(gen1.isEditRequest).toBe(false);
    expect(gen1.cleanPrompt).toBe('a robot holding a red skateboard');
    expect(gen1.aspectRatio).toBe('1:1');

    const gen2 = detectImageGenerationIntent('/image A serene alpine mountain lake at golden hour in 16:9 4K');
    expect(gen2.isImageRequest).toBe(true);
    expect(gen2.aspectRatio).toBe('16:9');
    expect(gen2.imageSize).toBe('4K');
    expect(gen2.highQuality).toBe(true);

    const edit1 = detectImageGenerationIntent(
      '[IMAGE_DATA_URL:data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=] Can you add a llama next to the image?'
    );
    expect(edit1.isImageRequest).toBe(true);
    expect(edit1.isEditRequest).toBe(true);
    expect(edit1.referenceImages).toHaveLength(1);
    expect(edit1.referenceImages[0].mimeType).toBe('image/png');

    // Coding requests mentioning "image" must NOT trigger image generation
    const coding1 = detectImageGenerationIntent('Write a React component for an image carousel in TypeScript');
    expect(coding1.isImageRequest).toBe(false);

    const coding2 = detectImageGenerationIntent('Fix the CSS bug on the HTML image tag');
    expect(coding2.isImageRequest).toBe(false);
  });

  it('2. Model Selection: defaults to gemini-3.1-flash-lite-image and upgrades to gemini-nano-banana-2.1 for 2K/4K, extended ratios, or search grounding', () => {
    const defaultModels = selectImageGenerationModels({});
    expect(defaultModels[0]).toBe('gemini-3.1-flash-lite-image');

    const hqResolutionModels = selectImageGenerationModels({ imageSize: '4K' });
    expect(hqResolutionModels[0]).toBe('gemini-nano-banana-2.1');

    const extendedRatioModels = selectImageGenerationModels({ aspectRatio: '4:1' });
    expect(extendedRatioModels[0]).toBe('gemini-nano-banana-2.1');

    const groundedModels = selectImageGenerationModels({ useGoogleSearch: true });
    expect(groundedModels[0]).toBe('gemini-nano-banana-2.1');

    expect(parseAspectRatioFromPrompt('Create a vertical phone wallpaper')).toBe('9:16');
    expect(parseAspectRatioFromPrompt('Create a widescreen landscape banner')).toBe('16:9');
    expect(parseImageSizeFromPrompt('Generate a 2K portrait illustration')).toEqual({
      imageSize: '2K',
      explicitResolution: true,
    });
  });

  it('3. Server Image Generation & Chat Stream Integration: generates a valid data:image asset and formats Markdown', async () => {
    const result = await generateImageWithGemini({
      prompt: 'A futuristic neon cityscape reflected in rain puddles at sunset',
      aspectRatio: '16:9',
    });

    expect(result.success).toBe(true);
    expect(result.imageDataUrl).toMatch(/^data:image\/[a-zA-Z0-9.+-]+;base64,/);
    expect(result.aspectRatio).toBe('16:9');

    const md = formatGeneratedImageMarkdown(result);
    expect(md).toContain(`![A futuristic neon cityscape reflected in rain puddles at sunset](${result.imageDataUrl})`);
    expect(md).toContain('**Aspect Ratio:** `16:9`');

    // Verify streamGeminiResponse automatically routes image generation prompts
    let streamed = '';
    for await (const chunk of streamGeminiResponse({
      messages: [{ role: 'user', content: 'Generate an image of an emerald forest waterfall' }],
    })) {
      streamed += chunk;
    }
    expect(streamed).toContain('data:image/');
    expect(streamed).toContain('emerald forest waterfall');
  });

  it('4. MarkdownRenderer & Tool Registry: safely renders data:image/* with referrerPolicy="no-referrer" and snaps typewriter past base64 spans', () => {
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    expect(safeMarkdownUrlTransform(validPng)).toBe(validPng);
    expect(safeMarkdownUrlTransform('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
    expect(safeMarkdownUrlTransform('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrlTransform('data:text/html;base64,PHNjcmlwdD4=')).toBe('');

    const sampleMd = `![Test Art](${validPng})\n\nGenerated caption text.`;
    // Slicing at index 15 (middle of the base64 data URL) must snap past the closing parenthesis of the image
    const snapped = snapVisibleLengthPastDataImages(sampleMd, 15);
    expect(snapped).toBe(`![Test Art](${validPng})`.length);

    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: sampleMd,
        animateTypewriter: false,
      })
    );
    expect(html).toContain('<img');
    expect(html).toContain('referrerPolicy="no-referrer"');

    // Verify generate_image is registered in unified ToolRegistryService
    const tool = toolRegistry.getTool('generate_image');
    expect(tool).toBeDefined();
    expect(tool?.parameters.prompt.required).toBe(true);
  });
});
