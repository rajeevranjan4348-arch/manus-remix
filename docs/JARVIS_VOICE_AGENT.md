# Jarvis Voice Agent

## Included

- Adds a dedicated phone-call button beside the existing dictation microphone in the chat composer. It opens the existing full-screen voice conversation experience without replacing the chat UI.
- Recognizes `Hey Manus` as a wake phrase during an active voice session. A wake-only utterance receives a short acknowledgement; text after the wake phrase is sent as the user's request.
- Keeps the selected Manus voice persona and speech rate settings, with `marcus` as the fallback persona. Actual voice availability and perceived depth depend on the speech voices installed by the user's browser or operating system.
- Keeps spoken-interruption enabled by default and leaves recognition running when the browser supports simultaneous speech recognition and synthesis. Mobile browsers may serialize those APIs; in that case recognition restarts when the browser ends its current recognition session.
- Persists user and assistant turns through the existing voice-task persistence flow so the transcript is available in Manus task/history storage. The transcript overlay can also send a conversation summary into the normal chat flow.

## Permission and privacy

Microphone permission is requested only when the user opens the voice conversation. Closing the modal stops recognition and speech playback. The wake phrase is not an always-on background listener; the user must open a voice session first. This avoids unexpectedly capturing audio while the app is idle.

## Browser limitations

The Web Speech API is not consistently available across browsers, and wake phrase detection is software speech recognition rather than a dedicated on-device keyword model. Speech recognition and text-to-speech can conflict on some Android/browser combinations. For production-grade always-on wake detection and consistently low-latency interruption, integrate a streaming speech service or native Android foreground service with explicit opt-in and a visible microphone indicator.

## Validation status

The change is committed on `feat/jarvis-voice-agent`. Build, browser microphone permissions, real-time voice interruption, and Android device behavior must be verified in CI and on a real device before claiming production readiness.
