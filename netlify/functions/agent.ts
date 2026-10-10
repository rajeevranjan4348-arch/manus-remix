import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const encoder = new TextEncoder();
function event(data: unknown) { return encoder.encode(`data: ${JSON.stringify(data)}\n\n`); }

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const messages: ChatMessage[] = Array.isArray(body?.messages)
    ? body.messages.filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .slice(-80).map((m: any) => ({ role: m.role, content: m.content.slice(0, 30000) }))
    : typeof body?.prompt === 'string' ? [{ role: 'user', content: body.prompt.slice(0, 30000) }] : [];
  if (!messages.length) return json({ error: 'Provide a prompt or messages array' }, 400);
  if (JSON.stringify(messages).length > 200_000) return json({ error: 'Conversation is too large' }, 413);

  const provider = String(body.provider || body.modelProvider || 'gemini').toLowerCase();
  const system = typeof body.systemInstruction === 'string'
    ? body.systemInstruction.slice(0, 12000)
    : 'You are Manus, an intelligent AI assistant. Be accurate, helpful, and direct. Never fabricate tool results or claim an action succeeded unless it did.';
  const wantsSearch = /\b(latest|today|current|right now|breaking|live|real[ -]?time|news|weather|stock price|exchange rate|forecast|who won)\b/i.test(messages[messages.length - 1].content);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (provider === 'anthropic' || provider === 'claude') {
          const key = process.env.ANTHROPIC_API_KEY;
          if (!key) throw new Error('ANTHROPIC_API_KEY is not configured on the server');
          const client = new Anthropic({ apiKey: key });
          const model = typeof body.model === 'string' && body.model.startsWith('claude-') ? body.model : 'claude-3-7-sonnet-latest';
          const response = await client.messages.create({
            model, max_tokens: Math.min(8192, Math.max(256, Number(body.maxTokens) || 4096)),
            system, messages: messages.map(m => ({ role: m.role, content: m.content })), stream: true,
          });
          for await (const item of response) {
            if (item.type === 'content_block_delta' && item.delta.type === 'text_delta') {
              controller.enqueue(event({ type: 'text-delta', delta: item.delta.text }));
            }
          }
        } else if (provider === 'gemini' || provider === 'google') {
          const key = process.env.GEMINI_API_KEY;
          if (!key) throw new Error('GEMINI_API_KEY is not configured on the server');
          const ai = new GoogleGenAI({ apiKey: key });
          const model = typeof body.model === 'string' && /^gemini-/i.test(body.model) ? body.model : 'gemini-2.5-flash';
          const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
          const response = await ai.models.generateContentStream({
            model, contents,
            config: { systemInstruction: system, ...(wantsSearch ? { tools: [{ googleSearch: {} }] } : {}) },
          });
          const sources = new Map<string, string>();
          for await (const chunk of response) {
            if (chunk.text) controller.enqueue(event({ type: 'text-delta', delta: chunk.text }));
            for (const item of chunk?.candidates?.[0]?.groundingMetadata?.groundingChunks || []) {
              const web = item?.web;
              if (typeof web?.uri === 'string' && /^https?:\/\//i.test(web.uri)) sources.set(web.uri, web.title || web.uri);
            }
          }
          if (wantsSearch && sources.size) {
            const markdown = '\n\n**Sources**\n' + [...sources.entries()].slice(0, 8).map(([url, title]) => `- [${String(title).replace(/[\[\]]/g, '')}](${url})`).join('\n');
            controller.enqueue(event({ type: 'text-delta', delta: markdown }));
          }
        } else {
          throw new Error('Unsupported provider. Use provider=gemini or provider=anthropic.');
        }
        controller.enqueue(event({ type: 'finish', finishReason: 'stop' }));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error: any) {
        controller.enqueue(event({ type: 'error', error: error?.message || 'AI request failed' }));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  } });
};
