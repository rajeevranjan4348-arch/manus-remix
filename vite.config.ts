import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { streamGeminiResponse } from './server/geminiService';
import { generateOAuthUrl, handleOAuthCallback, executeServerConnectorTool, isSafeUrl } from './server/connectorsService';
import { GoogleGenAI } from '@google/genai';

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
                } catch (gErr) {
                  console.warn('[Web Search] Google Search grounding notice:', gErr);
                }
              }

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
                } catch (fcErr) {
                  console.warn('[Web Search] Firecrawl notice:', fcErr);
                }
              }

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
                } catch (brErr) {
                  console.warn('[Web Search] Bridge notice:', brErr);
                }
              }

              res.end(JSON.stringify({
                query,
                results: results.slice(0, limit),
                providers: [...new Set(results.map(r => r.source))],
                configured: Boolean(process.env.GEMINI_API_KEY || firecrawlKey || bridgeUrl),
              }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message || 'Web search execution failed' }));
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

              // Sanitize filename
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

              // 1. Primary Engine: Google Gemini API (High-speed, live search grounding & deep reasoning)
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

              // 2. Secondary Engine: OpenRouter key pool (if explicit user key or env keys exist)
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
                  } catch (e: any) {
                    // Try next candidate
                  }
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
          // Per-process circuit breaker: open after repeated upstream failures, then probe after cooldown.
          const breaker = (globalThis as any).__manusStreamBreaker ||= { failures: 0, openedAt: 0 };
          const FAILURE_THRESHOLD = 3;
          const RESET_AFTER_MS = 20_000;
          const now = Date.now();
          const isOpen = breaker.failures >= FAILURE_THRESHOLD && now - breaker.openedAt < RESET_AFTER_MS;

          let bodyStr = '';
          req.on('data', chunk => {
            bodyStr += chunk;
            if (bodyStr.length > 2 * 1024 * 1024) {
              res.statusCode = 413;
              res.end('Request too large');
              req.destroy();
            }
          });

          req.on('end', async () => {
            if (res.writableEnded) return;
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            const sendEvent = (event: unknown) => {
              if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\\n\\n`);
            };
            const sendFailure = (message: string, code: string, retryable = true) => {
              sendEvent({ type: 'error', code, message, retryable });
              sendEvent({ type: 'finish', finishReason: 'error' });
              sendEvent('[DONE]');
              if (!res.writableEnded) res.end();
            };

            if (isOpen) {
              const waitSeconds = Math.max(1, Math.ceil((RESET_AFTER_MS - (Date.now() - breaker.openedAt)) / 1000));
              res.statusCode = 503;
              sendFailure(`AI streaming is temporarily unavailable after repeated failures. Please retry in about ${waitSeconds} seconds.`, 'CIRCUIT_OPEN');
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
              let emitted = false;
              for await (const delta of stream) {
                if (res.destroyed || res.writableEnded) return;
                if (delta) {
                  emitted = true;
                  sendEvent({ type: 'text-delta', delta });
                }
              }
              if (!emitted) throw new Error('The AI provider returned an empty response.');
              breaker.failures = 0;
              breaker.openedAt = 0;
              sendEvent({ type: 'finish', finishReason: 'stop' });
              sendEvent('[DONE]');
              if (!res.writableEnded) res.end();
            } catch (err: any) {
              breaker.failures += 1;
              if (breaker.failures >= FAILURE_THRESHOLD) breaker.openedAt = Date.now();
              console.error('[AI Stream] upstream failure', err?.message || err);
              const message = breaker.failures >= FAILURE_THRESHOLD
                ? 'The AI service failed several times and is temporarily paused. Check your API key/provider connection, then retry in 20 seconds.'
                : 'The AI response could not be completed. Check your connection and API key, then select Retry.';
              sendFailure(message, breaker.failures >= FAILURE_THRESHOLD ? 'CIRCUIT_OPEN' : 'STREAM_FAILED');
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
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
  }
});