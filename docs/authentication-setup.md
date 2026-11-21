# Authentication setup

This app reuses Firebase Authentication. The frontend never stores passwords; Firebase manages credential hashing, ID tokens, refresh, and session persistence. Browser Google sign-in uses Firebase’s Google provider. Android uses Google Credential Manager through the Capacitor social-login bridge, then exchanges the returned Google ID token for a Firebase credential.

## Firebase project settings

In the Firebase project used by `firebase-applet-config.json`:

1. Enable **Email/Password** and **Google** under Authentication → Sign-in method.
2. Add every deployed web hostname to Authentication → Settings → Authorized domains. Firebase blocks OAuth callbacks from unlisted domains.
3. Set the Firebase password policy to require at least 8 characters so the policy is enforced by the service as well as by the app form.
4. Review the email verification and password reset templates. The app requests the Firebase-hosted action flow and supplies `/login` as the continue URL.
5. Keep the existing `oAuthClientId` equal to the Google OAuth **Web application** client ID for this Firebase project. It is a public client identifier, not a client secret. Never put an OAuth client secret in the app, source tree, or APK.

## Android Google sign-in

The Capacitor Android project is generated during the APK workflow. The native sign-in bridge uses the `webClientId` in `firebase-applet-config.json` and only includes the Google provider.

Before testing a real Android APK, register the Android application ID `com.rajeevranjan.manusremix` in the same Firebase/Google Cloud project, enable Google sign-in, and add the SHA-1 certificate fingerprints for the debug and release signing certificates to the Android OAuth client. Use the Web client ID from the Firebase config as the server/web client ID for the Credential Manager flow. Re-sync/regenerate the Android project after plugin or OAuth configuration changes:

```bash
npm install
npm run android:add
npm run android:sync
npm run android:debug
```

This checkout does not contain a generated `android/` directory or signing certificate, so the SHA-1 fingerprints and a real APK sign-in test must be completed with the generated build/signing configuration. Do not commit signing keys or client secrets.

## Verification checklist

- Confirm a new email/password account sends a verification email and remains on the verification screen until confirmed.
- Confirm an existing account can sign in, choose whether the session persists after restart, and sign out.
- Confirm reset links work, then verify that the Firebase action page returns to `/login`.
- Test Google sign-in from a deployed, authorized web origin and from the generated Android APK.
- Check desktop and narrow mobile layouts in both light and dark themes.
- Use a Firebase Auth emulator or dedicated test project for automated integration tests; do not test by creating accounts in a production user database.
