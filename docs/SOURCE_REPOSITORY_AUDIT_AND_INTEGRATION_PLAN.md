# Source Repository Audit and Integration Plan

Target: `rajeevranjan4348-arch/manus-remix` (`main`)

## Integration rules
- Preserve the existing Manus Remix UI. Do not import or replace source-project UI.
- Integrate capabilities as server-side services, agents, tools, APIs, or connectors.
- Keep secrets server-side; validate inputs and provider output; use timeouts and bounded payloads.
- A source repository's README or file presence is not proof of production readiness. Test each integration before describing it as working.
- Review each source repository's license before copying code. Prefer documented APIs/MCP/bridges when appropriate.

## Initial target-code findings

| Capability | Current evidence | Status / next step |
|---|---|---|
| Agent response | `netlify/functions/agent.ts` streams Gemini responses over SSE | Existing; tool dispatch remains incomplete |
| Web search | `netlify/functions/web-search.ts` supports Firecrawl and an Agent Reach bridge | Implemented adapter; credentials and live endpoint need runtime verification |
| World Monitor | `server/worldmonitor/client.ts` supports MCP `tools/list` and `tools/call` | Client scaffold; authenticated, schema-validated chat dispatch still needed |
| Public APIs | `src/lib/publicApiProviders.ts` lists representative providers across categories | Directory only; not proof that all providers are live |
| Google Workspace | `src/lib/workspaceTools.ts` contains Calendar, Gmail, Drive, Docs, Sheets and other actions | Existing browser-side tools; confirm OAuth state and require confirmation for writes |
| Android | AndroidEnv sidecar and Scrcpy bridge files exist | Integration surfaces present; device, permission and authorization tests required |
| Memory | `src/lib/agentMemory.ts` stores explicit memories in browser localStorage | Local browser memory; not cross-device durable memory |
| Image generation | Gemini SDK is already a server dependency | Natural-language image routing added in this change; live provider access and UI rendering still require deployment verification |
| Voice and permissions | Permission/audio/voice modules exist | Must verify real-device permissions, cancellation and track cleanup |
| Authentication persistence | Existing auth flow has recently changed | Re-test cold restart, token refresh and sign-out on supported clients |

## Source repository inventory (initial; not a full code audit)

| Repository | Candidate capability to investigate | Integration guardrail |
|---|---|---|
| `Science-` | Development/template tooling | Do not import its UI scaffold |
| `ultron-by-sagar-builds` | Vision/hand-tracking experiments | Do not copy its 3D/orb UI; require explicit camera permission |
| `MiniMax-H` / `MiniMax-H3` | Model/provider ecosystem | Use a supported remote API; do not copy model weights into the app |
| `ruflo` | Agent orchestration, tools and memory | Inspect APIs, dependency footprint and license before adopting |
| `opendroid` | Android planning and action orchestration | Require native bridge, explicit permissions and confirmation for consequential actions |
| `worldmonitor` | Real-time intelligence/news tools | Prefer hosted MCP/API; review AGPL implications before copying source |
| `Scrapling` | Web extraction/scraping | Respect robots/terms, domain allowlists, timeouts and response limits |
| `deepseek-harness` | Plugin-based model/agent harness | Check project maturity and compatibility before adoption |
| `gods-eye-view` | Further source review required | No capability assumed until source is inspected |
| `rakazo` | Further source review required | No capability assumed until source is inspected |
| `Agent-Reach` | Multi-source internet/data retrieval | Connect via the existing authenticated bridge; never execute arbitrary fetched commands |
| `Ul8` | AI Studio/Vite starter | Template overlap; avoid replacing target UI |
| `openmuse` | Browser/files/terminal agent patterns | Gate filesystem and terminal operations; no unapproved destructive actions |
| `hermes-agent` | Persistent memory, skills, multi-provider and scheduling patterns | Port only selected compatible backend concepts; review dependencies and license |
| `grok-app` | Coding/workbench and session workflow patterns | Do not copy its UI; inspect reusable backend contracts separately |
| `Earbuds-` | Voice-first and Android bridge patterns | Validate actual implementation; require platform permissions and secure bridge auth |

## Acceptance criteria before declaring completion
1. No UI/layout/theme files changed for backend-only integrations.
2. All tool names and arguments are allowlisted/schema-validated; unknown tools are rejected.
3. Every external request has timeout, bounded response size, safe URL validation and sanitized errors.
4. Secrets remain in server-side environment variables; never use `VITE_*` for secrets.
5. Side-effecting Workspace, Android, filesystem and GitHub actions require authorization and confirmation.
6. Image generation and other provider-dependent features fail honestly when provider access is unavailable.
7. Run `npm run lint`, `npm run build`, focused tests and Netlify smoke tests; report only checks that actually passed.
8. Complete source-by-source code/license review before porting implementation from any repository.

## Image-generation routing added
Explicit prompts such as “generate an image of …” are routed server-side to the Gemini image model. Results are sent using the existing SSE text-delta contract as Markdown, so no UI component or source-project UI is introduced. The deployed Gemini account must support the image model; actual deployment/browser rendering must still be tested.
