# Security audit and remediation tracker

Repository: `rajeevranjan4348-arch/manus-remix`

This document records a code-level review of selected files. It is not a penetration test and does not certify the application as secure. Items must remain open until the relevant implementation and tests are verified.

## Confirmed observations

- `src/lib/blink.ts`: a browser-side fallback emits simulated terminal/tool calls and success messages instead of executing real work. Remove or clearly isolate this demo fallback before treating tool results as trusted.
- `src/lib/blink.ts`: a default mock user identity is present. It must never be used to authorize server-side access to private data.
- `src/lib/chatDatabase.ts`: chat persistence uses IndexedDB/localStorage fallback. Browser storage is user-controlled and is not a trusted authorization boundary.
- `netlify/functions/agent.ts`: a server-side `GEMINI_API_KEY` is used, but the reviewed excerpt does not demonstrate authentication, strict request validation, request-size limits, or per-user/IP rate limiting.
- `src/lib/workspaceAuth.ts`: the Google OAuth provider requests broad Workspace scopes, including Gmail and Drive. Scope minimization and action-specific consent are required.
- `src/lib/workspaceTools.ts`: connector calls send OAuth access tokens from the browser and include upstream response text in thrown errors. Errors should be safely normalized, and high-impact actions should require explicit confirmation.
- `src/db/schema.ts`: messages reference conversations, but ownership checks and row-level policies are not represented in this schema file. Database schema alone cannot enforce authorization.
- `src/components/agent/MarkdownRenderer.tsx`: ReactMarkdown is used without raw-HTML support in this component, which is a safer default; verify all other renderers and URL/link handling too.
- `firebase-applet-config.json`: client Firebase configuration is public-facing configuration, not a substitute for Firebase Authentication, Firestore/Storage Security Rules, API restrictions, or least-privilege OAuth consent.

## Baseline hardening added in this branch

- Netlify response headers for MIME sniffing, framing, referrer policy, browser permissions, and HSTS.
- `Cache-Control: no-store` for Netlify function responses.
- CI checks for leaked secrets, dependency advisories, frozen-lockfile installation, type checking, and production build.

## Required remediation — not yet verified as implemented

1. Move any privileged tool execution behind authenticated server-side endpoints; remove fake-success fallbacks.
2. Validate Firebase ID tokens on every private endpoint and derive the user ID only from verified claims.
3. Enforce ownership checks for every chat, file, memory, project, and connector operation; add database row-level policies where supported.
4. Add strict Zod schemas, bounded request bodies, per-user/IP rate limits, and distributed limits for multi-instance deployment.
5. Add CSRF protections for cookie-authenticated mutations; configure explicit trusted origins and credentials-safe CORS.
6. Add upload signature/size validation, private storage, malware scanning where available, and authorization checks on downloads.
7. Add SSRF-safe URL fetching with redirect and DNS/IP validation.
8. Add prompt-injection boundaries, tool argument validation, least-privilege tool capabilities, and confirmation for consequential actions.
9. Minimize Google OAuth scopes; validate state/PKCE where applicable, protect refresh tokens server-side, and support revocation.
10. Verify Firebase rules, database credentials/SSL, encryption/backup policies, retention/deletion controls, log redaction, and restore procedures.
11. Add automated negative tests for cross-user access, auth bypass, XSS, CSRF, uploads, rate limits, injection, and tool authorization.
12. Add a tested CSP only after validating Firebase, Google sign-in, maps, streaming, and required external integrations. A guessed restrictive CSP can break existing functionality.

## Environment/configuration checklist

- `GEMINI_API_KEY`: server-side Netlify environment variable only.
- `FIRECRAWL_API_KEY`, `AGENT_REACH_BRIDGE_URL`, `AGENT_REACH_BRIDGE_TOKEN`: server-side only if those integrations are enabled.
- `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`: server-side database settings; use TLS and least-privilege credentials where supported.
- Configure Firebase Authentication and Firestore/Storage Security Rules in Firebase Console. Rules cannot be safely inferred from this repository's client configuration.

Do not mark any item complete solely because it is listed here. Re-run CI and perform endpoint-level negative tests before production deployment.
