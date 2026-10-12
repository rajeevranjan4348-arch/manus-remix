# Android app (Capacitor)

This repository now has a Capacitor Android wrapper configuration and an automated debug-APK build workflow. The web UI remains the same; Android is a native WebView shell around the built app.

## Build an APK in GitHub Actions

1. Open the repository's **Actions** tab.
2. Run **Build Android APK**, or push a change to `main`.
3. Download the `manus-remix-debug-apk` artifact from a successful run.
4. Install the debug APK on your Android phone. Android may ask you to allow installation from the browser/file manager you used.

The APK is a debug build for testing, not a Play Store release. A signed release needs a private signing key stored as GitHub Actions secrets; never commit signing keys.

## Build locally

Use Node.js 20.19+ (or a newer supported LTS), Java 21, and Android SDK / platform tools.

```bash
npm install
npm run android:add
npm run android:sync
npm run android:debug
```

The debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Permissions and actions

The Android build workflow declares Android manifest permissions for camera, microphone, location, and notifications. Android and WebView still require runtime permission prompts; declaring a manifest permission does not grant it automatically. The user must approve access in Android's permission dialog and may revoke it later.

- Camera and microphone should only be requested when the user activates the related feature. Web camera/microphone use requires HTTPS in deployed web builds and a WebView permission handler that grants only the requested resource after Android permission approval.
- Location should be requested only when a location feature is used.
- Files should use Android's file picker / Storage Access Framework so the user chooses what to share; broad storage access is not requested.
- Native app/device actions are not automatically available to an AI model just because the APK exists. Each action needs an explicit native bridge, permission checks, user-visible confirmation for sensitive/destructive actions, and a safe allowlist. This wrapper does not grant silent access to other apps, messages, contacts, or arbitrary phone controls.

## Backend requirement

Capacitor packages the frontend, not the server. Any AI/API endpoint must be reachable from the phone over HTTPS and must not depend on Vite's development-only middleware or localhost. Keep provider API keys on a trusted backend, never in the APK or frontend bundle.
