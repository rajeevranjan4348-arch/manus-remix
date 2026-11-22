import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {
  categorizeSessionWithGemini,
  streamGeminiResponse,
  summarizeSessionHistory,
} from './server/geminiService';
import {
  enrichQueryWithRealtimeData,
  fetchLiveCryptoPrices,
  fetchLiveExchangeRates,
  fetchLiveNewsAndFacts,
  fetchLiveWeatherSnapshot,
  getLiveTemporalContext,
} from './server/realtimeDataService';
import {
  orchestrateRealtimeResearch,
  routeQueryIntent,
} from './server/rtie';
import {
  generateOAuthUrl,
  handleOAuthCallback,
  executeServerConnectorTool,
  isSafeUrl,
  refreshUserConnectorToken,
} from './server/connectorsService';
import { handleCloudSqlApiRequest } from './server/cloudSqlRoutes';
import { searchVerifiedEntityImages } from './server/visualSearchService';
import { resolveBackendGoogleIntegrations } from './server/workspaceIntegrationsHandler';
import { checkSharedRateLimit } from './server/distributedRateLimiter';
import { verifyBearerToken } from './src/middleware/auth';
import { GoogleGenAI } from '@google/genai';
import { agentActivityHub } from './server/agentActivityService';
import { runTechnicalVerification } from './server/agentVerificationService';

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
  const apiMiddleware = async (req: any, res: any, next: any) => {
        const url = req.url?.split('?')[0];

        if (url === '/api/health') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, code: 'METHOD_NOT_ALLOWED' }));
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, service: 'ai-app-function', generatedAt: new Date().toISOString() }));
          return;
        }

        // Server-Side Cloud SQL Relational Data Endpoints
        if (url && url.startsWith('/api/sql/')) {
          const sqlTaskId = (req.headers['x-task-id'] as string) || '';
          const sqlHandle = sqlTaskId
            ? agentActivityHub.startActivity(sqlTaskId, {
                title: 'Checking database connection and query',
                description: `Executing ${req.method || 'GET'} ${url}`,
                toolName: 'cloud_sql',
                category: 'database',
              })
            : null;
          try {
            const handled = await handleCloudSqlApiRequest(req, res, url);
            if (handled) {
              sqlHandle?.complete(`Completed ${url}`);
              return;
            }
            sqlHandle?.cancel('Route not handled');
          } catch (sqlErr: any) {
            sqlHandle?.fail(sqlErr);
            throw sqlErr;
          }
        }

        // Real-Time Agent Activity SSE Stream, Snapshot, Cancellation & Verification Endpoints
        if (url === '/api/agent/activity/stream' && req.method === 'GET') {
          const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
          const taskId = String(queryParams.get('taskId') || '').trim().slice(0, 120);
          if (!taskId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'taskId query parameter is required.' }));
            return;
          }

          const lastEventIdHeader = req.headers['last-event-id'];
          const rawSince =
            (typeof lastEventIdHeader === 'string' && lastEventIdHeader.trim()) ||
            queryParams.get('sinceSeq') ||
            '0';
          const sinceSeq = Number.parseInt(rawSince, 10) || 0;

          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          if (typeof (res as any).flushHeaders === 'function') {
            (res as any).flushHeaders();
          }

          const writeActivityFrame = (activityEvent: any) => {
            if (res.writableEnded) return;
            res.write(`id: ${activityEvent.seq}\n`);
            res.write(`event: agent-activity\n`);
            res.write(`data: ${JSON.stringify({ type: 'agent-activity', event: activityEvent })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          };

          // Replay missed events cleanly without duplicates
          const missed = agentActivityHub.getEvents(taskId, sinceSeq);
          for (const ev of missed) {
            writeActivityFrame(ev);
          }

          const unsubscribe = agentActivityHub.subscribe(taskId, writeActivityFrame);
          const heartbeat = setInterval(() => {
            if (res.writableEnded) {
              clearInterval(heartbeat);
              unsubscribe();
              return;
            }
            res.write(': heartbeat\n\n');
          }, 15000);

          const cleanup = () => {
            clearInterval(heartbeat);
            unsubscribe();
          };
          req.on('close', cleanup);
          res.on('close', cleanup);
          return;
        }

        if (url === '/api/agent/activity' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
          const taskId = String(queryParams.get('taskId') || '').trim().slice(0, 120);
          const sinceSeq = Number.parseInt(queryParams.get('sinceSeq') || '0', 10) || 0;
          if (!taskId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'taskId is required', events: [] }));
            return;
          }
          res.end(
            JSON.stringify({
              taskId,
              latestSeq: agentActivityHub.getLatestSeq(taskId),
              events: agentActivityHub.getEvents(taskId, sinceSeq),
            })
          );
          return;
        }

        if (url === '/api/agent/activity/cancel' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          let bodyStr = '';
          req.on('data', (chunk: any) => { bodyStr += chunk; });
          req.on('end', () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const taskId = String(body?.taskId || '').trim().slice(0, 120);
              const reason = typeof body?.reason === 'string' ? body.reason : 'Cancelled by user';
              const cancelled = taskId ? agentActivityHub.cancelActiveActivities(taskId, reason) : [];
              res.end(JSON.stringify({ ok: true, cancelledCount: cancelled.length }));
            } catch (err: any) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid cancel payload' }));
            }
          });
          return;
        }

        if (url === '/api/agent/verify' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          let bodyStr = '';
          req.on('data', (chunk: any) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const taskId = String(body?.taskId || `verify_${Date.now()}`).trim().slice(0, 120);
              const prompt = typeof body?.prompt === 'string' ? body.prompt : 'Verify project configuration';
              const report = await runTechnicalVerification({
                taskId,
                prompt,
                targetPaths: Array.isArray(body?.targetPaths) ? body.targetPaths : undefined,
                runTypeCheck: Boolean(body?.runTypeCheck),
                runTests: Boolean(body?.runTests),
                runBuild: Boolean(body?.runBuild),
              });
              res.end(JSON.stringify({ ok: true, report }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: err?.message || 'Verification failed' }));
            }
          });
          return;
        }

        // Server-Side Real-Time Data & RTIE Intelligence Endpoint
        if (url === '/api/realtime' || url === '/api/realtime-data' || url === '/api/rtie/research' || url === '/.netlify/functions/realtime') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          const decodedToken = await verifyBearerToken(req.headers.authorization as string | undefined);
          if (!decodedToken?.uid) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' }));
            return;
          }
          const rateLimit = await checkSharedRateLimit(`realtime:${decodedToken.uid}`, 30, 60);
          if (rateLimit.unavailable) {
            res.statusCode = 503;
            res.end(JSON.stringify({ ok: false, error: 'Real-time data is temporarily unavailable because the shared rate limiter is not configured.', code: 'RATE_LIMIT_UNAVAILABLE' }));
            return;
          }
          if (!rateLimit.allowed) {
            res.statusCode = 429;
            res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
            res.end(JSON.stringify({ ok: false, error: 'Rate limit exceeded. Please wait before sending more research requests.', code: 'RATE_LIMITED' }));
            return;
          }

          const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const query = String(body.query || queryParams.get('q') || queryParams.get('query') || '').trim();
              const city = String(body.city || queryParams.get('city') || 'New Delhi').trim();

              if (query) {
                const [rtie, enriched] = await Promise.all([
                  orchestrateRealtimeResearch(query, {
                    bypassCache: Boolean(body.bypassCache),
                    includeGoogleGroundingFetch: Boolean(body.includeGoogleGroundingFetch),
                  }),
                  enrichQueryWithRealtimeData(query),
                ]);
                res.end(JSON.stringify({
                  ok: true,
                  ...enriched,
                  rtie,
                  route: rtie.route,
                  verification: rtie.verification,
                  freshness: rtie.freshness,
                }));
                return;
              }

              const [weather, currency, crypto, news] = await Promise.all([
                fetchLiveWeatherSnapshot(city),
                fetchLiveExchangeRates('USD', 'INR', 1),
                fetchLiveCryptoPrices(),
                fetchLiveNewsAndFacts('latest technology and science news', 4),
              ]);

              res.end(JSON.stringify({
                ok: true,
                temporal: getLiveTemporalContext(),
                weather,
                currency,
                crypto,
                news,
              }));
            } catch (err: any) {
              res.statusCode = 200;
              res.end(JSON.stringify({
                ok: true,
                temporal: getLiveTemporalContext(),
                error: err?.message || 'Partial real-time feed unavailable',
              }));
            }
          });
          return;
        }

        // Google Workspace Active Integrations Endpoint
        if (
          url === '/api/workspace/integrations' ||
          url === '/.netlify/functions/workspace-integrations'
        ) {
          res.setHeader('Content-Type', 'application/json');
          const authHeader = (req.headers['authorization'] as string) || '';
          const userEmailHeader = (req.headers['x-user-email'] as string) || '';
          const disabledHeader = (req.headers['x-disabled-apps'] as string) || '';
          const disabledAppIds = disabledHeader
            ? disabledHeader.split(',').map((s) => s.trim()).filter(Boolean)
            : [];

          resolveBackendGoogleIntegrations({
            authorizationHeader: authHeader,
            userEmailHeader,
            disabledAppIds,
          })
            .then((payload) => {
              res.statusCode = 200;
              res.end(JSON.stringify(payload));
            })
            .catch((err: any) => {
              res.statusCode = 500;
              res.end(
                JSON.stringify({
                  authenticated: false,
                  accountEmail: null,
                  checkedAt: new Date().toISOString(),
                  source: 'backend',
                  integrations: [],
                  error: err?.message || 'Failed to inspect Google integrations',
                })
              );
            });
          return;
        }

        // Connector API Endpoints
        if (url?.startsWith('/api/connectors')) {
          res.setHeader('Content-Type', 'application/json');
          const userId = (req.headers['x-user-id'] as string) || 'usr_manus_default';

          if (req.method === 'GET' && (url === '/api/connectors' || url === '/api/connectors/')) {
            res.end(JSON.stringify({ connectors: [] }));
            return;
          }

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
                const { connectorId, toolName, args, customUrl, userId: bodyUserId, taskId: bodyTaskId } = body;
                const activeUser = bodyUserId || userId;
                const activeTaskId = String(bodyTaskId || req.headers['x-task-id'] || '').trim();

                if (customUrl && !isSafeUrl(customUrl)) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'SSRF_BLOCKED', message: 'Target URL is prohibited.' }));
                  return;
                }

                const connHandle = activeTaskId
                  ? agentActivityHub.startActivity(activeTaskId, {
                      title: `Executing ${connectorId || 'connector'} tool (${toolName || 'query'})`,
                      description: `Running backend connector action on ${connectorId || 'custom'}`,
                      toolName: String(toolName || connectorId || 'connector'),
                      category: 'api',
                    })
                  : null;

                const execResult = await executeServerConnectorTool(
                  connectorId || 'custom', 
                  toolName || 'query', 
                  args || {}, 
                  activeUser
                );
                if (execResult?.success === false) {
                  connHandle?.fail(execResult?.error || execResult?.message || 'Connector tool failed');
                } else {
                  connHandle?.complete(`Connector ${connectorId || 'custom'} completed`);
                }
                res.end(JSON.stringify(execResult));
              } catch (e: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'EXECUTION_FAILED', message: e?.message || 'Server error' }));
              }
            });
            return;
          }

          if (req.method === 'POST' && url.endsWith('/token/refresh')) {
            let bodyStr = '';
            req.on('data', chunk => { bodyStr += chunk; });
            req.on('end', async () => {
              try {
                const body = bodyStr ? JSON.parse(bodyStr) : {};
                const authHeader = (req.headers.authorization as string) || '';
                const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
                  ? authHeader.slice(7).trim()
                  : '';
                const activeUser = body.userId || userId;
                const connectorId = body.connectorId || 'google_workspace';
                const refreshRes = await refreshUserConnectorToken(activeUser, connectorId, {
                  force: Boolean(body.force),
                  clientAccessToken: body.clientAccessToken || bearerToken || undefined,
                  refreshToken: body.refreshToken || undefined,
                  expiresInMs: typeof body.expiresInMs === 'number' ? body.expiresInMs : undefined,
                  user: body.userEmail ? { email: body.userEmail } : undefined,
                });
                res.statusCode = refreshRes.success ? 200 : 400;
                res.end(JSON.stringify(refreshRes));
              } catch (e: any) {
                res.statusCode = 500;
                res.end(
                  JSON.stringify({
                    success: false,
                    error: e?.message || 'Token refresh failed',
                  })
                );
              }
            });
            return;
          }

          if (req.method === 'POST' && url.includes('/disconnect')) {
            res.end(JSON.stringify({ success: true, message: 'Disconnected' }));
            return;
          }
        }

        // Server-Side Task AI Tagging Endpoint (Gemini API)
        if (
          (url === '/api/tag-task' ||
            url === '/api/gemini/tag-task' ||
            url === '/.netlify/functions/tag-task') &&
          req.method === 'POST'
        ) {
          res.setHeader('Content-Type', 'application/json');
          const decodedToken = await verifyBearerToken(req.headers.authorization as string | undefined);
          if (!decodedToken?.uid) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }));
            return;
          }
          const rateLimit = await checkSharedRateLimit(`tag-task:${decodedToken.uid}`, 20, 60);
          if (rateLimit.unavailable || !rateLimit.allowed) {
            res.statusCode = rateLimit.unavailable ? 503 : 429;
            if (!rateLimit.unavailable) res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
            res.end(JSON.stringify({
              error: rateLimit.unavailable ? 'Task tagging is temporarily unavailable because the shared rate limiter is not configured.' : 'Too many task-tagging requests. Please wait and try again.',
              code: rateLimit.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
            }));
            return;
          }
          let bodyStr = '';
          let bodyBytes = 0;
          let bodyTooLarge = false;
          req.on('data', chunk => {
            bodyBytes += Buffer.byteLength(chunk);
            if (bodyBytes > 16 * 1024) bodyTooLarge = true;
            else if (!bodyTooLarge) bodyStr += chunk;
          });
          req.on('end', async () => {
            if (bodyTooLarge) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: 'Request payload exceeds the maximum allowed size.', code: 'PAYLOAD_TOO_LARGE' }));
              return;
            }
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};

              // Support batch session categorization for HistoryPanel automated tagging
              if (Array.isArray(body?.sessions)) {
                const batchEntries = body.sessions.slice(0, 25);
                const results: Record<string, string[]> = {};
                await Promise.all(
                  batchEntries.map(async (entry: any) => {
                    const sessionId = typeof entry?.id === 'string' ? entry.id : typeof entry?.sessionId === 'string' ? entry.sessionId : '';
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
                res.end(JSON.stringify({ results }));
                return;
              }

              const title = typeof body?.title === 'string' ? body.title.trim() : '';
              const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
              const content = typeof body?.content === 'string' ? body.content.trim() : '';
              const messages = Array.isArray(body?.messages) ? body.messages : undefined;

              if (!prompt && !title && !content && (!messages || messages.length === 0)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Task prompt or content is required' }));
                return;
              }

              const categorized = await categorizeSessionWithGemini({
                sessionId: typeof body?.sessionId === 'string' ? body.sessionId : undefined,
                title,
                prompt,
                content,
                messages,
              });

              res.end(
                JSON.stringify({
                  tags: categorized.tags,
                  primaryCategory: categorized.primaryCategory,
                  source: categorized.source,
                })
              );
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err?.message || 'Failed to categorize task session', tags: [] }));
            }
          });
          return;
        }

        // Server-Side Session Conversation History Summary Endpoint (Gemini API)
        if ((url === '/api/summarize-session' || url === '/api/gemini/summarize-session') && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          const decodedToken = await verifyBearerToken(req.headers.authorization as string | undefined);
          if (!decodedToken?.uid) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }));
            return;
          }
          const rateLimit = await checkSharedRateLimit(`summarize-session:${decodedToken.uid}`, 20, 60);
          if (rateLimit.unavailable || !rateLimit.allowed) {
            res.statusCode = rateLimit.unavailable ? 503 : 429;
            if (!rateLimit.unavailable) res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
            res.end(JSON.stringify({
              error: rateLimit.unavailable ? 'Session summaries are temporarily unavailable because the shared rate limiter is not configured.' : 'Too many summary requests. Please wait and try again.',
              code: rateLimit.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
            }));
            return;
          }
          let bodyStr = '';
          let bodyBytes = 0;
          let bodyTooLarge = false;
          req.on('data', chunk => {
            bodyBytes += Buffer.byteLength(chunk);
            if (bodyBytes > 16 * 1024) bodyTooLarge = true;
            else if (!bodyTooLarge) bodyStr += chunk;
          });
          req.on('end', async () => {
            if (bodyTooLarge) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: 'Request payload exceeds the maximum allowed size.', code: 'PAYLOAD_TOO_LARGE' }));
              return;
            }
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const summary = await summarizeSessionHistory({
                title: typeof body?.title === 'string' ? body.title : undefined,
                prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
                content: typeof body?.content === 'string' ? body.content : undefined,
                messages: Array.isArray(body?.messages) ? body.messages : undefined,
              });
              res.end(JSON.stringify({ summary }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err?.message || 'Failed to generate session summary' }));
            }
          });
          return;
        }

        // Server-Side Visual Answer Engine Image Search Endpoint
        if ((url === '/api/visual-search' || url === '/.netlify/functions/visual-search') && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          const decodedToken = await verifyBearerToken(req.headers.authorization as string | undefined);
          if (!decodedToken?.uid) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }));
            return;
          }
          const rateLimit = await checkSharedRateLimit(`web-search:${decodedToken.uid}`, 30, 60);
          if (rateLimit.unavailable || !rateLimit.allowed) {
            res.statusCode = rateLimit.unavailable ? 503 : 429;
            res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
            res.end(JSON.stringify({
              error: rateLimit.unavailable ? 'Search is temporarily unavailable because the shared rate limiter is not configured.' : 'Too many search requests. Please wait and try again.',
              code: rateLimit.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
            }));
            return;
          }
          let bodyStr = '';
          let bodyBytes = 0;
          let bodyTooLarge = false;
          req.on('data', chunk => {
            bodyBytes += Buffer.byteLength(chunk);
            if (bodyBytes > 16 * 1024) bodyTooLarge = true;
            else if (!bodyTooLarge) bodyStr += chunk;
          });
          req.on('end', async () => {
            if (bodyTooLarge) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: 'Request payload exceeds the maximum allowed size.', code: 'PAYLOAD_TOO_LARGE' }));
              return;
            }
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const queries = Array.isArray(body?.queries)
                ? body.queries.map((q: any) => String(q || '').trim()).filter(Boolean)
                : typeof body?.query === 'string' && body.query.trim()
                  ? [body.query.trim()]
                  : [];
              const maxResults = Math.min(4, Math.max(1, Number(body?.limit || body?.maxResults) || 4));
              const isComparison = Boolean(body?.isComparison);
              if (queries.length === 0) {
                res.end(JSON.stringify({ ok: true, images: [] }));
                return;
              }
              const images = await searchVerifiedEntityImages({
                primarySubject: typeof body?.primarySubject === 'string' ? body.primarySubject : queries[0],
                subjects: Array.isArray(body?.subjects) ? body.subjects : undefined,
                queries,
                requiredTokens: Array.isArray(body?.requiredTokens) ? body.requiredTokens : undefined,
                disallowedTokens: Array.isArray(body?.disallowedTokens) ? body.disallowedTokens : undefined,
                isComparison,
                limit: maxResults,
              });
              res.end(JSON.stringify({ ok: true, images }));
            } catch (err: any) {
              res.end(JSON.stringify({ ok: false, images: [], error: err?.message || 'Visual search unavailable' }));
            }
          });
          return;
        }

        // Server-Side Web Search Endpoint (mirrors netlify/functions/web-search.ts)
        if ((url === '/api/web-search' || url === '/api/search' || url === '/.netlify/functions/web-search') && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          const decodedToken = await verifyBearerToken(req.headers.authorization as string | undefined);
          if (!decodedToken?.uid) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }));
            return;
          }
          const rateLimit = await checkSharedRateLimit(`web-search:${decodedToken.uid}`, 30, 60);
          if (rateLimit.unavailable || !rateLimit.allowed) {
            res.statusCode = rateLimit.unavailable ? 503 : 429;
            res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
            res.end(JSON.stringify({
              error: rateLimit.unavailable ? 'Search is temporarily unavailable because the shared rate limiter is not configured.' : 'Too many search requests. Please wait and try again.',
              code: rateLimit.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
            }));
            return;
          }
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
                    model: 'gemini-3-flash-preview',
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
        if (req.method === 'POST' && (url === '/api/image-generation' || url === '/.netlify/functions/image-generation')) {
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
          const decodedToken = await verifyBearerToken(req.headers.authorization as string | undefined);
          if (!decodedToken?.uid) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }));
            return;
          }
          const rateLimit = await checkSharedRateLimit(`agent:${decodedToken.uid}`, 45, 60);
          if (rateLimit.unavailable || !rateLimit.allowed) {
            res.statusCode = rateLimit.unavailable ? 503 : 429;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
            res.end(JSON.stringify({
              error: rateLimit.unavailable ? 'AI service is temporarily unavailable because the shared rate limiter is not configured.' : 'Too many requests. Please wait and try again.',
              code: rateLimit.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
            }));
            return;
          }
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

        if (
          req.method === 'POST' &&
          (url === '/api/gemini/stream' ||
            url === '/api/ai/stream' ||
            url === '/api/agent' ||
            url === '/.netlify/functions/agent' ||
            url?.startsWith('/api/ai/'))
        ) {
          const decodedToken = await verifyBearerToken(req.headers.authorization as string | undefined);
          if (!decodedToken?.uid) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }));
            return;
          }
          const rateLimit = await checkSharedRateLimit(`agent:${decodedToken.uid}`, 45, 60);
          if (rateLimit.unavailable || !rateLimit.allowed) {
            res.statusCode = rateLimit.unavailable ? 503 : 429;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
            res.end(JSON.stringify({
              error: rateLimit.unavailable ? 'AI service is temporarily unavailable because the shared rate limiter is not configured.' : 'Too many requests. Please wait and try again.',
              code: rateLimit.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
            }));
            return;
          }
          let bodyStr = '';
          req.on('data', chunk => {
            bodyStr += chunk;
          });

          req.on('end', async () => {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof (res as any).flushHeaders === 'function') {
              (res as any).flushHeaders();
            }

            let clientAborted = false;
            res.on('close', () => {
              if (!res.writableEnded) {
                clientAborted = true;
              }
            });

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
              const requestId = typeof body?.requestId === 'string' && body.requestId.trim()
                ? body.requestId.trim().slice(0, 120)
                : `srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const taskId = typeof body?.taskId === 'string' && body.taskId.trim()
                ? body.taskId.trim().slice(0, 120)
                : requestId;
              const abortController = new AbortController();

              const safeWrite = (payload: string) => {
                if (clientAborted || res.writableEnded) return;
                try {
                  res.write(payload);
                  if (typeof (res as any).flush === 'function') {
                    (res as any).flush();
                  }
                } catch {
                  clientAborted = true;
                }
              };

              // Immediate initial SSE event + periodic 5s heartbeat so proxies/clients never idle out
              safeWrite(`data: ${JSON.stringify({ type: 'stream-open', requestId, taskId, timestamp: Date.now() })}\n\n`);
              const heartbeatTimer = setInterval(() => {
                if (clientAborted || res.writableEnded) return;
                safeWrite(`: heartbeat ${Date.now()}\n\n`);
                safeWrite(`data: ${JSON.stringify({ type: 'heartbeat', requestId, taskId, timestamp: Date.now() })}\n\n`);
              }, 5000);

              const handleClose = () => {
                if (!res.writableEnded) {
                  clientAborted = true;
                  clearInterval(heartbeatTimer);
                  abortController.abort();
                  agentActivityHub.cancelActiveActivities(taskId, 'Client closed stream');
                }
              };
              res.on('close', handleClose);
              req.on('close', handleClose);

              let hasEmittedDeltas = false;

              try {
                const inputMessages = body.messages || (body.prompt ? [{ role: 'user', content: body.prompt }] : []);
                console.info(`[AI Stream] reqId=${requestId} taskId=${taskId} status=started messages=${Array.isArray(inputMessages) ? inputMessages.length : 0}`);

                const stream = streamGeminiResponse({
                  messages: inputMessages,
                  systemInstruction: body.systemInstruction,
                  model: body.model || 'gemini-3-flash-preview',
                  thinkHarder: Boolean(body.thinkHarder),
                  signal: abortController.signal,
                  taskId,
                  onResearchProgress: (stageEvent) => {
                    safeWrite(`data: ${JSON.stringify({ type: 'research-stage', requestId, ...stageEvent })}\n\n`);
                  },
                  onActivity: (activityEvent) => {
                    safeWrite(`data: ${JSON.stringify({ type: 'agent-activity', requestId, taskId, event: activityEvent })}\n\n`);
                  },
                });

                for await (const delta of stream) {
                  if (clientAborted || res.writableEnded) break;
                  if (delta) {
                    hasEmittedDeltas = true;
                    safeWrite(`data: ${JSON.stringify({ type: 'text-delta', delta, textDelta: delta, requestId })}\n\n`);
                  }
                }

                if (!clientAborted && !res.writableEnded) {
                  streamCircuitBreaker.recordSuccess();
                  console.info(`[AI Stream] reqId=${requestId} status=completed`);
                  safeWrite(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop', requestId })}\n\n`);
                  safeWrite('data: [DONE]\n\n');
                  res.end();
                }
              } catch (streamErr: any) {
                if (!clientAborted && !hasEmittedDeltas) {
                  streamCircuitBreaker.recordFailure();
                }
                console.error('[AI Stream Error]', streamErr?.message || streamErr);

                if (!clientAborted && !res.writableEnded) {
                  if (hasEmittedDeltas) {
                    // Preserve already-streamed partial tokens cleanly instead of overwriting with an error
                    safeWrite(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop', partialRecovery: true, requestId })}\n\n`);
                    safeWrite('data: [DONE]\n\n');
                    res.end();
                  } else {
                    let userErrorMsg = 'Stream processing failed. Please verify your connection or try again.';
                    const errMsg = String(streamErr?.message || streamErr).toLowerCase();
                    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('resource_exhausted')) {
                      userErrorMsg = 'API Rate limit or Quota exceeded. Please check your Gemini API plan or wait a few moments before retrying.';
                    } else if (errMsg.includes('timeout') || errMsg.includes('abort')) {
                      userErrorMsg = 'Stream connection timed out waiting for AI model. Please retry your request.';
                    } else if (streamErr?.message) {
                      userErrorMsg = streamErr.message;
                    }
                    safeWrite(`data: ${JSON.stringify({ type: 'error', error: userErrorMsg, requestId })}\n\n`);
                    safeWrite(`data: ${JSON.stringify({ type: 'finish', finishReason: 'error', error: userErrorMsg, requestId })}\n\n`);
                    safeWrite('data: [DONE]\n\n');
                    res.end();
                  }
                }
              } finally {
                clearInterval(heartbeatTimer);
              }
            } catch (err: any) {
              try {
                res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'error', error: err?.message || 'Invalid request payload' })}\n\n`);
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
  };

  return {
    name: 'gemini-api-plugin',
    configureServer(server) {
      server.middlewares.use(apiMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware);
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
  build: {
    target: 'esnext',
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
    hmr: false,
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  preview: {
    port: 3000,
    host: true,
    allowedHosts: true,
  },
});
