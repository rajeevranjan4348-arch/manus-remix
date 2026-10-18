/**
 * Standalone production server for Manus AI Agent Clone.
 * Serves the built frontend from dist/ AND handles /api/* routes
 * (fixes HTTP 404 on chat when running `vite preview` or any static host).
 *
 * Usage: node server/standalone.mjs   (env: PORT, GEMINI_API_KEY, OPENROUTER_API_KEY)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './apiMiddleware.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.normalize(path.join(DIST, urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  // SPA fallback: unknown non-file paths serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const idx = path.join(urlPath.replace(/\/$/, ''), 'index.html');
    filePath = path.normalize(path.join(DIST, idx));
    if (!fs.existsSync(filePath)) filePath = path.join(DIST, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Did you run `npm run build`?');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (ext === '.html') headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleApiRequest(req, res);
    if (!handled) serveStatic(req, res);
  } catch (err) {
    console.error('[Server] Unhandled error:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Manus Standalone] Serving dist/ + /api/* on http://0.0.0.0:${PORT}`);
  console.log(`[Manus Standalone] Gemini key configured: ${Boolean(process.env.GEMINI_API_KEY)} | OpenRouter key configured: ${Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS)}`);
});
