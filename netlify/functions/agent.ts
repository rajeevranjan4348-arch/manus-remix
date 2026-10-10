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
      systemInstruction += `\n\n[EXTENDED REASONING MODE ACTIVE]\nReason carefully internally, then provide a concise answer without revealing private chain-of-thought.`;
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const latestUserText =
      [...messages].reverse().find((m: any) => m?.role === 'user' && typeof m?.content === 'string')?.content
      || (typeof body.prompt === 'string' ? body.prompt : '');

    // Keep greetings and ordinary conversation on the fast, non-search path.
    // Enable Google Search grounding for queries whose answers can change over time.
    const needsLiveSearch = (text: string) => {
      const q = text.toLowerCase();
      return /\b(latest|today|current|currently|right now|breaking|live|real[\s-]?time|news|headlines|recent|this week|yesterday|weather|stock price|share price|exchange rate|world news|india news|tech news|latest updates|election results|box office|release date|latest version|price today|score|standings|forecast|who won|who is (the )?(prime minister|president|chief minister|ceo)|who are the (current|latest)\b)\b/i.test(q)
        || /\b(202[5-9]|203\d)\b/.test(q)
        || /\b(what happened|what's happening|whats happening|tell me about the latest|latest on)\b/i.test(q);
    };
    const useGoogleSearch = needsLiveSearch(latestUserText);

    if (useGoogleSearch) {
      systemInstruction +=
        '\n\nLIVE WEB SEARCH IS ENABLED. Use Google Search grounding to answer current-events, news, and other changing-fact questions. ' +
        'Prioritize recent, reliable sources. Clearly distinguish confirmed information from uncertainty. Include useful source links and publication dates when available. ' +
        'Never invent sources, URLs, dates, headlines, or live facts. If search results are insufficient, say so.';
    }

    const contents = messages
      .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
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

    for (const model of candidateModels) {
      try {
        responseStream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction,
            ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
          },
        });
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
        const sources = new Map<string, string>();
        try {
          for await (const chunk of responseStream) {
            const text = chunk.text;
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: text })}\n\n`)
              );
            }

            // Grounding metadata can arrive on a later stream chunk.
            const groundingChunks = chunk?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            for (const groundingChunk of groundingChunks) {
              const web = groundingChunk?.web;
              if (typeof web?.uri === 'string' && /^https?:\/\//i.test(web.uri)) {
                sources.set(web.uri, typeof web.title === 'string' && web.title.trim() ? web.title : web.uri);
              }
            }
          }

          // Append links as normal streamed Markdown so existing chat UIs can render them
          // without any UI changes or a new event protocol.
          if (useGoogleSearch && sources.size > 0) {
            const sourceMarkdown = '\n\n**Sources**\n' + Array.from(sources.entries())
              .slice(0, 8)
              .map(([url, title]) => `- [${title.replace(/[\[\]]/g, '')}](${url})`)
              .join('\n');
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: sourceMarkdown })}\n\n`)
            );
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
