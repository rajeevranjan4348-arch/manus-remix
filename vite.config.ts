import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { streamGeminiResponse } from './server/geminiService';

function geminiApiPlugin(): Plugin {
  return {
    name: 'gemini-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        if (req.method === 'POST' && (url === '/api/gemini/stream' || url === '/api/ai/stream' || url === '/api/ai/agent')) {
          let bodyStr = '';
          req.on('data', chunk => {
            bodyStr += chunk;
          });

          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');

              const stream = streamGeminiResponse({
                messages: body.messages || (body.prompt ? [{ role: 'user', content: body.prompt }] : []),
                systemInstruction: body.systemInstruction,
                model: body.model || 'gemini-2.5-flash',
                thinkHarder: Boolean(body.thinkHarder),
              });

              for await (const delta of stream) {
                res.write(`data: ${JSON.stringify({ type: 'text-delta', delta })}\n\n`);
              }

              res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            } catch (err: any) {
              console.error('[Gemini API Error]', err);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err?.message || 'Gemini API Error' }));
              } else {
                res.write(`data: ${JSON.stringify({ type: 'error', error: err?.message || 'Gemini API Error' })}\n\n`);
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