# Vane-inspired research integration

Manus Remix now has a Vane-inspired research subsystem adapted to its Vite + Netlify Functions architecture.

## What is included

- Research intent classification for web, academic, and discussion queries.
- Parallel searches through the existing Firecrawl and optional Agent Reach HTTP bridge credentials.
- Normalized, deduplicated source records with URL validation and bounded snippets.
- A structured research endpoint at \`POST /api/vane-research\`.
- Enrichment of the existing AI agent's live/research-query context. Existing Gemini grounding and OpenRouter fallback remain in place.

## Why this is not a full Vane source-tree copy

Vane's Next.js routes, in-memory EventEmitter sessions, SQLite/Drizzle chat store, and Docker-managed SearXNG runtime are not portable to Netlify Functions without separate runtime and persistence work. This adapter keeps Manus's UI, task lifecycle, provider selection, and conversation persistence intact.

## Endpoint

Request:

\`\`\`json
{ "query": "Compare recent research on local language models", "mode": "academic", "limit": 5 }
\`\`\`

Modes: \`web\`, \`academic\`, \`discussion\`. Mode is classification metadata and may be passed to an Agent Reach bridge; Firecrawl currently searches its configured web source.

Response includes \`query\`, \`mode\`, \`sources\` (title, URL, snippet, provider), \`providers\`, \`warnings\`, and \`configured\`.

## Environment

Uses existing server-only variables:

- \`FIRECRAWL_API_KEY\`
- \`AGENT_REACH_BRIDGE_URL\` (optional)
- \`AGENT_REACH_BRIDGE_TOKEN\` (optional)

Never expose these credentials to the browser. Configure them in Netlify environment variables.

## Verification

Run \`npm ci\`, \`npm run lint\`, \`npm test\`, and \`npm run build\`. Test missing credentials, malformed JSON, invalid mode, empty results, provider timeout, and current-query citation behavior. No UI components or database schema are changed by this integration.
