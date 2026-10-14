# Security Specification & Adversarial Test Suite

## 1. Data Invariants
- **Authentication & Verification**: Any write operation requires an authenticated user with `request.auth.uid != null`.
- **Identity Invariant (isOwner)**:
  - Users may only create, read, update, and delete their own user profile document (`/users/{userId}` where `userId == request.auth.uid`).
  - Users may only create, read, update, and delete their own settings (`/users/{userId}/settings/{settingsId}` where `userId == request.auth.uid`).
  - Projects (`/projects/{projectId}`) can only be created with `userId == request.auth.uid` and can only be read, updated, or deleted by the project owner.
  - Conversations (`/conversations/{conversationId}`) can only be created with `userId == request.auth.uid` and can only be read, updated, or deleted by the conversation owner.
  - Messages (`/conversations/{conversationId}/messages/{messageId}`) can only be written by the conversation owner where `userId == request.auth.uid` and the parent conversation exists and belongs to the user.
- **Immutability Invariant**:
  - `id` and `userId` fields cannot be altered on update (`incoming().id == existing().id && incoming().userId == existing().userId`).
  - `createdAt` / `created_at` fields cannot be altered after creation.
- **Terminal State Guard**:
  - When a conversation status is `'completed'`, only allowed updates (or owner actions) apply, preventing arbitrary state tampering.
- **Resource Boundary Limits**:
  - All IDs must match `^[a-zA-Z0-9_\-]+$` and length `<= 128`.
  - All string sizes are strictly bound.

---

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing - Impersonate Another User's Profile)**:
   - Target: `/users/victim_user_123`
   - Actor: `attacker_uid`
   - Payload: `{"id": "victim_user_123", "email": "victim@example.com", "displayName": "Victim"}`
   - Expected: `PERMISSION_DENIED`

2. **Payload 2 (Ghost Field Injection - Shadow Field Attack on User Profile)**:
   - Target: `/users/attacker_uid`
   - Actor: `attacker_uid`
   - Payload: `{"id": "attacker_uid", "email": "attacker@example.com", "isAdmin": true, "superUser": true}`
   - Expected: `PERMISSION_DENIED`

3. **Payload 3 (Unauthenticated Read on User Profiles)**:
   - Target: `/users/victim_user_123`
   - Actor: `unauthenticated`
   - Expected: `PERMISSION_DENIED`

4. **Payload 4 (Identity Theft on Project Creation)**:
   - Target: `/projects/project_malicious_1`
   - Actor: `attacker_uid`
   - Payload: `{"id": "project_malicious_1", "userId": "victim_user_123", "name": "Stolen Project", "created_at": "2026-10-12T00:00:00Z", "updated_at": "2026-10-12T00:00:00Z"}`
   - Expected: `PERMISSION_DENIED`

5. **Payload 5 (Cross-Tenant Project Snooping / Read Leak)**:
   - Target: `/projects/victim_project_999` (owned by `victim_user_123`)
   - Actor: `attacker_uid`
   - Action: `get` or `list`
   - Expected: `PERMISSION_DENIED`

6. **Payload 6 (Owner Tampering on Project Update)**:
   - Target: `/projects/attacker_project_1`
   - Actor: `attacker_uid`
   - Payload: `{"userId": "another_user_456"}` (modifying immutable `userId`)
   - Expected: `PERMISSION_DENIED`

7. **Payload 7 (Massive String Resource Exhaustion / Denial of Wallet)**:
   - Target: `/projects/project_oversized_1`
   - Actor: `attacker_uid`
   - Payload: `{"id": "project_oversized_1", "userId": "attacker_uid", "name": "A".repeat(10000), "created_at": "...", "updated_at": "..."}`
   - Expected: `PERMISSION_DENIED`

8. **Payload 8 (Foreign Conversation Read / Session Hijacking)**:
   - Target: `/conversations/victim_conversation_777` (owned by `victim_user_123`)
   - Actor: `attacker_uid`
   - Action: `get`
   - Expected: `PERMISSION_DENIED`

9. **Payload 9 (Orphaned / Unauthorized Message Injection into Foreign Chat)**:
   - Target: `/conversations/victim_conversation_777/messages/msg_rogue_1`
   - Actor: `attacker_uid`
   - Payload: `{"id": "msg_rogue_1", "conversationId": "victim_conversation_777", "userId": "attacker_uid", "role": "user", "content": "Rogue injection", "timestamp": "...", "status": "success"}`
   - Expected: `PERMISSION_DENIED`

10. **Payload 10 (Path Traversal / Malicious ID Injection)**:
    - Target: `/conversations/../../../system_config/secrets`
    - Actor: `attacker_uid`
    - Expected: `PERMISSION_DENIED`

11. **Payload 11 (Invalid Status Enum Tampering)**:
    - Target: `/conversations/conv_123`
    - Actor: `attacker_uid`
    - Payload: `{"status": "hacked_status_bypassed"}`
    - Expected: `PERMISSION_DENIED`

12. **Payload 12 (Blanket Collection Query Scraping)**:
    - Target: `/conversations`
    - Actor: `attacker_uid`
    - Query: `db.collection('conversations')` without user filter
    - Expected: `PERMISSION_DENIED`
