import { GoogleGenAI } from '@google/genai';

const jsonResponse = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';

  if (!prompt) {
    return jsonResponse({ error: 'Prompt is required' }, 400);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ tags: [] });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Analyze the user's task prompt and generated response below. Select 1 to 3 relevant concise tags from this allowed set: ["Research", "Coding", "Analysis", "Design", "Writing", "Automation", "General"].

Prompt: "${prompt.slice(0, 1500)}"
Response Preview: "${content.slice(0, 1500)}"

Return a JSON object with a "tags" array property, e.g. {"tags": ["Research", "Coding"]}.`,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const textOut = response.text?.trim() || '';
    try {
      const parsed = JSON.parse(textOut);
      if (Array.isArray(parsed?.tags) && parsed.tags.length > 0) {
        return jsonResponse({ tags: parsed.tags });
      }
    } catch {}

    return jsonResponse({ tags: [] });
  } catch (err: any) {
    return jsonResponse({ tags: [] });
  }
};
