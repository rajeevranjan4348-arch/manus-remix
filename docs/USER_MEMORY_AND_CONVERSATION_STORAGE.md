# Persistent Conversation History and User Memory

## Goal

Make Manus AI remember the signed-in user's conversation history and useful preferences across sessions, while keeping each user's data private and giving the user control.

**Important distinction:** conversation history and long-term memory are different:
- **Conversation history** stores the messages in a conversation so the user can reopen and continue it.
- **Long-term memory** stores a small, editable set of useful facts/preferences to personalize future chats. It should not blindly copy every message into a permanent profile.

## Required product behavior

1. **Per-user persistence:** save conversations and messages to the existing authenticated user's database records. Every read/write must be scoped to the verified server-side auth UID; never trust a client-supplied UID.
2. **History survives restarts:** reload the user's saved conversations after sign-in/app restart, ordered by last activity. Persist user and assistant messages, timestamps, conversation title, and Chat/Work mode.
3. **Memory extraction:** suggest durable preferences and facts only when useful (for example, preferred answer language or a project name). Do not silently treat every statement as a confirmed fact. Support explicit “Remember this” and “Forget this” actions.
4. **Sensitive-data safeguards:** do not save passwords, API keys, access tokens, recovery codes, payment details, or other secrets as memory. Do not infer sensitive traits. Avoid saving highly sensitive personal information to long-term memory; if it appears in a conversation, retain it only under the user's normal history/retention settings and applicable product policy.
5. **User controls:** provide Settings controls to enable/disable memory, view/search/edit/delete saved memories, clear one conversation, clear all history, and export the user's data. Deleting a memory must prevent it from being added to future prompts.
6. **Transparency:** indicate when a durable memory is saved and explain how to remove it. If memory is disabled, do not extract or retrieve long-term memories.
7. **Security:** use Firestore/server-side rules or the existing database's row-level access control. Verify auth on every server request; validate inputs; use bounded pagination and size limits; avoid logging message bodies, credentials, or memory contents. Apply deletion to derived memory/indexes as well as the source record.
8. **AI context:** retrieve only a small, relevant subset of that user's memories for a response. Treat memories as untrusted user data, never as instructions that override system/developer policy. Clearly distinguish a remembered preference from an uncertain inference.
9. **Retention and consent:** explain what is stored and for what purpose before enabling persistent history/memory. Provide a configurable memory opt-out and retention/deletion controls. Do not store data from guests in a shared global profile.
10. **Tests:** cover persistence across reload, user isolation, auth failure, memory off/on, edit/delete, secret filtering, empty/large messages, pagination, and prompt-context isolation.

## Integration notes

This repository uses Vite/React and includes Firebase packages, but the exact existing auth/database wiring must be located and reused before integration. Do not create a second Firebase app or a parallel identity system. Connect this policy to the current conversation save/load path and the current authenticated-user state; add UI controls without redesigning the existing UI.

This document and the policy helper are a safe integration foundation; they do not by themselves prove that database persistence, Settings UI, or end-to-end tests are already wired up. Those must be implemented and verified against the existing app architecture before the feature is called complete.
