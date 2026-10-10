import { GoogleGenAI } from '@google/genai';

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    function normalizeModel(modelName?: string): string {
      if (!modelName) return 'gemini-2.5-flash';
      const clean = modelName.replace(/^google\//, '').trim();
      if (clean === 'gemini-3-flash' || clean === 'gemini-3.0-flash') {
        return 'gemini-2.5-flash';
      }
      return clean;
    }

    const candidateModels = Array.from(new Set([
      normalizeModel(body.model),
      'gemini-2.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash'
    ]));

    let systemInstruction = body.systemInstruction || 
      'You are Manus, an intelligent AI assistant. Provide direct, helpful, and high-quality responses. Answer factual questions directly. Do not generate fake reports or fake charts unless specifically asked for them.';

    if (body.thinkHarder) {
      systemInstruction += `\n\n[EXTENDED REASONING MODE ACTIVE]\nEnclose your step-by-step reasoning inside <think>...</think> tags before your final answer.`;
    }

    const messages = body.messages || [];
    const contents = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    if (contents.length === 0 && body.prompt) {
      contents.push({
        role: 'user',
        parts: [{ text: body.prompt }],
      });
    }

    let responseStream: any = null;
    let selectedModel = '';

    for (const model of candidateModels) {
      try {
        responseStream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction,
          },
        });
        selectedModel = model;
        break;
      } catch (err) {
        console.warn(`[Netlify Agent] Model ${model} failed, trying fallback:`, err);
      }
    }

    if (!responseStream) {
      throw new Error('All candidate models failed');
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            const text = chunk.text;
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: text })}\n\n`)
              );
            }
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err: any) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err?.message || 'Stream error' })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
