import { categorizeSessionWithGemini } from '../../server/geminiService';

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

  try {
    if (Array.isArray(body?.sessions)) {
      const batchEntries = body.sessions.slice(0, 25);
      const results: Record<string, string[]> = {};
      await Promise.all(
        batchEntries.map(async (entry: any) => {
          const sessionId =
            typeof entry?.id === 'string'
              ? entry.id
              : typeof entry?.sessionId === 'string'
                ? entry.sessionId
                : '';
          if (!sessionId) return;
          const categorized = await categorizeSessionWithGemini({
            sessionId,
            title: typeof entry?.title === 'string' ? entry.title : undefined,
            prompt: typeof entry?.prompt === 'string' ? entry.prompt : undefined,
            content: typeof entry?.content === 'string' ? entry.content : undefined,
            messages: Array.isArray(entry?.messages) ? entry.messages : undefined,
          });
          results[sessionId] = categorized.tags;
        })
      );
      return jsonResponse({ results });
    }

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    const messages = Array.isArray(body?.messages) ? body.messages : undefined;

    if (!prompt && !title && !content && (!messages || messages.length === 0)) {
      return jsonResponse({ error: 'Task prompt or content is required' }, 400);
    }

    const categorized = await categorizeSessionWithGemini({
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : undefined,
      title,
      prompt,
      content,
      messages,
    });

    return jsonResponse({
      tags: categorized.tags,
      primaryCategory: categorized.primaryCategory,
      source: categorized.source,
    });
  } catch (err: any) {
    return jsonResponse({ error: err?.message || 'Failed to categorize task session', tags: [] }, 500);
  }
};
