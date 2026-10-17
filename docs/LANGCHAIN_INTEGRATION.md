# LangChain source and Manus Remix integration

This integration combines the three requested approaches without duplicating the upstream monorepo into the production frontend:

1. **Full upstream source (linked):** vendor/langchain is a Git submodule pinned to an upstream commit. Initialize it with git submodule update --init --recursive when cloning Manus Remix. The source remains independently versioned and includes the full upstream repository at the pinned revision.
2. **Project-owned integration code:** netlify/functions/langchain_agent.py and netlify/functions/requirements.txt provide a small, separately maintained adapter. This is the code Manus owns and deploys; it is not a copied fork of all upstream files.
3. **Runtime integration:** POST /api/langchain/* is routed to the Netlify function. Send JSON with a prompt field. Configure OPENAI_API_KEY as a server-side Netlify environment variable and optionally set LANGCHAIN_MODEL (default openai:gpt-4.1-mini). Never place the key in frontend code or commit it to Git.

## Important boundaries

- The existing React/Vite UI and current AI endpoints are left intact; this adds a separate opt-in endpoint.
- The endpoint uses LangChain's Python package, not LangChain.js. It requires a Netlify Python-function runtime capable of installing netlify/functions/requirements.txt; verify this in the actual deployment environment before enabling it for users.
- The new endpoint is not automatically substituted for the existing agent workflow. Connect it to useAgentTask only after API behavior, auth/rate limits, streaming needs, and deployment tests have been verified.
- The full upstream source is included as a submodule rather than duplicated as a second full copy. A second physical copy would bloat the repository and make upstream updates harder; the pinned submodule provides the complete source tree without that duplication.
- This integration currently returns a single JSON response, not SSE streaming, and does not implement user authentication or rate limiting. Add those controls before production exposure.

## Local checks

- npm ci && npm run build
- Verify Python dependency installation and import in Netlify's build/runtime environment.
- With server-side credentials configured, POST a non-empty prompt to /api/langchain/ and verify a JSON text response.
- Confirm existing /api/ai/* and /api/gemini/* endpoints still route to the original agent function.
