# Mem0 long-term memory (Manus Remix)

Manus Remix can retrieve relevant memories before generating a response and queue the current user/assistant exchange for memory extraction after the response completes.

## Configure

In Netlify site environment variables, set:

- `MEM0_API_KEY`: Mem0 Platform API key (server-side only; never use a `VITE_*` prefix).
- `FIREBASE_WEB_API_KEY`: Firebase Web API key used by the server to verify the signed-in user's ID token via Identity Toolkit.

The feature is intentionally best-effort. If either value is missing, the chat keeps working without Mem0. Existing UI and SSE response events are unchanged.

## Privacy and isolation

- Memory is enabled only when the request carries a valid Firebase ID token and the server verifies it.
- The memory owner ID comes only from Firebase's verified `localId`; client-supplied user IDs are ignored.
- Search filters by the verified user's ID, and writes use the same ID, preventing one signed-in user from retrieving another user's memories.
- Only the current user turn and its generated answer are sent to Mem0 for extraction; the entire conversation transcript is not uploaded on every turn.
- Mem0 API credentials stay in Netlify server environment variables.
- Mem0 processing may be asynchronous, so a just-saved fact may not appear in the next immediate search.
- Long-term memory is not a perfect transcript archive. Keep using the existing Chat/Work history persistence for exact messages and artifacts.
- Avoid saving passwords, authentication tokens, payment details, or other secrets in chat.

## API

Uses Mem0 Platform REST endpoints:
- `POST https://api.mem0.ai/v3/memories/search/`
- `POST https://api.mem0.ai/v3/memories/add/`

Official docs: https://docs.mem0.ai/api-reference
