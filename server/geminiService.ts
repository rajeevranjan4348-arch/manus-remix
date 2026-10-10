import { GoogleGenAI } from '@google/genai';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  systemInstruction?: string;
  model?: string;
  thinkHarder?: boolean;
}

function normalizeModel(modelName?: string): string {
  if (!modelName) return 'gemini-2.5-flash';
  const clean = modelName.replace(/^google\//, '').trim();
  if (clean === 'gemini-3-flash' || clean === 'gemini-3.0-flash') {
    return 'gemini-2.5-flash';
  }
  return clean;
}

function needsLiveSearch(text: string): boolean {
  return /\b(latest|today|current|currently|right now|breaking|live|real[\s-]?time|news|headlines|recent|this week|yesterday|weather|stock price|share price|exchange rate|world news|india news|tech news|latest updates|election results|box office|release date|latest version|price today|score|standings|forecast|who won|who is (the )?(prime minister|president|chief minister|ceo)|who are the (current|latest)\b)\b/i.test(text)
    || /\b(202[5-9]|203\d)\b/.test(text)
    || /\b(what happened|what's happening|whats happening|tell me about the latest|latest on)\b/i.test(text);
}

export async function* streamGeminiResponse(options: StreamChatOptions) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const preferredModel = normalizeModel(options.model);
  const candidateModels = Array.from(new Set([
    preferredModel,
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash'
  ]));

  let systemPrompt = options.systemInstruction ||
    'You are Manus, an intelligent AI assistant. Provide direct, helpful, and high-quality responses. If asked factual questions, answer directly and accurately. Do not generate fake business reports or irrelevant charts unless specifically asked for data visualization, financial reports, or charts.';

  if (options.thinkHarder) {
    systemPrompt += '\n\n[EXTENDED REASONING MODE ACTIVE]\nReason carefully internally, then provide a concise answer without revealing private chain-of-thought.';
  }

  const latestUserText = [...options.messages].reverse()
    .find(m => m.role === 'user')?.content || '';
  const useGoogleSearch = needsLiveSearch(latestUserText);

  if (useGoogleSearch) {
    systemPrompt +=
      '\n\nLIVE WEB SEARCH IS ENABLED. Use Google Search grounding for current-events, news, and other changing-fact questions. ' +
      'Prioritize recent, reliable sources. Clearly distinguish confirmed information from uncertainty. Include useful source links and publication dates when available. ' +
      'Never invent sources, URLs, dates, headlines, or live facts. If search results are insufficient, say so.';
  }

  const contents = options.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  if (contents.length === 0) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hello' }],
    });
  }

  let lastError: any = null;
  for (const model of candidateModels) {
    try {
      const responseStream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
        },
      });

      let hasYielded = false;
      const sources = new Map<string, string>();

      for await (const chunk of responseStream) {
        const text = chunk.text;
        if (text) {
          hasYielded = true;
          yield text;
        }

        const groundingChunks = chunk?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        for (const groundingChunk of groundingChunks) {
          const web = groundingChunk?.web;
          if (typeof web?.uri === 'string' && /^https?:\/\//i.test(web.uri)) {
            sources.set(web.uri, typeof web.title === 'string' && web.title.trim() ? web.title : web.uri);
          }
        }
      }

      if (useGoogleSearch && sources.size > 0) {
        yield '\n\n**Sources**\n' + Array.from(sources.entries())
          .slice(0, 8)
          .map(([url, title]) => `- [${title.replace(/[\[\]]/g, '')}](${url})`)
          .join('\n');
      }

      if (hasYielded) {
        return; // Successfully streamed the response and any available source links.
      }
    } catch (err: any) {
      console.warn(`[AI Studio] Model ${model} failed, trying candidate fallback:`, err?.message || err);
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }
}
