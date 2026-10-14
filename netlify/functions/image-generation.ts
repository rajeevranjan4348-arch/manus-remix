import type { Handler } from '@netlify/functions';
import { GoogleGenAI } from '@google/genai';

const json = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  body: JSON.stringify(body),
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { ...json(405, { error: 'Method not allowed' }), headers: { ...json(405, {}).headers, Allow: 'POST' } };
  }

  let prompt = '';
  try {
    const payload = JSON.parse(event.body || '{}');
    prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  } catch {
    return json(400, { error: 'Request body must be valid JSON.' });
  }

  if (!prompt) return json(400, { error: 'An image prompt is required.' });
  if (prompt.length > 4000) return json(413, { error: 'Image prompts must be 4,000 characters or fewer.' });

  // Configure GEMINI_API_KEY (or GOOGLE_API_KEY) in Netlify environment variables.
  // Never use a VITE_ prefix for provider secrets.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return json(503, { error: 'Image generation is not configured. Add GEMINI_API_KEY to the Netlify environment variables and redeploy.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.IMAGE_GENERATION_MODEL || 'gemini-2.5-flash-image';
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    const parts = response.candidates?.flatMap(candidate => candidate.content?.parts || []) || [];
    const imagePart = parts.find(part => part.inlineData?.data && part.inlineData?.mimeType?.startsWith('image/'));
    if (!imagePart?.inlineData?.data || !imagePart.inlineData.mimeType) {
      const providerText = parts.map(part => part.text).filter(Boolean).join('\n').slice(0, 500);
      console.error('[image-generation] Provider returned no image.', providerText);
      return json(502, { error: 'The image provider did not return an image. Try a more specific prompt.' });
    }

    return json(200, {
      success: true,
      provider: 'Gemini',
      model,
      mimeType: imagePart.inlineData.mimeType,
      imageDataUrl: 'data:' + imagePart.inlineData.mimeType + ';base64,' + imagePart.inlineData.data,
      alt: prompt.slice(0, 180),
    });
  } catch (error) {
    console.error('[image-generation] Provider request failed:', error);
    return json(502, { error: 'Image generation provider request failed. Check the configured model, API key permissions, and provider quota.' });
  }
};
