# Voice, persistence, permissions and live-data integration

This phase keeps the existing Manus Remix UI and visual styles intact. The existing IndexedDB/local fallback remains the local conversation store; task recovery reconstructs missing messages from saved task metadata. This is browser/device persistence, not cross-device cloud sync.

## Voice
- The existing microphone controls use the browser SpeechRecognition API after a user gesture.
- Browser/OS permission prompts remain authoritative. No hidden/background microphone recording is attempted.
- Chat-view voice submissions mark the next response for speech playback using the browser's SpeechSynthesis API. Browser speech recognition and voice availability vary by device.

## Live search, news, weather and sources
- The existing Netlify agent uses Gemini Google Search grounding for changing facts and emits returned grounding URLs as Markdown source links.
- IRIS bridge supports current weather, Google Search grounded answers, GitHub public repository lookups, optional Maps Places, and multimodal file analysis.
- Set `GEMINI_API_KEY` on Netlify; set `GOOGLE_MAPS_API_KEY` only if Maps is needed.

## Authorization and phone commands
- `POST /api/secure-tools` requires a Firebase ID token in `Authorization: Bearer ...`, verified server-side via Firebase Identity Toolkit.
- Configure `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID` and a high-entropy `TOOL_APPROVAL_SECRET` as Netlify server environment variables. Enable Firestore and permit a signed-in user to create only their own `toolApprovals` records; test the rules before enabling commands. The API uses a Firestore create precondition to reject replayed approval tokens. Never use `VITE_*` for server secrets.
- `request-approval` issues a short-lived, user-bound HMAC approval token for an allowlisted command. `execute-approved` requires `approved: true` and validates token signature, expiry, command and user identity.
- This API only returns an approved command plan. It does not control Android directly. A native companion must revalidate the plan and ask for/obey Android OS permissions before opening apps or changing device settings. Background wake-word listening, arbitrary taps/swipes, AccessibilityService and persistent background work are native-only and must be opt-in.

## Authentication and persistence boundaries
- The existing Blink guest fallback is not a verified Firebase identity and cannot authorize secure device actions.
- IndexedDB/localStorage preserve history on the same browser profile. Cross-device persistent history requires a real authenticated database and user-scoped server rules; do not claim cloud sync until that is configured.
