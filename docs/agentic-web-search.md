# Agentic web search integration

Manus Remix can combine two complementary projects without replacing its existing chat UI:

- **Firecrawl** (`firecrawl/firecrawl`): hosted Search API for web results. Configure `FIRECRAWL_API_KEY` in Netlify.
- **Agent Reach** (`Panniantong/Agent-Reach`): a Python/CLI toolkit for connecting agents to multiple sources. It is not automatically a hosted HTTP endpoint. Deploy it separately with an HTTP bridge and set `AGENT_REACH_BRIDGE_URL`; optionally protect the bridge with `AGENT_REACH_BRIDGE_TOKEN`.

## Endpoint

`POST /.netlify/functions/web-search` (also available as `/api/web-search` after Netlify redirects).

Request:
```json
{"query":"latest AI agent framework releases","limit":5}
```

Response:
```json
{"query":"latest AI agent framework releases","results":[{"title":"Example","url":"https://example.com/article","snippet":"Search result summary","source":"firecrawl"}],"providers":["firecrawl"]}
```

The Agent Reach bridge accepts `POST { "query": string, "limit": number }` and returns `{ "results": [{ "title": string, "url": string, "snippet": string }] }`. Use HTTPS for remote bridges. The function validates result URLs and deduplicates results.

## Netlify configuration

Set secrets in Netlify → Site configuration → Environment variables. Never use `VITE_*` prefixes for secrets.

- `FIRECRAWL_API_KEY` — optional Firecrawl API key.
- `AGENT_REACH_BRIDGE_URL` — optional URL of your separately deployed Agent Reach HTTP bridge.
- `AGENT_REACH_BRIDGE_TOKEN` — optional bearer token shared with that bridge.

At least one provider must be configured. This adapter does not change existing UI. To make chat automatically search, call `/api/web-search` from the existing agent orchestration when a question needs fresh information, then pass returned snippets/URLs to the model and render citations. Treat page content as untrusted source data, never as instructions.