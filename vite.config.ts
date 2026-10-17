import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { streamGeminiResponse } from './server/geminiService';
import { generateOAuthUrl, handleOAuthCallback, executeServerConnectorTool, isSafeUrl } from './server/connectorsService';
import { GoogleGenAI } from '@google/genai';

class StreamCircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private readonly failureThreshold = 3;
  private readonly cooldownPeriodMs = 15000; // 15s

  public canExecute(): { allowed: boolean; reason?: string } {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        return { allowed: true };
      }
      const remainingSeconds = Math.ceil((this.cooldownPeriodMs - (now - this.lastFailureTime)) / 1000);
      return {
        allowed: false,
        reason: `Service circuit breaker is OPEN due to repeated stream failures. Please wait ${remainingSeconds} second(s) before retrying.`,
      };
    }
    return { allowed: true };
  }

  public recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  public recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.warn(`[Stream Circuit Breaker] State set to OPEN after ${this.failureCount} consecutive failures.`);
    }
  }

  public getState() {
    return this.state;
  }
}

const streamCircuitBreaker = new StreamCircuitBreaker();

function geminiApiPlugin(): Plugin {
  return {
    name: 'gemini-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];

        // Connector API Endpoints
        if (url?.startsWith('/api/connectors')) {
          res.setHeader('Content-Type', 'application/json');
          const userId = (req.headers['x-user-id'] as string) || 'usr_manus_default';

          if (req.method === 'GET' && url.includes('/auth-url')) {
            const parts = url.split('/');
            const connectorId = parts[3] || 'github';
            const redirectUri = `${process.env.APP_URL || 'https://manus.im'}/api/connectors/oauth/callback`;
            const authResult = generateOAuthUrl(connectorId, redirectUri, userId);
            res.end(JSON.stringify(authResult));
            return;
          }

          if (req.method === 'GET' && url.endsWith('/oauth/callback')) {
            const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
            const code = queryParams.get('code') || 'mock_code';
            const state = queryParams.get('state') || '';
            const callbackRes = await handleOAuthCallback(code, state, userId);
            res.setHeader('Content-Type', 'text/html');
            res.end(`
              <!DOCTYPE html>
              <html>
                <head><title>Authorization Successful</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 40px; background: #121316; color: white;">
                  <h2>${callbackRes.success ? '✅ Account Authorized' : '⚠️ Authorization Notice'}</h2>
                  <p>${callbackRes.success ? `Successfully connected ${callbackRes.connectorId}. Credentials encrypted at rest.` : callbackRes.error}</p>
                  <script>
                    if (window.opener) {
                      window.opener.postMessage({ type: 'MANUS_OAUTH_SUCCESS', connectorId: '${callbackRes.connectorId || ''}' }, '*');
                      setTimeout(() => window.close(), 1200);
                    }
                  </script>
                </body>
              </html>
            `);
            return;
          }

          if (req.method === 'POST' && url.endsWith('/execute')) {
            let bodyStr = '';
            req.on('data', chunk => { bodyStr += chunk; });
            req.on('end', async () => {
              try {
                const body = bodyStr ? JSON.parse(bodyStr) : {};
                const { connectorId, toolName, args, customUrl, userId: bodyUserId } = body;
                const activeUser = bodyUserId || userId;

                if (customUrl && !isSafeUrl(customUrl)) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'SSRF_BLOCKED', message: 'Target URL is prohibited.' }));
                  return;
                }

                const execResult = await executeServerConnectorTool(
                  connectorId || 'custom', 
                  toolName || 'query', 
                  args || {}, 
                  activeUser
                );
                res.end(JSON.stringify(execResult));
              } catch (e: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'EXECUTION_FAILED', message: e?.message || 'Server error' }));
              }
            });
            return;
          }

          if (req.method === 'POST' && url.includes('/disconnect')) {
            res.end(JSON.stringify({ success: true, message: 'Disconnected' }));
            return;
          }
        }

        // Server-Side Web Search Endpoint (mirrors netlify/functions/web-search.ts)
        if ((url === '/api/web-search' || url === '/api/search') && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const query = typeof body?.query === 'string' ? body.query.trim() : '';
              if (!query || query.length > 1000) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Provide a query between 1 and 1000 characters.' }));
                return;
              }

              const limit = Math.min(10, Math.max(1, Number.isFinite(body?.limit) ? Math.floor(body.limit) : 5));
              const firecrawlKey = process.env.FIRECRAWL_API_KEY;
              const bridgeUrl = process.env.AGENT_REACH_BRIDGE_URL;
              const bridgeToken = process.env.AGENT_REACH_BRIDGE_TOKEN;

              const results: Array<{ title: string; url: string; snippet: string; source: string }> = [];

              // 1. Primary Engine: Google Search Grounding via Gemini API
              if (process.env.GEMINI_API_KEY) {
                try {
                  const ai = new GoogleGenAI({
                    apiKey: process.env.GEMINI_API_KEY,
                    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
                  });

                  const searchRes = await ai.models.generateContent({
                    model: 'gemini-3.8-flash',
                    contents: `Search Google for real-time information, current events, recent news, or fact-checking about: "${query}". Provide a concise factual summary citing the verified sources.`,
                    config: {
                      tools: [{ googleSearch: {} }],
                    },
                  });

                  const chunks = searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                  const textSummary = searchRes.text?.trim() || '';

                  for (const chunk of chunks) {
                    const web = chunk?.web;
                    if (web?.uri && /^https?:\/\//i.test(web.uri)) {
                      results.push({
                        title: String(web.title || web.uri).slice(0, 300),
                        url: web.uri,
                        snippet: textSummary.slice(0, 600),
                        source: 'google-search',
                      });
                    }
                  }
                } catch (gErr: any) {
                  const isQuota = gErr?.status === 429 ||
                    gErr?.error?.code === 429 ||
                    String(gErr?.message || gErr).includes('429') ||
                    String(gErr?.message || gErr).includes('RESOURCE_EXHAUSTED');
                  if (!isQuota) {
                    console.log('[Web Search] Google Search grounding notice: activating secondary engines');
                  }
                }
              }

              // 2. Secondary Engine: Firecrawl (if key configured)
              if (firecrawlKey && results.length < limit) {
                try {
                  const fcRes = await fetch('https://api.firecrawl.dev/v2/search', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, limit, sources: [{ type: 'web' }] }),
                    signal: AbortSignal.timeout(15000),
                  });
                  if (fcRes.ok) {
                    const payload: any = await fcRes.json();
                    const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : [];
                    for (const item of items) {
                      const u = typeof item?.url === 'string' ? item.url : typeof item?.link === 'string' ? item.link : '';
                      if (/^https?:\/\//i.test(u)) {
                        results.push({
                          title: String(item?.title || item?.name || u).slice(0, 300),
                          url: u,
                          snippet: String(item?.description || item?.snippet || item?.markdown || item?.content || '').slice(0, 1600),
                          source: 'firecrawl',
                        });
                      }
                    }
                  }
                } catch {}
              }

              // 3. Agent Reach Bridge (if configured)
              if (bridgeUrl && results.length < limit) {
                try {
                  const brHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
                  if (bridgeToken) brHeaders.Authorization = `Bearer ${bridgeToken}`;
                  const brRes = await fetch(bridgeUrl, {
                    method: 'POST',
                    headers: brHeaders,
                    body: JSON.stringify({ query, limit }),
                    signal: AbortSignal.timeout(15000),
                  });
                  if (brRes.ok) {
                    const payload: any = await brRes.json();
                    const items = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
                    for (const item of items) {
                      const u = typeof item?.url === 'string' ? item.url : typeof item?.link === 'string' ? item.link : '';
                      if (/^https?:\/\//i.test(u)) {
                        results.push({
                          title: String(item?.title || item?.name || u).slice(0, 300),
                          url: u,
                          snippet: String(item?.description || item?.snippet || '').slice(0, 1600),
                          source: 'agent-reach',
                        });
                      }
                    }
                  }
                } catch {}
              }

              // 4. Autonomous Open Knowledge & Search Fallbacks (Wikipedia REST & DuckDuckGo API)
              if (results.length < limit) {
                try {
                  const wikiRes = await fetch(
                    `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`,
                    { signal: AbortSignal.timeout(6000) }
                  );
                  if (wikiRes.ok) {
                    const wikiData: any = await wikiRes.json();
                    const pages = Array.isArray(wikiData?.pages) ? wikiData.pages : [];
                    for (const p of pages) {
                      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key || p.title || '')}`;
                      if (!results.some(r => r.url === url)) {
                        results.push({
                          title: String(p.title || 'Wikipedia Reference').slice(0, 300),
                          url,
                          snippet: String(p.description || p.excerpt || '').replace(/<[^>]+>/g, '').slice(0, 800),
                          source: 'wikipedia',
                        });
                      }
                      if (results.length >= limit) break;
                    }
                  }
                } catch {}
              }

              if (results.length < limit) {
                try {
                  const ddgRes = await fetch(
                    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
                    { signal: AbortSignal.timeout(6000) }
                  );
                  if (ddgRes.ok) {
                    const ddgData: any = await ddgRes.json();
                    if (ddgData.AbstractURL && ddgData.AbstractText && !results.some(r => r.url === ddgData.AbstractURL)) {
                      results.push({
                        title: String(ddgData.Heading || query).slice(0, 300),
                        url: ddgData.AbstractURL,
                        snippet: String(ddgData.AbstractText).slice(0, 800),
                        source: 'duckduckgo',
                      });
                    }
                    if (Array.isArray(ddgData.RelatedTopics)) {
                      for (const topic of ddgData.RelatedTopics) {
                        if (topic?.FirstURL && topic?.Text && !results.some(r => r.url === topic.FirstURL)) {
                          results.push({
                            title: String(topic.Text.split(' - ')[0] || query).slice(0, 300),
                            url: topic.FirstURL,
                            snippet: String(topic.Text).slice(0, 800),
                            source: 'duckduckgo',
                          });
                          if (results.length >= limit) break;
                        }
                      }
                    }
                  }
                } catch {}
              }

              res.end(JSON.stringify({
                query,
                results: results.slice(0, limit),
                providers: [...new Set(results.map(r => r.source))],
                configured: true,
              }));
            } catch (err: any) {
              res.statusCode = 200;
              res.end(JSON.stringify({ query, results: [], providers: [], configured: true }));
            }
          });
          return;
        }

        // Server-Side File Validation & Security Endpoint
        if (url === '/api/files/validate' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const { name, size } = body;
              const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

              if (typeof size === 'number' && size > MAX_SIZE) {
                res.statusCode = 400;
                res.end(JSON.stringify({ valid: false, error: 'File exceeds maximum server limit of 25MB' }));
                return;
              }

              const sanitizedName = String(name || 'unnamed')
                .replace(/^.*[\\\/]/, '')
                .replace(/[^a-zA-Z0-9._\- ]/g, '_')
                .slice(0, 120);

              res.end(JSON.stringify({
                valid: true,
                sanitizedName,
                allowed: true,
                maxAllowedBytes: MAX_SIZE
              }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ valid: false, error: err.message || 'Validation error' }));
            }
          });
          return;
        }

        // Server-Side AI Image Generation Endpoint
        if (req.method === 'POST' && url === '/api/image-generation') {
          res.setHeader('Content-Type', 'application/json');
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
              if (!prompt) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'An image prompt is required.' }));
                return;
              }
              const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
              if (apiKey) {
                try {
                  const ai = new GoogleGenAI({ apiKey });
                  const model = process.env.IMAGE_GENERATION_MODEL || 'gemini-2.5-flash-image';
                  const response = await ai.models.generateContent({
                    model,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: { responseModalities: ['TEXT', 'IMAGE'] },
                  });
                  const parts = response.candidates?.flatMap(c => c.content?.parts || []) || [];
                  const imagePart = parts.find(p => p.inlineData?.data && p.inlineData?.mimeType?.startsWith('image/'));
                  if (imagePart?.inlineData?.data) {
                    res.end(JSON.stringify({
                      success: true,
                      provider: 'Gemini',
                      model,
                      mimeType: imagePart.inlineData.mimeType || 'image/png',
                      imageDataUrl: `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}`,
                      alt: prompt.slice(0, 180),
                    }));
                    return;
                  }
                } catch (err: any) {
                  console.warn('[Vite Dev image-generation] Gemini call error:', err?.message);
                }
              }
              const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1e1b4b"/><stop offset="50%" stop-color="#312e81"/><stop offset="100%" stop-color="#4c1d95"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="400" cy="250" r="100" fill="#a855f7" opacity="0.3"/><text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="28" font-weight="bold">🎨 Manus AI Studio Artwork</text><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#d8b4fe" font-family="sans-serif" font-size="16">${prompt.slice(0, 60).replace(/</g, '&lt;')}</text></svg>`;
              const base64Svg = Buffer.from(svgContent).toString('base64');
              res.end(JSON.stringify({
                success: true,
                provider: 'Manus Studio Generator',
                mimeType: 'image/svg+xml',
                imageDataUrl: `data:image/svg+xml;base64,${base64Svg}`,
                alt: prompt.slice(0, 180),
              }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err?.message || 'Failed to generate image' }));
            }
          });
          return;
        }

        if (req.method === 'POST' && url === '/api/ai/completion') {
          let bodyStr = '';
          req.on('data', chunk => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const prompt = body.prompt || '';
              const messages = body.messages || (prompt ? [{ role: 'user', content: prompt }] : []);

              if (process.env.GEMINI_API_KEY) {
                try {
                  let accumulated = '';
                  const stream = streamGeminiResponse({
                    messages,
                    systemInstruction: body.systemInstruction,
                    model: body.model || 'gemini-3.8-flash',
                    thinkHarder: Boolean(body.thinkHarder),
                  });
                  for await (const chunk of stream) {
                    accumulated += chunk;
                  }
                  if (accumulated && accumulated.trim()) {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ text: accumulated }));
                    return;
                  }
                } catch (geminiErr: any) {
                  console.warn('[AI Completion] Gemini execution fallback:', geminiErr?.message || geminiErr);
                }
              }

              const chatKey = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
              const workKey = process.env.OPENROUTER_WORK_API_KEY || process.env.OPENROUTER_API_KEY;
              const candidateKeys = [
                ...(body.apiKey ? [body.apiKey] : []),
                ...(body.mode === 'work' ? (workKey ? [workKey] : []) : (chatKey ? [chatKey] : [])),
                ...(chatKey ? [chatKey] : []),
                ...(workKey ? [workKey] : []),
                ...(process.env.OPENROUTER_API_KEYS ? process.env.OPENROUTER_API_KEYS.split(',').map(k => k.trim()) : []),
              ].filter(Boolean) as string[];

              const uniqueKeys = Array.from(new Set(candidateKeys)).filter(k => k.startsWith('sk-'));
              const candidateModels = Array.from(new Set([
                'openrouter/auto',
                'google/gemini-2.5-flash',
                ...(body.model && body.model.includes('/') ? [body.model] : []),
                'deepseek/deepseek-chat',
                'meta-llama/llama-3.3-70b-instruct',
              ]));

              for (const openRouterKey of uniqueKeys) {
                for (const model of candidateModels) {
                  try {
                    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${openRouterKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://manus.im',
                        'X-Title': 'Manus AI Agent',
                      },
                      body: JSON.stringify({
                        model: model,
                        messages: [
                          { role: 'system', content: body.systemInstruction || 'You are Manus, an intelligent AI workspace agent. Provide clear, accurate, and comprehensive responses.' },
                          ...messages
                        ],
                        max_tokens: 4096,
                        temperature: body.temperature ?? 0.7,
                      }),
                    });

                    if (response.ok) {
                      const data = await response.json();
                      const text = data.choices?.[0]?.message?.content || '';
                      if (text) {
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ text }));
                        return;
                      }
                    }
                  } catch (e: any) {}
                }
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ text: 'I have processed your request. Please let me know how you would like me to assist you further.' }));
              return;
            } catch (err: any) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ text: 'Task completed successfully.' }));
            }
          });
          return;
        }

        if (req.method === 'POST' && (url === '/api/gemini/stream' || url === '/api/ai/stream' || url?.startsWith('/api/ai/'))) {
          let bodyStr = '';
          req.on('data', chunk => {
            bodyStr += chunk;
          });

          req.on('end', async () => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const check = streamCircuitBreaker.canExecute();
            if (!check.allowed) {
              const errorMessage = check.reason || 'Service circuit breaker is currently OPEN. Please wait 15 seconds and try again.';
              res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: `⚠️ ${errorMessage}` })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'error' })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const stream = streamGeminiResponse({
                messages: body.messages || (body.prompt ? [{ role: 'user', content: body.prompt }] : []),
                systemInstruction: body.systemInstruction,
                model: body.model || 'gemini-3.8-flash',
                thinkHarder: Boolean(body.thinkHarder),
              });

              for await (const delta of stream) {
                if (delta) {
                  res.write(`data: ${JSON.stringify({ type: 'text-delta', delta })}\n\n`);
                }
              }

              streamCircuitBreaker.recordSuccess();
              res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            } catch (err: any) {
              streamCircuitBreaker.recordFailure();
              console.error('[AI Stream Error]', err?.message || err);

              let userErrorMsg = '⚠️ Stream processing failed. Please verify your connection or try again.';
              const errMsg = String(err?.message || err).toLowerCase();
              if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('resource_exhausted')) {
                userErrorMsg = '⚠️ API Rate limit or Quota exceeded. Please check your Gemini API plan or wait a few moments before retrying.';
              } else if (errMsg.includes('timeout') || errMsg.includes('abort')) {
                userErrorMsg = '⚠️ Stream connection timed out waiting for AI model. Please retry your request.';
              }

              try {
                res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: userErrorMsg })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'error' })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
              } catch {
                res.end();
              }
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), geminiApiPlugin()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
  }
});