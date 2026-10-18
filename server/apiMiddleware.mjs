/**
 * Shared API middleware for /api/* routes (Gemini stream, AI completion, connectors).
 * Used by BOTH the Vite dev-server plugin and the standalone production server
 * (server/standalone.mjs) so `vite preview` / deployed builds no longer 404 on chat.
 *
 * This is a plain-JS mirror of the route logic in vite.config.ts + server/geminiService.ts.
 */
import { GoogleGenAI } from '@google/genai';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeModel(modelName) {
  if (!modelName) return 'gemini-flash-latest';
  const clean = String(modelName).replace(/^google\//, '').trim();
  // Map any requested/legacy/placeholder model to valid Gemini API model ids.
  return clean;
}

function needsLiveSearch(text) {
  return /\b(latest|today|current|currently|right now|breaking|live|real[\s-]?time|news|headlines|recent|this week|yesterday|weather|stock price|share price|exchange rate|world news|india news|tech news|latest updates|election results|box office|release date|latest version|price today|score|standings|forecast|who won|who is (the )?(prime minister|president|chief minister|ceo)|who are the (current|latest)\b)\b/i.test(text)
    || /\b(202[5-9]|203\d)\b/.test(text)
    || /\b(what happened|what's happening|whats happening|tell me about the latest|latest on)\b/i.test(text);
}

function generateResilientResponse(prompt) {
  const clean = String(prompt || '').trim().toLowerCase();
  if (/^(hi|hello|hey|hiya|howdy|good\s+(morning|afternoon|evening|day))[!?.\s]*$/i.test(clean)) {
    return 'Hello! I am Manus, your autonomous AI workspace agent. How can I assist you today? You can ask me to research live information, analyze data, write code, or execute complex workspace tasks.';
  }
  if (/who are you|what can you do|what is manus/i.test(clean)) {
    return 'I am **Manus**, an intelligent general-purpose AI workspace agent.\n\nHere is what I can do for you:\n- **Full-Stack Engineering**: Build, modify, debug, and preview web applications and interactive systems.\n- **Autonomous Web Research**: Synthesize deep insights, gather current facts, and verify real-time data.\n- **Voice & Multimodal Work**: Natural speech conversations, audio processing, camera capture, and document analysis.\n- **Data Analysis & Processing**: Compute metrics, summarize complex records, and generate actionable reports.\n\nTell me what you\'d like to work on, and I\'ll take care of it!';
  }
  return '<think>\nAnalyzed user prompt: "' + String(prompt || '').trim() + '"\nContextual evaluation: No AI provider key is configured on this server (set GEMINI_API_KEY or OPENROUTER_API_KEY), so live inference is unavailable.\n</think>\n\n### Notice\n\nThe AI provider is not configured on this deployment, so I cannot generate a real answer for **"' + String(prompt || '').trim() + '"** right now.\n\nTo enable live responses, set one of these environment variables on the server and restart:\n- `GEMINI_API_KEY` (Google Gemini)\n- `OPENROUTER_API_KEY` (OpenRouter)\n\nYour request was NOT sent to any external service and no action was taken on your behalf.';
}

async function* streamGemini(options) {
  const apiKey = process.env.GEMINI_API_KEY;
  const latestUserText = [...(options.messages || [])].reverse()
    .find((m) => m.role === 'user')?.content || options.prompt || '';

  if (apiKey) {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'manus-agent-clone' } } });
    const preferred = normalizeModel(options.model);
    const candidateModels = Array.from(new Set([
      preferred,
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash',
    ])).filter(Boolean);

    let systemPrompt = options.systemInstruction ||
      'You are Manus, an elite AI workspace agent. Provide direct, authoritative, structured, and high-quality responses. When reasoning through complex challenges, write your thoughts inside <think> and </think> tags before your final response. Do not invent facts, sources, or actions.';
    if (options.thinkHarder) {
      systemPrompt += '\n\n[EXTENDED REASONING MODE ACTIVE]\nEnclose your step-by-step logical deconstruction and trade-off evaluation inside <think> and </think> tags at the beginning of your response.';
    }
    const useGoogleSearch = needsLiveSearch(latestUserText);
    if (useGoogleSearch) {
      systemPrompt += '\n\nLIVE WEB SEARCH IS ENABLED. Use Google Search grounding for current-events questions. Never invent sources, URLs, dates, headlines, or live facts. If search results are insufficient, say so.';
    }

    const contents = (options.messages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: latestUserText || 'Hello' }] });

    for (const model of candidateModels) {
      const toolConfigs = useGoogleSearch ? [{ tools: [{ googleSearch: {} }] }, {}] : [{}];
      for (const toolConfig of toolConfigs) {
        try {
          const responseStream = await ai.models.generateContentStream({
            model,
            contents,
            config: { systemInstruction: systemPrompt, ...toolConfig },
          });
          let hasYielded = false;
          const sources = new Map();
          for await (const chunk of responseStream) {
            const text = chunk.text;
            if (text) { hasYielded = true; yield text; }
            const groundingChunks = chunk?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            for (const gc of groundingChunks) {
              const web = gc?.web;
              if (typeof web?.uri === 'string' && /^https?:\/\//i.test(web.uri)) {
                sources.set(web.uri, typeof web.title === 'string' && web.title.trim() ? web.title : web.uri);
              }
            }
          }
          if (useGoogleSearch && sources.size > 0) {
            yield '\n\n**Sources**\n' + Array.from(sources.entries()).slice(0, 8)
              .map(([url, title]) => '- [' + title.replace(/[\[\]]/g, '') + '](' + url + ')').join('\n');
          }
          if (hasYielded) return;
        } catch (err) {
          console.warn('[AI Model Router] Gemini model "' + model + '" failed:', err?.status || err?.message || err);
          if (err?.status === 429 || String(err?.message || '').includes('RESOURCE_EXHAUSTED')) await sleep(250);
        }
      }
    }
  }

  // OpenRouter fallback pool
  const apiKeys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_WORK_API_KEY,
    process.env.OPENROUTER_CHAT_API_KEY,
    ...(process.env.OPENROUTER_API_KEYS ? process.env.OPENROUTER_API_KEYS.split(',').map((k) => k.trim()) : []),
  ].filter(Boolean);

  for (const openRouterKey of Array.from(new Set(apiKeys))) {
    try {
      yield* streamOpenRouter(options, openRouterKey);
      return;
    } catch (orErr) {
      console.warn('[AI Model Router] OpenRouter key attempt failed:', orErr?.message || orErr);
    }
  }

  // Honest local synthesizer (no fake success claims)
  console.log('[AI Model Router] No provider available — using resilient response synthesizer');
  const fallbackText = generateResilientResponse(latestUserText);
  const words = fallbackText.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 3) {
    yield words.slice(i, i + 3).join('');
    await sleep(20);
  }
}

async function* streamOpenRouter(options, openRouterApiKey) {
  const candidateModels = Array.from(new Set(['openrouter/auto', 'meta-llama/llama-3.2-3b-instruct:free']));
  const messages = [];
  if (options.systemInstruction) messages.push({ role: 'system', content: options.systemInstruction });
  for (const m of options.messages || []) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') });
  }
  if (messages.filter((m) => m.role !== 'system').length === 0) {
    messages.push({ role: 'user', content: options.prompt || 'Hello' });
  }

  let lastError = null;
  for (const model of candidateModels) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + openRouterApiKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Manus AI Agent',
        },
        body: JSON.stringify({ model, messages, stream: true, max_tokens: 2048 }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error('OpenRouter status ' + response.status + ' for model ' + model + ': ' + bodyText.slice(0, 200));
      }
      if (!response.body) throw new Error('OpenRouter response body is null');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let hasYielded = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') return;
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) { hasYielded = true; yield delta; }
            } catch {}
          }
        }
      }
      if (hasYielded) return;
    } catch (err) {
      console.warn('[AI Model Router] OpenRouter model "' + model + '" skipped:', err?.message || err);
      lastError = err;
    }
  }
  if (lastError) throw lastError;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let bodyStr = '';
    req.on('data', (chunk) => {
      bodyStr += chunk;
      if (bodyStr.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(bodyStr ? JSON.parse(bodyStr) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

/**
 * Handle /api/* requests. Returns true if handled, false to fall through (static files).
 */
export async function handleApiRequest(req, res) {
  const url = (req.url || '').split('?')[0];
  const method = req.method || 'GET';

  if (!url.startsWith('/api/')) return false;

  // Health probe
  if (method === 'GET' && (url === '/api/health' || url === '/api/gemini/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, gemini: Boolean(process.env.GEMINI_API_KEY), openrouter: Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS) }));
    return true;
  }

  // Non-stream connector/web-search endpoints are not available in standalone mode.
  if (url.startsWith('/api/connectors') || url === '/api/android/scrcpy/input' || url.startsWith('/api/checkpoints')) {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not available in standalone server mode' }));
    return true;
  }

  if (method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  }

  const body = await readBody(req);
  const messages = body.messages || (body.prompt ? [{ role: 'user', content: body.prompt }] : []);

  // JSON (non-stream) completion endpoint used by some hooks
  if (url === '/api/ai/completion') {
    try {
      let text = '';
      for await (const delta of streamGemini({ messages, systemInstruction: body.systemInstruction, model: body.model })) {
        text += delta;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text }));
    } catch (err) {
      console.error('[API] /api/ai/completion failed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'completion_failed', message: String(err?.message || err) }));
    }
    return true;
  }

  // SSE streaming endpoints: /api/gemini/stream, /api/ai/stream, /api/ai/*
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event) => {
    try { res.write('data: ' + JSON.stringify(event) + '\n\n'); } catch {}
  };

  try {
    for await (const delta of streamGemini({
      messages,
      systemInstruction: body.systemInstruction,
      model: body.model,
      thinkHarder: Boolean(body.thinkHarder),
    })) {
      sendEvent({ type: 'text-delta', delta });
    }
    sendEvent({ type: 'finish', finishReason: 'stop' });
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[API] Stream error:', err);
    sendEvent({ type: 'text-delta', delta: 'The AI server encountered an unexpected problem. Your message was not completed; please try again.' });
    sendEvent({ type: 'finish', finishReason: 'error' });
    res.write('data: [DONE]\n\n');
  }
  res.end();
  return true;
}
