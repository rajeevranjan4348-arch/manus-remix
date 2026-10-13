# Manus Remix: AI Studio Bug-Fix Prompt

Paste this prompt into Google AI Studio Build mode with the existing Manus Remix project open.

---

Act as a senior React/TypeScript, AI streaming, Netlify Functions, and QA engineer. Fix the real runtime bug shown in the supplied screen recording in the existing Manus Remix app. The user sends a simple factual question (example: “Who is Prime Minister of India and who is Anuradha Paudwal?”), but no answer appears while “Manus is typing…” remains stuck and the Manus header/status text overlaps.

## Non-negotiable constraints
- Diagnose the actual root cause before editing; trace the send handler → task/agent hook → AI provider/request → response parsing → message state/rendering.
- Preserve existing UI, layout, colors, fonts, icons, robot/orb, animations, history, connectors, and responsive behavior. Only fix the overlapping status text where needed.
- Do not replace real AI calls with mocks, hard-coded answers, fake progress, or placeholder responses.
- Do not delete unrelated code or weaken auth/security.
- Keep Netlify deployment compatibility and secrets server-side.

## Required fixes
1. Reproduce the bug with a plain factual prompt and inspect browser console, network request/response, Netlify function logs, and the actual error payload.
2. Verify that the chat submit handler invokes the intended AI path exactly once and that the submitted user message is added to the active conversation.
3. Verify provider configuration and model mapping. Check environment variables and endpoint routing without exposing secret values. If the request fails, surface a useful user-facing error instead of silently staying in a typing state.
4. Audit stream/SSE handling if used: content-type, event framing, chunk parsing, completion/error events, reader cancellation, aborted requests, and empty-stream handling. If the app uses the agent SDK rather than SSE for this path, fix the SDK callback/state path instead of adding a second competing request.
5. Ensure the assistant response is appended to the *same active conversation* and is rendered in the normal message list. Avoid relying only on a task result panel if chat messages are the visible UI.
6. Guarantee every request terminates its loading/typing state on success, provider error, malformed payload, network failure, timeout, and user cancellation. Use `try/catch/finally`, request IDs or cancellation guards where appropriate, and prevent stale requests from overwriting a newer conversation.
7. Prevent duplicate sends and duplicate assistant messages, but do not deduplicate legitimate identical answers from separate user turns.
8. Fix the header/status layout so “Manus” and “Manus is typing…” cannot overlap at narrow mobile widths. Preserve the existing design and make status text wrap/truncate safely.
9. Keep stop/cancel functional. A stopped request must not later overwrite the current result or leave the UI loading.
10. Do not report success when the provider returns empty content. Show a clear retryable error and log a sanitized diagnostic identifier.

## Tests and acceptance criteria
- Plain prompt returns visible assistant text in the conversation.
- Follow-up prompt uses the correct current conversation and latest context.
- Provider 4xx/5xx, missing server key, offline/network failure, malformed response, empty response, and cancellation all stop the typing indicator and show a useful error.
- A slow previous request cannot overwrite a newer chat.
- No duplicate messages, no stuck loading state, no console errors.
- Mobile header has no overlapping text.
- Run the project's existing lint/typecheck/build/tests; fix regressions. Do not claim checks passed unless actually run.
- Review the final diff and summarize root cause, files changed, tests run, and any required environment setup.

Implement the fix in the existing codebase, not just this prompt. Do not stop after writing a plan.