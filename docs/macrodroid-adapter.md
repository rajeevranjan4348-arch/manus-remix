# MacroDroid adapter setup (optional)

MacroDroid runs locally on an Android phone. It is separate from the Google DeepMind `android_env` Python environment and from the Netlify gateway.

## Safe starter macro

Create a macro in MacroDroid manually using these high-level steps:

1. Choose a trigger you explicitly control (for example, a home-screen shortcut or a notification action). Avoid always-on triggers until the workflow is tested.
2. Add a confirmation dialog showing the exact action to be performed.
3. Add only the required action, such as opening a selected app or showing a notification. Do not begin with call, message-send, payment, or accessibility-wide actions.
4. Add a clear cancellation path and a visible result notification.
5. Test with harmless actions first; check Android permission prompts and battery/background restrictions.

Do not put Firebase service-account JSON, bridge tokens, or other server secrets into a MacroDroid macro. Do not expose ADB over the internet. This guide is setup guidance only: no macro has been installed on the user's phone by the repository commit.
