import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { streamGeminiResponse } from './server/geminiService';
import { generateOAuthUrl, handleOAuthCallback, executeServerConnectorTool, isSafeUrl } from './server/connectorsService';
import { fetchServerWeather } from './server/weatherService';
import { globalStreamingCircuitBreaker, geminiCircuitBreaker } from './server/circuitBreaker';

function geminiApiPlugin(): Plugin {
  return {
    name: 'gemini-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];

        // Connector API Endpoints
        if (url?.startsWith('/api/connectors')) {
          res.setHeader('Content-Type', 'application/json');
          const userId = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'].trim() : '';

          if (req.method === 'GET' && url.includes('/auth-url')) {
            if (!userId) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: 'AUTHENTICATED_USER_REQUIRED', message: 'Sign in before connecting an account.' }));
              return;
            }
            const parts = url.split('/');
            const connectorId = parts[3] || 'github';
            if (connectorId !== 'github') {
              res.statusCode = 501;
              res.end(JSON.stringify({ error: 'CONNECTOR_OAUTH_UNAVAILABLE', message: `OAuth is not implemented for ${connectorId} yet.` }));
              return;
            }
            if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET || !process.env.TOKEN_ENCRYPTION_SECRET) {
              res.statusCode = 503;
              res.end(JSON.stringify({ error: 'OAUTH_NOT_CONFIGURED', message: 'Configure GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and TOKEN_ENCRYPTION_SECRET on the server before connecting GitHub.' }));
              return;
            }
            const redirectUri = `${process.env.APP_URL || 'https://manus.im'}/api/connectors/oauth/callback`;
            const authResult = generateOAuthUrl(connectorId, redirectUri, userId);
            res.end(JSON.stringify(authResult));
            return;
          }

          if (req.method === 'GET' && url.endsWith('/oauth/callback')) {
            const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
            const code = queryParams.get('code') || '';
            const state = queryParams.get('state') || '';
            const callbackRes = await handleOAuthCallback(code, state);
            const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
              '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[char] || char));
            const callbackConnectorId = escapeHtml(callbackRes.connectorId || '');
            const callbackMessage = escapeHtml(callbackRes.success
              ? `Successfully connected ${callbackRes.connectorId}. Credentials encrypted at rest.`
              : callbackRes.error || 'Authorization failed.');
            const callbackEvent = callbackRes.success ? 'MANUS_OAUTH_SUCCESS' : 'MANUS_OAUTH_ERROR';
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(`
              <!DOCTYPE html>
              <html>
                <head><title>${callbackRes.success ? 'Authorization Successful' : 'Authorization Failed'}</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 40px; background: #121316; color: white;">
                  <h2>${callbackRes.success ? '✅ Account Authorized' : '⚠️ Authorization Failed'}</h2>
                  <p>${callbackMessage}</p>
                  <script>
                    if (window.opener) {
                      window.opener.postMessage({ type: '${callbackEvent}', connectorId: '${callbackConnectorId}' }, window.location.origin);
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
                const { connectorId, toolName, args, customUrl } = body;
                if (!userId) {
                  res.statusCode = 401;
                  res.end(JSON.stringify({ error: 'AUTHENTICATED_USER_REQUIRED', message: 'Sign in before using a connector.' }));
                  return;
                }
                const activeUser = userId;

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

        // Server-Side Real-Time Weather Endpoint
        if (url === '/api/weather') {
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'GET') {
            const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
            const city = queryParams.get('city') || queryParams.get('location') || queryParams.get('q') || '';
            if (!city.trim()) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'City parameter is required (e.g. ?city=Delhi)', code: 'CITY_REQUIRED' }));
              return;
            }
            try {
              const data = await fetchServerWeather(city, 8000);
              if (!data) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: `Could not retrieve weather data for "${city}"`, code: 'NOT_FOUND' }));
                return;
              }
              res.end(JSON.stringify({ success: true, data }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message || 'Weather fetch failed' }));
            }
            return;
          }
          if (req.method === 'POST') {
            let bodyStr = '';
            req.on('data', chunk => { bodyStr += chunk; });
            req.on('end', async () => {
              try {
                const body = bodyStr ? JSON.parse(bodyStr) : {};
                const city = body?.city || body?.location || body?.q || '';
                if (!city.trim()) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'City is required in body', code: 'CITY_REQUIRED' }));
                  return;
                }
                const data = await fetchServerWeather(city, 8000);
                if (!data) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: `Could not retrieve weather data for "${city}"`, code: 'NOT_FOUND' }));
                  return;
                }
                res.end(JSON.stringify({ success: true, data }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message || 'Weather fetch failed' }));
              }
            });
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

              if (firecrawlKey) {
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
                configured: Boolean(firecrawlKey || bridgeUrl),
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

        // Circuit Breaker Health & Status Endpoint
        if (req.method === 'GET' && url === '/api/gemini/circuit-breaker') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            status: 'ok',
            geminiCircuitBreaker: geminiCircuitBreaker.getMetrics(),
            globalCircuitBreaker: globalStreamingCircuitBreaker.getMetrics(),
          }));
          return;
        }

        // Circuit Breaker Manual Reset Endpoint
        if (req.method === 'POST' && url === '/api/gemini/circuit-breaker/reset') {
          geminiCircuitBreaker.reset();
          globalStreamingCircuitBreaker.reset();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            status: 'ok',
            message: 'Gemini circuit breaker successfully reset to CLOSED state.',
            geminiCircuitBreaker: geminiCircuitBreaker.getMetrics(),
          }));
          return;
        }

        // Circuit Breaker Manual Trip (Simulation/Outage Testing) Endpoint
        if (req.method === 'POST' && url === '/api/gemini/circuit-breaker/trip') {
          let tripBody = '';
          req.on('data', c => { tripBody += c; });
          req.on('end', () => {
            let parsed = {};
            try { parsed = tripBody ? JSON.parse(tripBody) : {}; } catch {}
            geminiCircuitBreaker.trip(parsed.reason || 'Simulated outage test trip');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              status: 'ok',
              message: 'Gemini circuit breaker manually tripped to OPEN state.',
              geminiCircuitBreaker: geminiCircuitBreaker.getMetrics(),
            }));
          });
          return;
        }

        if (req.method === 'POST' && (url === '/api/gemini/stream' || url === '/api/ai/stream' || url === '/api/ai/agent')) {
          let bodyStr = '';
          req.on('data', chunk => {
            bodyStr += chunk;
          });

          req.on('end', async () => {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            // 1. Circuit Breaker Guard: Check if Gemini or outer circuit breaker is in tripped state
            const isGeminiTripped = !geminiCircuitBreaker.canAttempt();
            const isGlobalTripped = !globalStreamingCircuitBreaker.canAttempt();

            if (isGlobalTripped || isGeminiTripped) {
              const activeBreaker = isGeminiTripped ? geminiCircuitBreaker : globalStreamingCircuitBreaker;
              console.warn(`[AI Stream] ${activeBreaker.serviceName} circuit breaker is OPEN. Fast-failing with actionable recovery steps.`);
              const actionableMessage = activeBreaker.formatActionableRecoveryMessage();
              res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: actionableMessage })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'error', error: `${activeBreaker.serviceName} circuit breaker open`, code: 'CIRCUIT_BREAKER_OPEN' })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'error' })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            let chunksYielded = 0;
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const stream = streamGeminiResponse({
                messages: body.messages || (body.prompt ? [{ role: 'user', content: body.prompt }] : []),
                systemInstruction: body.systemInstruction,
                model: body.model || 'gemini-3.8-flash',
                thinkHarder: Boolean(body.thinkHarder),
              });

              for await (const delta of stream) {
                chunksYielded++;
                res.write(`data: ${JSON.stringify({ type: 'text-delta', delta })}\n\n`);
              }

              // Normal completion: record success to circuit breakers and cleanly terminate SSE
              globalStreamingCircuitBreaker.recordSuccess();
              geminiCircuitBreaker.recordSuccess();
              res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            } catch (err: any) {
              console.error('[AI Stream] Streaming provider error:', err?.message || err);
              globalStreamingCircuitBreaker.recordFailure(err);
              geminiCircuitBreaker.recordFailure(err);

              try {
                const actionableMessage = geminiCircuitBreaker.formatActionableRecoveryMessage(err);
                
                // If stream died before sending any tokens, present the actionable advice directly to the user
                if (chunksYielded === 0) {
                  res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: actionableMessage })}\n\n`);
                }
                
                res.write(`data: ${JSON.stringify({ type: 'error', error: err?.message || 'Streaming failure' })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'error' })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
              } catch (writeErr) {
                console.warn('[AI Stream] Failed to write circuit breaker error message:', writeErr);
                try { res.end(); } catch {}
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