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

  // Build system instruction
  let systemPrompt = options.systemInstruction || 
    'You are Manus, an intelligent AI assistant. Provide direct, helpful, and high-quality responses. If asked factual questions, answer directly and accurately. Do not generate fake business reports or irrelevant charts unless specifically asked for data visualization, financial reports, or charts.';

  if (options.thinkHarder) {
    systemPrompt += `\n\n[EXTENDED REASONING MODE ACTIVE]\nBefore providing your final response, conduct thorough step-by-step reasoning enclosed inside <think>...</think> tags. In your <think> section, analyze the core problem, verify assumptions, explore alternative angles, and test potential edge cases.`;
  }

  // Format contents for generateContentStream
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
        },
      });

      let hasYielded = false;
      for await (const chunk of responseStream) {
        const text = chunk.text;
        if (text) {
          hasYielded = true;
          yield text;
        }
      }

      if (hasYielded) {
        return; // Successfully streamed entire response
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
